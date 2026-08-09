<template>
  <div class="editpage">
    <EditorTopBar
      :back-label="t('editor.backToTasks')"
      :title="currentFile?.name ?? t('editor.artifact')"
      :subtitle="taskTitle"
      :title-icon="currentKind === 'diff' ? 'branch' : 'text'"
      :diff-stats="diffStats"
      :view-modes="currentKind !== 'diff'"
      :active-view="activeView"
      @back="goBack"
      @change-view="setView"
    >
      <template #actions>
        <button class="iconbtn" :title="t('editor.copy')" @click="copyContent">
          <Icon name="copy" class="acticon" />
        </button>
      </template>
    </EditorTopBar>

    <div class="editbody">
      <EditorArtifactList
        :files="files"
        :task-id="taskId"
        :selected-name="selectedName"
        @select="selectFile"
      />

      <div class="editmain">
        <div v-if="currentFile" class="editsurface">
          <!-- Diff artifact → single diff viewer (no code/preview split). -->
          <EditorViewerPane v-if="currentKind === 'diff'" :content="content" mode="diff" />

          <template v-else>
            <!-- Read-only Monaco for the raw artifact (code / split). -->
            <div
              v-if="effectiveView !== 'preview'"
              class="editcode"
              :class="{ split: effectiveView === 'split' }"
            >
              <MonacoViewer :value="content" :language="monacoLang" :read-only="true" />
            </div>
            <!-- Rendered markdown preview (preview / split). -->
            <EditorViewerPane
              v-if="effectiveView !== 'code'"
              :content="content"
              mode="preview"
              :is-split="effectiveView === 'split'"
              :workspace-root="workspaceRoot"
            />
          </template>
        </div>

        <div v-else class="editempty">
          <Icon name="text" class="editempty-icon" />
          <p>{{ loaded ? t('editor.noArtifactSelected') : t('editor.loading') }}</p>
        </div>

        <!-- Status bar -->
        <div class="editstatus">
          <span>{{ languageLabel }}</span>
          <span>UTF-8</span>
          <span>LF</span>
          <span class="editstatus-spacer" />
          <span>{{ t('editor.lines', { n: lineCount }) }}</span>
          <span>{{ t('editor.words', { n: wordCount }) }}</span>
          <span>{{ t('editor.chars', { n: charCount }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Task Artifact Editor — fullscreen viewer for a task's output files (ADR 0021).
// Route /edit/:taskId loads the task via tasks.get, lists its declared artifacts
// (workflow node.outputs ↔ run output), and shows the selected one as markdown
// (code / split / rendered preview), a unified diff, or YAML. Artifacts are
// engine-owned → read-only here (edit real files via the Project Code Workspace).
// All state/logic lives in useTaskArtifacts (page-controller).
import { computed, onMounted } from 'vue'
import EditorTopBar from '~/components/editor/EditorTopBar.vue'
import EditorArtifactList from '~/components/editor/EditorArtifactList.vue'
import EditorViewerPane from '~/components/editor/EditorViewerPane.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import { useTaskArtifacts } from '~/composables/useTaskArtifacts'

definePageMeta({ layout: false })
defineOptions({ name: 'TaskArtifactEditPage' })

const { t } = useI18n()
const route = useRoute()
const taskId = String(route.params.taskId)

const {
  taskTitle,
  workspaceRoot,
  loaded,
  files,
  currentFile,
  selectedName,
  content,
  currentKind,
  activeView,
  effectiveView,
  diffStats,
  languageLabel,
  lineCount,
  charCount,
  wordCount,
  init,
  selectFile,
  setView,
  copyContent,
} = useTaskArtifacts(taskId)

// Monaco language hint from the artifact kind (md → markdown, yaml → yaml).
const monacoLang = computed(() => (currentKind.value === 'yaml' ? 'yaml' : 'markdown'))

const goBack = () => navigateTo('/tasks')

onMounted(() => {
  void init()
})
</script>

<style scoped>
.editpage {
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
.editbody {
  display: flex;
  flex: 1;
  min-height: 0;
}
.editmain {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.editsurface {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.editcode {
  height: 100%;
  min-width: 0;
  flex: 1;
}
.editcode.split {
  flex: 0 0 50%;
  width: 50%;
  border-right: 1px solid var(--border);
}
.editempty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--textDim);
}
.editempty-icon {
  width: 40px;
  height: 40px;
  color: var(--textFaint);
}
.editstatus {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 14px;
  flex-shrink: 0;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  background: var(--bgPanel);
  border-top: 1px solid var(--border);
}
.editstatus-spacer {
  flex: 1;
}
</style>
