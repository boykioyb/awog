<template>
  <!-- Dialog shadcn (z-170): trên mọi form-modal (≤150) nhưng DƯỚI menu của AppSelect
       (popper z-180, teleport ra body) — nên các select trong hộp không chìm. Esc do
       `onEsc` bên dưới lo (né khi một menu AppSelect đang mở) nên chặn Esc của Dialog;
       click nền / nút × đi đường `close` (từ chối ở đường duyệt / đóng ở thủ công). -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && void close()">
    <DialogContent
      class="flex max-h-[86vh] w-155 max-w-[94vw] flex-col gap-0 overflow-hidden bg-card p-0 text-card-foreground"
      @escape-key-down.prevent
    >
      <div class="flex items-start gap-3 border-b px-4 pt-3.5 pr-10 pb-2.5">
        <div class="min-w-0 flex-1">
          <DialogTitle class="text-base font-semibold text-foreground">
            {{ t('sessions.spawn.title') }}
          </DialogTitle>
          <DialogDescription class="mt-0.5 text-sm text-muted-foreground">
            {{ subtitle }}
          </DialogDescription>
        </div>
      </div>

      <div class="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
        <div class="text-xs font-semibold text-muted-foreground">
          {{ t('sessions.spawn.brief') }}
        </div>
        <Textarea
          v-model="brief"
          class="min-h-10 resize-y rounded-sm bg-background px-2.5 py-1.75 text-sm"
          rows="3"
          :placeholder="t('sessions.spawn.briefPh')"
        />
        <div class="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="xs"
            class="gap-1.25 font-normal text-muted-foreground shadow-none [&_svg]:size-3"
            :disabled="!brief.trim() || genBusy || fieldBusy"
            @click="genTeam"
          >
            <Icon name="sparkles" />
            {{ genBusy ? t('sessions.spawn.generating') : t('sessions.spawn.generate') }}
          </Button>
          <span class="min-w-0 text-xs text-muted-foreground">
            {{ t('sessions.spawn.briefHint') }}
          </span>
        </div>

        <!-- Chip thu gọn "Cấu hình chung" — pill một dòng, bấm mở lưới select bên dưới. -->
        <Button
          variant="outline"
          size="xs"
          type="button"
          class="max-w-full self-start rounded-full bg-muted px-2.5 gap-1.25 font-normal text-muted-foreground shadow-none [&_svg]:size-3"
          @click="sharedOpen = !sharedOpen"
        >
          <Icon
            name="chev"
            class="transition-transform motion-reduce:transition-none"
            :class="{ 'rotate-180': sharedOpen }"
          />
          <span>{{ t('sessions.spawn.shared') }}</span>
          <span class="min-w-0 truncate">{{ sharedSummary }}</span>
        </Button>
        <div
          v-if="sharedOpen"
          class="grid grid-cols-2 gap-x-2.5 gap-y-2 rounded-md border border-dashed bg-muted p-2.5"
        >
          <div
            v-for="f in fieldsFor(shared, inheritParent)"
            :key="f.key"
            class="flex min-w-0 flex-col gap-1"
          >
            <span class="text-xs text-muted-foreground">{{ f.label }}</span>
            <AppSelect
              :model-value="shared[f.key]"
              :options="f.opts"
              width="100%"
              @update:model-value="(v: string) => setField(shared, f.key, v)"
            />
          </div>
        </div>

        <div class="flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>{{ t('sessions.spawn.children', { n: children.length }) }}</span>
          <Button
            variant="outline"
            size="xs"
            class="gap-1.25 font-normal text-muted-foreground shadow-none [&_svg]:size-3"
            :disabled="children.length >= MAX_CHILDREN"
            @click="addChild"
          >
            <Icon name="plus" />
            {{ t('sessions.spawn.add') }}
          </Button>
        </div>

        <div
          v-for="(c, i) in children"
          :key="c.key"
          class="flex flex-col gap-1.5 rounded-md border bg-muted p-2.5"
        >
          <div class="flex gap-1.5">
            <Input
              v-model="c.title"
              :placeholder="t('sessions.spawn.childTitle')"
              maxlength="80"
              class="h-auto min-w-0 flex-1 rounded-sm bg-background px-2.5 py-1.75 text-sm"
            />
            <!-- Nút sparkle hover ra accent; thùng rác mới là danger. -->
            <Button
              variant="ghost"
              size="iconSm"
              class="flex-none text-muted-foreground disabled:opacity-35 hover:text-primary"
              :disabled="fieldBusy || genBusy"
              :aria-label="t('sessions.spawn.genField')"
              :title="t('sessions.spawn.genField')"
              @click="genField(c, 'title')"
            >
              <Icon name="sparkles" />
            </Button>
            <Input
              v-model="c.role"
              :placeholder="t('sessions.spawn.childRole')"
              maxlength="60"
              class="h-auto min-w-0 flex-1 rounded-sm bg-background px-2.5 py-1.75 text-sm flex-none basis-[34%]"
            />
            <Button
              variant="ghost"
              size="iconSm"
              class="flex-none text-muted-foreground disabled:opacity-35 hover:bg-destructive/10 hover:text-destructive"
              :disabled="children.length <= 1"
              :aria-label="t('sessions.spawn.childRemove')"
              @click="children.splice(i, 1)"
            >
              <Icon name="trash" />
            </Button>
          </div>
          <Textarea
            v-model="c.prompt"
            class="min-h-10 resize-y rounded-sm bg-background px-2.5 py-1.75 text-sm"
            rows="2"
            :placeholder="t('sessions.spawn.childPrompt')"
          />
          <!-- "Vai có thật" của con (session-teams §3): agent AWOG gắn vào phiên
               con lúc spawn. '' = con trần; giá trị là agentKey (source|proj|id)
               để phân biệt hai agent trùng id ở hai tầng. Nhãn cố định trái, select
               chiếm phần còn lại. -->
          <div class="flex items-center gap-2">
            <span class="flex-none text-xs text-muted-foreground">
              {{ t('sessions.spawn.f.agent') }}
            </span>
            <AppSelect
              :model-value="c.agentKey"
              :options="agentOpts"
              width="100%"
              @update:model-value="(v: string) => (c.agentKey = v)"
            />
          </div>
          <div class="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="xs"
              class="h-auto self-start gap-1.25 px-1 py-0.5 text-xs font-normal text-muted-foreground [&_svg]:size-3"
              :disabled="fieldBusy || genBusy"
              @click="genField(c, 'prompt')"
            >
              <Icon name="sparkles" />
              {{ fieldBusy ? t('sessions.spawn.generating') : t('sessions.spawn.genField') }}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              class="h-auto self-start gap-1.25 px-1 py-0.5 text-xs font-normal text-muted-foreground [&_svg]:size-3"
              @click="toggleOvr(c)"
            >
              <Icon
                name="chev"
                class="transition-transform motion-reduce:transition-none"
                :class="{ 'rotate-180': !!c.ovr }"
              />
              {{ t('sessions.spawn.childCustom') }}
            </Button>
          </div>
          <div v-if="c.ovr" class="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-dashed pt-1">
            <div
              v-for="f in fieldsFor(c.ovr, inheritShared, shared)"
              :key="f.key"
              class="flex min-w-0 flex-col gap-1"
            >
              <span class="text-xs text-muted-foreground">{{ f.label }}</span>
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

      <div class="flex flex-col gap-2 border-t px-4 py-3">
        <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <Checkbox
            :model-value="remember"
            @update:model-value="(v: boolean | 'indeterminate') => (remember = v === true)"
          />
          <span>{{ t('sessions.spawn.remember') }}</span>
        </label>
        <div class="flex justify-end gap-2">
          <Button :disabled="busy" variant="outline" @click="close">
            {{ manual ? t('common.cancel') : t('sessions.spawn.deny') }}
          </Button>
          <Button :disabled="busy || !canSubmit" variant="default" @click="approve">
            {{ t('sessions.spawn.approve', { n: children.length }) }}
          </Button>
        </div>
        <div v-if="!canSubmit" class="text-xs text-destructive">
          {{ t('sessions.spawn.invalid') }}
        </div>
      </div>
    </DialogContent>
  </Dialog>
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

// "Tạo bằng AI" → sessions.spawnDraft mode 'team': sidecar gọi complete với
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
