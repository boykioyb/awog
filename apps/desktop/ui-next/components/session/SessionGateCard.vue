<template>
  <!-- Thẻ gate/trạng thái: bề mặt card, viền mảnh, bo lg, hàng tiêu đề medium, hàng
       nút căn phải. Tone thẻ (chờ / production / lỗi) tra qua CARD_CLASS + HEAD_CLASS. -->
  <!-- plan -->
  <div
    v-if="block.kind === 'plan'"
    class="my-1 flex flex-col gap-0.5 rounded-lg border p-3"
    :class="CARD_CLASS[planStatus === 'pending' ? 'gate' : '']"
  >
    <div
      class="mb-2 flex items-center gap-2 text-base leading-4.5 font-medium [&_svg]:size-3.5"
      :class="HEAD_CLASS[planStatus === 'pending' ? 'gate' : '']"
    >
      <Icon name="rules" />
      {{ t('sessions.gate.plan') }}
    </div>
    <!-- Thân plan = markdown của model render như một tài liệu (SessionTextBlock). -->
    <SessionTextBlock class="mb-1.5" :text="planMarkdown" />
    <div v-if="planStatus === 'pending'" class="mt-2.5 flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" @click="onPlanEdit">
        {{ t('sessions.gate.planEdit') }}
      </Button>
      <Button size="sm" @click="onPlanRun">
        <Icon name="check" />
        {{ t('sessions.gate.planRun') }}
      </Button>
    </div>
    <div
      v-else
      class="mt-1.5 flex items-center gap-2 text-base leading-4.5 [&_svg]:size-3.5 text-success"
    >
      <Icon name="check" />
      {{ t('sessions.gate.planApproved') }}
    </div>
  </div>

  <!-- question → form riêng: 3 dạng câu hỏi + ô ghi chú + 3 lối kết thúc không còn
       vừa trong thẻ gộp này (SessionQuestionForm.vue). -->
  <SessionQuestionForm v-else-if="block.kind === 'question'" :block="block" />

  <!-- perm -->
  <!-- Lệnh hạ tầng nhuộm ĐỎ thay vì hổ phách khi chạm tài khoản production (ADR 0088
       §5): hai tone loại trừ nhau (permCardTone), không bao giờ cùng lúc. -->
  <div
    v-else-if="block.kind === 'perm'"
    class="my-1 flex flex-col gap-0.5 rounded-lg border p-3"
    :class="CARD_CLASS[permCardTone]"
  >
    <!-- Lệnh hạ tầng: tiêu đề là nút thu/mở cả thẻ. Thu gọn còn MỘT hàng — chip
         production + lớp lệnh, dòng lệnh cắt một dòng, trạng thái — vì thẻ đã duyệt
         nằm mãi trong transcript và chiếm cả màn hình. Thẻ đang chờ vẫn giữ nút
         Từ chối/Cho phép khi thu gọn (xem `showBody`). Giữ chữ/màu của hàng tiêu đề
         (kể cả đỏ/hổ phách khi đang chờ), chỉ bỏ chrome của nút. -->
    <Button
      v-if="infra"
      variant="ghost"
      class="h-auto w-full min-w-0 justify-start gap-2 p-0 text-left text-base leading-4.5 font-medium hover:bg-transparent [&_svg]:size-3.5"
      :class="[HEAD_CLASS[permCardTone], infraOpen ? 'mb-2' : 'mb-0']"
      :aria-expanded="infraOpen"
      :title="infraOpen ? t('infraGate.collapse') : t('infraGate.expand')"
      @click="infraOpen = !infraOpen"
    >
      <Icon name="globe" class="shrink-0" />
      <span class="shrink-0">{{ t('infraGate.title') }}</span>
      <template v-if="!infraOpen">
        <Badge
          v-for="chip in headChips"
          :key="chip.key"
          variant="outline"
          class="inline-block shrink-0 truncate rounded-sm px-2 py-0.5 text-xs leading-4"
          :class="CHIP_TONE_CLASS[chip.tone]"
        >
          {{ chip.label }}
        </Badge>
        <!-- Dòng lệnh rút gọn: một dòng, cắt bằng …; bản đầy đủ ở thân thẻ khi mở.
             mono: dòng lệnh shell. -->
        <span class="min-w-0 flex-1 truncate font-mono text-sm font-normal text-muted-foreground">
          {{ infra.command }}
        </span>
        <span class="shrink-0 text-sm font-normal" :class="STATE_TONE_CLASS[permState.tone]">
          {{ permState.label }}
        </span>
      </template>
      <Icon
        name="chev"
        class="ml-auto shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none"
        :class="infraOpen && 'rotate-180'"
      />
    </Button>
    <div
      v-else
      class="mb-2 flex items-center gap-2 text-base leading-4.5 font-medium [&_svg]:size-3.5"
      :class="HEAD_CLASS[permCardTone]"
    >
      <Icon name="shield" />
      {{ t('sessions.gate.permission') }}
    </div>
    <!-- Hạ tầng (ADR 0088 §5): hậu quả → dòng lệnh → ngữ cảnh, đúng thứ tự người
         duyệt cần đọc. Dòng lệnh là bản ĐÃ chèn cờ ngữ cảnh của sidecar, nên nó là
         thứ sắp chạy thật chứ không phải thứ model gõ ra. Cả cụm nằm NGOÀI nhánh
         pending nên một lệnh đã duyệt vẫn tra lại được là nó chạm account nào. -->
    <template v-if="infra && infraOpen">
      <!-- Một câu: lệnh này làm gì với hạ tầng. Đọc trước dòng lệnh, vì phần lớn người
           duyệt không phân loại được `s3api delete-bucket` chỉ bằng cách nhìn. -->
      <div
        class="text-base leading-5"
        :class="
          infra.commandClass === 'destructive'
            ? 'font-semibold text-destructive'
            : 'text-foreground'
        "
      >
        {{ t(`infraGate.sentence.${infra.commandClass}`) }}
      </div>
      <!-- Dòng lệnh ĐÚNG NHƯ sắp chạy. XUỐNG DÒNG chứ không cuộn ngang: phần đuôi bị
           đẩy khỏi tầm nhìn (macOS ẩn scrollbar) tệ hơn một lệnh bị bẻ dòng — chữ vẫn
           nguyên văn nên copy ra terminal vẫn chạy đúng, và `wrap-anywhere` chỉ bẻ
           khi token không còn chỗ. mono: dòng lệnh người dùng copy vào terminal. -->
      <div
        class="mt-2 rounded-sm border bg-muted px-2.5 py-2 font-mono text-base leading-4.5 wrap-anywhere whitespace-pre-wrap text-foreground select-text"
      >
        {{ infra.command }}
      </div>
      <!-- Chip ngữ cảnh — viền mảnh + chữ muted; danger/warn nhuộm theo mức hậu quả.
           `-chdir=` dài hơn cả thẻ thì cắt bằng …, giá trị đầy đủ nằm ở `title`. -->
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Badge
          v-for="chip in infraChips"
          :key="chip.key"
          variant="outline"
          class="inline-block max-w-full shrink-0 truncate rounded-sm px-2 py-0.5 text-xs leading-4"
          :class="CHIP_TONE_CLASS[chip.tone]"
          :title="chip.label"
        >
          {{ chip.label }}
        </Badge>
      </div>
      <!-- Ba câu trước khi bấm: sẽ làm gì · kết quả mong đợi · rủi ro. Nhãn đứng
           trước để đọc lướt vẫn ra nghĩa; xem `infraBrief` cho luật dựng từng dòng.
           Mặc định THU GỌN: mỗi dòng tối đa 2 dòng chữ, rủi ro dùng bản tóm tắt, lời
           rủi ro của model ẩn; bấm "Xem chi tiết" ra bản đầy đủ. Lưới hai cột để nhãn
           thẳng hàng; cửa sổ hẹp thì tự xuống một cột. -->
      <dl
        class="mt-2 mb-0 grid grid-cols-[max-content_1fr] gap-x-2.5 gap-y-1 max-[560px]:grid-cols-1 max-[560px]:gap-0.5"
      >
        <template v-for="row in infraBrief" :key="row.label">
          <dt class="text-sm leading-4.5 whitespace-nowrap text-dim">{{ row.label }}</dt>
          <dd class="m-0 text-sm leading-4.5" :class="BRIEF_TONE_CLASS[row.tone]">
            <!-- Nhãn "model diễn giải" là sibling ĐỨNG NGOÀI phần bị cắt dòng: nó nói
                 nguồn của câu chữ, cắt mất nó là người đọc tưởng AWOG tự suy. Nhãn nhỏ,
                 không tô màu cảnh báo — nó nói NGUỒN, không nói mức nguy hiểm. -->
            <span class="flex items-start gap-1.5">
              <span class="min-w-0" :class="!briefOpen && 'line-clamp-2'">
                {{ briefOpen ? row.text : (row.short ?? row.text) }}
              </span>
              <span
                v-if="row.ai"
                class="shrink-0 rounded-full border px-1.5 text-xs leading-4 whitespace-nowrap text-faint"
                :title="t('infraGate.brief.aiWhy')"
              >
                {{ t('infraGate.brief.ai') }}
              </span>
            </span>
            <!-- Dòng RỦI RO giữ phần AWOG tự suy ở trên; lời mô hình chỉ nối thêm
                 vào đây, có nhãn, xuống dòng riêng để không đọc lẫn. Xem `infraBrief`. -->
            <span v-if="briefOpen && row.note" class="mt-0.5 block text-dim">
              {{ row.note }}
              <span
                class="ml-1.5 rounded-full border px-1.5 text-xs leading-4 whitespace-nowrap text-faint"
                :title="t('infraGate.brief.aiWhy')"
              >
                {{ t('infraGate.brief.ai') }}
              </span>
            </span>
          </dd>
        </template>
      </dl>
      <Button
        variant="ghost"
        class="mt-1 h-auto justify-start gap-1 p-0 text-sm leading-4.5 font-normal text-faint hover:bg-transparent hover:text-foreground [&_svg]:size-3"
        :aria-expanded="briefOpen"
        @click="briefOpen = !briefOpen"
      >
        <Icon
          name="chev"
          class="transition-transform motion-reduce:transition-none"
          :class="briefOpen && 'rotate-180'"
        />
        {{ briefOpen ? t('infraGate.brief.less') : t('infraGate.brief.more') }}
      </Button>
      <!-- Chỉ hiện khi đang hỏi hoặc đã hỏng: lúc bình thường ba dòng trên tự nói
           hết, thêm một dòng trạng thái nữa chỉ là nhiễu ngay trên nút Cho phép. -->
      <p v-if="explainState?.loading" class="mt-0.5 mb-0 text-sm leading-4.5 text-faint">
        {{ t('infraGate.brief.loading') }}
      </p>
      <p
        v-else-if="explainState?.failed"
        class="mt-0.5 mb-0 flex items-baseline gap-2 text-sm leading-4.5 text-faint"
        :title="explainState.error"
      >
        {{ t('infraGate.brief.failed') }}
        <Button
          variant="link"
          class="h-auto p-0 text-sm leading-4.5 font-normal underline"
          @click="onRetryExplain"
        >
          {{ t('infraGate.brief.retry') }}
        </Button>
      </p>
    </template>
    <div v-else-if="!infra" class="text-base leading-5 text-foreground">
      {{ t('sessions.gate.allowQuestion') }}
      <b>{{ block.tool }}</b>
      {{ t('sessions.gate.on') }}
      <!-- mono: lệnh shell mà lời xin quyền đang hỏi -->
      <span
        class="rounded-sm bg-muted px-1.5 py-px font-mono text-base leading-4.5 text-muted-foreground"
      >
        {{ block.target }}
      </span>
      ?
    </div>
    <template v-if="cancelled">
      <div
        v-if="showBody"
        class="mt-1.5 flex items-center gap-2 text-base leading-4.5 [&_svg]:size-3.5 text-destructive"
      >
        {{ t('sessions.gate.cancelled') }}
      </div>
    </template>
    <template v-else-if="permStatus === 'pending'">
      <!-- ADR 0080: the rule about to be created, verbatim, BEFORE the button that
           creates it. "Always allow" on `git status` grants `Bash(git status)` — not
           every Bash call — and the only way the user can know that is to read it.
           Mỗi hàng đẩy lời giải thích xuống một dòng riêng (basis-full) thay vì ép cạnh
           control. -->
      <div
        v-if="canRemember && showBody"
        class="mt-2 flex flex-wrap items-center gap-2 text-base leading-4.5 text-muted-foreground"
      >
        <span class="font-medium text-muted-foreground">{{ ruleLabel }}</span>
        <!-- mono: chuỗi luật là code người dùng có thể copy -->
        <span
          class="rounded-sm border bg-muted px-2 py-0.5 font-mono text-base leading-4.5 break-all text-foreground select-text"
        >
          {{ ruleText }}
        </span>
        <span class="basis-full text-dim">{{ ruleMeaning }}</span>
      </div>
      <!-- No rule could be derived (compound shell command…) → "Always allow" is not
           rendered at all; say why instead of leaving a dead button. Lệnh hạ tầng
           không bao giờ nhớ được, và lý do khác hẳn nên câu chữ cũng khác. -->
      <div
        v-else-if="showBody"
        class="mt-2 flex flex-wrap items-center gap-2 text-base leading-4.5 text-muted-foreground"
      >
        <Icon name="alert" class="size-3.5 shrink-0 text-warning" />
        <span>{{ infra ? t('infraGate.noRemember') : noRuleReason }}</span>
      </div>
      <div
        v-if="canRemember && showBody"
        class="mt-2 flex flex-wrap items-center gap-2 text-base leading-4.5 text-muted-foreground"
      >
        <span class="font-medium text-muted-foreground">{{ t('sessionsPerm.scopeLabel') }}</span>
        <AppSelect
          :model-value="permScope"
          :options="scopeOptions"
          width="190px"
          @update:model-value="setScope"
        />
        <span class="basis-full text-dim">{{ scopeHint }}</span>
      </div>
      <div class="mt-2.5 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" @click="onDeny">
          {{ t('sessions.gate.deny') }}
        </Button>
        <Button v-if="canRemember" variant="outline" size="sm" @click="onAllowAlways">
          {{ t('sessions.gate.allowAlways') }}
        </Button>
        <Button size="sm" @click="onAllow">
          <Icon name="check" />
          {{ t('sessions.gate.allow') }}
        </Button>
      </div>
    </template>
    <template v-else-if="permStatus === 'allowed' && showBody">
      <div
        class="mt-1.5 flex items-center gap-2 text-base leading-4.5 [&_svg]:size-3.5 text-success"
      >
        <Icon name="check" />
        {{ t('sessions.gate.allowed') }}
      </div>
      <!-- Where the rule actually landed, from the RPC's savedScopes (the engine
           downgrades project → session when the session has no project). -->
      <div
        v-if="savedMessage"
        class="mt-2 flex flex-wrap items-center gap-2 text-base leading-4.5 text-muted-foreground"
      >
        <span>{{ savedMessage }}</span>
        <span
          v-if="savedOk && ruleText"
          class="rounded-sm border bg-muted px-2 py-0.5 font-mono text-base leading-4.5 break-all text-foreground select-text"
        >
          {{ ruleText }}
        </span>
      </div>
      <div
        v-if="savedDowngraded"
        class="mt-2 flex flex-wrap items-center gap-2 text-base leading-4.5 text-muted-foreground"
      >
        <Icon name="alert" class="size-3.5 shrink-0 text-warning" />
        <span>{{ t('sessionsPerm.savedDowngraded') }}</span>
      </div>
      <!-- Kết quả lệnh vừa được duyệt, chép từ step của CHÍNH lời gọi này (xem
           attachPermResult trong store). Không có dòng này thì thẻ chỉ nói "Đã cho
           phép", còn output nằm trong khối bước mặc định thu gọn bên dưới — người
           vừa bấm Cho phép đọc ra như thể lệnh không trả về gì. Nằm SAU hàng "Đã cho
           phép" vì đó là thứ tự thời gian thật (duyệt → chạy → kết quả). -->
      <template v-if="permOutput">
        <Separator class="mt-2" />
        <div class="pt-2">
          <div class="flex items-center gap-2 text-xs font-semibold text-dim">
            <span>{{ t('sessions.step.output') }}</span>
            <!-- mono: mã thoát là chữ của máy -->
            <span v-if="permExit" class="font-mono font-medium text-destructive">
              {{ permExit }}
            </span>
          </div>
          <!-- Xuống dòng chứ không cuộn ngang — cùng lý do như dòng lệnh ở trên.
               mono: output thô của tool. -->
          <pre
            class="m-0 pt-0.5 font-mono text-base leading-4.5 wrap-anywhere whitespace-pre-wrap text-muted-foreground select-text"
            >{{ permOutput }}</pre
          >
        </div>
      </template>
    </template>
    <div
      v-else-if="permStatus === 'denied' && showBody"
      class="mt-1.5 flex items-center gap-2 text-base leading-4.5 [&_svg]:size-3.5 text-destructive"
    >
      {{ t('sessions.gate.denied') }}
    </div>
  </div>

  <!-- steer — ghi chú nghiêng trên thanh primary. -->
  <div
    v-else-if="block.kind === 'steer'"
    class="flex items-center gap-2 border-l-2 border-ring py-0.5 pl-2.5 text-base leading-4.5 text-muted-foreground italic"
  >
    <Icon name="send" class="size-3 text-primary" />
    {{ t('sessions.gate.steered', { text: block.text || '' }) }}
  </div>

  <!-- error -->
  <div
    v-else-if="block.kind === 'error'"
    class="my-1 flex flex-col gap-0.5 rounded-lg border p-3"
    :class="CARD_CLASS.err"
  >
    <div
      class="mb-2 flex items-center gap-2 text-base leading-4.5 font-medium [&_svg]:size-3.5"
      :class="HEAD_CLASS.err"
    >
      <Icon name="alert" />
      {{ t('sessions.gate.error') }}
    </div>
    <div class="text-base leading-5 text-foreground">{{ block.text }}</div>
    <div class="mt-2.5 flex items-center justify-end gap-2">
      <Button size="sm" @click="onRetry">
        <Icon name="refresh" />
        {{ t('sessions.gate.retry') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Gate / status cards (blockHtml ~1466): plan, question (delegated to
// SessionQuestionForm),
// permission, steer note, error. Wired to the sessions store: each action drives
// the real store (which in turn talks to the sidecar in IPC mode, or mutates the
// no-bridge session locally). The DISPLAY is derived from `props.block` — the store's
// own reactive object — via computeds, so the card never holds shadow status that
// can diverge from the store. Only the per-question in-progress selection
// (`forms` + the active tab) stays local UI working-state until "Submit" commits it.
// Accepts the full block union; only the gate kinds match a branch (others render
// nothing) so the parent's v-else can pass an un-narrowed AssistantBlock cleanly.
import type {
  AssistantBlock,
  InfraCommandClass,
  InfraPrompt,
  StepDetailKind,
} from '~/composables/useSessionsData'
import { useSessionPermissionRule } from '~/composables/useSessionPermissionRule'
import { useInfraExplain, type ExplainState } from '~/composables/useInfraExplain'

const props = defineProps<{ block: AssistantBlock }>()
const { t } = useI18n()
const store = useSessionsStore()

// Locate this card's (sessionId, msgIndex) from the store without new props: the
// block instance lives inside the active session's assistant message. Reactive so
// it tracks the active session. msgIndex = -1 when not found (guard before action).
const sessionId = computed<number | null>(() => store.activeId)
const msgIndex = computed<number>(
  () =>
    store.active?.msgs.findIndex(
      (m) => m.role === 'assistant' && (m.blocks as AssistantBlock[]).includes(props.block),
    ) ?? -1,
)
const located = computed<boolean>(() => sessionId.value != null && msgIndex.value >= 0)

// ── Plan ──────────────────────────────────────────────────────────────────────
// Display approved/pending straight from the block (store flips it on approve).
const planStatus = computed<'pending' | 'approved'>(() =>
  props.block.kind === 'plan' ? (props.block.status ?? 'pending') : 'pending',
)
// Render the model's own markdown when present (headers/lists/bold/code survive);
// fall back to the flattened items as a bullet list (legacy steps).
const planMarkdown = computed<string>(() => {
  if (props.block.kind !== 'plan') return ''
  if (props.block.markdown) return props.block.markdown
  return props.block.items.map((x) => `- ${x}`).join('\n')
})
const onPlanRun = (): void => {
  if (!located.value || sessionId.value == null) return
  store.approvePlan(sessionId.value, msgIndex.value)
}
const onPlanEdit = (): void => {
  // Seed the composer with the plan text so the user can refine it before re-asking.
  if (props.block.kind === 'plan') store.seedComposer(planMarkdown.value)
}

// ── Permission ────────────────────────────────────────────────────────────────
// allowed/denied/pending derived from the block (store flips it on resolve).
const permStatus = computed<'pending' | 'allowed' | 'denied'>(() =>
  props.block.kind === 'perm' ? (props.block.status ?? 'pending') : 'pending',
)
// A parked gate (question/perm) abandoned by a turn cancel → render as cancelled,
// not interactive (the store sets `cancelled` and stops counting it as awaiting).
const cancelled = computed(
  () =>
    (props.block.kind === 'question' || props.block.kind === 'perm') &&
    props.block.cancelled === true,
)
// Rule text + tier for this prompt (ADR 0080). The rule rides on the block itself
// (the store fills it from the permission-request event); the project id decides
// whether the "This project" tier is even available.
const {
  rule: ruleText,
  ruleLabel,
  ruleMeaning,
  noRuleReason,
  canAlwaysAllow,
  sessionOnly,
  scope: permScope,
  setScope,
  scopeOptions,
  scopeHint,
  savedOk,
  savedMessage,
  savedDowngraded,
  recordSave,
} = useSessionPermissionRule(
  () => (props.block.kind === 'perm' ? props.block.suggestion : undefined),
  () => store.active?.project ?? '',
)
// ── Lệnh hạ tầng (ADR 0088 §5, §6) ────────────────────────────────────────────
// Cổng quyền gửi kèm prompt duyệt một payload có cấu trúc (`decisionReason`), đã
// được validate ở biên store. Có mặt ⇒ thẻ đổi bố cục; vắng ⇒ thẻ duyệt thường,
// không nhánh nào biết gì về nhánh kia.
const infra = computed<InfraPrompt | undefined>(() =>
  props.block.kind === 'perm' ? props.block.infra : undefined,
)
const isProdInfra = computed<boolean>(() => infra.value?.accountKind === 'production')
// Thẻ đang "sáng đèn" chờ người duyệt — màu (hổ phách hay đỏ) do isProdInfra chọn.
const gateLit = computed<boolean>(() => permStatus.value === 'pending' && !cancelled.value)

// Thu/mở cả thẻ lệnh hạ tầng. Mặc định theo trạng thái LÚC MOUNT: thẻ đang chờ thì
// mở (người duyệt cần đọc), thẻ đã xong trong lịch sử thì thu. Không tự thu ngay sau
// khi bấm Cho phép — lúc đó người dùng đang chờ đọc phần Kết quả ngay trong thẻ.
const infraOpen = ref(gateLit.value)
// Thẻ thường (không phải hạ tầng) không thu được ⇒ luôn hiện đủ thân.
const showBody = computed<boolean>(() => !infra.value || infraOpen.value)
// Hàng tiêu đề khi thu gọn chỉ giữ hai chip đọc-trong-một-liếc: production + lớp lệnh.
const headChips = computed(() =>
  infraChips.value.filter((c) => c.key === 'prod' || c.key === 'class'),
)
const permState = computed<{ label: string; tone: '' | 'ok' | 'warn' }>(() => {
  if (cancelled.value) return { label: t('sessions.gate.cancelled'), tone: '' }
  if (permStatus.value === 'pending') return { label: t('sessions.status.awaiting'), tone: 'warn' }
  if (permStatus.value === 'allowed') return { label: t('sessions.gate.allowed'), tone: 'ok' }
  return { label: t('sessions.gate.denied'), tone: '' }
})

// Lệnh hạ tầng nhớ được — nhưng CHỈ trong phiên. Luật ghi xuống đĩa cho nó là dựng
// nguồn sự thật thứ hai cạnh ma trận quyền và người dùng sẽ tin nhầm cái yếu hơn
// (ADR 0088 §6); allowance sống trong bộ nhớ, chết cùng phiên, thì không. Cổng ở
// sidecar đã chỉ chào đúng dạng đó, nên điều kiện này là lưới thứ hai: một đường
// khác lỡ gửi kèm luật cho prompt hạ tầng vẫn không mọc ra nút.
const canRemember = computed<boolean>(
  () => canAlwaysAllow.value && (!infra.value || sessionOnly.value),
)

type InfraChip = { key: string; label: string; tone: '' | 'warn' | 'danger' }
// Lớp lệnh tô theo mức hậu quả, không theo mức quyền: `write` còn quay lại được,
// `destructive` thì không.
const CLASS_TONE: Record<InfraCommandClass, InfraChip['tone']> = {
  read: '',
  write: 'warn',
  destructive: 'danger',
  'context-switch': 'warn',
}
// Thứ tự ĐỌC, không phải thứ tự field: tài khoản trước vị trí, vị trí trước cụm.
const CONTEXT_FIELDS = [
  'accountId',
  'profile',
  'region',
  'context',
  'namespace',
  'workspace',
] as const

const infraChips = computed<InfraChip[]>(() => {
  const i = infra.value
  if (!i) return []
  const chips: InfraChip[] = []
  // Chip đỏ đứng đầu hàng: "lệnh này chạm production" là thứ phải đọc được trong
  // một cái liếc, trước cả lớp lệnh và tên account.
  if (i.accountKind === 'production') {
    chips.push({ key: 'prod', label: t('infraGate.chip.production'), tone: 'danger' })
  }
  chips.push({
    key: 'class',
    label: t(`infraGate.class.${i.commandClass}`),
    tone: CLASS_TONE[i.commandClass],
  })
  for (const field of CONTEXT_FIELDS) {
    const value = i[field]
    if (!value) continue
    const slot = field === 'accountId' ? 'account' : field
    chips.push({ key: field, label: t(`infraGate.chip.${slot}`, { value }), tone: '' })
  }
  if (i.reason === 'bypass') {
    chips.push({ key: 'reason', label: t('infraGate.chip.bypass'), tone: 'warn' })
  } else if (i.reason === 'session-narrowed') {
    chips.push({ key: 'reason', label: t('infraGate.chip.narrowed'), tone: '' })
  }
  return chips
})

/** Từ khoá shell — chúng đứng ở vị trí đầu đoạn nhưng không phải chương trình nào. */
const SHELL_KEYWORDS = new Set(['do', 'done', 'then', 'else', 'elif', 'fi', 'esac', 'in'])

/**
 * Cắt một chuỗi shell ở các toán tử NẰM NGOÀI dấu nháy, trả về tên những chương
 * trình thật sẽ chạy (đã khử trùng lặp ở chỗ gọi).
 *
 * Cần vì `command.split(' ')[0]` nói dối ngay khi chuỗi không phải một lệnh trần:
 * với `POD=api-8d64…; echo "…"; kubectl -n apps exec …` nó trả về phép GÁN BIẾN và
 * thẻ đi khoe `POD=api-8d64…` như thể đó là chương trình sắp chạy (lỗi thật
 * 2026-09-16).
 *
 * ⚠ PHẢI ĐẾM DẤU NHÁY, không được `split(/[;|]/)` cho gọn: chuỗi trong ảnh chụp có
 * `grep -E "^(128|129|130|131|132)"`, nên cắt mù theo `|` sẽ đẻ ra bốn "đoạn" mang
 * tên `129`, `130`, `131` và một đoạn tên `do`. Một danh sách như thế còn tệ hơn
 * cái tên sai nó vừa thay thế.
 *
 * Đây CHỈ là đường lùi khi mô hình không trả lời được: nó đếm và gọi tên, không
 * diễn giải. Nó cũng không phải một parser shell — `$(…)` lồng nhiều tầng hay
 * here-doc thì nó đếm sai, và điều đó chấp nhận được vì hậu quả xấu nhất là một
 * dòng mô tả thô, không phải một quyết định quyền sai.
 */
function shellStages(command: string): string[] {
  const segments: string[] = []
  let buf = ''
  let quote: "'" | '"' | null = null
  for (let k = 0; k < command.length; k += 1) {
    const ch = command[k] as string
    if (quote) {
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      // `&&` / `||` là một toán tử, không phải hai.
      if ((ch === '|' || ch === '&') && command[k + 1] === ch) k += 1
      segments.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  segments.push(buf)

  return segments
    .map((seg) => {
      // Bỏ phép gán env đứng trước lệnh (`FOO=bar cmd`) rồi lấy token đầu còn lại.
      const tok = seg.trim().split(/\s+/)
      let k = 0
      while (k < tok.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok[k] as string)) k += 1
      const head = tok[k] ?? ''
      // Tên chương trình bắt đầu bằng chữ cái hoặc `/`; số, `$(…)`, `"` thì không.
      if (!/^[A-Za-z/][A-Za-z0-9_./-]*$/.test(head)) return ''
      const name = head.split('/').pop() as string
      return SHELL_KEYWORDS.has(name) ? '' : name
    })
    .filter((x) => x !== '')
}

// ── Diễn giải bằng mô hình ────────────────────────────────────────────────────
// Thẻ hỏi mô hình "lệnh này làm gì" vì AWOG không có bảng ngữ nghĩa cho vài nghìn
// op của ba CLI (xem `useInfraExplain`). CHỈ hỏi cho thẻ ĐANG CHỜ: diễn giải một
// quyết định đã xong thì không ai được lợi, mà vẫn tốn một lượt gọi.
const { explain, retry: retryExplain } = useInfraExplain()
const explainState = ref<ExplainState | null>(null)

watchEffect(() => {
  const i = infra.value
  if (!i || permStatus.value !== 'pending' || cancelled.value) return
  explainState.value = explain(i, store.active?.project)
})

function onRetryExplain(): void {
  const i = infra.value
  if (!i) return
  explainState.value = retryExplain(i, store.active?.project)
}

/**
 * Ba câu trước khi bấm: SẼ LÀM GÌ · KẾT QUẢ MONG ĐỢI · RỦI RO.
 *
 * Thay cho các dòng chú thích rời rạc trước 2026-09-16 (trong đó có "Không ghim tài
 * khoản nào…", một câu đúng nhưng đọc như cước chú). Người sắp bấm Cho phép cần trả
 * lời được ba câu đó, và mấy dòng cũ chỉ trả lời câu thứ ba, một phần.
 *
 * HAI NGUỒN, VÀ RANH GIỚI GIỮA CHÚNG LÀ HÀNG RÀO chứ không phải lựa chọn hiển thị:
 *
 *   · AWOG tự suy — từ payload. Biết chắc, không bao giờ sai, nhưng chỉ nói được
 *     những gì payload chứa: lớp lệnh, tài khoản, vùng, chuỗi shell hay không.
 *   · Mô hình diễn giải — đọc chính dòng lệnh và nói nó làm gì. Dễ hiểu hơn hẳn,
 *     nhưng ĐẦU VÀO LÀ THỨ MODEL VIẾT RA, nên một chuỗi được dẫn dắt có thể tìm
 *     cách nói chuyện với người đang cầm nút Cho phép.
 *
 * Nên: hai dòng đầu để mô hình thay thế (nói sai về một op thì tệ, nhưng không
 * gỡ được hàng rào nào), còn dòng RỦI RO thì KHÔNG — phần AWOG tự suy luôn đứng
 * đó, và lời mô hình chỉ được nối THÊM vào sau, có nhãn. Mô hình được quyền làm
 * cho dễ hiểu hơn, không được quyền làm cho có vẻ an toàn hơn.
 */
type BriefRow = {
  label: string
  text: string
  tone: '' | 'warn' | 'danger'
  /** `text` đến từ mô hình ⇒ gắn nhãn, để người đọc biết cân nhắc nó khác nhau. */
  ai?: boolean
  /** Dòng phụ do mô hình viết, đứng SAU `text` (chỉ dùng ở hàng Rủi ro). */
  note?: string
  /** Bản tóm tắt hiện khi khối đang thu gọn (chỉ hàng Rủi ro — câu AWOG tự suy dài). */
  short?: string
}

// Mặc định thu gọn: thẻ duyệt sống mãi trong transcript, và ba đoạn đầy đủ (nhất là
// khi có chuỗi shell + tài khoản chưa xác minh) đẩy nút Cho phép xuống dưới màn hình.
// Bản thu gọn vẫn nói đủ ba ý — chỉ bỏ phần giải thích "vì sao".
const briefOpen = ref(false)

const infraBrief = computed<BriefRow[]>(() => {
  const i = infra.value
  if (!i) return []
  const ai = explainState.value?.result ?? null

  // ── 1. Sẽ làm gì ──
  // Mô hình đọc được cả chuỗi shell nhiều tầng; đường lùi chỉ gọi tên chương trình.
  const stages = shellStages(i.command)
  const where = [
    i.profile ? t('infraGate.chip.profile', { value: i.profile }) : '',
    i.region ? t('infraGate.chip.region', { value: i.region }) : '',
    i.context ? t('infraGate.chip.context', { value: i.context }) : '',
    i.namespace ? t('infraGate.chip.namespace', { value: i.namespace }) : '',
  ].filter((x) => x !== '')

  let derivedWhat: string
  if (stages.length > 1) {
    derivedWhat = t('infraGate.brief.whatShell', {
      n: stages.length,
      names: [...new Set(stages)].join(', '),
    })
  } else {
    const parts = i.command.trim().split(/\s+/)
    const binary = stages[0] ?? parts[0] ?? i.tool
    // `aws s3api head-bucket` ⇒ "s3api head-bucket"; `kubectl get ns` ⇒ "get ns".
    const op = parts
      .slice(1)
      .filter((x) => !x.startsWith('-'))
      .slice(0, 2)
      .join(' ')
    derivedWhat = op
      ? t('infraGate.brief.what', { binary, op })
      : t('infraGate.brief.whatBare', { binary })
    if (where.length) derivedWhat = `${derivedWhat} — ${where.join(' · ')}`
  }

  const rows: BriefRow[] = [
    {
      label: t('infraGate.brief.label.what'),
      text: ai?.what ?? derivedWhat,
      tone: '',
      ...(ai ? { ai: true } : {}),
    },
    {
      label: t('infraGate.brief.label.expect'),
      text: ai?.expect ?? t(`infraGate.brief.expect.${i.commandClass}`),
      tone: '',
      ...(ai ? { ai: true } : {}),
    },
  ]

  // ── 3. Rủi ro: ghép đúng những gì payload nói ra ──
  // Mỗi ý đi thành cặp [đầy đủ, tóm tắt]; ý nào vốn đã ngắn thì hai bản trùng nhau.
  const risks: [string, string][] = []
  // Đây là chỗ sự thật cũ của "noAccount" chuyển về — nó KHÔNG phải cước chú, nó là
  // lý do thẻ đang hiện PRODUCTION: `accountKindOf` coi account chưa biết là
  // production (fail-safe), nên người đọc phải biết badge kia đến từ đâu.
  const risk = (full: string, short: string = full): void => {
    risks.push([full, short])
  }
  if (!i.accountId)
    risk(t('infraGate.brief.risk.unknownAccount'), t('infraGate.brief.riskShort.unknownAccount'))
  else if (i.accountKind === 'production') risk(t('infraGate.brief.risk.production'))
  if (i.shell) risk(t('infraGate.brief.risk.shell'), t('infraGate.brief.riskShort.shell'))
  if (i.reason === 'bypass') risk(t('infraGate.hint.bypass'), t('infraGate.brief.riskShort.bypass'))
  else if (i.reason === 'session-narrowed')
    risk(t('infraGate.hint.narrowed'), t('infraGate.brief.riskShort.narrowed'))
  if (risks.length === 0) risk(t(`infraGate.brief.risk.${i.commandClass}`))

  rows.push({
    label: t('infraGate.brief.label.risk'),
    text: risks.map((r) => r[0]).join(' '),
    short: risks.map((r) => r[1]).join(' '),
    tone: i.commandClass === 'destructive' ? 'danger' : isProdInfra.value ? 'warn' : '',
    ...(ai ? { note: ai.risk } : {}),
  })
  return rows
})

// ── Kết quả lệnh trên thẻ đã duyệt ────────────────────────────────────────────
// Chỉ hiện kết quả DẠNG CHỮ: diff/file đã có nguyên một khối bước ngay dưới thẻ,
// chép lại vào thẻ là nhân đôi cả một file vào transcript mà không thêm gì.
const RESULT_KINDS: readonly StepDetailKind[] = ['terminal', 'text', 'list']
const permOutput = computed<string>(() => {
  const b = props.block
  if (b.kind !== 'perm' || !b.detail) return ''
  return b.detailKind == null || RESULT_KINDS.includes(b.detailKind) ? b.detail : ''
})
// Mã thoát chỉ đáng in khi KHÁC 0: dấu "✓" của lệnh thành công là nhiễu ngay cạnh
// chính output vừa hiện ra, còn `exit 254` là thứ đọc trước cả nội dung.
const permExit = computed<string>(() => {
  const r = props.block.kind === 'perm' ? props.block.result : ''
  return r && r !== '✓' ? r : ''
})

const onAllow = (): void => {
  if (!located.value || sessionId.value == null) return
  void store.setPermission(sessionId.value, msgIndex.value, 'allow')
}
// Allow + remember, in ONE call: the store answers the prompt with the chosen tier
// and hands back the tiers the sidecar actually wrote to. Everything read off the
// store (session id, message index, scope) is read BEFORE the await — the resumed
// turn may park the next prompt while this one is still in flight.
const onAllowAlways = async (): Promise<void> => {
  if (!located.value || sessionId.value == null) return
  const requested = permScope.value
  const written = await store.setPermission(
    sessionId.value,
    msgIndex.value,
    'allow',
    true,
    requested,
  )
  recordSave(requested, written)
}
const onDeny = (): void => {
  if (!located.value || sessionId.value == null) return
  void store.setPermission(sessionId.value, msgIndex.value, 'deny')
}

// ── Error ─────────────────────────────────────────────────────────────────────
const onRetry = (): void => {
  if (!located.value || sessionId.value == null) return
  store.regenerate(sessionId.value, msgIndex.value)
}

// ── Class Tailwind theo tone (thay cho `.ichip.danger` / `.ihstate.ok` / `.pbrief-txt.warn`
// và `.gcard.gate|.iprod|.err` cũ). Chỉ là bảng tra hiển thị — không có logic.
// `gate` = đang chờ quyết định (tint hổ phách); `prod` = lệnh hạ tầng đang chờ trên tài
// khoản PRODUCTION (tint đỏ); `err` = thẻ lỗi. Ba trạng thái không bao giờ trộn nhau.
type CardTone = '' | 'gate' | 'prod' | 'err'
const CARD_CLASS: Record<CardTone, string> = {
  '': 'border-border bg-card',
  gate: 'border-warning/45 bg-warning/8',
  prod: 'border-destructive/45 bg-destructive/8',
  err: 'border-destructive/45 bg-destructive/8',
}
const HEAD_CLASS: Record<CardTone, string> = {
  '': 'text-foreground',
  gate: 'text-warning',
  prod: 'text-destructive',
  err: 'text-destructive',
}
const permCardTone = computed<CardTone>(() => {
  if (!gateLit.value) return ''
  return isProdInfra.value ? 'prod' : 'gate'
})
const CHIP_TONE_CLASS: Record<InfraChip['tone'], string> = {
  '': 'text-muted-foreground',
  warn: 'border-warning/45 bg-warning/10 text-warning',
  danger: 'border-destructive/45 bg-destructive/10 font-semibold text-destructive',
}
const STATE_TONE_CLASS: Record<'' | 'ok' | 'warn', string> = {
  '': 'text-muted-foreground',
  ok: 'text-success',
  warn: 'text-warning',
}
const BRIEF_TONE_CLASS: Record<BriefRow['tone'], string> = {
  '': 'text-muted-foreground',
  warn: 'text-warning',
  danger: 'text-destructive',
}
</script>
