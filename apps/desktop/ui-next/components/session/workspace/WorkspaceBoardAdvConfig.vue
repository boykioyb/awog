<template>
  <!-- Advanced — override LLM per-slot của người nhận (collapse mặc định).
       Chỉ hiện khi assignee resolve ra ít nhất một slot. -->
  <div v-if="rows.length" class="wsed-adv">
    <button type="button" class="wsed-advtoggle" :class="{ on: open }" @click="open = !open">
      <SlidersHorizontal class="size-3" />
      {{ t('board.adv.title') }}
      <span v-if="customCount" class="wsed-advcount">
        {{ t('board.adv.count', { n: customCount }) }}
      </span>
      <ChevronDown class="wsed-advchev" :class="{ on: open }" />
    </button>
    <Collapse :open="open">
      <div class="wsed-advbody">
        <p class="wsed-advhint">{{ t('board.adv.hint') }}</p>
        <div v-for="row in rows" :key="row.key" class="wsed-advrow">
          <div class="wsed-advhead">
            <span class="wsed-advname">{{ row.label }}</span>
            <span class="wsed-advrole">{{ t(`board.adv.role.${row.role}`) }}</span>
            <span v-if="row.sessionId" class="wsed-advlive">{{ t('board.adv.live') }}</span>
            <button
              v-if="Object.keys(entry(row.key)).length"
              type="button"
              class="wsed-advreset"
              :title="t('board.adv.reset')"
              @click="reset(row.key)"
            >
              <RotateCcw class="size-3" />
            </button>
          </div>
          <div class="wsed-advgrid">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{{ t('board.adv.provider') }}</span>
              <AppSelect
                :model-value="entry(row.key).provider ?? ''"
                :options="providerOpts(row)"
                width="100%"
                @update:model-value="set(row.key, 'provider', $event)"
              />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{{ t('board.adv.account') }}</span>
              <AppSelect
                :model-value="entry(row.key).accountId ?? ''"
                :options="accountOpts(row)"
                width="100%"
                @update:model-value="set(row.key, 'accountId', $event)"
              />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{{ t('board.adv.model') }}</span>
              <AppSelect
                :model-value="entry(row.key).modelId ?? ''"
                :options="modelOpts(row)"
                width="100%"
                @update:model-value="set(row.key, 'modelId', $event)"
              />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{{ t('board.adv.effort') }}</span>
              <AppSelect
                :model-value="entry(row.key).level ?? ''"
                :options="levelOpts"
                width="100%"
                @update:model-value="set(row.key, 'level', $event)"
              />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{{ t('board.adv.mode') }}</span>
              <AppSelect
                :model-value="entry(row.key).mode ?? ''"
                :options="modeOpts"
                width="100%"
                @update:model-value="set(row.key, 'mode', $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </Collapse>
  </div>
</template>

<script setup lang="ts">
// Phần "Advanced" của board item editor — override runtime LLM per-slot của
// người nhận. Mặc định COLLAPSE (nâng cao). Assignee resolve ra các SLOT:
//   agent:<key>          → 'self'
//   team:<key>           → 'lead' + 'member:<title>' theo spec
//   member:<runId|title> → 'member:<title>'
//   sessionId sống       → 'self' (phiên lẻ) / 'lead' + member:* (gốc run) /
//                          'member:<title>' (member của run)
// Mỗi slot một map {provider,accountId,modelId,level,mode} — field trống =
// kế thừa. Persist trên item.assigneeConfig qua configForSave(); phiên sống
// được áp NGAY qua sessions.setLlmOverride trong applyLive() — thắng cả pin
// provider/model/account của agent spec ở lượt chạy, nên đây chính là đường
// "đổi account khi hết token". Member chưa spawn nhận override lúc
// materialize (sidecar tra lại item.assigneeConfig).
import { computed, ref, watch } from 'vue'
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-vue-next'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import Collapse from '~/components/common/Collapse.vue'
import { useAccounts } from '~/composables/useAccounts'
import { providerModelDisplayName, providerModelIds } from '~/composables/useProviderModels'
import { dispatchRunSettings } from '~/composables/useProjectLlmDefaults'
import {
  THINKING_LEVELS,
  type Session,
  type SessionAgentRef,
  type SessionLlmOverride,
} from '~/composables/useSessionsData'
import { useAgentsStore } from '~/stores/agents'
import { useBoardStore, type BoardItem } from '~/stores/board'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import { useTeamsStore } from '~/stores/teams'
import type { ProviderName } from '~/types'

const props = defineProps<{
  // Giá trị select "giao cho" đang chọn — spec ref, sessionId sống, 'user' hoặc ''.
  assignee: string
  // Project đích của item — fallback provider theo llmDefaults của nó.
  projectId: string
  // Item đang sửa (null = tạo mới) — seed assigneeConfig.
  item: BoardItem | null
  // Lead + member sessions được truyền vào editor (để resolve run/spec khi
  // assignee là 'member:<runId|title>' hoặc một phiên sống thuộc run ngoài).
  lead?: Session | undefined
  members: Session[]
}>()

const { t } = useI18n()
const agentsStore = useAgentsStore()
const teamsStore = useTeamsStore()
const sessionsStore = useSessionsStore()
const settingsStore = useSettingsStore()
const board = useBoardStore()
// useAccounts tự hydrate providers/accounts từ sidecar — cần cho option
// account/model khi editor mở mà Settings chưa từng mount.
const { accountById } = useAccounts()

type AdvRow = {
  key: string // slot key trong assigneeConfig
  label: string
  role: 'agent' | 'lead' | 'member'
  // engineId của phiên SỐNG gắn slot này — vắng mặt = slot chờ materialize.
  sessionId?: string
  // Provider do agent bind ghim — fallback để liệt kê account/model đúng
  // provider khi override chưa đặt.
  agentProvider?: ProviderName
}

const open = ref(false)
const cfg = ref<Record<string, SessionLlmOverride>>({ ...(props.item?.assigneeConfig ?? {}) })

// SessionAgentRef → khoá agentsStore ('<source>|<projectId>|<id>').
const agentRefKey = (ref: SessionAgentRef | undefined): string =>
  ref ? `${ref.source ?? 'global'}|${ref.projectId ?? ''}|${ref.id}` : ''
const agentOfRef = (ref: SessionAgentRef | undefined) =>
  ref?.id ? agentsStore.agentByKey(agentRefKey(ref)) : undefined
// Provider pin của một phiên sống qua agent đang bind (roster biết agent ref;
// spec của nó có provider). Không resolve được ⇒ undefined — fallback chuỗi dưới.
const sessionAgentProvider = (s: Session | undefined): ProviderName | undefined =>
  agentOfRef(s?.agent)?.provider

// Run/spec helpers — mirror các computed của editor (runRoot/benchRootId/
// runTeamSpec) để component tự chứa khi mount ở cả create lẫn edit mode.
const runRoot = computed(() => {
  const a = props.item?.assigneeSessionId
  if (a && a !== 'user') {
    const s = sessionsStore.sessions.find((x) => x.engineId === a)
    if (s) {
      if (s.teamRunId) return s.teamRunId
      if (sessionsStore.sessions.some((m) => m.teamRunId === a)) return a
    }
  }
  return ''
})
const benchRootId = computed(
  () =>
    runRoot.value ||
    props.lead?.engineId ||
    props.members.find((m) => m.teamRunId)?.teamRunId ||
    '',
)
const runTeamSpec = computed(() => {
  const root = sessionsStore.sessions.find((s) => s.engineId === benchRootId.value)
  if (!root?.teamId) return undefined
  const exact = root.teamSource
    ? teamsStore.teamByKey(
        `${root.teamSource}|${root.teamSource === 'project' ? (root.teamProjectId ?? '') : ''}|${root.teamId}`,
      )
    : undefined
  return (
    exact ??
    teamsStore.teamByKey(`global||${root.teamId}`) ??
    (root.project ? teamsStore.teamByKey(`project|${root.project}|${root.teamId}`) : undefined)
  )
})

const rows = computed<AdvRow[]>(() => {
  const a = props.assignee
  const out: AdvRow[] = []
  if (!a || a === 'user') return out
  if (a.startsWith('agent:')) {
    const agent = agentsStore.agentByKey(a.slice(6))
    if (agent) {
      out.push({
        key: 'self',
        label: agent.name || agent.id,
        role: 'agent',
        ...(agent.provider ? { agentProvider: agent.provider } : {}),
      })
    }
    return out
  }
  if (a.startsWith('team:')) {
    const team = teamsStore.teamByKey(a.slice(5))
    if (!team) return out
    const leadAgent = agentOfRef(team.lead)
    out.push({
      key: 'lead',
      label: leadAgent?.name || team.name,
      role: 'lead',
      ...(leadAgent?.provider ? { agentProvider: leadAgent.provider } : {}),
    })
    for (const m of team.members) {
      const ma = agentOfRef(m.agent)
      out.push({
        key: `member:${m.title}`,
        label: m.title,
        role: 'member',
        ...(ma?.provider ? { agentProvider: ma.provider } : {}),
      })
    }
    return out
  }
  if (a.startsWith('member:')) {
    const sep = a.indexOf('|')
    const title = a.slice(sep + 1)
    const runId = a.slice(7, sep)
    // Member spec của RUN đó (nếu resolve được) cho label + agent provider;
    // phiên sống cùng title (nếu đã spawn) để biết slot có phiên.
    const live = sessionsStore.sessions.find((s) => s.teamRunId === runId && s.title === title)
    const spec =
      runId === benchRootId.value
        ? runTeamSpec.value?.members.find((m) => m.title === title)
        : undefined
    out.push({
      key: `member:${title}`,
      label: live?.title || spec?.title || title,
      role: 'member',
      ...(live?.engineId ? { sessionId: live.engineId } : {}),
      agentProvider: agentOfRef(spec?.agent)?.provider ?? sessionAgentProvider(live),
    })
    return out
  }
  // sessionId sống — member / gốc run / phiên lẻ.
  const s = sessionsStore.sessions.find((x) => x.engineId === a)
  if (!s?.engineId) return out
  if (s.teamRunId) {
    out.push({
      key: `member:${s.title}`,
      label: s.title,
      role: 'member',
      sessionId: s.engineId,
      agentProvider: sessionAgentProvider(s),
    })
    return out
  }
  const members = sessionsStore.sessions.filter((m) => m.teamRunId === s.engineId && m.engineId)
  out.push({
    key: 'lead',
    label: s.title,
    role: 'lead',
    sessionId: s.engineId,
    agentProvider: sessionAgentProvider(s),
  })
  const seen = new Set<string>()
  for (const m of members) {
    const k = `member:${m.title}`
    seen.add(k)
    out.push({
      key: k,
      label: m.title,
      role: 'member',
      sessionId: m.engineId,
      agentProvider: sessionAgentProvider(m),
    })
  }
  // Member spec còn trên bench cũng cấu hình được — override nằm trên item,
  // áp lúc materialize lười.
  for (const m of runTeamSpec.value?.members ?? []) {
    const k = `member:${m.title}`
    if (seen.has(k)) continue
    const ma = agentOfRef(m.agent)
    out.push({
      key: k,
      label: m.title,
      role: 'member',
      ...(ma?.provider ? { agentProvider: ma.provider } : {}),
    })
  }
  return out
})

// Nhịp edit của item đã materialize: llmOverride hiện có TRÊN phiên sống nhưng
// item chưa ghi (đặt từ đường khác) ⇒ đổ vào row tương ứng để user thấy đúng
// trạng thái thật. Chỉ THÊM key còn thiếu — không đè lên config của item.
watch(
  rows,
  (list) => {
    let changed = false
    const next = { ...cfg.value }
    for (const r of list) {
      if (!r.sessionId || next[r.key] !== undefined) continue
      const ov = sessionsStore.sessions.find((s) => s.engineId === r.sessionId)?.llmOverride
      if (ov) {
        next[r.key] = { ...ov }
        changed = true
      }
    }
    if (changed) cfg.value = next
  },
  { immediate: true },
)

const entry = (key: string): SessionLlmOverride => cfg.value[key] ?? {}
const customCount = computed(
  () => rows.value.filter((r) => Object.keys(entry(r.key)).length).length,
)

// Provider account → ProviderName — y hệt PROVIDER_NAME của useSessionsData
// (catalog bên đó private nên mirror bộ map nhỏ ở đây).
const PROVIDER_NAME: Record<string, ProviderName> = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'google',
}

// Provider hiệu dụng của một row để liệt kê account/model: override → pin của
// agent bind → settings dispatch mặc định của project (giống thứ tự runtime).
const effProvider = (row: AdvRow): ProviderName =>
  entry(row.key).provider ??
  row.agentProvider ??
  (dispatchRunSettings(props.projectId).provider as ProviderName)

// '' = kế thừa (xoá field khỏi override). Đổi provider ⇒ account/model của
// provider cũ vô nghĩa — reset về inherit trong cùng một ghi.
function set(key: string, field: keyof SessionLlmOverride, v: string): void {
  const cur: SessionLlmOverride = { ...entry(key) }
  if (v === '') delete cur[field]
  else (cur as Record<string, string>)[field] = v
  if (field === 'provider') {
    delete cur.accountId
    delete cur.modelId
  }
  if (field === 'accountId' && v) {
    // Account mang provider của nó — ghim provider theo để cặp account/provider
    // không lệch nhau ở lượt chạy (khuôn cfgOf của popover điều phối).
    const acc = accountById(v)
    if (acc) cur.provider = PROVIDER_NAME[acc.provider]
  }
  const next = { ...cfg.value }
  if (Object.keys(cur).length) next[key] = cur
  else delete next[key]
  cfg.value = next
}

function reset(key: string): void {
  const next = { ...cfg.value }
  delete next[key]
  cfg.value = next
}

const PROVIDER_OPTS: AppSelectOption[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
]
const MODE_KEYS: [NonNullable<SessionLlmOverride['mode']>, string][] = [
  ['ask', 'Ask'],
  ['plan', 'Plan'],
  ['accept-edits', 'AcceptEdits'],
  ['execute', 'Execute'],
]

const providerOpts = (row: AdvRow): AppSelectOption[] => {
  const opts: AppSelectOption[] = [
    { value: '', label: t('board.adv.inherit') },
    ...PROVIDER_OPTS.map((o) => ({
      ...o,
      disabled: !settingsStore.isProviderConnected(o.value as ProviderName),
    })),
  ]
  const cur = entry(row.key).provider
  if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur })
  return opts
}

const accountOpts = (row: AdvRow): AppSelectOption[] => {
  const p = effProvider(row)
  const accounts = settingsStore.providers[p]?.accounts ?? []
  const cur = entry(row.key).accountId
  const opts: AppSelectOption[] = [
    { value: '', label: t('board.adv.inherit') },
    ...accounts.map((a) => ({ value: a.id, label: a.label || a.id })),
  ]
  if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur })
  return opts
}

const modelOpts = (row: AdvRow): AppSelectOption[] => {
  const p = effProvider(row)
  const bucket = settingsStore.providers[p]
  const cur = entry(row.key)
  // Account đã chọn (hoặc active của provider) có baseURL + models riêng ⇒
  // catalog curated của endpoint đó; còn lại = catalog chung của provider
  // (khuôn availableModelIds của useProjectLlmDefaults).
  const acctId = cur.accountId ?? bucket?.activeAccountId ?? undefined
  const acct = bucket?.accounts.find((a) => a.id === acctId)
  const ids = acct?.baseURL && acct.models?.length ? acct.models : providerModelIds(p)
  const opts: AppSelectOption[] = [
    { value: '', label: t('board.adv.inherit') },
    ...ids.map((id) => ({ value: id, label: providerModelDisplayName(id) })),
  ]
  if (cur.modelId && !ids.includes(cur.modelId)) {
    opts.push({ value: cur.modelId, label: providerModelDisplayName(cur.modelId) })
  }
  return opts
}

const levelOpts: AppSelectOption[] = [
  { value: '', label: t('board.adv.inherit') },
  ...THINKING_LEVELS.map((lv) => ({ value: lv, label: t(`common.thinking.${lv}`) })),
]

const modeOpts: AppSelectOption[] = [
  { value: '', label: t('board.adv.inherit') },
  ...MODE_KEYS.map(([v, k]) => ({ value: v, label: t(`sessions.mode.${k}`) })),
]

// Map đã lọc theo slot của assignee HIỆN TẠI — key lạc hậu (đổi team khác,
// member đổi tên) không ghi xuống item. null = gỡ hẳn assigneeConfig.
function configForSave(): Record<string, SessionLlmOverride> | null {
  const keys = new Set(rows.value.map((r) => r.key))
  const out: Record<string, SessionLlmOverride> = {}
  for (const k of keys) {
    const ov = cfg.value[k]
    if (ov && Object.keys(ov).length) out[k] = ov
  }
  return Object.keys(out).length ? out : null
}

// Áp override lên các phiên SỐNG của assignee sau một ghi thành công — lúc này
// item.assigneeSessionId là phiên CUỐI (vừa materialize hoặc vốn đã sống).
// Key vắng trong config ⇒ gỡ llmOverride khỏi phiên đó (user reset về inherit).
async function applyLive(item: BoardItem): Promise<void> {
  const sid = item.assigneeSessionId
  if (!sid || sid === 'user') return
  const s = sessionsStore.sessions.find((x) => x.engineId === sid)
  if (!s?.engineId) return
  const itemCfg = item.assigneeConfig ?? {}
  const targets: [string, string][] = []
  if (s.teamRunId) {
    targets.push([s.engineId, `member:${s.title}`])
  } else {
    const members = sessionsStore.sessions.filter((m) => m.teamRunId === s.engineId && m.engineId)
    if (members.length) {
      targets.push([s.engineId, 'lead'])
      for (const m of members) targets.push([m.engineId as string, `member:${m.title}`])
    } else {
      targets.push([s.engineId, 'self'])
    }
  }
  for (const [engineId, key] of targets) {
    const ov = itemCfg[key]
    await board.setLlmOverride(engineId, ov && Object.keys(ov).length ? ov : null)
  }
}

defineExpose({ configForSave, applyLive })
</script>

<style scoped>
.wsed-adv {
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
}
.wsed-advtoggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  cursor: pointer;
}
.wsed-advtoggle:hover,
.wsed-advtoggle.on {
  color: var(--text);
}
.wsed-advcount {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accentDim);
  color: var(--accent);
  font-size: 10px;
}
.wsed-advchev {
  margin-left: auto;
  width: 12px;
  height: 12px;
  transition: transform 0.15s ease;
}
.wsed-advchev.on {
  transform: rotate(180deg);
}
.wsed-advbody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px;
}
.wsed-advhint {
  font-size: 11px;
  line-height: 1.45;
  color: var(--textFaint);
}
.wsed-advrow {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wsed-advhead {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wsed-advname {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsed-advrole {
  font-size: 10px;
  color: var(--textFaint);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 6px;
  flex-shrink: 0;
}
.wsed-advlive {
  font-size: 10px;
  color: var(--green);
  flex-shrink: 0;
}
.wsed-advreset {
  margin-left: auto;
  color: var(--textFaint);
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
}
.wsed-advreset:hover {
  color: var(--text);
}
.wsed-advgrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
</style>
