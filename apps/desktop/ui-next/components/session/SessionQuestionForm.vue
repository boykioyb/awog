<template>
  <!-- Thẻ câu hỏi — khung card; đang chờ trả lời (`gate`) = viền + nền hổ phách nhạt.
       `data-qhead` / `data-qbody` là móc để SessionQuestionDrawer gỡ hàng tiêu đề và
       cho thân cuộn khi thẻ nằm trong ngăn kéo. -->
  <div
    class="my-1 flex flex-col gap-0.5 rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm"
    :class="{ 'border-warning/45 bg-warning/5': !answered && !cancelled }"
  >
    <div
      data-qhead
      class="mb-1.5 flex items-center gap-2 text-base font-medium"
      :class="!answered && !cancelled ? 'text-warning' : 'text-foreground'"
    >
      <Icon name="alert" class="size-4 shrink-0" />
      {{ items.length > 1 ? t('sessions.gate.questionMulti') : t('sessions.gate.question') }}
    </div>
    <!-- Tiêu đề của cả lời gọi (`title`), trên mọi câu hỏi. -->
    <div v-if="block.title" class="mt-0.5 mb-2.5 text-lg font-semibold text-foreground">
      {{ block.title }}
    </div>

    <!-- answered → read-only record. An item CAN be answerless (decide-for-me /
         follow-up), so the record shows what was actually said, nothing more. -->
    <template v-if="answered">
      <div v-for="(it, qi) in items" :key="qi" :class="{ 'mt-3.5': qi > 0 }">
        <div class="mb-2.5 text-base leading-(--lh-prose) text-foreground">{{ it.prompt }}</div>
        <div v-if="it.answer" class="mt-1 flex items-center gap-2 text-base text-success">
          <Icon name="check" class="size-4 shrink-0" />
          {{ t('sessions.gate.chose', { answer: it.answer }) }}
        </div>
        <div v-else class="mt-1 flex items-center gap-2 text-base text-destructive">
          {{ t('sessions.gate.noAnswer') }}
        </div>
      </div>
      <!-- Chữ người dùng viết thêm, hiện lại ở bản ghi read-only. -->
      <div v-if="block.response" class="mt-2.5 text-sm leading-(--lh-prose) text-muted-foreground">
        {{ t('sessions.gate.wrote', { text: block.response }) }}
      </div>
    </template>

    <!-- cancelled by a turn abort while still parked -->
    <template v-else-if="cancelled">
      <div
        v-for="(it, qi) in items"
        :key="qi"
        class="mb-2.5 text-base leading-(--lh-prose) text-foreground"
      >
        {{ it.prompt }}
      </div>
      <div class="mt-1 flex items-center gap-2 text-base text-destructive">
        {{ t('sessions.gate.cancelled') }}
      </div>
    </template>

    <!-- interactive: one tab per question; pick → auto-advance; submit on last -->
    <template v-else>
      <!-- Body and action row are SIBLINGS, not one block: in the question drawer the
           column is short (a bottom dock can leave it a few hundred pixels), and what
           has to give there is the body — the submit row must stay on screen. A plain
           div here, styled only by the drawer. -->
      <div data-qbody>
        <Tabs
          v-if="forms.length > 1"
          :model-value="active"
          @update:model-value="(v: string | number) => (active = Number(v))"
        >
          <TabsList class="mb-3 h-auto flex-wrap justify-start gap-0.5">
            <TabsTrigger v-for="(f, qi) in forms" :key="qi" :value="qi" class="px-2.5">
              <Icon v-if="isAnswered(f)" name="check" class="text-primary" />
              {{ f.item.header || t('sessions.gate.qtab', { n: qi + 1 }) }}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <template v-for="(f, qi) in forms" :key="qi">
          <div v-if="qi === active">
            <div class="mb-2.5 text-base leading-(--lh-prose) text-foreground">
              {{ f.item.prompt }}
            </div>
            <!-- Dòng gợi ý dưới câu hỏi (`description`). -->
            <div v-if="f.item.hint" class="-mt-1 mb-2.5 text-sm text-muted-foreground">
              {{ f.item.hint }}
            </div>

            <!-- text: một ô nhập tự do, không có lựa chọn nào -->
            <div v-if="f.item.kind === 'text'" class="flex flex-col gap-2">
              <Textarea
                v-model="f.text"
                class="min-h-20 resize-y"
                :placeholder="f.item.placeholder || t('sessions.gate.textPlaceholder')"
                :maxlength="TEXT_MAX"
                @keydown.enter.meta="onEnter"
                @keydown.enter.ctrl="onEnter"
              />
              <!-- Bộ đếm ký tự (cap là của AWOG, schema không có). -->
              <div class="mt-0.5 text-right text-xs text-muted-foreground tabular-nums">
                {{ f.text.length }} / {{ TEXT_MAX }}
              </div>
            </div>

            <!-- number: thanh trượt + số đọc được, kèm đơn vị nếu model có gửi -->
            <div v-else-if="f.item.kind === 'number'" class="flex flex-col gap-2">
              <div class="flex items-center gap-3">
                <!-- raw-ok: components/ui chưa có Slider shadcn; range gốc tô màu primary -->
                <input
                  v-model.number="f.num"
                  class="min-w-0 flex-1 accent-primary"
                  type="range"
                  :min="numMin(f)"
                  :max="numMax(f)"
                  :step="f.item.step ?? 1"
                />
                <span
                  class="min-w-18 text-right text-lg font-semibold text-foreground tabular-nums"
                >
                  {{ f.num }}
                  <b v-if="f.item.unit" class="ml-0.5 text-sm font-normal text-muted-foreground">
                    {{ f.item.unit }}
                  </b>
                </span>
              </div>
              <div class="mt-0.5 flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{{ numMin(f) }}</span>
                <span>{{ numMax(f) }}</span>
              </div>
            </div>

            <!-- choice (mặc định): nhiều lựa chọn = checkbox, một lựa chọn = nút -->
            <div v-else class="flex flex-col gap-2">
              <template v-if="f.item.multi">
                <!-- Hàng nhiều lựa chọn — ô tick + nhãn; đang chọn = viền primary + wash.
                     Ô tick là span vẽ, không phải Checkbox: label bấm sẽ chuyển click
                     sang control bên trong ⇒ lật hai lần. -->
                <label
                  v-for="(o, oi) in f.item.options"
                  :key="oi"
                  class="flex cursor-pointer gap-2.5 rounded-md border px-3 py-2 text-base text-foreground transition-colors hover:border-ring motion-reduce:transition-none"
                  :class="[
                    f.sel.includes(o.label) ? 'border-primary bg-primary/10' : 'border-input',
                    o.desc ? 'items-start' : 'items-center',
                  ]"
                  @click="toggle(f, o.label)"
                >
                  <span
                    class="grid size-4 flex-none place-items-center rounded-sm border"
                    :class="[
                      f.sel.includes(o.label)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input text-transparent',
                      { 'mt-0.5': !!o.desc },
                    ]"
                  >
                    <Icon v-if="f.sel.includes(o.label)" name="check" class="size-3" />
                  </span>
                  <span class="block">
                    {{ o.label }}
                    <b v-if="o.desc" class="mt-0.5 block text-sm font-normal text-muted-foreground">
                      {{ o.desc }}
                    </b>
                  </span>
                </label>
              </template>
              <template v-else>
                <!-- Một lựa chọn — hàng viền trên nền card; đang chọn = viền primary + wash. -->
                <Button
                  v-for="(o, oi) in f.item.options"
                  :key="oi"
                  variant="outline"
                  class="h-auto flex-col items-start justify-start gap-0.5 px-3 py-2 text-left text-base font-normal whitespace-normal text-foreground shadow-none hover:border-ring motion-reduce:transition-none"
                  :class="{ 'border-primary bg-primary/10': f.sel.includes(o.label) }"
                  @click="choose(f, qi, o.label)"
                >
                  {{ o.label }}
                  <b v-if="o.desc" class="block text-sm font-normal text-muted-foreground">
                    {{ o.desc }}
                  </b>
                </Button>
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
        <div class="mt-3">
          <Label class="mb-1.5 block text-sm font-normal text-muted-foreground">
            {{ t('sessions.gate.responseLabel') }}
          </Label>
          <Input
            v-model="response"
            :placeholder="t('sessions.gate.responsePlaceholder')"
            :maxlength="TEXT_MAX"
          />
        </div>
      </div>

      <!-- Hàng nút: "bạn quyết đi" đứng riêng bên trái (lối thoát, không phải hành động
           chính), hai nút kết thúc dồn về phải. -->
      <div class="mt-1 flex items-center gap-2">
        <!-- Bỏ lượt hỏi: không trả lời câu nào, nói thẳng cho model là "bạn quyết". -->
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground"
          type="button"
          @click="onDecide"
        >
          {{ t('sessions.gate.decideForMe') }}
        </Button>
        <span class="flex-1" />
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
