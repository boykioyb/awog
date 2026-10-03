<template>
  <Teleport to="body">
    <div v-if="open" class="spw-ovl" @click.self="close">
      <div class="spw-card" role="dialog" aria-modal="true" :aria-label="t('sessions.spawn.title')">
        <div class="spw-head">
          <div class="spw-headtx">
            <div class="spw-title">{{ t('sessions.spawn.title') }}</div>
            <div class="spw-sub">{{ subtitle }}</div>
          </div>
          <button class="spw-x" :aria-label="t('common.close')" @click="close">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="spw-body">
          <div class="spw-sec">{{ t('sessions.spawn.brief') }}</div>
          <textarea
            v-model="brief"
            class="spw-ta"
            rows="3"
            :placeholder="t('sessions.spawn.briefPh')"
          />
          <div class="spw-briefrow">
            <button
              class="spw-add"
              :disabled="!brief.trim() || genBusy || fieldBusy"
              @click="genTeam"
            >
              <Icon name="sparkles" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ genBusy ? t('sessions.spawn.generating') : t('sessions.spawn.generate') }}
            </button>
            <span class="spw-briefhint">{{ t('sessions.spawn.briefHint') }}</span>
          </div>

          <button class="spw-chip" type="button" @click="sharedOpen = !sharedOpen">
            <Icon
              name="chev"
              class="spw-ovr-chev"
              :class="{ open: sharedOpen }"
              style="width: var(--icon-xs); height: var(--icon-xs)"
            />
            <span>{{ t('sessions.spawn.shared') }}</span>
            <span class="spw-chip-sum">{{ sharedSummary }}</span>
          </button>
          <div v-if="sharedOpen" class="spw-grid spw-chipgrid">
            <div v-for="f in fieldsFor(shared, inheritParent)" :key="f.key" class="spw-field">
              <span class="spw-fl">{{ f.label }}</span>
              <AppSelect
                :model-value="shared[f.key]"
                :options="f.opts"
                width="100%"
                @update:model-value="(v: string) => setField(shared, f.key, v)"
              />
            </div>
          </div>

          <div class="spw-sec spw-secrow">
            <span>{{ t('sessions.spawn.children', { n: children.length }) }}</span>
            <button class="spw-add" :disabled="children.length >= MAX_CHILDREN" @click="addChild">
              <Icon name="plus" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ t('sessions.spawn.add') }}
            </button>
          </div>

          <div v-for="(c, i) in children" :key="c.key" class="spw-child">
            <div class="spw-crow">
              <Input
                v-model="c.title"
                :placeholder="t('sessions.spawn.childTitle')"
                maxlength="80"
                class="spw-in"
              />
              <button
                class="spw-cx spw-genbtn"
                :disabled="fieldBusy || genBusy"
                :aria-label="t('sessions.spawn.genField')"
                :title="t('sessions.spawn.genField')"
                @click="genField(c, 'title')"
              >
                <Icon name="sparkles" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </button>
              <Input
                v-model="c.role"
                :placeholder="t('sessions.spawn.childRole')"
                maxlength="60"
                class="spw-in spw-role"
              />
              <button
                class="spw-cx"
                :disabled="children.length <= 1"
                :aria-label="t('sessions.spawn.childRemove')"
                @click="children.splice(i, 1)"
              >
                <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </button>
            </div>
            <textarea
              v-model="c.prompt"
              class="spw-ta"
              rows="2"
              :placeholder="t('sessions.spawn.childPrompt')"
            />
            <!-- "Vai có thật" của con (session-teams §3): agent AWOG gắn vào phiên
                 con lúc spawn. '' = con trần; giá trị là agentKey (source|proj|id)
                 để phân biệt hai agent trùng id ở hai tầng. -->
            <div class="spw-crow2 spw-agentrow">
              <span class="spw-fl">{{ t('sessions.spawn.f.agent') }}</span>
              <AppSelect
                :model-value="c.agentKey"
                :options="agentOpts"
                width="100%"
                @update:model-value="(v: string) => (c.agentKey = v)"
              />
            </div>
            <div class="spw-crow2">
              <button
                class="spw-ovr"
                :disabled="fieldBusy || genBusy"
                @click="genField(c, 'prompt')"
              >
                <Icon name="sparkles" style="width: var(--icon-xs); height: var(--icon-xs)" />
                {{ fieldBusy ? t('sessions.spawn.generating') : t('sessions.spawn.genField') }}
              </button>
              <button class="spw-ovr" @click="toggleOvr(c)">
                <Icon
                  name="chev"
                  class="spw-ovr-chev"
                  :class="{ open: !!c.ovr }"
                  style="width: var(--icon-xs); height: var(--icon-xs)"
                />
                {{ t('sessions.spawn.childCustom') }}
              </button>
            </div>
            <div v-if="c.ovr" class="spw-grid spw-ovrgrid">
              <div
                v-for="f in fieldsFor(c.ovr, inheritShared, shared)"
                :key="f.key"
                class="spw-field"
              >
                <span class="spw-fl">{{ f.label }}</span>
                <AppSelect
                  :model-value="c.ovr[f.key]"
                  :options="f.opts"
                  width="100%"
                  @update:model-value="(v: string) => setField(c.ovr!, f.key, v)"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="spw-foot">
          <label class="spw-rm">
            <input v-model="remember" type="checkbox" />
            <span>{{ t('sessions.spawn.remember') }}</span>
          </label>
          <div class="spw-actions">
            <Button :disabled="busy" variant="outline" @click="close">
              {{ manual ? t('common.cancel') : t('sessions.spawn.deny') }}
            </Button>
            <Button :disabled="busy || !canSubmit" variant="default" @click="approve">
              {{ t('sessions.spawn.approve', { n: children.length }) }}
            </Button>
          </div>
          <div v-if="!canSubmit" class="spw-err">{{ t('sessions.spawn.invalid') }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Popover ĐIỀU PHỐI phiên con — cổng duyệt duy nhất của tool `create_session`
// (docs/features/session-runs.md). Hai nguồn mở:
//
//   1. Agent đề xuất: runner park `create_session` + bắn `session.spawn-request`
//      → store.pendingSpawn → popover này. Duyệt = resolveSpawn; Từ chối/đóng/
//      Esc = deny (mặc định AN TOÀN — không duyệt thì không có phiên nào được tạo).
//   2. Người dùng tự mở: menu ⋯ → "Điều phối phiên con…" → useSessionSpawnDialog
//      → cùng popover → sessions.spawnMembers RPC (không qua model).
//
// "Cấu hình chung" áp cho mọi phiên con; mỗi phiên có thể mở "Tuỳ chỉnh riêng" để
// đè từng field ('' = theo chung/cha — mergeDrafts lấy field của tầng dưới). Bản
// trộn cuối gửi lên sidecar làm `children[].config`; bản CHUNG gửi làm `config`
// chỉ để `remember` ghi nhớ lên gốc nhóm (spawnConfig → lần sau model gọi
// create_session chạy thẳng, không hỏi lại — đúng tinh thần "chỉ allow 1 lần").
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { normalizeStyleSlug, RESPONSE_STYLES } from '~/composables/useSessionModelConfig'
import {
  modelDisplayName,
  modelIdFromDisplay,
  PROVIDER_DISPLAY,
  THINKING_LEVELS,
  useSessionsData,
  type Provider,
  type Session,
  type SpawnChildSpec,
  type SpawnSessionConfig,
  type ThinkingLevel,
} from '~/composables/useSessionsData'
import { useAccounts, type AccountOption } from '~/composables/useAccounts'
import { useOutputStyles } from '~/composables/useOutputStyles'
import { useSessionSpawnDialog } from '~/composables/useSessionSpawnDialog'
import { useSessionsStore } from '~/stores/sessions'
import { useAgentsStore } from '~/stores/agents'
import type { ProviderName } from '~/stores/settings'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

defineOptions({ name: 'SessionSpawnHost' })

// Trần con mỗi lô — mirrors MAX_CHILDREN trong sidecar sessions/spawn.ts.
const MAX_CHILDREN = 12

const { t } = useI18n()
const store = useSessionsStore()
const agents = useAgentsStore()
const dlg = useSessionSpawnDialog()
const toast = useToast()
const { accounts, accountById, accountByDisplay, modelsForAccount } = useAccounts()
const { stylesForProject, ensureStylesLoaded } = useOutputStyles()
const { providerOf } = useSessionsData()

// ── Nguồn mở ──
const req = computed(() => store.pendingSpawn)
const manual = computed(() => !req.value && dlg.parentId.value != null)
const open = computed(() => !!req.value || dlg.parentId.value != null)
const parent = computed<Session | null>(() => {
  if (req.value) return store.byEngineId(req.value.sessionId) ?? null
  const id = dlg.parentId.value
  return id == null ? null : (store.sessions.find((s) => s.id === id) ?? null)
})

// ── Draft ──
// Mọi field là string; '' = "theo phiên cha" (cấu hình chung) hoặc "theo cấu hình
// chung" (đè riêng của từng con). md: '' | 'md' | 'nomd' — select ba trạng thái
// cho responseStyleNoMarkdown (boolean tuỳ chọn, '' = không ghi field).
type DraftCfg = {
  accountId: string
  model: string
  level: string
  style: string
  md: string
  mode: string
}
type DraftChild = {
  key: number
  title: string
  role: string
  prompt: string
  ovr: DraftCfg | null
  // agentKey của agents store ('' = con trần) — gom đủ source/projectId/id để
  // approve() bóc lại thành agentId/agentSource/agentProjectId của SpawnChildSpec.
  agentKey: string
}

const blankCfg = (): DraftCfg => ({
  accountId: '',
  model: '',
  level: '',
  style: '',
  md: '',
  mode: '',
})

const shared = ref<DraftCfg>(blankCfg())
const children = ref<DraftChild[]>([])
const remember = ref(true)
const busy = ref(false)
// Ô "Yêu cầu" — nguồn cho các nút sinh draft bằng AI, và được gửi vào phiên cha
// như một tin nhắn thường khi duyệt (store.sendMessage → tự queue nếu cha đang
// chạy — đường duyệt thì cha đang park giữa tool call).
const brief = ref('')
const genBusy = ref(false)
const fieldBusy = ref(false)
// "Cấu hình chung" thu vào chip để ưu tiên yêu cầu + danh sách phiên — chip tóm
// tắt giá trị hiệu lực (sharedSummary), bấm mới mở lưới select đầy đủ.
const sharedOpen = ref(false)
// Gốc nhóm đã có spawnConfig hay chưa — chỉ đường thủ công mới gặp, để bỏ
// chọn "nhớ" khi duyệt thì revoke luôn (xem approve).
const hadSaved = ref(false)
const rootClientId = ref<number | null>(null)
let seq = 0

const PROVIDER_NAME_BY_DISPLAY = Object.fromEntries(
  Object.entries(PROVIDER_DISPLAY).map(([k, v]) => [v, k]),
) as Record<Provider, ProviderName>

// Display mode của Session → engine AgentMode (payload RPC dùng engine strings).
const MODE_TO_ENGINE: Record<string, SpawnSessionConfig['mode']> = {
  Ask: 'ask',
  Plan: 'plan',
  AcceptEdits: 'accept-edits',
  Execute: 'execute',
}
const MODE_KEYS: [NonNullable<SpawnSessionConfig['mode']>, string][] = [
  ['ask', 'Ask'],
  ['plan', 'Plan'],
  ['accept-edits', 'AcceptEdits'],
  ['execute', 'Execute'],
]

function draftFromSession(s: Session): DraftCfg {
  return {
    accountId: s.accountId ?? '',
    model: s.model ?? '',
    level: s.ultracode ? 'ultracode' : (s.thinkingLevel ?? 'high'),
    style: normalizeStyleSlug(s.style),
    md: s.noMarkdown ? 'nomd' : 'md',
    mode: MODE_TO_ENGINE[s.mode ?? ''] ?? '',
  }
}

function draftFromConfig(c: SpawnSessionConfig): DraftCfg {
  return {
    accountId: c.accountId ?? '',
    model: c.modelId ? modelDisplayName(c.modelId) : '',
    level: c.ultracode ? 'ultracode' : (c.level ?? ''),
    style: c.responseStyle ? normalizeStyleSlug(c.responseStyle) : '',
    md: c.responseStyleNoMarkdown === undefined ? '' : c.responseStyleNoMarkdown ? 'nomd' : 'md',
    mode: c.mode ?? '',
  }
}

// Draft → SpawnSessionConfig; field '' bị BỎ QUA (không ghi = kế thừa cha).
function cfgOf(d: DraftCfg): SpawnSessionConfig | undefined {
  const cfg: SpawnSessionConfig = {}
  if (d.accountId) {
    cfg.accountId = d.accountId
    const acc = accountById(d.accountId)
    if (acc) cfg.provider = PROVIDER_NAME_BY_DISPLAY[acc.provider]
  }
  if (d.model) cfg.modelId = modelIdFromDisplay(d.model)
  if (d.level === 'ultracode') cfg.ultracode = true
  else if (d.level) cfg.level = d.level as ThinkingLevel
  if (d.style) cfg.responseStyle = d.style
  if (d.md === 'md') cfg.responseStyleNoMarkdown = false
  else if (d.md === 'nomd') cfg.responseStyleNoMarkdown = true
  if (d.mode) cfg.mode = d.mode as SpawnSessionConfig['mode']
  return Object.keys(cfg).length ? cfg : undefined
}

// Field của ovr ('' = trống) rơi về shared — trộn trước khi build config con.
function mergeDrafts(base: DraftCfg, ovr: DraftCfg | null): DraftCfg {
  if (!ovr) return base
  const m = blankCfg()
  for (const k of Object.keys(m) as (keyof DraftCfg)[]) m[k] = ovr[k] || base[k]
  return m
}

// ── Option lists ──
const inheritParent = computed(() => t('sessions.spawn.inheritParent'))
const inheritShared = computed(() => t('sessions.spawn.inheritShared'))

// Account hiệu lực của một draft: chọn riêng → nó; '' → theo `base` (đè riêng)
// → theo account của phiên cha. Fallback cuối là account "ảo" dựng từ PROVIDER
// parse ra từ display string — y hệt `availableModels` của useSessionModelConfig
// để picker này và picker của phiên RA CÙNG MỘT danh sách (kể cả khi accountId
// đã lạc hậu / account bị xoá: picker ngoài vẫn ra đúng catalog của provider đó,
// không được rơi mặc định về Anthropic).
function effAccount(d: DraftCfg, base?: DraftCfg): AccountOption {
  const pick = accountById(d.accountId || base?.accountId || '')
  if (pick) return pick
  const s = parent.value
  const disp = s?.account ?? ''
  const byId = s?.accountId ? accountById(s.accountId) : undefined
  const found = byId ?? (disp ? accountByDisplay(disp) : undefined)
  if (found) return found
  const provider = providerOf(disp)
  return { id: '', label: '', provider, providerDisplay: provider, display: disp }
}

function fieldsFor(d: DraftCfg, inherit: string, base?: DraftCfg) {
  const acc = effAccount(d, base)
  const inheritOpt: AppSelectOption = { value: '', label: inherit }
  const levelOpts: AppSelectOption[] = [
    inheritOpt,
    ...THINKING_LEVELS.map((lv) => ({
      value: lv,
      label: t(`common.thinking.${lv}`),
    })),
    // Ultracode chỉ tồn tại trên nhánh Claude SDK của provider anthropic.
    ...(acc?.provider === 'Anthropic'
      ? [{ value: 'ultracode', label: t('common.thinking.ultracode') }]
      : []),
  ]
  const project = parent.value?.project ?? ''
  const styleOpts: AppSelectOption[] = [
    inheritOpt,
    { value: 'Default', label: t('sessions.style.normal.name') },
    ...RESPONSE_STYLES.flatMap((g) => g.rows)
      .filter((r) => r.slug !== 'normal')
      .map((r) => ({ value: r.slug, label: t(`sessions.style.${r.slug}.name`) })),
    ...stylesForProject(project).map((s) => ({
      value: s.id,
      label: s.name || s.id,
    })),
  ]
  // AppSelect chỉ hiện label khi value khớp ĐÚNG một option — giá trị đang chọn
  // mà vắng mặt trong list (account lạc hậu, model bị gỡ khỏi catalog, modelIds
  // curated của custom endpoint đổi) thì trigger render TRỐNG, nhìn y như select
  // chưa load. Luôn nối giá trị hiện tại vào đuôi list nếu nó không có sẵn.
  const accOpts: AppSelectOption[] = [
    inheritOpt,
    ...accounts.value.map((a) => ({ value: a.id, label: a.display })),
  ]
  if (d.accountId && !accOpts.some((o) => o.value === d.accountId)) {
    accOpts.push({ value: d.accountId, label: parent.value?.account || d.accountId })
  }
  const modelList = modelsForAccount(acc)
  const modelOpts: AppSelectOption[] = [
    inheritOpt,
    ...modelList.map((m) => ({ value: m, label: m })),
  ]
  if (d.model && !modelList.includes(d.model)) {
    modelOpts.push({ value: d.model, label: d.model })
  }
  return [
    { key: 'accountId' as const, label: t('sessions.spawn.f.account'), opts: accOpts },
    { key: 'model' as const, label: t('sessions.spawn.f.model'), opts: modelOpts },
    { key: 'level' as const, label: t('sessions.spawn.f.level'), opts: levelOpts },
    { key: 'style' as const, label: t('sessions.spawn.f.style'), opts: styleOpts },
    {
      key: 'md' as const,
      label: t('sessions.spawn.f.md'),
      opts: [
        inheritOpt,
        { value: 'md', label: t('sessions.spawn.md.on') },
        { value: 'nomd', label: t('sessions.spawn.md.off') },
      ],
    },
    {
      key: 'mode' as const,
      label: t('sessions.spawn.f.mode'),
      opts: [
        inheritOpt,
        ...MODE_KEYS.map(([v, k]) => ({ value: v, label: t(`sessions.mode.${k}`) })),
      ],
    },
  ]
}

// Đổi account ⇒ model đang chọn có thể không còn trong catalog mới → reset,
// để "theo cha/chung" thay vì gửi một modelId thuộc provider khác.
function setField(d: DraftCfg, key: keyof DraftCfg, v: string) {
  d[key] = v
  if (key === 'accountId') d.model = ''
}

// ── Agent picker (session-teams §3) ──
// agentKey của một spec model đề xuất — spec mang 3 field phẳng, draft chỉ cần
// một khoá; '' khi spec không gắn agent.
function specAgentKey(c: SpawnChildSpec): string {
  if (!c.agentId) return ''
  return agents.agentKey({
    id: c.agentId,
    source: c.agentSource ?? 'global',
    projectId: c.agentProjectId,
  })
}
// Options của picker: '' = không agent; agent project có hậu tố tầng để phân
// biệt cùng-id ở tầng global (label chỉ là hiển thị — value mang đủ danh tính).
const agentOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('sessions.spawn.agentNone') },
  ...agents.agents.map((a) => ({
    value: agents.agentKey(a),
    label:
      a.source === 'project'
        ? `${a.name || a.id} · ${t('sessions.spawn.agentProject')}`
        : a.name || a.id,
  })),
])

// ── Children ──
function addChild() {
  children.value.push({ key: seq++, title: '', role: '', prompt: '', ovr: null, agentKey: '' })
}
function toggleOvr(c: DraftChild) {
  c.ovr = c.ovr ? null : blankCfg()
}

// "Tạo bằng AI" → sessions.spawnDraft mode 'team': sidecar gọi completePi với
// provider/model/account của PHIÊN CHA (model rẻ trước, fallback model phiên).
// Kết quả ĐỔ VÀO list như draft — người dùng sửa tiếp trước khi duyệt; không
// tự tạo phiên.
async function genTeam() {
  const s = parent.value
  if (!s?.engineId || genBusy.value || fieldBusy.value || !brief.value.trim()) return
  genBusy.value = true
  try {
    const res = await store.generateSpawnDraft({
      sessionId: s.engineId,
      brief: brief.value.trim(),
      mode: 'team',
    })
    if (res?.children?.length) {
      // Sinh lại cả ê-kíp KHÔNG được xoá agent user đã gắn: bảo lưu picker theo
      // title trùng khớp — con mới trùng tên con cũ coi như cùng một vai.
      const keepAgent = new Map(children.value.map((c) => [c.title.trim(), c.agentKey]))
      children.value = res.children.slice(0, MAX_CHILDREN).map((c) => ({
        key: seq++,
        title: c.title,
        role: c.role,
        prompt: c.prompt,
        ovr: null,
        agentKey: keepAgent.get(c.title.trim()) ?? specAgentKey(c),
      }))
    } else {
      toast.add({ title: t('sessions.spawn.genFailed'), color: 'error' })
    }
  } finally {
    genBusy.value = false
  }
}

// Sparkle trên từng ô → mode 'field': chỉ sinh lại ô đó của con đó, các ô/field
// khác (kể cả context truyền đi để sinh cho khớp) giữ nguyên y như người nhập.
async function genField(c: DraftChild, field: 'title' | 'prompt') {
  const s = parent.value
  if (!s?.engineId || genBusy.value || fieldBusy.value) return
  fieldBusy.value = true
  try {
    const res = await store.generateSpawnDraft({
      sessionId: s.engineId,
      brief: brief.value.trim(),
      mode: 'field',
      field,
      context: { title: c.title, role: c.role, prompt: c.prompt },
    })
    if (res?.value) c[field] = res.value
    else toast.add({ title: t('sessions.spawn.genFailed'), color: 'error' })
  } finally {
    fieldBusy.value = false
  }
}

const canSubmit = computed(
  () =>
    children.value.length >= 1 && children.value.every((c) => c.title.trim() && c.prompt.trim()),
)

// Dòng tóm tắt trên chip "Cấu hình chung": giá trị HIỆU LỰC sau khi trộn lựa
// chọn chung với kế thừa phiên cha (account · model · level · mode).
const sharedSummary = computed(() => {
  const s = parent.value
  const d = shared.value
  const acc = d.accountId
    ? (accountById(d.accountId)?.display ?? s?.account ?? '')
    : (s?.account ?? '')
  const model = d.model || s?.model || ''
  const lv = d.level || (s?.ultracode ? 'ultracode' : s?.thinkingLevel) || ''
  const level = lv
    ? lv === 'ultracode'
      ? t('common.thinking.ultracode')
      : t(`common.thinking.${lv}`)
    : ''
  const modeV = d.mode || MODE_TO_ENGINE[s?.mode ?? ''] || ''
  const modeK = MODE_KEYS.find(([v]) => v === modeV)?.[1]
  const mode = modeK ? t(`sessions.mode.${modeK}`) : ''
  return [acc, model, level, mode].filter(Boolean).join(' · ')
})

const subtitle = computed(() => {
  const s = parent.value
  if (!s) return ''
  return req.value
    ? t('sessions.spawn.subAgent', { parent: s.title, count: children.value.length })
    : t('sessions.spawn.subManual', { parent: s.title })
})

// ── Lifecycle ──
// Reseed khi NGUỒN đổi: request mới lên đầu hàng đợi (requestId đổi) hoặc popover
// thủ công mở/đóng (parentId đổi). `open` suy ra từ hai biến này nên không cần
// watch riêng — hai đỉnh watch phủ đủ mọi cạnh chuyển của open.
watch(
  [() => req.value?.requestId, () => dlg.parentId.value],
  () => {
    if (open.value) seed()
  },
  { immediate: true },
)

// Esc = đường `close` (từ chối ở đường duyệt / đóng ở đường thủ công). Trừ khi
// một menu AppSelect đang mở — Esc đó là của menu (handler riêng của nó không
// stopPropagation, nên phải tự né ở đây).
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (document.querySelector('.aselmenu')) return
  void close()
}
watch(open, (v) => {
  if (v) window.addEventListener('keydown', onEsc)
  else window.removeEventListener('keydown', onEsc)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

function seed() {
  busy.value = false
  brief.value = ''
  genBusy.value = false
  fieldBusy.value = false
  sharedOpen.value = false
  const s = parent.value
  // Nhớ gốc nhóm (đường thủ công có thể mở trên gốc đã có spawnConfig).
  const rootEid = s ? store.groupRootEid(s) : undefined
  const root = rootEid ? store.byEngineId(rootEid) : undefined
  rootClientId.value = root?.id ?? null
  hadSaved.value = !!root?.spawnConfig
  shared.value = root?.spawnConfig
    ? draftFromConfig(root.spawnConfig)
    : s
      ? draftFromSession(s)
      : blankCfg()
  remember.value = true
  const src = req.value?.children
  children.value = src?.length
    ? src.map((c) => ({
        key: seq++,
        title: c.title,
        role: c.role,
        prompt: c.prompt,
        ovr: null,
        // Đề xuất của model có thể đã gắn agent (create_session nhận agent*).
        agentKey: specAgentKey(c),
      }))
    : [{ key: seq++, title: '', role: '', prompt: '', ovr: null, agentKey: '' }]
  // Ô "Yêu cầu": ưu tiên `goal` model gửi kèm create_session; không có thì suy
  // ra từ bản đề xuất — một con lấy nguyên prompt (đó chính là yêu cầu), nhiều
  // con ghép "title — role". Đường thủ công không có đề xuất nên bắt đầu trống.
  const goal = req.value?.goal?.trim()
  brief.value =
    goal ||
    (src?.length === 1
      ? src[0]!.prompt
      : (src?.map((c) => (c.role ? `${c.title} — ${c.role}` : c.title)).join('; ') ?? ''))
  if (s?.project) void ensureStylesLoaded([s.project])
  // Picker agent cần danh bạ đã nạp; global + tầng project của phiên cha.
  if (agents.available) void agents.loadAgents(s?.project ? [s.project] : [])
}

// Đóng = TỪ CHỐI ở đường duyệt (không duyệt ⇒ không phiên nào được tạo); chỉ đóng
// ở đường thủ công. Esc + click nền đi cùng đường này.
async function close() {
  if (busy.value) return
  const r = req.value
  if (r) {
    busy.value = true
    try {
      await store.resolveSpawn({ requestId: r.requestId, approved: false })
    } finally {
      busy.value = false
    }
  } else {
    dlg.close()
  }
}

async function approve() {
  if (!canSubmit.value || busy.value) return
  busy.value = true
  try {
    const cfg = cfgOf(shared.value)
    const specs: SpawnChildSpec[] = children.value.map((c) => {
      const merged = cfgOf(mergeDrafts(shared.value, c.ovr))
      const spec: SpawnChildSpec = {
        title: c.title.trim(),
        role: c.role.trim(),
        prompt: c.prompt.trim(),
      }
      if (merged) spec.config = merged
      // "Vai có thật": bóc agentKey ra bộ ba phẳng của SpawnChildSpec — khoá
      // lạc hậu (agent bị xoá giữa chừng) thì gửi trần, sidecar tự báo lỗi.
      const agent = c.agentKey ? agents.agentByKey(c.agentKey) : undefined
      if (agent) {
        spec.agentId = agent.id
        spec.agentSource = agent.source
        if (agent.projectId) spec.agentProjectId = agent.projectId
      }
      return spec
    })
    // Yêu cầu trong ô brief được chat vào phiên cha khi duyệt THÀNH CÔNG — cha
    // nhận được mục tiêu điều phối dưới dạng một tin nhắn thường (queue nếu
    // đang chạy). Chỉ gửi khi thực sự có con được tạo, để cha không nhận một
    // yêu cầu "đã điều phối" trên một lô fail sạch.
    const msg = brief.value.trim()
    // Chụp id TRƯỚC khi resolve — resolveSpawn xoá request khỏi hàng nên
    // computed `parent` lập tức rơi về null và brief sẽ không bao giờ đi được.
    const pid = parent.value?.id
    const sendBriefToParent = () => {
      if (msg && pid != null) void store.sendMessage(pid, msg)
    }
    if (req.value) {
      // Chỉ chat yêu cầu vào cha khi request thật sự được héo — resolved:false
      // (lượt cha vừa bị huỷ) hay RPC lỗi mà vẫn gửi thì cha nhận một tin "đã
      // điều phối" mồ côi trong khi không con nào được tạo.
      const ok = await store.resolveSpawn({
        requestId: req.value.requestId,
        approved: true,
        children: specs,
        ...(cfg ? { config: cfg } : {}),
        remember: remember.value,
      })
      if (ok) sendBriefToParent()
    } else if (dlg.parentId.value != null) {
      // Bỏ tick "nhớ" trên nhóm ĐÃ nhớ ⇒ revoke luôn — checkbox phải thành lời
      // hứa thật, không được im lặng giữ config cũ.
      if (!remember.value && hadSaved.value && rootClientId.value != null) {
        await store.setSpawnConfig(rootClientId.value, null)
      }
      const res = await store.spawnChildrenFromUi({
        parentId: dlg.parentId.value,
        children: specs,
        ...(cfg ? { config: cfg } : {}),
        remember: remember.value,
      })
      if (!res) {
        toast.add({ title: t('sessions.spawn.failed', { n: specs.length }), color: 'error' })
      } else {
        if (res.created.length) {
          toast.add({
            title: t('sessions.spawn.created', { n: res.created.length }),
            color: 'success',
          })
        }
        if (res.failed.length) {
          toast.add({
            title: t('sessions.spawn.failed', { n: res.failed.length }),
            description: res.failed.map((f) => `${f.title}: ${f.reason}`).join('\n'),
            color: 'error',
          })
        }
        if (res.created.length) sendBriefToParent()
      }
      dlg.close()
    }
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.spw-ovl {
  position: fixed;
  inset: 0;
  /* 155: trên mọi form-modal (≤150) nhưng DƯỚI menu của AppSelect (160, teleported
     ra body) và confirm (200) — đặt cao hơn thì các select trong dialog chìm xuống
     dưới chính overlay này. */
  z-index: 155;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.spw-card {
  width: 620px;
  max-width: 94vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius); /* rounded-lg */
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.spw-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.spw-headtx {
  flex: 1;
  min-width: 0;
}
.spw-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--foreground);
}
.spw-sub {
  margin-top: 2px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
.spw-x {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-xs); /* rounded-sm */
}
.spw-x:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.spw-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spw-sec {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted-foreground);
}
.spw-secrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.spw-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
}
.spw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.spw-fl {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
.spw-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted-foreground);
  border-radius: var(--r-xs); /* rounded-sm */
  padding: 4px 10px;
  font-size: var(--fs-sm);
  cursor: pointer;
  font-family: var(--sans);
}
.spw-add:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.spw-add:disabled {
  opacity: 0.45;
  cursor: default;
}
.spw-briefrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spw-briefhint {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  min-width: 0;
}
/* Chip thu gọn "Cấu hình chung" — pill một dòng, bấm mở lưới select bên dưới. */
.spw-chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--muted-foreground);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 4px 10px;
  border-radius: var(--r-pill);
  font-family: var(--sans);
}
.spw-chip:hover {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.spw-chip-sum {
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.spw-chipgrid {
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  background: var(--muted);
}
.spw-child {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  background: var(--muted);
}
.spw-crow {
  display: flex;
  gap: 6px;
}
.spw-in {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  background: var(--background);
  border: 1px solid var(--input);
  border-radius: var(--r-xs); /* rounded-sm */
  color: var(--foreground);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  outline: none;
}
.spw-in:focus-visible {
  border-color: var(--input);
  box-shadow: 0 0 0 1px var(--ring);
}
.spw-role {
  flex: 0 0 34%;
}
.spw-cx {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-xs); /* rounded-sm */
}
.spw-cx:hover {
  color: var(--destructive);
  background: rgb(from var(--destructive) r g b / 0.1);
}
.spw-cx:disabled {
  opacity: 0.35;
  cursor: default;
}
/* Nút sparkle phải sau .spw-cx:hover — cùng specificity, cái sau thắng —
   để hover ra accent thay vì danger (trash mới là danger). */
.spw-genbtn:hover {
  color: var(--primary);
  background: var(--accent-wash);
}
.spw-crow2 {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* Hàng picker agent: label cố định trái, select chiếm phần còn lại. */
.spw-agentrow {
  gap: 8px;
}
.spw-agentrow .spw-fl {
  flex: 0 0 auto;
}
.spw-ta {
  width: 100%;
  resize: vertical;
  min-height: 40px;
  padding: 7px 10px;
  background: var(--background);
  border: 1px solid var(--input);
  border-radius: var(--r-xs); /* rounded-sm */
  color: var(--foreground);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  outline: none;
}
.spw-ta:focus-visible {
  border-color: var(--input);
  box-shadow: 0 0 0 1px var(--ring);
}
.spw-ovr {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 2px 4px;
  border-radius: var(--r-xs); /* rounded-sm */
  font-family: var(--sans);
}
.spw-ovr:hover {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.spw-ovr:disabled {
  opacity: 0.45;
  cursor: default;
}
.spw-ovr-chev {
  transition: transform 0.15s;
}
.spw-ovr-chev.open {
  transform: rotate(180deg);
}
.spw-ovrgrid {
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.spw-foot {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.spw-rm {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  color: var(--foreground);
  cursor: pointer;
}
.spw-note {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
.spw-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.spw-actions .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.spw-err {
  font-size: var(--fs-xs);
  color: var(--destructive);
}
</style>
