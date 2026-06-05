<template>
  <!-- Right-docked overlay floating on top of the chat (never consumes main
       layout). Resizable via the handle on its left edge. -->
  <div ref="rootEl" class="absolute z-30 inset-y-0 right-0 flex" :style="containerStyle">
    <div
      class="flex-shrink-0 ws-resizer cursor-col-resize hidden md:block"
      :style="resizerStyle"
      @mousedown="onDragStart"
      @dblclick="resetSize"
    />
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden" :style="contentStyle">
      <!-- Header -->
      <div
        class="px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <Info :size="13" :style="{ color: t.textDim }" />
        <span class="text-[1em] font-medium" :style="{ color: t.text }">
          {{ tr('sessionInfo.title') }}
        </span>
        <button
          type="button"
          class="ml-auto p-1 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('sessionInfo.close')"
          @click="panel.close(session.id)"
        >
          <X :size="14" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto">
        <SessionInfoSection :label="tr('sessionInfo.meta')">
          <dl class="space-y-1.5">
            <div v-for="row in meta" :key="row.key" class="flex items-start gap-3">
              <dt class="text-[1em] flex-shrink-0" :style="{ color: t.textDim, minWidth: '92px' }">
                {{ row.label }}
              </dt>
              <dd
                class="text-[1em] flex-1 min-w-0 break-words text-right"
                :class="row.mono ? 'font-mono' : ''"
                :style="{ color: t.text }"
              >
                {{ row.value }}
              </dd>
            </div>
          </dl>
        </SessionInfoSection>

        <SessionInfoSection :label="tr('sessionInfo.project')">
          <div v-if="project" class="space-y-2">
            <div class="flex items-center gap-2 min-w-0">
              <FolderGit2 :size="14" class="flex-shrink-0" :style="{ color: t.accent }" />
              <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">
                {{ project.name }}
              </span>
            </div>
            <div
              class="text-[1em] font-mono break-all"
              :style="{ color: t.textDim }"
              :title="project.path"
            >
              {{ project.path }}
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[1em] transition"
              :style="{ background: t.bgSubtle, color: t.text, border: `1px solid ${t.border}` }"
              @click="viewInFinder()"
            >
              <FolderOpen :size="13" />
              {{ tr('sessionInfo.project.view_in_finder') }}
            </button>
          </div>
          <p v-else class="text-[1em]" :style="{ color: t.textFaint }">
            {{ tr('sessionInfo.project.none') }}
          </p>
        </SessionInfoSection>

        <SessionInfoSection
          :label="tr('sessionInfo.files')"
          :count="contextFiles.length || undefined"
        >
          <div v-if="contextFiles.length" class="space-y-1.5">
            <SessionInfoFileRow
              v-for="file in contextFiles"
              :key="file.key"
              :file="file"
              :can-reveal="projectRoot !== null"
              @open="(att: SessionAttachment) => emit('openAttachment', att)"
              @reveal="revealFile"
              @open-file="openFile"
            />
          </div>
          <p v-else class="text-[1em]" :style="{ color: t.textFaint }">
            {{ tr('sessionInfo.files.empty') }}
          </p>
        </SessionInfoSection>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2, FolderOpen, Info, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, toRef, useTemplateRef } from 'vue'
import type { CSSProperties } from 'vue'
import type { Session, SessionAttachment } from '~/types'
import { useSessionInfoPanelStore } from '~/stores/sessionInfoPanel'
import SessionInfoSection from './SessionInfoSection.vue'
import SessionInfoFileRow from './SessionInfoFileRow.vue'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useSessionInfoPanelStore()

const { project, projectRoot, meta, contextFiles, viewInFinder, revealFile, openFile } =
  useSessionInfo(toRef(props, 'session'))

// ── Resize (right-dock only — handle on the left edge) ──────────────────────
const dragging = ref(false)
const rootEl = useTemplateRef<HTMLElement>('rootEl')

const containerStyle = computed<CSSProperties>(() => ({
  width: `${panel.widthPx}px`,
  // Cap to the chat area (positioned ancestor) so a too-large persisted size
  // never slides under the NavRail / off-screen.
  maxWidth: '100%',
  boxShadow: `-12px 0 32px ${t.value.shadow}`,
}))

const resizerStyle = computed<CSSProperties>(() => ({
  width: '6px',
  background: dragging.value ? t.value.accent : t.value.border,
  zIndex: 5,
}))

const contentStyle = computed<CSSProperties>(() => ({
  background: t.value.bg,
  borderLeft: `1px solid ${t.value.border}`,
}))

let dragStartX = 0
let dragStartWidth = 0

// Live cap = the chat area (the drawer's positioned ancestor).
const availableWidth = (): number => {
  const parent = rootEl.value?.offsetParent as HTMLElement | null
  return parent?.clientWidth ?? window.innerWidth
}

const onDragMove = (e: MouseEvent) => {
  // Handle on the left edge → dragging left grows the width.
  panel.setWidth(Math.min(dragStartWidth - (e.clientX - dragStartX), availableWidth()))
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  panel.commitWidth()
}

const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  dragStartX = e.clientX
  dragStartWidth = panel.widthPx
  dragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetSize = () => {
  panel.setWidth(360)
  panel.commitWidth()
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<style scoped>
.ws-resizer {
  transition: background 120ms ease;
}
</style>
