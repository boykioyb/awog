<template>
  <div ref="rootRef" class="relative">
    <button
      class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
      :style="chipStyle"
      :title="chipTitle"
      @click="toggle"
    >
      <Palette :size="10" />
      {{ chipLabel }}
      <ChevronDown :size="9" :style="{ color: t.textDim }" />
    </button>

    <div
      v-if="isOpen"
      class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20 max-h-[60vh] overflow-y-auto"
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
import { computed, ref, useTemplateRef } from 'vue'
import type { Session } from '~/types'
import { RESPONSE_STYLE_GROUPS, findResponseStyle } from '~/utils/response-styles'

const props = defineProps<{ session: Session }>()

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

// Borderless chip (matches SessionChipsPopover): brightness carries the open /
// active state, not a box outline.
const chipStyle = computed(() => ({
  background: 'transparent',
  color: isOpen.value || activeStyle.value || noMarkdown.value ? t.value.text : t.value.textDim,
}))

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

// Opened by the `/style` session command (composer dispatch).
defineExpose({ open: () => (isOpen.value = true) })
</script>
