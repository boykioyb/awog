<template>
  <div
    class="px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <component :is="icon" v-if="icon" :size="13" :style="{ color: t.textDim }" />
    <span class="text-[1em] font-medium" :style="{ color: t.text }">{{ title }}</span>
    <div class="ml-auto flex items-center gap-1">
      <slot name="actions" />

      <div ref="posRef" class="relative">
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{ color: showPosMenu ? t.accent : t.textDim }"
          :title="tr('workspace.position')"
          @click="showPosMenu = !showPosMenu"
        >
          <component :is="POSITION_ICONS[panel.position]" :size="14" />
        </button>
        <div
          v-if="showPosMenu"
          class="absolute right-0 top-full mt-1 rounded-md py-1 z-30"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.borderStrong}`,
            boxShadow: `0 8px 24px ${t.shadow}`,
            minWidth: '150px',
          }"
        >
          <button
            v-for="opt in POSITIONS"
            :key="opt.id"
            type="button"
            class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[1em] transition"
            :style="{
              color: panel.position === opt.id ? t.accent : t.text,
              background: panel.position === opt.id ? t.bgSubtle : 'transparent',
            }"
            @click="selectPosition(opt.id)"
          >
            <component :is="opt.icon" :size="13" :style="{ color: t.textDim }" />
            {{ tr(opt.labelKey) }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="p-1 rounded transition"
        :style="{ color: t.textDim }"
        :title="tr('workspace.close')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PanelBottom, PanelLeft, PanelRight, X } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import type { WorkspacePanelPosition } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'

defineProps<{
  title: string
  icon?: Component
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()

const POSITIONS: { id: WorkspacePanelPosition; icon: Component; labelKey: string }[] = [
  { id: 'right', icon: PanelRight, labelKey: 'workspace.position.right' },
  { id: 'left', icon: PanelLeft, labelKey: 'workspace.position.left' },
  { id: 'bottom', icon: PanelBottom, labelKey: 'workspace.position.bottom' },
]

const POSITION_ICONS: Record<WorkspacePanelPosition, Component> = {
  right: PanelRight,
  left: PanelLeft,
  bottom: PanelBottom,
}

const showPosMenu = ref(false)
const posRef = ref<HTMLElement | null>(null)

const selectPosition = (pos: WorkspacePanelPosition) => {
  panel.setPosition(pos)
  showPosMenu.value = false
}

const onClickOutside = (e: MouseEvent) => {
  if (!showPosMenu.value) return
  if (posRef.value && posRef.value.contains(e.target as Node)) return
  showPosMenu.value = false
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>
