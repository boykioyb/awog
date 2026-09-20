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
      <!-- Ba câu trước khi bấm: sẽ làm gì · kết quả mong đợi · rủi ro. Nhãn đứng
           trước để đọc lướt vẫn ra nghĩa; xem `infraBrief` cho luật dựng từng dòng. -->
      <dl class="pbrief">
        <template v-for="row in infraBrief" :key="row.label">
          <dt class="pbrief-lbl">{{ row.label }}</dt>
          <dd class="pbrief-txt" :class="row.tone">
            {{ row.text }}
            <span v-if="row.ai" class="pbrief-ai" :title="t('infraGate.brief.aiWhy')">
              {{ t('infraGate.brief.ai') }}
            </span>
            <!-- Dòng RỦI RO giữ phần AWOG tự suy ở trên; lời mô hình chỉ nối thêm
                 vào đây, có nhãn. Xem `infraBrief` cho lý do ranh giới đó. -->
            <span v-if="row.note" class="pbrief-note">
              {{ row.note }}
              <span class="pbrief-ai" :title="t('infraGate.brief.aiWhy')">
                {{ t('infraGate.brief.ai') }}
              </span>
            </span>
          </dd>
        </template>
      </dl>
      <!-- Chỉ hiện khi đang hỏi hoặc đã hỏng: lúc bình thường ba dòng trên tự nói
           hết, thêm một dòng trạng thái nữa chỉ là nhiễu ngay trên nút Cho phép. -->
      <p v-if="explainState?.loading" class="pbrief-state">
        {{ t('infraGate.brief.loading') }}
      </p>
      <p v-else-if="explainState?.failed" class="pbrief-state" :title="explainState.error">
        {{ t('infraGate.brief.failed') }}
        <button class="pbrief-retry" type="button" @click="onRetryExplain">
          {{ t('infraGate.brief.retry') }}
        </button>
      </p>
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
        <span class="prulelbl">{{ ruleLabel }}</span>
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
      <!-- Kết quả lệnh vừa được duyệt, chép từ step của CHÍNH lời gọi này (xem
           attachPermResult trong store). Không có dòng này thì thẻ chỉ nói "Đã cho
           phép", còn output nằm trong khối bước mặc định thu gọn bên dưới — người
           vừa bấm Cho phép đọc ra như thể lệnh không trả về gì. -->
      <div v-if="permOutput" class="pout">
        <div class="pouthead">
          <span>{{ t('sessions.step.output') }}</span>
          <span v-if="permExit" class="poutexit">{{ permExit }}</span>
        </div>
        <pre class="cvcode plain poutbody">{{ permOutput }}</pre>
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
}

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
  const risks: string[] = []
  // Đây là chỗ sự thật cũ của "noAccount" chuyển về — nó KHÔNG phải cước chú, nó là
  // lý do thẻ đang hiện PRODUCTION: `accountKindOf` coi account chưa biết là
  // production (fail-safe), nên người đọc phải biết badge kia đến từ đâu.
  if (!i.accountId) risks.push(t('infraGate.brief.risk.unknownAccount'))
  else if (i.accountKind === 'production') risks.push(t('infraGate.brief.risk.production'))
  if (i.shell) risks.push(t('infraGate.brief.risk.shell'))
  if (i.reason === 'bypass') risks.push(t('infraGate.hint.bypass'))
  else if (i.reason === 'session-narrowed') risks.push(t('infraGate.hint.narrowed'))
  if (risks.length === 0) risks.push(t(`infraGate.brief.risk.${i.commandClass}`))

  rows.push({
    label: t('infraGate.brief.label.risk'),
    text: risks.join(' '),
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
</script>

<style scoped>
/* Khối "sẽ làm gì · kết quả · rủi ro" của thẻ duyệt lệnh hạ tầng. Lưới hai cột để
   nhãn thẳng hàng; ở cửa sổ hẹp nó tự xuống một cột. */
.pbrief {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
  margin: 8px 0 0;
}

.pbrief-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textDim);
  white-space: nowrap;
}

.pbrief-txt {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}

.pbrief-txt.warn {
  color: var(--amber);
}

.pbrief-txt.danger {
  color: var(--danger);
}

/* Nhãn "do model" — nhỏ, không tô màu cảnh báo: nó nói NGUỒN của câu chữ, không
   nói mức nguy hiểm. Trộn hai thứ đó vào một màu là dạy sai người đọc. */
.pbrief-ai {
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  white-space: nowrap;
}

/* Câu của mô hình ở hàng Rủi ro: xuống dòng riêng để không bị đọc lẫn vào phần
   AWOG tự suy đứng trước nó. */
.pbrief-note {
  display: block;
  margin-top: 3px;
  color: var(--textDim);
}

.pbrief-state {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.pbrief-retry {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-decoration: underline;
}

@media (max-width: 560px) {
  .pbrief {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

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
/* Dòng lệnh ĐÚNG NHƯ sắp chạy. XUỐNG DÒNG chứ không cuộn ngang.
   Bản đầu để `white-space: pre` + `overflow-x: auto` với lý do "một lệnh bị bẻ dòng
   đọc ra thành nhiều lệnh" — đúng về nguyên tắc, nhưng trên thực tế phần ĐUÔI bị
   đẩy ra ngoài tầm nhìn và thanh cuộn ngang không hiện trên thanh này (macOS ẩn
   scrollbar), nên người duyệt đọc `aws sts get-caller-identity … | env | grep -c
   '^AWS_'` mà không thấy `'^AWS_'`. Một lệnh dài bị cắt cụt tệ hơn một lệnh bị bẻ
   dòng: chữ vẫn nguyên văn (không thêm/bớt ký tự nào) nên copy ra terminal vẫn chạy
   đúng, và `overflow-wrap: anywhere` chỉ bẻ khi token không còn chỗ — cờ ngắn vẫn
   nằm nguyên trên dòng của nó. */
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
/* ── Kết quả của lệnh vừa được duyệt ─────────────────────────────────────────
   Nằm SAU hàng "Đã cho phép" vì đó là thứ tự thời gian thật (duyệt → chạy → kết
   quả), và cách hàng luật đã ghi. Nhãn nhỏ phía trên để "Kết quả" không bị đọc lẫn
   vào dòng lệnh ở đầu thẻ. */
.pout {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
}
.pouthead {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 650;
  color: var(--textDim);
}
.poutexit {
  font-family: var(--code); /* mono-ok: mã thoát là chữ của máy */
  font-weight: 550;
  color: var(--danger);
}
/* Xuống dòng chứ không cuộn ngang — cùng lý do như `.icmd`: output dài (một dòng
   JSON lỗi AWS) mà để `pre` là phần đuôi biến mất khỏi tầm mắt trên thanh này. */
.poutbody {
  margin: 0;
  padding: 2px 0 0;
  border: none;
  background: transparent;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
