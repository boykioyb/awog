<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden" :style="{ background: t.bg }">
    <!-- Top bar -->
    <div
      class="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
      :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
    >
      <button type="button" :title="tr('code.back')" :style="iconBtn" @click="goBack">
        <ArrowLeft :size="14" />
      </button>
      <span class="text-[1em] font-medium" :style="{ color: t.text }">
        {{ project?.name ?? tr('code.project') }}
      </span>
      <span v-if="project" class="text-[12px] font-mono truncate" :style="{ color: t.textFaint }">
        {{ project.path }}
      </span>
    </div>

    <!-- Body -->
    <div v-if="ready" class="flex flex-1 min-h-0">
      <!-- Activity bar -->
      <div
        class="flex flex-col items-center gap-1 py-2 flex-shrink-0"
        :style="{ width: '44px', background: t.bgRail, borderRight: `1px solid ${t.border}` }"
      >
        <button
          type="button"
          :title="tr('code.explorer')"
          :style="activityBtn('explorer')"
          @click="activity = 'explorer'"
        >
          <Files :size="18" />
        </button>
        <button
          type="button"
          :title="tr('code.search')"
          :style="activityBtn('search')"
          @click="activity = 'search'"
        >
          <Search :size="18" />
        </button>
        <button
          type="button"
          :title="tr('code.source_control')"
          :style="activityBtn('git')"
          @click="activity = 'git'"
        >
          <GitBranch :size="18" />
        </button>
        <button
          type="button"
          :title="tr('code.toggle_terminal')"
          class="mt-auto"
          :style="{
            padding: '8px',
            borderRadius: '6px',
            color: terminalOpen ? t.accent : t.textDim,
            background: terminalOpen ? t.bgActive : 'transparent',
          }"
          @click="terminalOpen = !terminalOpen"
        >
          <TerminalSquare :size="18" />
        </button>
      </div>

      <!-- Side panel -->
      <div class="flex-shrink-0" :style="{ width: '260px', borderRight: `1px solid ${t.border}` }">
        <CodeExplorer v-show="activity === 'explorer'" />
        <CodeSearchPanel v-show="activity === 'search'" />
        <CodeSourceControl v-if="activity === 'git'" />
      </div>

      <!-- Editor area -->
      <div class="flex flex-col flex-1 min-w-0 min-h-0">
        <CodeTabStrip v-if="tabs.length > 0" />
        <div class="flex flex-1 min-h-0 relative">
          <!-- Editor — kept mounted (v-show) in preview-only mode to preserve models -->
          <div
            v-show="tabs.length > 0 && effectiveView !== 'preview'"
            class="h-full min-w-0"
            :class="effectiveView === 'split' ? 'w-1/2' : 'flex-1'"
          >
            <MonacoEditor
              ref="editorRef"
              :path="activePath"
              :read-only="activeTab?.readOnly ?? false"
              @ready="handleEditorReady"
              @change="onEditorChange"
              @cursor-change="onCursorChange"
              @save="() => saveFile()"
              @open-palette="openPalette"
            />
          </div>
          <!-- Live markdown preview -->
          <div
            v-if="tabs.length > 0 && effectiveView !== 'code'"
            class="h-full min-w-0 overflow-y-auto px-8 py-5"
            :class="effectiveView === 'split' ? 'w-1/2' : 'flex-1'"
            :style="{
              background: t.bg,
              borderLeft: effectiveView === 'split' ? `1px solid ${t.border}` : undefined,
            }"
          >
            <MarkdownRenderer :content="previewSource" />
          </div>
          <!-- Empty state -->
          <div
            v-if="tabs.length === 0"
            class="absolute inset-0 flex flex-col items-center justify-center gap-2"
          >
            <FileCode :size="40" :stroke-width="1.5" :style="{ color: t.textFaint }" />
            <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('code.open_file_hint') }}</p>
          </div>
        </div>
        <!-- Bottom terminal panel -->
        <ProjectTerminalDock
          v-if="terminalOpen"
          :terminal-key="terminalKey"
          :workspace-root="workspaceRoot"
          @close="terminalOpen = false"
        />
        <!-- Status bar -->
        <div
          class="flex items-center gap-4 px-3 py-1 flex-shrink-0 text-[12px]"
          :style="{ background: t.bgPanel, borderTop: `1px solid ${t.border}`, color: t.textDim }"
        >
          <span v-if="activeTab" class="font-mono">
            {{ tr('code.status.position', { line: cursor.line, column: cursor.column }) }}
          </span>
          <span v-if="activeTab">{{ activeTab.language }}</span>
          <span v-if="activeTab?.readOnly" :style="{ color: t.warning }">
            {{ tr('code.status.readonly') }}
          </span>
        </div>
      </div>
    </div>

    <!-- Not ready -->
    <div v-else class="flex-1 flex flex-col items-center justify-center gap-2">
      <FolderX :size="40" :stroke-width="1.5" :style="{ color: t.textFaint }" />
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('code.not_found') }}</p>
    </div>

    <!-- Quick open (Cmd/Ctrl+P) + command palette (Cmd/Ctrl+Shift+P) -->
    <CommandPalette
      :open="paletteOpen"
      :mode="paletteMode"
      :workspace-root="workspaceRoot"
      :commands="paletteCommands"
      @close="closePalette"
      @pick-file="openFile"
      @run-command="(c) => c.run()"
    />

    <!-- Close-tab dirty confirm -->
    <Teleport to="body">
      <div
        v-if="closeConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center"
        :style="{ background: 'rgba(0,0,0,0.5)' }"
      >
        <div
          class="w-80 rounded-lg p-4"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <p class="text-[1em] font-medium mb-1" :style="{ color: t.text }">
            {{ tr('code.unsaved.title') }}
          </p>
          <p class="text-[1em] mb-4 break-all" :style="{ color: t.textDim }">{{ closeConfirm }}</p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.bgHover, color: t.textDim }"
              @click="closeConfirm = null"
            >
              {{ tr('common.cancel') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.dangerBg, color: t.danger }"
              @click="confirmCloseDiscard"
            >
              {{ tr('code.unsaved.discard') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.accent, color: t.accentText }"
              @click="confirmCloseSave"
            >
              {{ tr('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toasts -->
    <Teleport to="body">
      <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="px-3 py-2 rounded-md text-[1em] shadow-lg"
          :style="toastStyle(toast.kind)"
        >
          {{ toast.text }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  FileCode,
  Files,
  FolderX,
  GitBranch,
  Search,
  TerminalSquare,
} from 'lucide-vue-next'
import { computed, provide } from 'vue'
import type { CSSProperties } from 'vue'
import MonacoEditor from '~/components/editor/MonacoEditor.vue'
import MarkdownRenderer from '~/components/markdown/MarkdownRenderer.vue'
import CodeExplorer from '~/components/workspace/code/CodeExplorer.vue'
import CodeSearchPanel from '~/components/workspace/code/CodeSearchPanel.vue'
import CodeSourceControl from '~/components/workspace/code/CodeSourceControl.vue'
import CodeTabStrip from '~/components/workspace/code/CodeTabStrip.vue'
import ProjectTerminalDock from '~/components/workspace/ProjectTerminalDock.vue'
import CommandPalette from '~/components/workspace/CommandPalette.vue'
import {
  ProjectWorkspaceKey,
  useProjectWorkspace,
  type ActivityView,
} from '~/composables/useProjectWorkspace'

definePageMeta({ layout: false, keepalive: false })
// Explicit name — the file is `code.vue`, but `code` is a reserved HTML element,
// which Vue warns about when it becomes the page component id.
defineOptions({ name: 'ProjectCodePage' })

const { t } = useTheme()
const { t: tr } = useI18n()
const route = useRoute()
const projectId = route.params.id as string

const ctx = useProjectWorkspace(projectId)
provide(ProjectWorkspaceKey, ctx)

const {
  project,
  ready,
  activity,
  terminalOpen,
  terminalKey,
  workspaceRoot,
  editorRef,
  tabs,
  activePath,
  activeTab,
  cursor,
  effectiveView,
  previewSource,
  onEditorChange,
  onCursorChange,
  saveFile,
  openFile,
  closeConfirm,
  confirmCloseSave,
  confirmCloseDiscard,
  paletteOpen,
  paletteMode,
  paletteCommands,
  openPalette,
  closePalette,
  toasts,
  toastStyle,
} = ctx

// Return to wherever the editor was opened from: a session (selection is kept
// in the store) or, by default, the project list.
const goBack = () => navigateTo(route.query.from === 'session' ? '/sessions' : '/projects')

// Deep-link: /projects/:id/code?file=<path> opens that file once Monaco is up
// (the bridge from a session's Files tab / chat reference).
const handleEditorReady = () => {
  const f = route.query.file
  if (typeof f === 'string' && f.length > 0) ctx.openFile(f)
}

const iconBtn = computed<CSSProperties>(() => ({
  padding: '6px',
  borderRadius: '4px',
  color: t.value.textDim,
  transition: 'all 0.15s',
}))

const activityBtn = (view: ActivityView): CSSProperties => ({
  padding: '8px',
  borderRadius: '6px',
  color: activity.value === view ? t.value.accent : t.value.textDim,
  background: activity.value === view ? t.value.bgActive : 'transparent',
  transition: 'all 0.15s',
})
</script>
