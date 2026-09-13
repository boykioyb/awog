<template>
  <!-- plan -->
  <div v-if="block.kind === 'plan'" class="gcard" :class="{ gate: planStatus === 'pending' }">
    <div class="gh">
      <Icon name="rules" />
      {{ t('sessions.gate.plan') }}
    </div>
    <SessionTextBlock class="planbody" :text="planMarkdown" />
    <div v-if="planStatus === 'pending'" class="cact">
      <button class="btn sm" @click="onPlanEdit">{{ t('sessions.gate.planEdit') }}</button>
      <button class="btn pri sm" @click="onPlanRun">
        <Icon name="check" />
        {{ t('sessions.gate.planRun') }}
      </button>
    </div>
    <div v-else class="resolved">
      <Icon name="check" />
      {{ t('sessions.gate.planApproved') }}
    </div>
  </div>

  <!-- question → form riêng: 3 dạng câu hỏi + ô ghi chú + 3 lối kết thúc không còn
       vừa trong thẻ gộp này (SessionQuestionForm.vue). -->
  <SessionQuestionForm v-else-if="block.kind === 'question'" :block="block" />

  <!-- perm -->
  <!-- Lệnh hạ tầng nhuộm ĐỎ thay vì hổ phách khi chạm tài khoản production (ADR 0088
       §5): hai lớp không cùng lúc, nếu không thì `.gcard.gate` của prototype.css và
       luật đỏ ở đây tranh nhau đúng một thuộc tính và thắng thua phụ thuộc thứ tự
       chèn style — thứ không ai đọc code đoán được. -->
  <div
    v-else-if="block.kind === 'perm'"
    class="gcard"
    :class="{ gate: gateLit && !isProdInfra, iprod: gateLit && isProdInfra }"
  >
    <div class="gh">
      <Icon :name="infra ? 'globe' : 'shield'" />
      {{ infra ? t('infraGate.title') : t('sessions.gate.permission') }}
    </div>
    <!-- Hạ tầng (ADR 0088 §5): hậu quả → dòng lệnh → ngữ cảnh, đúng thứ tự người
         duyệt cần đọc. Dòng lệnh là bản ĐÃ chèn cờ ngữ cảnh của sidecar, nên nó là
         thứ sắp chạy thật chứ không phải thứ model gõ ra. Cả cụm nằm NGOÀI nhánh
         pending nên một lệnh đã duyệt vẫn tra lại được là nó chạm account nào. -->
    <template v-if="infra">
      <div class="isent" :class="{ hot: infra.commandClass === 'destructive' }">
        {{ t(`infraGate.sentence.${infra.commandClass}`) }}
      </div>
      <div class="icmd">{{ infra.command }}</div>
      <div class="ichips">
        <span
          v-for="chip in infraChips"
          :key="chip.key"
          class="chip"
          :class="chip.tone"
          :title="chip.label"
        >
          {{ chip.label }}
        </span>
      </div>
      <div v-for="note in infraNotes" :key="note" class="pnote">
        <Icon name="alert" />
        <span>{{ note }}</span>
      </div>
    </template>
    <div v-else>
      {{ t('sessions.gate.allowQuestion') }}
      <b>{{ block.tool }}</b>
      {{ t('sessions.gate.on') }}
      <span class="permcode">{{ block.target }}</span>
      ?
    </div>
    <div v-if="cancelled" class="resolved den">{{ t('sessions.gate.cancelled') }}</div>
    <template v-else-if="permStatus === 'pending'">
      <!-- ADR 0080: the rule about to be created, verbatim, BEFORE the button that
           creates it. "Always allow" on `git status` grants `Bash(git status)` — not
           every Bash call — and the only way the user can know that is to read it. -->
      <div v-if="canRemember" class="prule">
        <span class="prulelbl">{{ t('sessionsPerm.ruleLabel') }}</span>
        <span class="prulecode">{{ ruleText }}</span>
        <span class="prulehint">{{ ruleMeaning }}</span>
      </div>
      <!-- No rule could be derived (compound shell command…) → "Always allow" is not
           rendered at all; say why instead of leaving a dead button. Lệnh hạ tầng
           không bao giờ nhớ được, và lý do khác hẳn nên câu chữ cũng khác. -->
      <div v-else class="pnote">
        <Icon name="alert" />
        <span>{{ infra ? t('infraGate.noRemember') : noRuleReason }}</span>
      </div>
      <div v-if="canRemember" class="pscope">
        <span class="prulelbl">{{ t('sessionsPerm.scopeLabel') }}</span>
        <AppSelect
          :model-value="permScope"
          :options="scopeOptions"
          width="190px"
          @update:model-value="setScope"
        />
        <span class="prulehint">{{ scopeHint }}</span>
      </div>
      <div class="cact">
        <button class="btn sm" @click="onDeny">{{ t('sessions.gate.deny') }}</button>
        <button v-if="canRemember" class="btn sm" @click="onAllowAlways">
          {{ t('sessions.gate.allowAlways') }}
        </button>
        <button class="btn pri sm" @click="onAllow">
          <Icon name="check" />
          {{ t('sessions.gate.allow') }}
        </button>
      </div>
    </template>
    <template v-else-if="permStatus === 'allowed'">
      <div class="resolved">
        <Icon name="check" />
        {{ t('sessions.gate.allowed') }}
      </div>
      <!-- Where the rule actually landed, from the RPC's savedScopes (the engine
           downgrades project → session when the session has no project). -->
      <div v-if="savedMessage" class="psaved">
        <span>{{ savedMessage }}</span>
        <span v-if="savedOk && ruleText" class="prulecode">{{ ruleText }}</span>
      </div>
      <div v-if="savedDowngraded" class="pnote">
        <Icon name="alert" />
        <span>{{ t('sessionsPerm.savedDowngraded') }}</span>
      </div>
    </template>
    <div v-else class="resolved den">{{ t('sessions.gate.denied') }}</div>
  </div>

  <!-- steer -->
  <div v-else-if="block.kind === 'steer'" class="steernote">
    <Icon name="send" style="width: var(--icon-xs); height: var(--icon-xs)" />
    {{ t('sessions.gate.steered', { text: block.text || '' }) }}
  </div>

  <!-- error -->
  <div v-else-if="block.kind === 'error'" class="gcard err">
    <div class="gh">
      <Icon name="alert" />
      {{ t('sessions.gate.error') }}
    </div>
    <div style="font-size: var(--fs-md); line-height: var(--lh-md)">{{ block.text }}</div>
    <div class="cact">
      <button class="btn pri sm" @click="onRetry">
        <Icon name="refresh" />
        {{ t('sessions.gate.retry') }}
      </button>
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
import type { AssistantBlock, InfraCommandClass, InfraPrompt } from '~/composables/useSessionsData'
import { useSessionPermissionRule } from '~/composables/useSessionPermissionRule'

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
// Render the model's own markdown when present (headers/lists/bold survive);
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
  ruleMeaning,
  noRuleReason,
  canAlwaysAllow,
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

// KHÔNG có nút "Always allow" cho lệnh hạ tầng: nhớ được một lệnh là dựng nguồn sự
// thật thứ hai cạnh ma trận quyền, và người dùng sẽ tin nhầm cái yếu hơn (ADR 0088
// §6). Cổng ở sidecar đã không chào luật nào (`offerAlwaysAllow: false`) nên hôm nay
// `canAlwaysAllow` vốn đã false; điều kiện này giữ cho nút không bao giờ mọc lại nếu
// một đường khác lỡ gửi kèm suggestion — bấm vào nó sẽ không có tác dụng gì.
const canRemember = computed<boolean>(() => canAlwaysAllow.value && !infra.value)

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
const hasInfraContext = computed<boolean>(() =>
  CONTEXT_FIELDS.some((f) => Boolean(infra.value?.[f])),
)

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

// Vì sao đang bị hỏi (hoặc vì sao lần sau sẽ không bị hỏi), và cảnh báo khi lời gọi
// không ghim tài khoản nào — lúc đó CLI tự giải lấy, và `default` rất thường là
// production.
const infraNotes = computed<string[]>(() => {
  const i = infra.value
  if (!i) return []
  const notes: string[] = []
  if (!hasInfraContext.value) notes.push(t('infraGate.noAccount'))
  if (i.reason === 'bypass') notes.push(t('infraGate.hint.bypass'))
  else if (i.reason === 'session-narrowed') notes.push(t('infraGate.hint.narrowed'))
  return notes
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
</script>

<style scoped>
/* Plan body = the model's markdown rendered as a document (SessionTextBlock).
   Replaces the old flat <ul> so headers/nested lists/bold/code survive. Breathing
   room from the approve/edit row (.cact mt:12) and the approved confirmation. */
.planbody {
  margin-bottom: 6px;
}
/* Submit stays disabled until every question has an answer. */
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* ── Permission rule preview + tier picker (ADR 0080) ────────────────────────
   Both rows sit between the "allow X on Y?" line and the action row, so the rule
   and its reach are read BEFORE the buttons. Each row wraps its explanation onto
   a line of its own (.prulehint) instead of squeezing it beside the control. */
.prule,
.pscope,
.psaved,
.pnote {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.prulelbl {
  font-weight: 550;
  color: var(--textMuted);
}
.prulehint {
  flex: 1 1 100%;
  color: var(--textDim);
}
/* The verbatim rule string — `Bash(git status)` — the user reads before granting it. */
.prulecode {
  font-family: var(--code); /* mono-ok: a rule string is code the user can copy */
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  background: var(--bgActive);
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 2px 7px;
  color: var(--text);
  user-select: text;
  word-break: break-all;
}
.pnote :deep(.icn) {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--amber);
  flex: 0 0 auto;
}
.psaved {
  margin-top: 7px;
}
/* ── Lệnh hạ tầng (ADR 0088 §5) ──────────────────────────────────────────────
   Thẻ đỏ thay cho thẻ hổ phách khi account là production. Hai lớp loại trừ nhau ở
   template nên ở đây không phải đua specificity với `.gcard.gate`. */
.gcard.iprod {
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
}
.gcard.iprod .gh {
  color: var(--danger);
}
/* Một câu: lệnh này làm gì với hạ tầng. Đọc trước dòng lệnh, vì phần lớn người
   duyệt không phân loại được `s3api delete-bucket` chỉ bằng cách nhìn. */
.isent {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.isent.hot {
  font-weight: 650;
  color: var(--danger);
}
/* Dòng lệnh ĐÚNG NHƯ sắp chạy. Cuộn ngang chứ KHÔNG xuống dòng: một lệnh bị bẻ
   dòng đọc ra thành nhiều lệnh, và `--profile prod` rơi xuống dòng dưới là đúng
   chi tiết mà người duyệt cần thấy dính liền với lệnh. */
.icmd {
  margin-top: 9px;
  padding: 7px 10px;
  font-family: var(--code); /* mono-ok: dòng lệnh người dùng copy vào terminal */
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  background: var(--bgActive);
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  white-space: pre;
  overflow-x: auto;
  user-select: text;
}
.ichips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}
/* Một `-chdir=` dài hơn cả thẻ thì cắt bằng ellipsis, không đẩy ngang cả hàng —
   giá trị đầy đủ nằm ở `title`. `inline-block` chứ không `inline-flex` (mặc định
   của `.chip`) vì text-overflow chỉ ăn trên hộp khối; chip ở đây thuần chữ nên
   không mất gì. */
.ichips .chip {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ichips .chip.danger {
  color: var(--danger);
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  font-weight: 650;
}
.ichips .chip.warn {
  color: var(--amber);
  border-color: var(--amberBorder);
  background: var(--amberDim);
}
</style>
