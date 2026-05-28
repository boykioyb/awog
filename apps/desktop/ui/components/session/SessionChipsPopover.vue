<template>
  <div ref="rootRef" class="flex items-center gap-1 flex-wrap">
    <!-- Provider chip -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
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
          class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Connection
        </div>
        <button
          v-for="p in availableProviders"
          :key="p"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
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
            class="ml-auto text-[9px] uppercase tracking-wider"
            :style="{ color: t.textDim }"
          >
            Not connected
          </span>
        </button>
      </div>
    </div>

    <!-- Model + Effort chip. Effort lives under the model popover (Claude Code
         pattern) since the supported level range is model-dependent. -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
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
          class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          {{ PROVIDER_LABEL[session.settings.provider] }} · Models
        </div>
        <button
          v-for="m in availableModels"
          :key="m.id"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
          :style="{
            background: session.settings.modelId === m.id ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '220px',
          }"
          @click="onPickModel(m.id)"
        >
          <span class="flex-1 min-w-0">{{ m.label }}</span>
          <span class="text-[9px] uppercase tracking-wider" :style="{ color: t.textDim }">
            {{ m.tier }}
          </span>
          <Check
            v-if="session.settings.modelId === m.id"
            :size="11"
            :style="{ color: t.success }"
          />
        </button>

        <div
          class="px-2.5 py-1 mt-1 text-[10px] uppercase tracking-wider"
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
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition disabled:cursor-not-allowed"
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
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
        :style="chipStyle(openPop === 'mode')"
        @click="togglePop('mode')"
      >
        <component :is="currentModeDef.icon" :size="10" />
        {{ currentModeDef.label }}
        <span
          v-if="hasAnyDisabled"
          class="font-mono text-[10px]"
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
          class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Mode
        </div>
        <button
          v-for="m in MODE_OPTIONS"
          :key="m.value"
          class="w-full text-left px-2.5 py-1.5 flex items-start gap-2 text-[11px] transition"
          :style="{
            background: session.settings.mode === m.value ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '220px',
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
            <div class="text-[10px] leading-snug" :style="{ color: t.textDim }">
              {{ m.desc }}
            </div>
          </div>
        </button>

        <!-- Tools row: opens the second-level modal. -->
        <button
          type="button"
          class="w-full text-left px-2.5 py-2 flex items-center gap-2 text-[11px] transition"
          :style="{
            color: t.text,
            background: 'transparent',
            borderTop: `1px solid ${t.border}`,
          }"
          @click="openToolsModal"
        >
          <Info :size="11" :style="{ color: t.textDim }" />
          <span class="flex-1">Tools</span>
          <span class="font-mono text-[10px]" :style="{ color: t.textDim }">
            {{ enabledToolCount }}/{{ TOOLS_CATALOG.length }}
          </span>
          <ChevronRight :size="11" :style="{ color: t.textDim }" />
        </button>
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
          <div class="text-[13px] font-semibold flex-1" :style="{ color: t.text }">
            Tools · {{ enabledToolCount }}/{{ TOOLS_CATALOG.length }}
          </div>
          <button
            type="button"
            class="text-[10px] underline-offset-2 hover:underline disabled:opacity-50 px-2"
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
              class="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-wider"
              :style="{ color: t.textFaint }"
            >
              {{ TOOL_GROUP_LABEL[group] }}
            </div>
            <button
              v-for="tool in toolsByGroup(group)"
              :key="tool.name"
              type="button"
              class="w-full text-left px-3 py-1.5 flex items-start gap-2 text-[11px] transition hover:bg-white/5"
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
                <div class="text-[10px] leading-snug" :style="{ color: t.textDim }">
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
  CheckCheck,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Info,
  ListChecks,
  Play,
  Sparkles,
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

type PopoverName = 'provider' | 'model' | 'mode' | null

// Display order for Effort section — show ALL levels (disabled ones grayed)
// so the user sees the full ladder and can read why a level is unavailable
// (it depends on the chosen model's `supportsThinking` + `maxLevel`).
const ALL_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'extra-high', 'max']

const props = defineProps<{
  session: Session
}>()

const { t } = useTheme()
const settings = useSettingsStore()
const store = useSessionsStore()

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

const chipStyle = (active: boolean) => ({
  background: active ? t.value.bgActive : t.value.bgSubtle,
  color: t.value.text,
  border: `1px solid ${active ? t.value.borderFocus : t.value.border}`,
})

const togglePop = (name: NonNullable<PopoverName>) => {
  openPop.value = openPop.value === name ? null : name
}

const MODE_OPTIONS = [
  {
    value: 'ask' as const,
    label: 'Ask',
    icon: HelpCircle,
    desc: 'Read-only tools run freely; any write or shell command prompts you first.',
  },
  {
    value: 'accept-edits' as const,
    label: 'Accept Edits',
    icon: CheckCheck,
    desc: 'Auto-approve file edits (Edit / Write / MultiEdit). Shell commands still prompt.',
  },
  {
    value: 'plan' as const,
    label: 'Plan',
    icon: ListChecks,
    desc: 'Research-only — the model investigates and proposes a plan, no writes or shell.',
  },
  {
    value: 'execute' as const,
    label: 'Execute',
    icon: Play,
    desc: 'Bypass all prompts — edits AND shell commands run without confirmation. Use with care.',
  },
]

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
