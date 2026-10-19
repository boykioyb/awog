<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <EditorTopBar
      :back-label="backLabel"
      :title="projectName ?? t('editor.project')"
      :subtitle="projectPath ?? ''"
      title-icon="folder"
      @back="goBack"
    >
      <template #actions>
        <Button
          :disabled="!activeTab || !activeTab.dirty"
          :title="t('editor.save')"
          variant="outline"
          size="iconMd"
          @click="saveFile"
        >
          <Icon name="save" />
        </Button>
      </template>
    </EditorTopBar>

    <!-- Body: explorer | editor area -->
    <div v-if="ready" class="flex min-h-0 flex-1">
      <div class="w-65 min-w-0 shrink-0 border-r">
        <EditorFileTree :ctrl="fileTreeCtrl" :selected-path="activePath" />
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- Tab strip — tab tài liệu có nút đóng + dấu chưa lưu riêng, `Tabs` không
             phủ được nên giữ hàng div bấm được. -->
        <div
          v-if="hasOpenTabs"
          class="flex shrink-0 items-stretch overflow-x-auto border-b bg-sidebar"
        >
          <div
            v-for="tab in tabs"
            :key="tab.path"
            class="flex cursor-pointer items-center gap-1.5 border-r px-2.5 py-1.5 font-medium whitespace-nowrap"
            :class="
              tab.path === activePath
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            "
            @click="activateTab(tab.path)"
          >
            <Icon name="text" class="size-3 shrink-0 text-faint" />
            <!-- font-mono: tên file đang mở (mono-ok). -->
            <span class="font-mono">{{ tab.name }}</span>
            <span v-if="tab.dirty" class="text-sm text-warning" :title="t('editor.unsaved')">
              ●
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              class="size-5 text-faint hover:text-foreground"
              :title="t('editor.close')"
              :aria-label="t('editor.close')"
              @click.stop="closeTab(tab.path)"
            >
              <Icon name="x" class="size-3" />
            </Button>
          </div>
        </div>

        <div class="relative flex min-h-0 flex-1">
          <!-- Editor kept mounted (v-show) so models survive empty-state toggles. -->
          <EditorMonacoPane
            v-show="hasOpenTabs"
            ref="paneRef"
            :path="activePath"
            :read-only="false"
            @ready="onEditorReady"
            @change="onChange"
            @cursor-change="onCursorChange"
            @save="saveFile"
          />
          <div
            v-if="!hasOpenTabs"
            class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground"
          >
            <Icon name="folder" class="size-10 text-faint" />
            <p>{{ t('editor.openFileHint') }}</p>
          </div>
        </div>

        <!-- Status bar -->
        <div
          class="flex shrink-0 items-center gap-4 border-t bg-sidebar px-3.5 py-1 text-sm text-muted-foreground tabular-nums"
        >
          <span v-if="activeTab">
            {{ t('editor.position', { line: cursor.line, column: cursor.column }) }}
          </span>
          <span v-if="activeTab?.language">{{ activeTab.language }}</span>
        </div>
      </div>
    </div>

    <!-- Resolving / not found -->
    <div
      v-else
      class="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
    >
      <Icon name="folder" class="size-10 text-faint" />
      <p>{{ ready === null ? t('editor.loading') : t('editor.projectNotFound') }}</p>
    </div>

    <!-- Shared file context menu (right-click a tree row). -->
    <AppContextMenu
      :open="fileMenu.menu.value !== null"
      :position="fileMenu.menu.value ?? { x: 0, y: 0 }"
      :items="fileMenu.items.value"
      @close="fileMenu.close"
      @select="fileMenu.onSelect"
    />
  </div>
</template>

<script setup lang="ts">
// Project Code Workspace — fullscreen multi-tab editor over a registered project
// folder (ADR 0021/0022). Route /code/:id resolves the absolute workspace root
// from projects.list, lists its tree (fs.listDir), opens files in tabs, edits in
// Monaco, and saves via fs.writeFile. All state/logic lives in useCodeWorkspace
// (page-controller); this SFC is the thin template (Tailwind + shadcn).
import { computed, onMounted, watch } from 'vue'
import EditorTopBar from '~/components/editor/EditorTopBar.vue'
import EditorFileTree from '~/components/editor/EditorFileTree.vue'
import EditorMonacoPane from '~/components/editor/EditorMonacoPane.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'
import { useCodeWorkspace } from '~/composables/useCodeWorkspace'
import Button from '~/components/ui/button/Button.vue'

definePageMeta({ layout: false })
// `code` is a reserved HTML element name — give the page an explicit name so Vue
// doesn't warn when it becomes the component id.
defineOptions({ name: 'ProjectCodePage' })

const { t } = useI18n()
const route = useRoute()
const projectId = String(route.params.id)

const ctrl = useCodeWorkspace(projectId)
const {
  projectName,
  projectPath,
  ready,
  fileTreeCtrl,
  fileMenu,
  tabs,
  activePath,
  activeTab,
  hasOpenTabs,
  cursor,
  editorRef,
  init,
  activateTab,
  closeTab,
  saveFile,
  onChange,
  onCursorChange,
  onEditorReady,
} = ctrl

// Bind the editor pane's exposed handle into the controller's editorRef so its
// imperative open/close/getValue calls reach the real Monaco editor.
const paneRef = useTemplateRef<MonacoEditorHandle>('paneRef')
watch(paneRef, (pane) => {
  editorRef.value = pane ?? null
})

// Return to wherever we were opened from (`?from`, set by openWorkspace) — a session
// when launched from the Project quick-view, else the Projects page. Only accept an
// internal path (leading single slash) so a stray query can't redirect off-app.
const returnPath = computed<string>(() => {
  const from = route.query.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : '/projects'
})
const backLabel = computed<string>(() =>
  returnPath.value.startsWith('/workbench') || returnPath.value.startsWith('/sessions')
    ? t('editor.backToSessions')
    : t('editor.backToProjects'),
)
const goBack = () => navigateTo(returnPath.value)

onMounted(() => {
  void init()
})
</script>
