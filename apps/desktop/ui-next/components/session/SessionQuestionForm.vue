<template>
  <div class="gcard" :class="{ gate: !answered && !cancelled }">
    <div class="gh">
      <Icon name="alert" class="size-4 shrink-0" />
      {{ items.length > 1 ? t('sessions.gate.questionMulti') : t('sessions.gate.question') }}
    </div>
    <div v-if="block.title" class="qtitle">{{ block.title }}</div>

    <!-- answered → read-only record. An item CAN be answerless (decide-for-me /
         follow-up), so the record shows what was actually said, nothing more. -->
    <template v-if="answered">
      <div v-for="(it, qi) in items" :key="qi" class="qitem">
        <div class="qp">{{ it.prompt }}</div>
        <div v-if="it.answer" class="resolved">
          <Icon name="check" class="size-4 shrink-0" />
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
      <!-- Body and action row are SIBLINGS, not one block: in the question drawer the
           column is short (a bottom dock can leave it a few hundred pixels), and what
           has to give there is the body — the submit row must stay on screen. A plain
           div here, styled only by the drawer. -->
      <div class="qbody">
        <div v-if="forms.length > 1" class="qtabs">
          <button
            v-for="(f, qi) in forms"
            :key="qi"
            class="qtab"
            :class="{ on: qi === active, done: isAnswered(f) }"
            @click="active = qi"
          >
            <Icon v-if="isAnswered(f)" name="check" class="size-3 shrink-0" />
            {{ f.item.header || t('sessions.gate.qtab', { n: qi + 1 }) }}
          </button>
        </div>

        <template v-for="(f, qi) in forms" :key="qi">
          <div v-if="qi === active" class="qitem">
            <div class="qp">{{ f.item.prompt }}</div>
            <div v-if="f.item.hint" class="qhint">{{ f.item.hint }}</div>

            <!-- text: một ô nhập tự do, không có lựa chọn nào -->
            <div v-if="f.item.kind === 'text'" class="qopts">
              <Textarea
                v-model="f.text"
                class="min-h-20 resize-y"
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
                    <Icon v-if="f.sel.includes(o.label)" name="check" class="size-3" />
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
              <Input
                v-model="f.other"
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
          <Input
            v-model="response"
            :placeholder="t('sessions.gate.responsePlaceholder')"
            :maxlength="TEXT_MAX"
          />
        </div>
      </div>

      <div class="cact qact">
        <!-- Bỏ lượt hỏi: không trả lời câu nào, nói thẳng cho model là "bạn quyết". -->
        <Button variant="ghost" size="sm" class="qghost" type="button" @click="onDecide">
          {{ t('sessions.gate.decideForMe') }}
        </Button>
        <span class="qspacer" />
        <!-- Xin thêm một vòng câu hỏi: gửi kèm phần đã trả lời (nếu có). -->
        <Button variant="outline" size="sm" @click="onFollowUp">
          {{ t('sessions.gate.askFollowUp') }}
        </Button>
        <Button v-if="!isLast" size="sm" :disabled="!activeAnswered" @click="active++">
          {{ t('sessions.gate.next') }}
        </Button>
        <Button v-else size="sm" :disabled="!canSubmit" @click="onSubmit">
          <Icon name="check" />
          {{ t('sessions.gate.submit') }}
        </Button>
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
/* Question card — card chrome on canonical tokens. The class names stay the
   documented hooks: `.gcard`/`.gate`/`.qopt`/`.qchk`/`.qtab` are theme-cute.css
   restyle targets AND the drawer's `:deep()` selectors look for them; the rules
   below re-express them on shadcn var names (cute's attribute-scoped rules still
   win when that theme family is active). Font sizes ride the fs/lh token scale
   so Appearance font-size scaling applies here too. */
.gcard {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-sm);
}
.gcard.gate {
  border-color: rgb(from var(--warning) r g b / 45%);
  background: rgb(from var(--warning) r g b / 6%);
}
.gcard.gate .gh {
  color: var(--warning);
}
.gh {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 500;
  color: var(--foreground);
  margin-bottom: 6px;
}
/* Resolved/cancelled one-liner (session question record). */
.resolved {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--success);
}
.resolved.den {
  color: var(--destructive);
}
/* Tiêu đề của cả lời gọi (`title`), trên mọi câu hỏi. */
.qtitle {
  margin: 2px 0 10px;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--foreground);
}
/* Câu hỏi — prose line. */
.qp {
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  margin-bottom: 10px;
  color: var(--foreground);
}
/* Dòng gợi ý dưới câu hỏi (`description`). */
.qhint {
  margin: -4px 0 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
.qitem + .qitem {
  margin-top: 14px;
}
.qopts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Single-choice option — outline row on the card surface; .on = primary edge +
   wash (proto selected-row idiom). */
.qopt {
  text-align: left;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  padding: 9px 12px;
  border: 1px solid var(--input);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--foreground);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.qopt:hover {
  border-color: var(--ring);
  background: var(--accent-wash);
}
.qopt.on {
  border-color: var(--primary);
  background: rgb(from var(--primary) r g b / 8%);
}
.qopt b {
  display: block;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 400;
  color: var(--muted-foreground);
  margin-top: 2px;
}
/* Multi-choice row — checkbox box + label; .on mirrors .qopt.on. */
.qchk {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  padding: 9px 12px;
  border: 1px solid var(--input);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--foreground);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.qchk:hover {
  border-color: var(--ring);
}
.qchk.on {
  border-color: var(--primary);
  background: rgb(from var(--primary) r g b / 8%);
}
/* Checkbox — shadcn checkbox look: input edge; checked = solid primary + white tick. */
.qchk .qcbox {
  width: 16px;
  height: 16px;
  border-radius: var(--r-xs);
  border: 1px solid var(--input);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: transparent;
}
.qchk.on .qcbox {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-foreground);
}
.qchktext {
  display: block;
}
.qchktext b {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 400;
  color: var(--muted-foreground);
}
.qchk.has-desc {
  align-items: flex-start;
}
.qchk.has-desc .qcbox {
  margin-top: 2px;
}
/* Câu hỏi 'text': bộ đếm ký tự (cap là của AWOG, schema không có). */
.qcount {
  margin-top: 2px;
  text-align: right;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
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
  accent-color: var(--primary);
}
.qnumval {
  min-width: 4.5rem;
  text-align: right;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.qnumval b {
  margin-left: 3px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 400;
  color: var(--muted-foreground);
}
.qnumends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
/* Ô ghi chú tự do cho cả lời gọi (`response`). */
.qresp {
  margin-top: 12px;
}
.qresplbl {
  display: block;
  margin-bottom: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
/* Hàng nút: "bạn quyết đi" đứng riêng bên trái (lối thoát, không phải hành động
   chính), hai nút kết thúc dồn về phải. */
.qact {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.qspacer {
  flex: 1;
}
.qghost {
  color: var(--muted-foreground);
}
.qghost:hover {
  color: var(--foreground);
}
/* Tab strip — shadcn Tabs idiom: muted track + raised active item. */
.qtabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 3px;
  margin-bottom: 12px;
  border-radius: var(--r-btn);
  background: var(--muted);
}
.qtab {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.qtab:hover {
  color: var(--foreground);
}
.qtab.on {
  background: var(--card);
  color: var(--foreground);
  box-shadow: var(--shadow-sm);
}
.qtab.done :deep(.icn) {
  color: var(--primary);
}
/* Chữ người dùng viết thêm, hiện lại ở bản ghi read-only. */
.qwrote {
  margin-top: 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--muted-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .qopt,
  .qchk,
  .qtab {
    transition: none;
  }
}
</style>
