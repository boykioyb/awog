<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.files')" :icon="FolderTree" @close="close">
      <template #actions>
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{
            color: showTree ? t.accent : t.textDim,
            background: showTree ? t.bgActive : 'transparent',
          }"
          :title="tr('workspace.files.toggleTree')"
          @click="toggleBrowser"
        >
          <ListTree :size="13" />
        </button>
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('workspace.refresh')"
          @click="refresh"
        >
          <RefreshCw :size="13" :class="{ 'animate-spin': loading }" />
        </button>
      </template>
    </WorkspaceDrawerHeader>

    <!-- Content: preview fills the panel; the tree is a toggle-able overlay. -->
    <div class="flex-1 relative overflow-hidden">
      <!-- Preview layer (shared Monaco editor, read-only) -->
      <div class="absolute inset-0 flex flex-col">
        <button
          v-if="!selectedPath"
          type="button"
          class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center transition"
          :style="{ color: t.textDim }"
          @click="toggleBrowser"
        >
          <FolderTree :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
          <span class="text-[1em]">{{ tr('workspace.files.browse') }}</span>
        </button>
        <template v-else>
          <div
            class="px-2 py-1.5 flex items-center gap-1 flex-shrink-0"
            :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
          >
            <!-- Back to the folder listing + breadcrumb — kept in sync with the
                 browser overlay so navigation works from the file detail too. -->
            <button
              type="button"
              class="p-1 rounded transition flex-shrink-0"
              :style="{ color: t.textDim }"
              :title="tr('workspace.files.back')"
              @click="goBackToList"
            >
              <ArrowLeft :size="13" />
            </button>
            <nav class="flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden">
              <template v-for="(crumb, ci) in fileBreadcrumbs" :key="crumb.path">
                <ChevronRight
                  v-if="ci > 0"
                  :size="12"
                  class="flex-shrink-0"
                  :style="{ color: t.textFaint }"
                />
                <span
                  v-if="crumb.isFile"
                  class="font-mono text-[1em] truncate"
                  :style="{ color: t.text }"
                >
                  {{ crumb.name }}
                </span>
                <button
                  v-else
                  type="button"
                  class="px-1 py-0.5 rounded text-[1em] whitespace-nowrap flex-shrink-0 transition hover:underline"
                  :style="{ color: t.textDim }"
                  @click="browseTo(crumb.path)"
                >
                  {{ crumb.name }}
                </button>
              </template>
            </nav>
            <button
              type="button"
              class="p-1 rounded transition flex-shrink-0"
              :style="{ color: copied ? t.success : t.textDim }"
              :title="copied ? tr('workspace.files.pathCopied') : tr('workspace.files.copyPath')"
              @click="copyPath"
            >
              <Check v-if="copied" :size="13" />
              <Copy v-else :size="13" />
            </button>
            <span
              v-if="fileContent?.truncated"
              class="text-[12px] flex-shrink-0"
              :style="{ color: t.warning }"
            >
              {{ tr('workspace.files.truncated') }}
            </span>

            <div class="ml-auto flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                class="p-1 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('workspace.files.reload')"
                @click="reloadCurrent"
              >
                <RotateCw :size="13" />
              </button>
              <!-- Markdown/HTML default to a rendered preview; toggle to raw source. -->
              <div
                v-if="(isMarkdown || isHtml) && !fileContent?.isBinary"
                class="inline-flex rounded overflow-hidden"
                :style="{ border: `1px solid ${t.border}` }"
              >
                <button
                  v-for="m in fileViewModes"
                  :key="m.value"
                  type="button"
                  class="px-1.5 py-1 inline-flex items-center transition"
                  :style="{
                    background: fileView === m.value ? t.bgActive : 'transparent',
                    color: fileView === m.value ? t.text : t.textDim,
                  }"
                  :title="tr(m.labelKey)"
                  @click="fileView = m.value"
                >
                  <component :is="m.icon" :size="12" />
                </button>
              </div>
              <button
                v-if="isMarkdown && !fileContent?.isBinary"
                type="button"
                class="p-1 rounded transition"
                :style="{ color: copiedKind === 'text' ? t.success : t.textDim }"
                :title="tr('workspace.files.copyText')"
                @click="copyText"
              >
                <Check v-if="copiedKind === 'text'" :size="13" />
                <Type v-else :size="13" />
              </button>
              <button
                v-if="!fileContent?.isBinary"
                type="button"
                class="p-1 rounded transition"
                :style="{ color: copiedKind === 'raw' ? t.success : t.textDim }"
                :title="
                  isMarkdown ? tr('workspace.files.copyRaw') : tr('workspace.files.copyContent')
                "
                @click="copyRaw"
              >
                <Check v-if="copiedKind === 'raw'" :size="13" />
                <Clipboard v-else :size="13" />
              </button>
              <button
                type="button"
                class="p-1 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('code.menu.reveal_os')"
                @click="revealCurrent"
              >
                <FolderOpen :size="13" />
              </button>
              <button
                v-if="session.projectId"
                type="button"
                class="p-1 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('workspace.files.openInEditor')"
                @click="openInEditor"
              >
                <Code2 :size="13" />
              </button>
              <button
                v-if="isHtml || isPdf"
                type="button"
                class="p-1 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('workspace.files.showInBrowser')"
                @click="openInBrowser"
              >
                <Globe :size="13" />
              </button>
              <button
                v-if="!fileContent?.isBinary || isPdf"
                type="button"
                class="p-1 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('workspace.files.fullscreen')"
                @click="fullscreen = true"
              >
                <Maximize2 :size="13" />
              </button>
            </div>
          </div>
          <FilePreviewFrame
            v-if="showFramePreview"
            :key="`${selectedPath}-${previewKey}`"
            class="flex-1 min-h-0"
            :workspace-root="workspaceRoot"
            :path="selectedPath ?? ''"
            :kind="isPdf ? 'pdf' : 'html'"
          />
          <div
            v-else-if="fileContent?.isBinary"
            class="flex-1 flex items-center justify-center px-6 text-center text-[1em]"
            :style="{ color: t.textDim }"
          >
            {{ tr('workspace.files.binary') }}
          </div>
          <div
            v-else-if="isMarkdown && fileView === 'preview'"
            ref="previewRef"
            class="flex-1 min-h-0 overflow-y-auto px-4 py-3"
            :style="{ color: t.text }"
          >
            <MarkdownRenderer :content="fileContent?.content ?? ''" />
          </div>
          <MonacoEditor
            v-else
            ref="editorRef"
            class="flex-1 min-h-0"
            :path="selectedPath"
            :read-only="true"
            @ready="onEditorReady"
          />
        </template>
      </div>

      <!-- Browser overlay (hidden by default; toggle via the header icon).
           Finder-style: one folder at a time, breadcrumb + back to navigate. -->
      <div
        v-if="showTree"
        class="absolute inset-0 z-10 flex flex-col"
        :style="{ background: t.bg }"
      >
        <div
          class="px-2 py-1.5 flex items-center gap-1 flex-shrink-0"
          :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
        >
          <button
            type="button"
            class="p-1 rounded transition flex-shrink-0"
            :style="{ color: t.textDim, opacity: atRoot ? 0.4 : 1 }"
            :disabled="atRoot"
            :title="tr('workspace.files.up')"
            @click="goUp"
          >
            <ArrowLeft :size="13" />
          </button>
          <nav class="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto">
            <template v-for="(crumb, ci) in breadcrumbs" :key="crumb.path">
              <ChevronRight
                v-if="ci > 0"
                :size="12"
                class="flex-shrink-0"
                :style="{ color: t.textFaint }"
              />
              <button
                type="button"
                class="px-1 py-0.5 rounded text-[1em] truncate transition hover:underline"
                :style="{ color: ci === breadcrumbs.length - 1 ? t.text : t.textDim }"
                @click="openDir(crumb.path)"
              >
                {{ crumb.name }}
              </button>
            </template>
          </nav>
          <button
            type="button"
            class="p-1 rounded transition flex-shrink-0"
            :style="{ color: t.textDim }"
            :title="tr('workspace.close')"
            @click="showTree = false"
          >
            <X :size="13" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto py-1">
          <WorkspaceFileRow
            v-for="entry in currentEntries"
            :key="entry.path"
            :entry="entry"
            :selected="selectedPath === entry.path"
            :renaming="renamingPath === entry.path"
            :on-open="openEntry"
            :on-context="onContext"
            :on-rename-submit="onRenameSubmit"
            :on-rename-cancel="onRenameCancel"
          />
          <div
            v-if="!currentEntries.length && !loading"
            class="px-4 py-6 text-center text-[1em]"
            :style="{ color: t.textFaint }"
          >
            {{ tr('workspace.files.empty') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Fullscreen file viewer -->
    <FileFullscreenModal
      v-if="fullscreen && selectedPath"
      :workspace-root="workspaceRoot"
      :path="selectedPath"
      :content="fileContent?.content ?? ''"
      :language="fileContent?.language"
      @close="fullscreen = false"
    />

    <!-- Right-click context menu -->
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @close="closeMenu" />

    <!-- Delete confirm -->
    <Teleport to="body">
      <div
        v-if="deleting"
        class="fixed inset-0 z-50 flex items-center justify-center"
        :style="{ background: 'rgba(0,0,0,0.5)' }"
        @click.self="cancelDelete"
      >
        <div
          class="w-80 rounded-lg p-4"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <p class="text-[1em] font-medium mb-1" :style="{ color: t.text }">
            {{
              deleting.isDir ? tr('code.explorer.delete_folder') : tr('code.explorer.delete_file')
            }}
          </p>
          <p class="text-[1em] mb-4 break-all" :style="{ color: t.textDim }">{{ deleting.path }}</p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.bgHover, color: t.text }"
              @click="cancelDelete"
            >
              {{ tr('common.cancel') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded text-[1em]"
              :style="{ background: t.dangerBg, color: t.danger }"
              @click="confirmDelete"
            >
              {{ tr('common.delete') }}
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
  Check,
  ChevronRight,
  Clipboard,
  Code,
  Code2,
  Copy,
  Eye,
  FolderOpen,
  FolderTree,
  Globe,
  ListTree,
  Maximize2,
  RefreshCw,
  RotateCw,
  Type,
  X,
} from 'lucide-vue-next'
import type { Session } from '~/types'
import { useWorkspaceFiles } from '~/composables/useWorkspaceFiles'
import ContextMenu from '~/components/ContextMenu.vue'
import FileFullscreenModal from '~/components/workspace/FileFullscreenModal.vue'
import FilePreviewFrame from '~/components/workspace/FilePreviewFrame.vue'
import MonacoEditor from '~/components/editor/MonacoEditor.vue'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'
import WorkspaceFileRow from './WorkspaceFileRow.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const {
  currentEntries,
  breadcrumbs,
  fileBreadcrumbs,
  atRoot,
  selectedPath,
  fileContent,
  loading,
  showTree,
  editorRef,
  onEditorReady,
  openDir,
  goUp,
  openEntry,
  toggleBrowser,
  browseTo,
  goBackToList,
  refresh,
  reloadFile,
  close,
  openInEditor,
  openInBrowser,
  revealCurrent,
  copied,
  copyPath,
  menu,
  menuItems,
  closeMenu,
  onContext,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  deleting,
  cancelDelete,
  confirmDelete,
  toasts,
  toastStyle,
} = useWorkspaceFiles(props)

// Markdown files render as a preview by default (toggle to the Monaco raw view).
const isMarkdown = computed(() => {
  const lang = (fileContent.value?.language ?? '').toLowerCase()
  return (
    lang === 'markdown' || lang === 'md' || /\.(md|markdown|mdx)$/i.test(selectedPath.value ?? '')
  )
})
// HTML/PDF render in an iframe preview (rendered page / Chromium PDF viewer).
const isHtml = computed(() => /\.html?$/i.test(selectedPath.value ?? ''))
const isPdf = computed(() => /\.pdf$/i.test(selectedPath.value ?? ''))

type FileView = 'preview' | 'raw'
const fileView = ref<FileView>('preview')
// Every newly-opened file starts in preview (the requested default) rather than
// inheriting a 'raw' toggle left over from the previous file.
watch(selectedPath, () => {
  fileView.value = 'preview'
})
const fileViewModes = [
  { value: 'preview' as const, labelKey: 'workspace.files.preview', icon: Eye },
  { value: 'raw' as const, labelKey: 'workspace.files.raw', icon: Code },
]
// PDF is always rendered (binary, no source view); HTML honors the preview toggle.
const showFramePreview = computed(
  () => isPdf.value || (isHtml.value && fileView.value === 'preview'),
)

const previewRef = useTemplateRef<HTMLElement>('previewRef')

// Fullscreen file viewer (escape the narrow docked panel for a big readable view).
const fullscreen = ref(false)

// Reload the current file: re-read content, and remount the preview iframe (it
// reads bytes itself, so a key bump is what forces HTML/PDF to refetch).
const previewKey = ref(0)
const reloadCurrent = async () => {
  await reloadFile()
  previewKey.value++
}

// Transient ✓ feedback for the content/raw copy buttons (separate from the
// path-copy feedback `copied` owned by the composable).
const copiedKind = ref<'text' | 'raw' | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const flashCopied = (kind: 'text' | 'raw') => {
  copiedKind.value = kind
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copiedKind.value = null), 1200)
}
const writeClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard may be denied in restricted contexts — ignore
  }
}
// Raw = the file/markdown source. Text = the rendered preview's plain text
// (markdown stripped); falls back to the source when not in preview mode.
const copyRaw = async () => {
  await writeClipboard(fileContent.value?.content ?? '')
  flashCopied('raw')
}
const copyText = async () => {
  await writeClipboard(previewRef.value?.textContent?.trim() || fileContent.value?.content || '')
  flashCopied('text')
}
onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>
