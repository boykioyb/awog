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

    <!-- Model chip -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
        :style="chipStyle(openPop === 'model')"
        @click="togglePop('model')"
      >
        <Sparkles :size="10" />
        {{ currentModel?.label ?? 'Pick model' }}
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
          {{ PROVIDER_LABEL[session.settings.provider] }} · Model
        </div>
        <button
          v-for="m in availableModels"
          :key="m.id"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
          :style="{
            background: session.settings.modelId === m.id ? t.bgActive : 'transparent',
            color: t.text,
          }"
          @click="onPickModel(m.id)"
        >
          <span class="flex-1 min-w-0">{{ m.label }}</span>
          <span class="text-[9px] uppercase tracking-wider" :style="{ color: t.textDim }">
            {{ m.tier }}
          </span>
        </button>
      </div>
    </div>

    <!-- Level chip -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
        :style="chipStyle(openPop === 'level')"
        :disabled="availableLevels.length <= 1"
        @click="togglePop('level')"
      >
        <Gauge :size="10" />
        {{ LEVEL_LABEL[session.settings.level] }}
        <ChevronDown v-if="availableLevels.length > 1" :size="9" :style="{ color: t.textDim }" />
      </button>
      <div
        v-if="openPop === 'level'"
        class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
        :style="popStyle"
      >
        <div
          class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Thinking level
        </div>
        <button
          v-for="lv in availableLevels"
          :key="lv"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
          :style="{
            background: session.settings.level === lv ? t.bgActive : 'transparent',
            color: t.text,
          }"
          @click="onPickLevel(lv)"
        >
          {{ LEVEL_LABEL[lv] }}
        </button>
      </div>
    </div>

    <!-- Mode chip -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] transition"
        :style="chipStyle(openPop === 'mode')"
        @click="togglePop('mode')"
      >
        <component :is="currentModeDef.icon" :size="10" />
        {{ currentModeDef.label }}
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Cable,
  CheckCheck,
  ChevronDown,
  Gauge,
  HelpCircle,
  ListChecks,
  Play,
  Sparkles,
} from 'lucide-vue-next'
import { ref, computed } from 'vue'
import type { AgentMode, ProviderName, Session, ThinkingLevel } from '~/types'
import {
  LEVEL_LABEL,
  PROVIDER_LABEL,
  levelsForModel,
  modelById,
  modelsForProvider,
} from '~/utils/models'

type PopoverName = 'provider' | 'model' | 'level' | 'mode' | null

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
    desc: 'Đọc + trả lời. Không tự sửa file.',
  },
  {
    value: 'accept-edits' as const,
    label: 'Accept Edits',
    icon: CheckCheck,
    desc: 'Tự áp dụng mọi edit, không hỏi xác nhận.',
  },
  {
    value: 'plan' as const,
    label: 'Plan',
    icon: ListChecks,
    desc: 'Lập kế hoạch + propose patch, chưa thực thi.',
  },
  {
    value: 'execute' as const,
    label: 'Execute',
    icon: Play,
    desc: 'Toàn quyền — chạy lệnh, sửa file, gọi tool.',
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
</script>
