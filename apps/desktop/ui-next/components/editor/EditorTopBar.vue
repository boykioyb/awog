<template>
  <div class="edtop">
    <button class="edback" :title="t('editor.back')" @click="emit('back')">
      <Icon name="chev" class="chev-left" />
      <span>{{ backLabel }}</span>
    </button>

    <div class="edsep" />

    <Icon :name="titleIcon" class="edicon" />
    <span class="edtitle">{{ title }}</span>
    <span v-if="subtitle" class="edsub">{{ subtitle }}</span>

    <!-- Diff stats (Task Artifact Editor, .diff/.patch files). -->
    <div v-if="diffStats" class="eddiff">
      <span class="eddiff-files">
        {{ t('editor.diffFiles', { n: diffStats.files }) }}
      </span>
      <span class="eddiff-add">+{{ diffStats.additions }}</span>
      <span class="eddiff-del">−{{ diffStats.deletions }}</span>
    </div>

    <span class="edspacer" />

    <!-- View-mode segmented control (markdown/yaml; hidden for diff). -->
    <div v-if="viewModes" class="seg edseg">
      <span
        v-for="v in viewOptions"
        :key="v.id"
        :class="{ on: activeView === v.id }"
        @click="emit('change-view', v.id)"
      >
        {{ t(v.labelKey) }}
      </span>
    </div>

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
// Fullscreen editor top bar (prototype CSS). Used by both editor routes: a back
// button, a title + optional subtitle, optional diff stats, an optional view-mode
// segmented control, and an `actions` slot for page-specific buttons (save / copy
// / theme picker). Diff stats + view modes are only passed by the Task Artifact
// Editor; the Project Code Workspace omits both.
import type { EditorViewMode, EditorDiffStats } from '~/components/editor/types'

withDefaults(
  defineProps<{
    backLabel: string
    title: string
    subtitle?: string
    titleIcon?: string
    diffStats?: EditorDiffStats | null
    // When true, render the code/split/preview segmented control.
    viewModes?: boolean
    activeView?: EditorViewMode
  }>(),
  { subtitle: '', titleIcon: 'folder', diffStats: null, viewModes: false, activeView: 'split' },
)

const emit = defineEmits<{
  back: []
  'change-view': [view: EditorViewMode]
}>()

const { t } = useI18n()

const viewOptions = [
  { id: 'code' as const, labelKey: 'editor.view.code' },
  { id: 'split' as const, labelKey: 'editor.view.split' },
  { id: 'preview' as const, labelKey: 'editor.view.preview' },
]
</script>

<style scoped>
.edtop {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 14px;
  min-height: 44px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
}
.edback {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
  border: 1px solid transparent;
}
.edback:hover {
  background: var(--bgHover);
  color: var(--text);
}
.edback .chev-left {
  width: 14px;
  height: 14px;
  transform: rotate(90deg);
}
.edsep {
  width: 1px;
  height: 16px;
  background: var(--border);
}
.edicon {
  width: 14px;
  height: 14px;
  color: var(--textDim);
  flex-shrink: 0;
}
.edtitle {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.edsub {
  /* mono-ok: subtitle carries the project path in pages/code/[id].vue */
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.eddiff {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.eddiff-files {
  color: var(--textDim);
}
.eddiff-add {
  color: var(--add);
}
.eddiff-del {
  color: var(--danger);
}
.edspacer {
  flex: 1;
}
.edseg {
  flex-shrink: 0;
}
</style>
