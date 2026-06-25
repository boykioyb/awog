<template>
  <div ref="rootRef" class="relative">
    <button
      class="inline-flex items-center gap-[5px] font-mono text-[12px] px-2 py-[3px] rounded-lg transition"
      :style="chipStyle"
      :title="chipTitle"
      @click="toggle"
    >
      <Palette :size="12" class="flex-shrink-0" />
      {{ chipLabel }}
      <ChevronDown :size="11" class="flex-shrink-0 opacity-70" />
    </button>

    <div
      v-if="isOpen"
      class="absolute left-0 rounded-md py-1 z-20 max-h-[60vh] overflow-y-auto"
      :class="placement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'"
      :style="popStyle"
    >
      <!-- Normal = the default: no style directive wired into the prompt. -->
      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
        :style="{
          background: !activeId ? t.bgActive : 'transparent',
          color: t.text,
          minWidth: '280px',
        }"
        @click="selectNormal"
      >
        <span class="flex-shrink-0">💬</span>
        <div class="flex-1 min-w-0">
          <div class="truncate">Normal</div>
          <div class="text-[12px] truncate" :style="{ color: t.textDim }">
            Default — no style applied
          </div>
        </div>
        <Check v-if="!activeId" :size="11" class="flex-shrink-0" :style="{ color: t.success }" />
      </button>

      <template v-for="group in RESPONSE_STYLE_GROUPS" :key="group.key">
        <div
          class="px-2.5 py-1 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          {{ group.emoji }} {{ group.label }}
        </div>
        <button
          v-for="s in group.styles"
          :key="s.id"
          type="button"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
          :style="{
            background: activeId === s.id ? t.bgActive : 'transparent',
            color: t.text,
            minWidth: '280px',
          }"
          @click="pick(s.id)"
        >
          <span class="flex-shrink-0">{{ s.emoji }}</span>
          <div class="flex-1 min-w-0">
            <div class="truncate">{{ s.name }}</div>
            <div class="text-[12px] truncate" :style="{ color: t.textDim }">{{ s.hint }}</div>
          </div>
          <Check
            v-if="activeId === s.id"
            :size="11"
            class="flex-shrink-0"
            :style="{ color: t.success }"
          />
        </button>
      </template>

      <!-- Modifier: strip markdown. Stacks on a style or applies on its own. -->
      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
        :style="{ color: t.text, borderTop: `1px solid ${t.border}` }"
        @click="toggleNoMarkdown"
      >
        <span class="flex-1">Plain text (no markdown)</span>
        <Check v-if="noMarkdown" :size="11" class="flex-shrink-0" :style="{ color: t.success }" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronDown, Palette } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { Session } from '~/types'
import { RESPONSE_STYLE_GROUPS, findResponseStyle } from '~/utils/response-styles'
import { registerStylePicker } from '~/utils/style-picker-bus'

const props = withDefaults(
  defineProps<{
    session: Session
    // Popover open direction. 'up' (default) suits the bottom composer; 'down'
    // suits the top session header where this chip now lives.
    placement?: 'up' | 'down'
  }>(),
  { placement: 'up' },
)

const { t } = useTheme()
const { menu } = useGlass()
const store = useSessionsStore()

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const isOpen = ref(false)
useClickOutside(rootRef, () => {
  isOpen.value = false
})

const activeId = computed(() => props.session.settings.responseStyle)
const noMarkdown = computed(() => props.session.settings.responseStyleNoMarkdown === true)
const activeStyle = computed(() => findResponseStyle(activeId.value))

// Chip label mirrors the active state: style name when set, else "Normal" (the
// default — no style wired). The brightness (chipStyle) signals active too.
const chipLabel = computed(() => activeStyle.value?.name ?? 'Normal')
const chipTitle = computed(() =>
  activeStyle.value ? `Response style: ${activeStyle.value.name}` : 'Response style: Normal',
)

const popStyle = computed(() => ({
  background: menu.value.background,
  border: `1px solid ${menu.value.borderColor}`,
  backdropFilter: menu.value.backdropFilter,
  boxShadow: menu.value.boxShadow,
  minWidth: '280px',
}))

// Outline chip (matches SessionChipsPopover `.chip.sm` recipe): transparent fill
// + hairline border; active/open lifts to a neutral highlight (bgActive +
// stronger border + full text), never an accent wash.
const chipStyle = computed(() => {
  const active = isOpen.value || !!activeStyle.value || noMarkdown.value
  return {
    background: active ? t.value.bgActive : 'transparent',
    border: `1px solid ${active ? t.value.borderStrong : t.value.border}`,
    color: active ? t.value.text : t.value.textDim,
  }
})

const toggle = () => {
  isOpen.value = !isOpen.value
}

// Persisted per session via updateSettings (no mirror to other sessions, unlike
// `mode`). Picking a style closes the popover; toggling the modifier keeps it
// open so the user can also pick a style in the same interaction.
const pick = (id: string) => {
  store.updateSettings(props.session.id, { responseStyle: id })
  isOpen.value = false
}

const toggleNoMarkdown = () => {
  store.updateSettings(props.session.id, { responseStyleNoMarkdown: !noMarkdown.value })
}

// Normal = default: clear the style so no directive is wired into the prompt.
// Leaves the no-markdown modifier alone (it's an orthogonal formatting toggle).
const selectNormal = () => {
  store.updateSettings(props.session.id, { responseStyle: undefined })
  isOpen.value = false
}

const open = () => {
  isOpen.value = true
}

// Opened by the `/style` session command. The composer dispatches it through
// the per-session registry (the picker now lives in the header, a sibling, so a
// template ref no longer reaches it). Register under the current session id and
// keep it pointed at the live session if the header is reused across switches.
watch(
  () => props.session.id,
  (id, prev) => {
    if (prev) registerStylePicker(prev, null)
    registerStylePicker(id, open)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  registerStylePicker(props.session.id, null)
})

// Kept for backward compat with any caller still holding a template ref.
defineExpose({ open })
</script>
