<template>
  <div class="codepage">
    <EditorTopBar
      :back-label="backLabel"
      :title="projectName ?? t('editor.project')"
      :subtitle="projectPath ?? ''"
      title-icon="folder"
      @back="goBack"
    >
      <template #actions>
        <button
          class="iconbtn"
          :disabled="!activeTab || !activeTab.dirty"
          :title="t('editor.save')"
          @click="saveFile"
        >
          <Icon name="save" class="acticon" />
        </button>
      </template>
    </EditorTopBar>

    <!-- Body: explorer | editor area -->
    <div v-if="ready" class="codebody">
      <div class="codeexplorer">
        <EditorFileTree :ctrl="fileTreeCtrl" :selected-path="activePath" />
      </div>

      <div class="codemain">
        <!-- Tab strip -->
        <div v-if="hasOpenTabs" class="codetabs">
          <div
            v-for="tab in tabs"
            :key="tab.path"
            class="codetab"
            :class="{ on: tab.path === activePath }"
            @click="activateTab(tab.path)"
          >
            <Icon name="text" class="codetab-icon" />
            <span class="codetab-name">{{ tab.name }}</span>
            <span v-if="tab.dirty" class="codetab-dirty" :title="t('editor.unsaved')">●</span>
            <button class="codetab-x" :title="t('editor.close')" @click.stop="closeTab(tab.path)">
              <Icon name="x" class="codetab-xicon" />
            </button>
          </div>
        </div>

        <div class="codeeditor">
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
          <div v-if="!hasOpenTabs" class="codeempty">
            <Icon name="folder" class="codeempty-icon" />
            <p>{{ t('editor.openFileHint') }}</p>
          </div>
        </div>

        <!-- Status bar -->
        <div class="codestatus">
          <span v-if="activeTab" class="codestatus-pos">
            {{ t('editor.position', { line: cursor.line, column: cursor.column }) }}
          </span>
          <span v-if="activeTab?.language">{{ activeTab.language }}</span>
        </div>
      </div>
    </div>

    <!-- Resolving / not found -->
    <div v-else class="codenotfound">
      <Icon name="folder" class="codeempty-icon" />
      <p>{{ ready === null ? t('editor.loading') : t('editor.projectNotFound') }}</p>
    </div>

    <!-- Toasts -->
    <Teleport to="body">
      <div class="codetoasts">
        <div v-for="toast in toasts" :key="toast.id" class="codetoast" :class="toast.kind">
          {{ toast.text }}
        </div>
      </div>
    </Teleport>

    <!-- Shared file context menu (right-click a tree row). -->
    <ContextMenu
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
// (page-controller); this SFC is the thin template + prototype CSS.
import { computed, onMounted, watch } from 'vue'
import EditorTopBar from '~/components/editor/EditorTopBar.vue'
import EditorFileTree from '~/components/editor/EditorFileTree.vue'
import EditorMonacoPane from '~/components/editor/EditorMonacoPane.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'
import { useCodeWorkspace } from '~/composables/useCodeWorkspace'

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
  toasts,
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
  returnPath.value.startsWith('/sessions')
    ? t('editor.backToSessions')
    : t('editor.backToProjects'),
)
const goBack = () => navigateTo(returnPath.value)

onMounted(() => {
  void init()
})
</script>

<style scoped>
.codepage {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
.acticon {
  width: 14px;
  height: 14px;
}
.iconbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.iconbtn:disabled:hover {
  border-color: var(--border);
  color: var(--textMuted);
}

.codebody {
  display: flex;
  flex: 1;
  min-height: 0;
}
.codeexplorer {
  flex: 0 0 260px;
  min-width: 0;
  border-right: 1px solid var(--border);
}
.codemain {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.codetabs {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--bgPanel);
  border-bottom: 1px solid var(--border);
}
.codetab {
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-right: 1px solid var(--border);
  color: var(--textDim);
  cursor: pointer;
  white-space: nowrap;
}
.codetab:hover {
  background: var(--bgHover);
}
.codetab.on {
  background: var(--bg);
  color: var(--text);
}
.codetab-icon {
  width: 12px;
  height: 12px;
  color: var(--textFaint);
  flex-shrink: 0;
}
.codetab-name {
  /* mono-ok: open file name on the tab */
  font-family: var(--code);
}
.codetab-dirty {
  color: var(--amber);
  font-size: 12px;
  line-height: 1;
}
.codetab-x {
  display: grid;
  place-items: center;
  padding: 2px;
  border-radius: var(--r-xs);
  color: var(--textFaint);
  background: transparent;
  cursor: pointer;
}
.codetab-x:hover {
  background: var(--bgActive);
  color: var(--text);
}
.codetab-xicon {
  width: 11px;
  height: 11px;
}

.codeeditor {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.codeempty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--textDim);
}
.codeempty-icon {
  width: 40px;
  height: 40px;
  color: var(--textFaint);
}

.codestatus {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 14px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--textDim);
  background: var(--bgPanel);
  border-top: 1px solid var(--border);
}

.codenotfound {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--textDim);
}

.codetoasts {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.codetoast {
  padding: 8px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgEl);
  color: var(--text);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.codetoast.success {
  border-color: var(--add);
  color: var(--add);
}
.codetoast.error {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
