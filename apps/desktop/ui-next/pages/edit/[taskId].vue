<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
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
        <Button :title="t('editor.copy')" variant="outline" size="iconMd" @click="copyContent">
          <Icon name="copy" />
        </Button>
      </template>
    </EditorTopBar>

    <div class="flex min-h-0 flex-1">
      <EditorArtifactList
        :files="files"
        :task-id="taskId"
        :selected-name="selectedName"
        @select="selectFile"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div v-if="currentFile" class="flex min-h-0 flex-1 overflow-hidden">
          <!-- Diff artifact → single diff viewer (no code/preview split). -->
          <EditorViewerPane v-if="currentKind === 'diff'" :content="content" mode="diff" />

          <template v-else>
            <!-- Read-only Monaco for the raw artifact (code / split). -->
            <div
              v-if="effectiveView !== 'preview'"
              class="h-full min-w-0"
              :class="effectiveView === 'split' ? 'w-1/2 shrink-0 grow-0 border-r' : 'flex-1'"
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

        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
        >
          <Icon name="text" class="size-10 text-faint" />
          <p>{{ loaded ? t('editor.noArtifactSelected') : t('editor.loading') }}</p>
        </div>

        <!-- Status bar -->
        <div
          class="flex shrink-0 items-center gap-4 border-t bg-sidebar px-3.5 py-1 text-sm text-muted-foreground tabular-nums"
        >
          <span>{{ languageLabel }}</span>
          <span>UTF-8</span>
          <span>LF</span>
          <span class="flex-1" />
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
import Button from '~/components/ui/button/Button.vue'

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
