<template>
  <div
    class="px-2.5 py-2 mx-1 my-0.5 rounded-lg text-left cursor-pointer transition"
    :style="{
      background: pill(selected).background,
      border: `1px solid ${selected ? t.border : 'transparent'}`,
      width: 'calc(100% - 8px)',
    }"
    @click="emit('select')"
    @contextmenu="emit('context-menu', $event)"
    @mouseenter="onHover"
    @mouseleave="onLeave"
  >
    <div class="min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <input
          type="checkbox"
          :checked="checked"
          class="cursor-pointer flex-shrink-0"
          :style="{ accentColor: t.accent }"
          :title="checked ? 'Remove from selection' : 'Add to selection'"
          @click.stop="emit('toggle-bulk')"
        />
        <input
          v-if="renaming"
          ref="inputEl"
          v-model="draftName"
          class="text-[1em] font-medium flex-1 min-w-0 rounded-lg px-1.5 py-0.5"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.borderStrong}`,
            color: t.text,
            outline: 'none',
          }"
          @click.stop
          @keydown.enter="commit"
          @keydown.escape="cancel"
          @blur="commit"
        />
        <div
          v-else
          class="text-[1em] font-medium truncate"
          :style="{ color: t.text }"
          @dblclick.stop="emit('start-rename')"
        >
          {{ agent.name }}
        </div>
        <span
          v-if="agent.role"
          class="text-[12px] leading-none uppercase tracking-wider font-semibold flex-shrink-0 px-1.5 py-0.5 rounded-full font-mono"
          :style="{
            color: t.textMuted,
            background: t.bgInput,
            border: `1px solid ${t.border}`,
          }"
        >
          {{ agent.role }}
        </span>
        <button
          class="p-1 rounded-lg flex-shrink-0 transition opacity-60 hover:opacity-100"
          :style="{ color: t.textMuted }"
          title="Actions"
          @click.stop="emit('open-menu', $event)"
        >
          <MoreHorizontal :size="13" />
        </button>
      </div>
      <div class="flex items-center gap-1.5 mt-0.5">
        <span class="text-[1em] truncate flex-1 min-w-0" :style="{ color: t.textDim }">
          {{ modelLabel }}
        </span>
        <span
          v-if="showSourceBadge"
          class="text-[12px] leading-none px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider whitespace-nowrap flex-shrink-0"
          :style="sourceBadgeStyle"
        >
          {{ sourceLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import type { Agent, AgentSource } from '~/types'
import { MODELS } from '~/utils/models'

const props = defineProps<{
  agent: Agent
  selected: boolean
  checked: boolean
  renaming: boolean
  // True khi list đang gom nhóm theo project (có group header). Khi đó tag project
  // trên item là thừa vì header đã hiển thị tên project — chỉ giữ tag source của
  // agent user/global vì group "User & Global" gộp chung nhiều tier.
  inGroup: boolean
}>()

const emit = defineEmits<{
  select: []
  'toggle-bulk': []
  'context-menu': [e: MouseEvent]
  'open-menu': [e: MouseEvent]
  'start-rename': []
  rename: [value: string]
  'cancel-rename': []
}>()

const { t } = useTheme()
const { pill } = useGlass()
const ws = useWorkspaceStore()

const SOURCE_LABEL: Record<AgentSource, string> = {
  global: '~/.awog',
  project: '.awog',
}

const isProjectAgent = (a: Agent): boolean => a.source === 'project'

const modelLabel = computed(
  () => MODELS.find((m) => m.id === props.agent.model)?.label ?? props.agent.model ?? '',
)

const sourceLabel = computed<string>(() => {
  const a = props.agent
  // Project-tier badge shows just the project name so users can tell which repo
  // a project-scoped agent comes from. The accent styling conveys the tier, so
  // the redundant suffix is dropped to keep the tag compact.
  if (isProjectAgent(a)) {
    const project = a.projectId ? ws.projects.find((p) => p.id === a.projectId) : undefined
    return project?.name ?? a.projectId ?? '?'
  }
  return SOURCE_LABEL[a.source]
})

// Ẩn tag project khi item nằm trong group (header đã chỉ rõ project). Tag source
// của agent global vẫn giữ trong group "User & Global".
const showSourceBadge = computed<boolean>(() => !(props.inGroup && isProjectAgent(props.agent)))

// Quiet tag: muted bg for all; project-scoped gets accent text + border instead
// of a loud solid fill so the list reads calmer.
const sourceBadgeStyle = computed<CSSProperties>(() => {
  const highlight = isProjectAgent(props.agent)
  return {
    background: t.value.bgInput,
    color: highlight ? t.value.accent : t.value.textDim,
    border: `1px solid ${highlight ? t.value.accent : t.value.border}`,
  }
})

const onHover = (e: MouseEvent) => {
  if (!props.selected)
    (e.currentTarget as HTMLElement).style.background = pill(false, true).background
}

const onLeave = (e: MouseEvent) => {
  if (!props.selected) (e.currentTarget as HTMLElement).style.background = 'transparent'
}

// Inline rename — local draft + focus on open. `settled` guards the blur that
// fires right after Enter/Escape so the row commits/cancels exactly once.
const inputEl = ref<HTMLInputElement | null>(null)
const draftName = ref(props.agent.name)
let settled = false

watch(
  () => props.renaming,
  (on) => {
    if (!on) return
    settled = false
    draftName.value = props.agent.name
    nextTick(() => {
      inputEl.value?.focus()
      inputEl.value?.select()
    })
  },
)

const commit = () => {
  if (settled) return
  settled = true
  emit('rename', draftName.value)
}

const cancel = () => {
  settled = true
  emit('cancel-rename')
}
</script>
