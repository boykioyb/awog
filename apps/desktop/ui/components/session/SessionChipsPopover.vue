<template>
  <div ref="rootRef" class="flex items-center gap-1 flex-wrap">
    <!-- Provider chip -->
    <div v-if="shows('provider')" class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
        :style="chipStyle(openPop === 'provider')"
        @click="togglePop('provider')"
      >
        <Cable :size="10" />
        {{ providerLabel }}
        <ChevronDown :size="9" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'provider'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="popStyle"
      >
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Connection
        </div>
        <button
          v-for="p in availableProviders"
          :key="p"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
          :style="{
            background: session.settings.provider === p ? t.bgActive : 'transparent',
            color: t.text,
          }"
          @click="onPickProvider(p)"
        >
          <span
            class="inline-block w-1.5 h-1.5 rounded-full"
            :style="{
              background: settings.isProviderConnected(p) ? t.success : t.textFaint,
            }"
          />
          {{ PROVIDER_LABEL[p] }}
          <span
            v-if="!settings.isProviderConnected(p)"
            class="ml-auto text-[12px] uppercase tracking-wider"
            :style="{ color: t.textDim }"
          >
            Not connected
          </span>
        </button>
      </div>
    </div>

    <!-- Account chip — per-session account override. Lets two sessions run on
         different accounts concurrently: the runner resolves settings.accountId
         and falls back to the global active account when it's unset. Hidden
         unless the provider has more than one account (nothing to switch). -->
    <div v-if="shows('account') && providerAccounts.length > 0" class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
        :style="chipStyle(openPop === 'account')"
        :title="accountChipTitle"
        @click="togglePop('account')"
      >
        <UserRound :size="10" class="flex-shrink-0" />
        <span class="truncate" :style="{ maxWidth: '120px' }">{{ currentAccountLabel }}</span>
        <ChevronDown :size="9" class="flex-shrink-0" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'account'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="accountPopStyle"
      >
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          {{ PROVIDER_LABEL[session.settings.provider] }} · Account
        </div>
        <button
          v-for="acc in providerAccounts"
          :key="acc.id"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
          :style="{
            background: isAccountActive(acc.id) ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '260px',
          }"
          @click="onPickAccount(acc.id)"
        >
          <span
            class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            :style="{ background: acc.status === 'connected' ? t.success : t.textFaint }"
            :title="acc.status"
          />
          <div class="flex-1 min-w-0">
            <div class="truncate" :style="{ color: t.text }">{{ acc.label }}</div>
            <div
              v-if="acc.account?.email"
              class="text-[12px] font-mono truncate"
              :style="{ color: t.textDim }"
            >
              {{ acc.account.email }}
            </div>
          </div>
          <span
            v-if="acc.id === activeAccountId"
            class="text-[12px] uppercase tracking-wider flex-shrink-0"
            :style="{ color: t.textDim }"
          >
            default
          </span>
          <Check v-if="isAccountActive(acc.id)" :size="11" :style="{ color: t.success }" />
        </button>
        <button
          v-if="session.settings.accountId !== undefined"
          type="button"
          class="w-full text-left px-2.5 py-1.5 text-[1em] transition"
          :style="{ color: t.textDim, borderTop: `1px solid ${t.border}` }"
          @click="resetAccount"
        >
          Follow active account
        </button>
      </div>
    </div>

    <!-- Model + Effort chip. Effort lives under the model popover (Claude Code
         pattern) since the supported level range is model-dependent. -->
    <div v-if="shows('model')" class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
        :style="chipStyle(openPop === 'model')"
        @click="togglePop('model')"
      >
        <Sparkles :size="10" />
        {{ currentModel?.label ?? 'Pick model' }}
        <span v-if="currentModel?.supportsThinking" :style="{ color: t.textDim }">
          · {{ LEVEL_LABEL[session.settings.level] }}
        </span>
        <ChevronDown :size="9" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'model'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="popStyle"
      >
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          {{ PROVIDER_LABEL[session.settings.provider] }} · Models
        </div>
        <button
          v-for="m in availableModels"
          :key="m.id"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
          :style="{
            background: session.settings.modelId === m.id ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '300px',
          }"
          @click="onPickModel(m.id)"
        >
          <span class="flex-1 min-w-0 whitespace-nowrap">{{ m.label }}</span>
          <span
            class="text-[12px] uppercase tracking-wider flex-shrink-0"
            :style="{ color: t.textDim }"
          >
            {{ m.tier }}
          </span>
          <Check
            v-if="session.settings.modelId === m.id"
            :size="11"
            :style="{ color: t.success }"
          />
        </button>

        <div
          class="px-2.5 py-1 mt-1 text-[1em] uppercase tracking-wider"
          :style="{
            color: t.textDim,
            borderTop: `1px solid ${t.border}`,
            borderBottom: `1px solid ${t.border}`,
          }"
        >
          Effort
        </div>
        <button
          v-for="lv in ALL_LEVELS"
          :key="lv"
          type="button"
          :disabled="!availableLevels.includes(lv)"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition disabled:cursor-not-allowed"
          :style="{
            background: session.settings.level === lv ? t.bgActive : 'transparent',
            color: availableLevels.includes(lv) ? t.text : t.textFaint,
            opacity: availableLevels.includes(lv) ? 1 : 0.5,
          }"
          @click="onPickLevel(lv)"
        >
          <span class="flex-1">{{ LEVEL_LABEL[lv] }}</span>
          <Check v-if="session.settings.level === lv" :size="11" :style="{ color: t.success }" />
        </button>
      </div>
    </div>

    <!-- Mode + Tools chip (tools live under the mode popover since the enabled
         tool set is what makes the mode meaningful in practice). -->
    <div v-if="shows('mode')" class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
        :style="chipStyle(openPop === 'mode')"
        @click="togglePop('mode')"
      >
        <component :is="currentModeDef.icon" :size="10" />
        {{ currentModeDef.label }}
        <span
          v-if="hasAnyDisabled"
          class="font-mono text-[1em]"
          :style="{ color: t.textDim }"
          :title="`${enabledToolCount} of ${TOOLS_CATALOG.length} tools enabled`"
        >
          · {{ enabledToolCount }}/{{ TOOLS_CATALOG.length }}
        </span>
        <ChevronDown :size="9" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'mode'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="popStyle"
      >
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Mode
        </div>
        <button
          v-for="m in MODE_OPTIONS"
          :key="m.value"
          class="w-full text-left px-2.5 py-1.5 flex items-start gap-2 text-[1em] transition"
          :style="{
            background: session.settings.mode === m.value ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '300px',
          }"
          @click="onPickMode(m.value)"
        >
          <component
            :is="m.icon"
            :size="11"
            class="mt-0.5 flex-shrink-0"
            :style="{ color: t.textDim }"
          />
          <div class="flex-1 min-w-0">
            <div :style="{ color: t.text }">{{ m.label }}</div>
            <div class="text-[1em] leading-snug" :style="{ color: t.textDim }">
              {{ m.desc }}
            </div>
          </div>
        </button>

        <!-- Tools row: opens the second-level modal. -->
        <button
          type="button"
          class="w-full text-left px-2.5 py-2 flex items-center gap-2 text-[1em] transition"
          :style="{
            color: t.text,
            background: 'transparent',
            borderTop: `1px solid ${t.border}`,
          }"
          @click="openToolsModal"
        >
          <Info :size="11" :style="{ color: t.textDim }" />
          <span class="flex-1">Tools</span>
          <span class="font-mono text-[1em]" :style="{ color: t.textDim }">
            {{ enabledToolCount }}/{{ TOOLS_CATALOG.length }}
          </span>
          <ChevronRight :size="11" :style="{ color: t.textDim }" />
        </button>
      </div>
    </div>

    <!-- MCP chip — per-session whitelist over enabled servers. Hidden when no
         MCP servers exist in the workspace (nothing to pick). -->
    <div v-if="shows('mcp') && mcpEnabledServers.length > 0" class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
        :style="chipStyle(openPop === 'mcp')"
        :title="mcpChipTitle"
        @click="togglePop('mcp')"
      >
        <Plug :size="10" />
        MCP
        <span class="font-mono text-[1em]" :style="{ color: t.textDim }">
          · {{ activeMcpCount }}/{{ mcpEnabledServers.length }}
        </span>
        <ChevronDown :size="9" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'mcp'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="mcpPopStyle"
      >
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider flex items-center gap-2"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          <span class="flex-1">MCP servers</span>
          <button
            v-if="session.mcpServerIds !== undefined"
            class="text-[1em] normal-case tracking-normal hover:underline"
            :style="{ color: t.textDim }"
            @click="resetMcp"
          >
            reset
          </button>
        </div>
        <button
          v-for="srv in mcpEnabledServers"
          :key="srv.id"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
          :style="{ color: t.text, background: 'transparent' }"
          @click="toggleMcp(srv.id)"
        >
          <span
            class="inline-flex items-center justify-center w-4 h-4 rounded-sm flex-shrink-0"
            :style="{
              background: isMcpActive(srv.id) ? t.accent : 'transparent',
              border: `1px solid ${isMcpActive(srv.id) ? t.accent : t.border}`,
            }"
          >
            <Check v-if="isMcpActive(srv.id)" :size="9" :style="{ color: t.accentText }" />
          </span>
          <div class="flex-1 min-w-0">
            <div class="truncate" :style="{ color: t.text }">{{ srv.name }}</div>
            <div class="text-[1em] font-mono truncate" :style="{ color: t.textDim }">
              {{ srv.id }}
              <span v-if="srv.tools.length > 0">· {{ srv.tools.length }} tools</span>
            </div>
          </div>
          <span
            class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            :style="{ background: srv.status === 'running' ? t.success : t.textFaint }"
            :title="srv.status"
          />
        </button>
        <div
          v-if="session.mcpServerIds === undefined"
          class="px-2.5 py-1.5 text-[1em]"
          :style="{ color: t.textDim, borderTop: `1px solid ${t.border}` }"
        >
          Default · all enabled MCP servers participate
        </div>
      </div>
    </div>
  </div>

  <!-- Tools modal (level 2). Opens from the Mode popover's Tools row. -->
  <Teleport to="body">
    <div
      v-if="toolsModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      :style="{ background: t.overlay }"
      @click.self="closeToolsModal"
    >
      <div
        class="w-full max-w-md rounded-lg shadow-xl flex flex-col"
        :style="{
          background: t.bgElevated,
          border: `1px solid ${t.border}`,
          maxHeight: '80vh',
        }"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="px-4 py-3 flex items-center gap-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <Info :size="13" :style="{ color: t.textDim }" />
          <div class="text-[1em] font-semibold flex-1" :style="{ color: t.text }">
            Tools · {{ enabledToolCount }}/{{ TOOLS_CATALOG.length }}
          </div>
          <button
            type="button"
            class="text-[1em] underline-offset-2 hover:underline disabled:opacity-50 px-2"
            :style="{ color: t.textDim }"
            :disabled="!hasAnyDisabled"
            @click="resetAllTools"
          >
            Reset
          </button>
          <button
            type="button"
            class="p-1 rounded transition flex items-center"
            :style="{ color: t.textDim }"
            aria-label="Close"
            @click="closeToolsModal"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="overflow-y-auto py-1">
          <template v-for="group in TOOL_GROUPS" :key="group">
            <div
              class="px-3 pt-2 pb-0.5 text-[1em] uppercase tracking-wider"
              :style="{ color: t.textFaint }"
            >
              {{ TOOL_GROUP_LABEL[group] }}
            </div>
            <button
              v-for="tool in toolsByGroup(group)"
              :key="tool.name"
              type="button"
              class="w-full text-left px-3 py-1.5 flex items-start gap-2 text-[1em] transition hover:bg-white/5"
              :style="{ color: t.text, background: 'transparent' }"
              @click="toggleTool(tool.name)"
            >
              <component
                :is="tool.icon"
                :size="12"
                class="mt-0.5 flex-shrink-0"
                :style="{ color: isToolEnabled(tool.name) ? t.text : t.textFaint }"
              />
              <div class="flex-1 min-w-0">
                <div
                  :style="{
                    color: isToolEnabled(tool.name) ? t.text : t.textDim,
                    textDecoration: isToolEnabled(tool.name) ? 'none' : 'line-through',
                  }"
                >
                  {{ tool.label }}
                </div>
                <div class="text-[1em] leading-snug" :style="{ color: t.textDim }">
                  {{ tool.description }}
                </div>
              </div>
              <span
                class="mt-1 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{
                  background: isToolEnabled(tool.name) ? t.success : t.textFaint,
                  opacity: isToolEnabled(tool.name) ? 1 : 0.5,
                }"
              />
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Plug,
  Sparkles,
  UserRound,
  X,
} from 'lucide-vue-next'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AgentMode, ProviderName, Session, ThinkingLevel } from '~/types'
import {
  LEVEL_LABEL,
  PROVIDER_LABEL,
  levelsForModel,
  modelById,
  modelsForProvider,
} from '~/utils/models'
import { TOOLS_CATALOG, TOOL_GROUP_LABEL, type ToolGroup } from '~/utils/tools-catalog'
import { MODE_OPTIONS } from '~/utils/session-modes'

type PopoverName = 'provider' | 'account' | 'model' | 'mode' | 'mcp' | null

// Display order for Effort section — show ALL levels (disabled ones grayed)
// so the user sees the full ladder and can read why a level is unavailable
// (it depends on the chosen model's `supportsThinking` + `maxLevel`).
const ALL_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'extra-high', 'max']

// `only` filters which chips render so the composer can split them across
// rows (e.g. Mode + MCP above the input, the rest below). Undefined = show all.
type ChipKind = 'provider' | 'account' | 'model' | 'mode' | 'mcp'

const props = defineProps<{
  session: Session
  only?: ChipKind[]
}>()

const shows = (kind: ChipKind): boolean => !props.only || props.only.includes(kind)

const { t } = useTheme()
const settings = useSettingsStore()
const store = useSessionsStore()
const ws = useWorkspaceStore()

const rootRef = ref<HTMLElement | null>(null)
const openPop = ref<PopoverName>(null)

useClickOutside(rootRef, () => {
  openPop.value = null
})

const availableProviders = computed<ProviderName[]>(() => ['anthropic', 'openai', 'google'])
const availableModels = computed(() => modelsForProvider(props.session.settings.provider))
const currentModel = computed(() => modelById(props.session.settings.modelId))
const availableLevels = computed(() => levelsForModel(currentModel.value))
const providerLabel = computed(() => PROVIDER_LABEL[props.session.settings.provider])

const popStyle = computed(() => ({
  background: t.value.bgPanel,
  border: `1px solid ${t.value.borderStrong}`,
  boxShadow: `0 8px 24px ${t.value.shadow}`,
  minWidth: '200px',
}))

// Borderless chips (user preference): no background, no border. The open/closed
// state is carried by text brightness (active = full text, idle = dimmed) and
// the chevron + the popover itself — not a box outline.
const chipStyle = (active: boolean) => ({
  background: 'transparent',
  color: active ? t.value.text : t.value.textDim,
})

const togglePop = (name: NonNullable<PopoverName>) => {
  openPop.value = openPop.value === name ? null : name
}

const currentModeDef = computed(
  () => MODE_OPTIONS.find((m) => m.value === props.session.settings.mode) ?? MODE_OPTIONS[0]!,
)

const resolveLevel = (levels: ThinkingLevel[]) =>
  (levels.includes(props.session.settings.level) ? props.session.settings.level : levels[0])!

const onPickProvider = (p: ProviderName) => {
  if (!settings.isProviderConnected(p)) return
  const firstModel = modelsForProvider(p)[0]
  if (!firstModel) return
  store.updateSettings(props.session.id, {
    provider: p,
    modelId: firstModel.id,
    level: resolveLevel(levelsForModel(firstModel)),
  })
  openPop.value = null
}

const onPickModel = (modelId: string) => {
  const model = modelById(modelId)
  if (!model) return
  store.updateSettings(props.session.id, {
    modelId,
    level: resolveLevel(levelsForModel(model)),
  })
  openPop.value = null
}

const onPickLevel = (lv: ThinkingLevel) => {
  store.updateSettings(props.session.id, { level: lv })
  openPop.value = null
}

const onPickMode = (m: AgentMode) => {
  store.updateSettings(props.session.id, { mode: m })
  openPop.value = null
}

// ─── Account chip ─────────────────────────────────────────────────────────────
// Per-session account selection so concurrent sessions can each pin a different
// account (the single global "active" account in Settings is only the default).
// undefined accountId = follow the global active; an explicit id pins this
// session even when the global active later changes.

const providerAccounts = computed(
  () => settings.providers[props.session.settings.provider]?.accounts ?? [],
)
const activeAccountId = computed(
  () => settings.providers[props.session.settings.provider]?.activeAccountId ?? null,
)
// The account actually in effect for this session: explicit override, else the
// global active. Drives both the chip label and the row highlight/check.
const effectiveAccountId = computed(() => props.session.settings.accountId ?? activeAccountId.value)
const currentAccount = computed(
  () => providerAccounts.value.find((a) => a.id === effectiveAccountId.value) ?? null,
)
const currentAccountLabel = computed(() => currentAccount.value?.label ?? 'Account')
const isAccountActive = (id: string): boolean => effectiveAccountId.value === id

const accountChipTitle = computed(() => {
  const label = currentAccount.value?.label
  if (props.session.settings.accountId === undefined) {
    return `Following the active account${label ? ` · ${label}` : ''}`
  }
  return `Pinned to ${label ?? 'account'} for this session`
})

const accountPopStyle = computed(() => ({
  background: t.value.bgPanel,
  border: `1px solid ${t.value.borderStrong}`,
  boxShadow: `0 8px 24px ${t.value.shadow}`,
  minWidth: '260px',
  maxHeight: '320px',
  overflowY: 'auto' as const,
}))

const onPickAccount = (id: string) => {
  store.updateSettings(props.session.id, { accountId: id })
  openPop.value = null
}

const resetAccount = () => {
  store.updateSettings(props.session.id, { accountId: undefined })
  openPop.value = null
}

// ─── Tools chip ──────────────────────────────────────────────────────────────

const TOOL_GROUPS: ToolGroup[] = ['file', 'shell', 'search', 'web', 'meta']

const disabledSet = computed(() => new Set(props.session.disabledTools ?? []))

const enabledToolCount = computed(() => TOOLS_CATALOG.length - disabledSet.value.size)

const hasAnyDisabled = computed(() => disabledSet.value.size > 0)

const toolsByGroup = (group: ToolGroup) => TOOLS_CATALOG.filter((tool) => tool.group === group)

const isToolEnabled = (name: string) => !disabledSet.value.has(name)

const toggleTool = (name: string) => {
  const set = new Set(disabledSet.value)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  store.setDisabledTools(props.session.id, [...set])
}

const resetAllTools = () => {
  store.setDisabledTools(props.session.id, [])
}

// ─── MCP chip ───────────────────────────────────────────────────────────────
// Per-session whitelist over the globally-enabled servers. Mirrors sidecar
// semantics: undefined = use all enabled (default), explicit array = filter.

const mcpEnabledServers = computed(() => ws.mcpServers.filter((s) => s.enabled))

const isMcpActive = (id: string): boolean => {
  const list = props.session.mcpServerIds
  if (list === undefined) return true
  return list.includes(id)
}

const activeMcpCount = computed<number>(
  () => mcpEnabledServers.value.filter((s) => isMcpActive(s.id)).length,
)

const mcpPopStyle = computed(() => ({
  background: t.value.bgPanel,
  border: `1px solid ${t.value.borderStrong}`,
  boxShadow: `0 8px 24px ${t.value.shadow}`,
  minWidth: '260px',
  maxHeight: '320px',
  overflowY: 'auto' as const,
}))

const mcpChipTitle = computed(() => {
  const total = mcpEnabledServers.value.length
  const active = activeMcpCount.value
  if (props.session.mcpServerIds === undefined) return `All ${total} enabled MCP servers active`
  return `${active}/${total} MCP servers active for this session`
})

const toggleMcp = (id: string) => {
  // First click switches from undefined (default-all) to explicit selection so
  // the user's first toggle reads literally: tick = include, untick = exclude.
  const current = props.session.mcpServerIds ?? mcpEnabledServers.value.map((s) => s.id)
  const set = new Set(current)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  store.setMcpServerIds(props.session.id, [...set])
}

const resetMcp = () => {
  store.setMcpServerIds(props.session.id, undefined)
  openPop.value = null
}

// ─── Tools modal (level-2) ──────────────────────────────────────────────────
// Separate from the Mode popover so the popover stays compact. Opening this
// closes the Mode popover so the underlying overlay isn't double-stacked.
const toolsModalOpen = ref(false)
const openToolsModal = () => {
  openPop.value = null
  toolsModalOpen.value = true
}
const closeToolsModal = () => {
  toolsModalOpen.value = false
}

const onToolsModalKey = (e: KeyboardEvent) => {
  if (!toolsModalOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeToolsModal()
  }
}
onMounted(() => document.addEventListener('keydown', onToolsModalKey))
onUnmounted(() => document.removeEventListener('keydown', onToolsModalKey))
</script>
