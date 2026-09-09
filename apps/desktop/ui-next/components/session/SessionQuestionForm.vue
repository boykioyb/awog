<template>
  <div class="gcard" :class="{ gate: !answered && !cancelled }">
    <div class="gh">
      <Icon name="alert" />
      {{ items.length > 1 ? t('sessions.gate.questionMulti') : t('sessions.gate.question') }}
    </div>
    <div v-if="block.title" class="qtitle">{{ block.title }}</div>

    <!-- answered → read-only record. An item CAN be answerless (decide-for-me /
         follow-up), so the record shows what was actually said, nothing more. -->
    <template v-if="answered">
      <div v-for="(it, qi) in items" :key="qi" class="qitem">
        <div class="qp">{{ it.prompt }}</div>
        <div v-if="it.answer" class="resolved">
          <Icon name="check" />
          {{ t('sessions.gate.chose', { answer: it.answer }) }}
        </div>
        <div v-else class="resolved den">{{ t('sessions.gate.noAnswer') }}</div>
      </div>
      <div v-if="block.response" class="qwrote">
        {{ t('sessions.gate.wrote', { text: block.response }) }}
      </div>
    </template>

    <!-- cancelled by a turn abort while still parked -->
    <template v-else-if="cancelled">
      <div v-for="(it, qi) in items" :key="qi" class="qp">{{ it.prompt }}</div>
      <div class="resolved den">{{ t('sessions.gate.cancelled') }}</div>
    </template>

    <!-- interactive: one tab per question; pick → auto-advance; submit on last -->
    <template v-else>
      <div v-if="forms.length > 1" class="qtabs">
        <button
          v-for="(f, qi) in forms"
          :key="qi"
          class="qtab"
          :class="{ on: qi === active, done: isAnswered(f) }"
          @click="active = qi"
        >
          <Icon
            v-if="isAnswered(f)"
            name="check"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
          {{ f.item.header || t('sessions.gate.qtab', { n: qi + 1 }) }}
        </button>
      </div>

      <template v-for="(f, qi) in forms" :key="qi">
        <div v-if="qi === active" class="qitem">
          <div class="qp">{{ f.item.prompt }}</div>
          <div v-if="f.item.hint" class="qhint">{{ f.item.hint }}</div>

          <!-- text: một ô nhập tự do, không có lựa chọn nào -->
          <div v-if="f.item.kind === 'text'" class="qopts">
            <textarea
              v-model="f.text"
              class="qtext"
              :placeholder="f.item.placeholder || t('sessions.gate.textPlaceholder')"
              :maxlength="TEXT_MAX"
              @keydown.enter.meta="onEnter"
              @keydown.enter.ctrl="onEnter"
            />
            <div class="qcount">{{ f.text.length }} / {{ TEXT_MAX }}</div>
          </div>

          <!-- number: thanh trượt + số đọc được, kèm đơn vị nếu model có gửi -->
          <div v-else-if="f.item.kind === 'number'" class="qopts">
            <div class="qnum">
              <input
                v-model.number="f.num"
                class="qslider"
                type="range"
                :min="numMin(f)"
                :max="numMax(f)"
                :step="f.item.step ?? 1"
              />
              <span class="qnumval">
                {{ f.num }}
                <b v-if="f.item.unit">{{ f.item.unit }}</b>
              </span>
            </div>
            <div class="qnumends">
              <span>{{ numMin(f) }}</span>
              <span>{{ numMax(f) }}</span>
            </div>
          </div>

          <!-- choice (mặc định): nhiều lựa chọn = checkbox, một lựa chọn = nút -->
          <div v-else class="qopts">
            <template v-if="f.item.multi">
              <label
                v-for="(o, oi) in f.item.options"
                :key="oi"
                class="qchk"
                :class="{ on: f.sel.includes(o.label), 'has-desc': !!o.desc }"
                @click="toggle(f, o.label)"
              >
                <span class="qcbox">
                  <Icon
                    v-if="f.sel.includes(o.label)"
                    name="check"
                    style="width: var(--icon-xs); height: var(--icon-xs)"
                  />
                </span>
                <span class="qchktext">
                  {{ o.label }}
                  <b v-if="o.desc">{{ o.desc }}</b>
                </span>
              </label>
            </template>
            <template v-else>
              <button
                v-for="(o, oi) in f.item.options"
                :key="oi"
                class="qopt"
                :class="{ on: f.sel.includes(o.label) }"
                @click="choose(f, qi, o.label)"
              >
                {{ o.label }}
                <b v-if="o.desc">{{ o.desc }}</b>
              </button>
            </template>
            <!-- "Other": free-text answer, luôn có (như Claude Code). -->
            <input
              v-model="f.other"
              class="qother"
              :placeholder="t('sessions.gate.otherPlaceholder')"
              @keydown.enter="onEnter"
            />
          </div>
        </div>
      </template>

      <!-- Ô "còn gì nữa không": đi vào `response` của tool — chữ của người dùng nằm
           ngoài mọi lựa chọn, model đọc được nguyên văn. -->
      <div class="qresp">
        <label class="qresplbl">{{ t('sessions.gate.responseLabel') }}</label>
        <input
          v-model="response"
          class="qother"
          :placeholder="t('sessions.gate.responsePlaceholder')"
          :maxlength="TEXT_MAX"
        />
      </div>

      <div class="cact qact">
        <!-- Bỏ lượt hỏi: không trả lời câu nào, nói thẳng cho model là "bạn quyết". -->
        <button class="qghost" @click="onDecide">{{ t('sessions.gate.decideForMe') }}</button>
        <span class="qspacer" />
        <!-- Xin thêm một vòng câu hỏi: gửi kèm phần đã trả lời (nếu có). -->
        <button class="btn sm" @click="onFollowUp">{{ t('sessions.gate.askFollowUp') }}</button>
        <button v-if="!isLast" class="btn pri sm" :disabled="!activeAnswered" @click="active++">
          {{ t('sessions.gate.next') }}
        </button>
        <button v-else class="btn pri sm" :disabled="!canSubmit" @click="onSubmit">
          <Icon name="check" />
          {{ t('sessions.gate.submit') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Form trả lời AskUserQuestion — tách khỏi SessionGateCard vì nay nó không còn là
// "một câu hỏi trắc nghiệm": có 3 dạng câu hỏi (choice / text / number), một ô ghi
// chú tự do, và ba lối kết thúc (trả lời · xin hỏi thêm · để model tự quyết).
//
// Ba dạng câu hỏi và ba lối kết thúc đều là field CÓ SẴN trong hợp đồng của tool
// (`kind`, `response`, `followUp`) — không phải AWOG tự nghĩ ra. Xem
// docs/features/ask-user-question.md.
//
// Trạng thái đang chọn là UI thuần cho tới lúc bấm; store mới là nơi commit.
import { computed, ref } from 'vue'
import type { QuestionBlock, QuestionItem } from '~/composables/useSessionsData'
import { questionAnswered } from '~/composables/useSessionsData'

const props = defineProps<{ block: QuestionBlock }>()
const { t } = useI18n()
const store = useSessionsStore()

// Cap ô tự do: đủ cho một đoạn giải thích, không đủ để nhét cả file vào context.
const TEXT_MAX = 1000

const items = computed<QuestionItem[]>(() => props.block.items)
const answered = computed<boolean>(() => questionAnswered(props.block))
const cancelled = computed<boolean>(() => props.block.cancelled === true)

// Vị trí (sessionId, msgIndex) của thẻ này, suy từ store — block là chính object
// trong message của phiên đang mở.
const sessionId = computed<number | null>(() => store.activeId)
const msgIndex = computed<number>(
  () =>
    store.active?.msgs.findIndex((m) => m.role === 'assistant' && m.blocks.includes(props.block)) ??
    -1,
)
const located = computed<boolean>(() => sessionId.value != null && msgIndex.value >= 0)

// Một QForm cho mỗi câu hỏi: lựa chọn + "Other" (choice), chữ (text), số (number).
type QForm = { item: QuestionItem; sel: string[]; other: string; text: string; num: number }
const numMin = (f: QForm): number => f.item.min ?? 0
const numMax = (f: QForm): number => f.item.max ?? 100
const forms = ref<QForm[]>(
  items.value.map((item) => ({
    item,
    sel: [],
    other: '',
    text: '',
    // Câu hỏi số LUÔN có sẵn một giá trị (defaultValue, hoặc min) — nên nó không bao
    // giờ là câu "chưa trả lời", đúng như một thanh trượt ngoài đời.
    num: item.defaultValue ?? item.min ?? 0,
  })),
)
const response = ref('')
const active = ref(0)

const isAnswered = (f: QForm): boolean => {
  if (f.item.kind === 'number') return true
  if (f.item.kind === 'text') return f.text.trim().length > 0
  return f.sel.length > 0 || f.other.trim().length > 0
}
const isLast = computed<boolean>(() => active.value >= forms.value.length - 1)
const activeAnswered = computed<boolean>(() => {
  const f = forms.value[active.value]
  return !!f && isAnswered(f)
})
const canSubmit = computed<boolean>(() => forms.value.every(isAnswered))

const choose = (f: QForm, qi: number, label: string): void => {
  f.sel = [label] // single-select: replace
  if (qi < forms.value.length - 1) active.value = qi + 1 // auto-advance
}
const toggle = (f: QForm, label: string): void => {
  const i = f.sel.indexOf(label)
  if (i === -1) f.sel.push(label)
  else f.sel.splice(i, 1)
}
const onEnter = (): void => {
  if (isLast.value) onSubmit()
  else if (activeAnswered.value) active.value += 1
}

// Một câu hỏi → một đáp án: nhãn đã chọn (+ "Other"), hoặc chữ, hoặc số.
const answerOf = (f: QForm): string[] => {
  if (f.item.kind === 'text') {
    const v = f.text.trim()
    return v ? [v] : []
  }
  if (f.item.kind === 'number') return [String(f.num)]
  const selected = [...f.sel]
  const extra = f.other.trim()
  if (extra) selected.push(extra)
  return selected
}
const collect = (onlyAnswered = false): { header: string; selected: string[] }[] =>
  forms.value
    .filter((f) => !onlyAnswered || isAnswered(f))
    .map((f) => ({ header: f.item.header ?? '', selected: answerOf(f) }))
    .filter((a) => a.selected.length > 0)

const send = (
  answers: { header: string; selected: string[] }[],
  opts?: { response?: string; followUp?: boolean },
): void => {
  if (!located.value || sessionId.value == null) return
  store.answerQuestion(sessionId.value, msgIndex.value, answers, opts)
}

const onSubmit = (): void => {
  if (!canSubmit.value) return
  send(collect(), response.value.trim() ? { response: response.value.trim() } : undefined)
}
// Xin thêm một vòng: gửi phần đã trả lời (có thể rỗng) + cờ followUp. Model được
// yêu cầu hỏi tiếp chứ không bắt tay vào việc.
const onFollowUp = (): void => {
  send(collect(true), {
    followUp: true,
    ...(response.value.trim() ? { response: response.value.trim() } : {}),
  })
}
// "Bạn quyết đi": không đáp án nào cả, và nói rõ ý đó bằng chữ để model không đọc
// nhầm thành "người dùng bỏ ngang".
const onDecide = (): void => {
  const own = response.value.trim()
  const note = 'Decide for me — use your best judgment and continue.'
  send([], { response: own ? `${own}\n\n${note}` : note })
}
</script>

<style scoped>
/* Tiêu đề của cả lời gọi (`title`), trên mọi câu hỏi. */
.qtitle {
  margin: 2px 0 10px;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--text);
}
/* Dòng gợi ý dưới câu hỏi (`description`). */
.qhint {
  margin: -4px 0 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
/* Selected single-select option mirrors the multi-select .qchk.on accent. */
.qopt.on {
  border-color: var(--accent);
}
.qchktext {
  display: block;
}
.qchktext b {
  display: block;
  margin-top: 3px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 400;
  color: var(--textDim);
}
.qchk.has-desc {
  align-items: flex-start;
}
.qchk.has-desc .qcbox {
  margin-top: 2px;
}
.qitem + .qitem {
  margin-top: 14px;
}
/* Câu hỏi 'text': ô nhiều dòng + bộ đếm ký tự (cap là của AWOG, schema không có). */
.qtext {
  width: 100%;
  min-height: 5rem;
  resize: vertical;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput, transparent);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-family: inherit;
}
.qtext:focus {
  outline: none;
  border-color: var(--accent);
}
.qcount {
  margin-top: 4px;
  text-align: right;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
/* Câu hỏi 'number': thanh trượt + số hiện tại. */
.qnum {
  display: flex;
  align-items: center;
  gap: 12px;
}
.qslider {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.qnumval {
  min-width: 4.5rem;
  text-align: right;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.qnumval b {
  margin-left: 3px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 400;
  color: var(--textDim);
}
.qnumends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
/* Ô ghi chú tự do cho cả lời gọi (`response`). */
.qresp {
  margin-top: 12px;
}
.qresplbl {
  display: block;
  margin-bottom: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
/* Hàng nút: "bạn quyết đi" đứng riêng bên trái (lối thoát, không phải hành động
   chính), hai nút kết thúc dồn về phải. */
.qact {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qspacer {
  flex: 1;
}
.qghost {
  padding: 5px 2px;
  border: none;
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.qghost:hover {
  color: var(--text);
  text-decoration: underline;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* Tab strip — one tab per question. */
.qtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 11px;
}
.qtab {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 500;
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.qtab:hover {
  border-color: var(--accent);
  color: var(--text);
}
.qtab.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.qtab.done :deep(.icn) {
  color: var(--accent);
}
/* Chữ người dùng viết thêm, hiện lại ở bản ghi read-only. */
.qwrote {
  margin-top: 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
</style>
