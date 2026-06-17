<template>
  <div class="flex flex-col overflow-hidden" :style="containerStyle" @click.stop>
    <div
      class="px-4 py-3 flex items-center gap-2"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <component :is="toolIcon" :size="12" class="flex-shrink-0" :style="{ color: t.textMuted }" />
      <div class="flex-1 min-w-0">
        <div class="text-[1em] font-medium truncate" :style="{ color: t.text }">
          {{ step.label }}
          <span v-if="step.target" class="font-mono text-[1em]" :style="{ color: t.textDim }">
            · {{ step.target }}
          </span>
        </div>
        <div
          v-if="step.description || step.pathHint"
          class="text-[1em] truncate"
          :style="{ color: t.textDim }"
        >
          <span v-if="step.description">{{ step.description }}</span>
          <span v-if="step.description && step.pathHint" :style="{ color: t.textFaint }">·</span>
          <span v-if="step.pathHint" class="font-mono">{{ step.pathHint }}</span>
        </div>
      </div>
      <div v-if="detailPath" ref="openMenuRef" class="relative flex-shrink-0">
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
          :style="{
            background: openMenuOpen ? t.bgActive : t.bgInput,
            color: t.text,
            border: `1px solid ${openMenuOpen ? t.borderFocus : t.border}`,
          }"
          @click="openMenuOpen = !openMenuOpen"
        >
          <ExternalLink :size="11" />
          Open
          <ChevronDown :size="9" :style="{ color: t.textDim }" />
        </button>
        <div
          v-if="openMenuOpen"
          class="absolute right-0 top-full mt-1 rounded-md py-1 z-30"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.borderStrong}`,
            boxShadow: `0 8px 24px ${t.shadow}`,
            minWidth: '180px',
          }"
        >
          <button
            v-for="opt in editorOptions"
            :key="opt.scheme"
            class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[1em] transition"
            :style="{
              color: t.text,
              background: openHoverIdx === opt.scheme ? t.bgHover : 'transparent',
            }"
            @mouseenter="openHoverIdx = opt.scheme"
            @mouseleave="openHoverIdx = null"
            @click="openInEditor(opt.scheme)"
          >
            <Code2 :size="11" :style="{ color: t.textDim }" />
            {{ opt.label }}
          </button>
          <div :style="{ height: '1px', background: t.border, margin: '4px 0' }" />
          <button
            class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[1em] transition"
            :style="{ color: t.text }"
            @click="copyPath"
          >
            <Clipboard :size="11" :style="{ color: t.textDim }" />
            Copy path
          </button>
        </div>
      </div>
      <AppButton
        variant="ghost"
        size="icon"
        class="flex-shrink-0"
        title="Close"
        @click="emit('close')"
      >
        <X :size="14" />
      </AppButton>
    </div>

    <div class="flex-1 overflow-y-auto">
      <template v-if="!detail">
        <div class="px-4 py-6 text-[1em] text-center" :style="{ color: t.textDim }">
          No detail available.
        </div>
      </template>

      <template v-else-if="detail.kind === 'diff' || detail.kind === 'file'">
        <div
          class="px-4 py-2 flex items-center gap-2 text-[1em] sticky top-0 z-10"
          :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
        >
          <FileText :size="11" class="flex-shrink-0" :style="{ color: t.textDim }" />
          <span class="font-mono truncate" :style="{ color: t.text }">{{ fileLikePath }}</span>
          <span
            v-if="detail.kind === 'diff' && step.additions !== undefined"
            class="inline-flex items-center px-1 rounded-sm font-mono text-[12px] leading-none"
            :style="{
              background: 'rgba(34, 197, 94, 0.12)',
              color: t.statusOk,
              border: '1px solid rgba(34, 197, 94, 0.35)',
            }"
          >
            +{{ step.additions }}
          </span>
          <span
            v-if="detail.kind === 'diff' && step.deletions !== undefined"
            class="inline-flex items-center px-1 rounded-sm font-mono text-[12px] leading-none"
            :style="{
              background: t.dangerBg,
              color: t.danger,
              border: `1px solid ${t.dangerBorder}`,
            }"
          >
            -{{ step.deletions }}
          </span>
          <span
            v-if="detail.kind === 'file' && detail.language"
            class="text-[1em] uppercase tracking-wider flex-shrink-0"
            :style="{ color: t.textDim }"
          >
            {{ detail.language }}
          </span>

          <div class="ml-auto flex items-center gap-1 flex-shrink-0">
            <!-- An Edit carries both the change and the resulting file: toggle
                 between the git-style diff and the full file content. -->
            <div
              v-if="canToggleFile"
              class="inline-flex rounded overflow-hidden"
              :style="{ border: `1px solid ${t.border}` }"
            >
              <button
                v-for="m in editViewModes"
                :key="m.value"
                class="px-2 py-0.5 text-[1em] inline-flex items-center gap-1 transition"
                :style="{
                  background: editView === m.value ? t.bgActive : 'transparent',
                  color: editView === m.value ? t.text : t.textDim,
                }"
                @click="editView = m.value"
              >
                <component :is="m.icon" :size="10" />
                {{ m.label }}
              </button>
            </div>

            <!-- Diff view: unified ↔ split. -->
            <div
              v-if="showingDiff"
              class="inline-flex rounded overflow-hidden"
              :style="{ border: `1px solid ${t.border}` }"
            >
              <button
                v-for="m in diffModes"
                :key="m.value"
                class="px-2 py-0.5 text-[1em] inline-flex items-center gap-1 transition"
                :style="{
                  background: diffMode === m.value ? t.bgActive : 'transparent',
                  color: diffMode === m.value ? t.text : t.textDim,
                }"
                @click="diffMode = m.value"
              >
                <component :is="m.icon" :size="10" />
                {{ m.label }}
              </button>
            </div>

            <!-- File view: markdown preview ↔ raw + copy. -->
            <div
              v-if="showingFile && isMarkdown"
              class="inline-flex rounded overflow-hidden"
              :style="{ border: `1px solid ${t.border}` }"
            >
              <button
                v-for="m in fileViewModes"
                :key="m.value"
                class="px-1.5 py-1 inline-flex items-center transition"
                :style="{
                  background: fileView === m.value ? t.bgActive : 'transparent',
                  color: fileView === m.value ? t.text : t.textDim,
                }"
                :title="m.label"
                @click="fileView = m.value"
              >
                <component :is="m.icon" :size="12" />
              </button>
            </div>
            <AppButton
              v-if="showingFile && isMarkdown"
              variant="ghost"
              size="icon"
              :active="copied === 'text'"
              title="Copy as plain text"
              @click="copyText"
            >
              <component :is="copied === 'text' ? Check : Clipboard" :size="12" />
            </AppButton>
            <AppButton
              v-if="showingFile"
              variant="ghost"
              size="icon"
              :active="copied === 'raw'"
              :title="isMarkdown ? 'Copy raw markdown' : 'Copy content'"
              @click="copyRaw"
            >
              <component :is="copied === 'raw' ? Check : Code2" :size="12" />
            </AppButton>
          </div>
        </div>

        <!-- Diff body (git-style change). -->
        <SideDiffViewer v-if="showingDiff && diffMode === 'split'" :content="diffText" />
        <DiffViewer v-else-if="showingDiff" :content="diffText" />

        <!-- File body (full content, same form as Read/Write). -->
        <div
          v-else-if="showingFile && isMarkdown && fileView === 'preview'"
          ref="previewRef"
          class="px-4 py-3"
          :style="{ color: t.text }"
        >
          <MarkdownRenderer :content="fileLikeContent" />
        </div>
        <pre
          v-else-if="showingFile"
          class="font-mono text-[1em] leading-[1.55] px-4 py-3 whitespace-pre-wrap"
          :style="{ color: t.text }"
          >{{ fileLikeContent }}</pre
        >
      </template>

      <template v-else-if="detail.kind === 'list'">
        <div
          v-for="(item, i) in detail.items"
          :key="i"
          class="px-4 py-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div class="text-[1em] flex items-center gap-2" :style="{ color: t.text }">
            <FolderSearch :size="11" :style="{ color: t.textDim }" />
            <span class="font-mono truncate">{{ item.label }}</span>
            <span
              v-if="item.path"
              class="ml-auto font-mono text-[1em] truncate"
              :style="{ color: t.textFaint }"
            >
              {{ item.path }}
            </span>
          </div>
          <pre
            v-if="item.snippet"
            class="mt-1 font-mono text-[1em] leading-[1.5] whitespace-pre-wrap"
            :style="{ color: t.textMuted }"
            >{{ item.snippet }}</pre
          >
        </div>
      </template>

      <template v-else-if="detail.kind === 'terminal'">
        <div class="px-4 py-3 space-y-2">
          <div class="flex items-center gap-2 text-[1em] font-mono">
            <span :style="{ color: t.textDim }">$</span>
            <span :style="{ color: t.text }">{{ detail.command }}</span>
            <span
              v-if="detail.exitCode !== undefined"
              class="ml-auto text-[1em] inline-flex items-center px-1.5 rounded-sm"
              :style="{
                background: detail.exitCode === 0 ? 'rgba(34, 197, 94, 0.12)' : t.dangerBg,
                color: detail.exitCode === 0 ? t.statusOk : t.danger,
                border: `1px solid ${detail.exitCode === 0 ? 'rgba(34, 197, 94, 0.35)' : t.dangerBorder}`,
              }"
            >
              exit {{ detail.exitCode }}
            </span>
          </div>
          <pre
            v-if="detail.output"
            class="font-mono text-[1em] leading-[1.55] whitespace-pre-wrap px-3 py-2 rounded"
            :style="{
              color: t.textMuted,
              background: t.bgInput,
              border: `1px solid ${t.border}`,
            }"
            >{{ detail.output }}</pre
          >
        </div>
      </template>

      <template v-else-if="detail.kind === 'text'">
        <div
          class="px-4 py-3 text-[1em] leading-relaxed whitespace-pre-wrap"
          :style="{ color: t.text }"
        >
          {{ detail.content }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Columns2,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FolderSearch,
  GitCompare,
  Rows,
  Save,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-vue-next'
import type { SessionStep } from '~/types'

const props = withDefaults(
  defineProps<{
    step: SessionStep
    floating?: boolean
  }>(),
  { floating: false },
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useTheme()

const containerStyle = computed(() => {
  if (props.floating) {
    return {
      width: 'min(1080px, 96vw)',
      maxWidth: '96vw',
      flexShrink: 0,
      background: t.value.bgPanel,
      borderLeft: `1px solid ${t.value.border}`,
      boxShadow: `-12px 0 32px ${t.value.shadow}`,
    }
  }
  return {
    width: '720px',
    flexShrink: 0,
    background: t.value.bgPanel,
    borderLeft: `1px solid ${t.value.border}`,
  }
})

type DiffMode = 'unified' | 'split'
const diffMode = ref<DiffMode>('split')
const diffModes = [
  { value: 'split' as const, label: 'Split', icon: Columns2 },
  { value: 'unified' as const, label: 'Unified', icon: Rows },
]

// An Edit/MultiEdit detail (kind 'diff') carries both the git-style diff AND the
// full file after the edit, so the user can flip between the change and the
// resulting file. Defaults to the diff — that's the point of an edit.
type EditView = 'diff' | 'file'
const editView = ref<EditView>('diff')
const editViewModes = [
  { value: 'diff' as const, label: 'Diff', icon: GitCompare },
  { value: 'file' as const, label: 'File', icon: FileText },
]
const openMenuOpen = ref(false)
const openMenuRef = ref<HTMLElement | null>(null)
const openHoverIdx = ref<string | null>(null)

const editorOptions = [
  { scheme: 'vscode' as const, label: 'Open in VS Code' },
  { scheme: 'cursor' as const, label: 'Open in Cursor' },
  { scheme: 'idea' as const, label: 'Open in JetBrains IDE' },
]

const closeOpenMenu = (ev: MouseEvent) => {
  if (!openMenuOpen.value) return
  if (openMenuRef.value && openMenuRef.value.contains(ev.target as Node)) return
  openMenuOpen.value = false
}

onMounted(() => document.addEventListener('mousedown', closeOpenMenu))
onUnmounted(() => document.removeEventListener('mousedown', closeOpenMenu))

const detailPath = computed(() => {
  const d = props.step.detail
  if (!d) return null
  if (d.kind === 'diff' || d.kind === 'file') return d.path
  return null
})

const openInEditor = (scheme: 'vscode' | 'cursor' | 'idea') => {
  const path = detailPath.value
  if (!path) return
  let url = ''
  if (scheme === 'vscode') url = `vscode://file/${path}`
  else if (scheme === 'cursor') url = `cursor://file/${path}`
  else if (scheme === 'idea')
    url = `jetbrains://idea/navigate/reference?path=${encodeURIComponent(path)}`
  window.location.href = url
  openMenuOpen.value = false
}

const copyPath = async () => {
  const path = detailPath.value
  if (!path) return
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    // ignore — clipboard may be unavailable in some contexts
  }
  openMenuOpen.value = false
}

const TOOL_ICONS = {
  read: FileText,
  write: Sparkles,
  edit: Edit3,
  save: Save,
  search: Search,
  'find-files': FolderSearch,
  terminal: Terminal,
  task: Sparkles,
} as const

const toolIcon = computed(() => (props.step.tool ? TOOL_ICONS[props.step.tool] : FileText))
const detail = computed(() => props.step.detail)

// The unified diff string (Edit/MultiEdit only); '' otherwise.
const diffText = computed(() => (detail.value?.kind === 'diff' ? detail.value.diff : ''))
// A 'diff' detail also offers a File view only when it carries the after-content.
const canToggleFile = computed(
  () => detail.value?.kind === 'diff' && (detail.value.content ?? '').length > 0,
)
const showingDiff = computed(() => detail.value?.kind === 'diff' && editView.value === 'diff')
const showingFile = computed(
  () =>
    detail.value?.kind === 'file' || (detail.value?.kind === 'diff' && editView.value === 'file'),
)

// File-view source, unified across 'file' (Read/Write) and 'diff' (Edit) details
// so the markdown/raw rendering + copy work the same for both.
const fileLikePath = computed(() => {
  const d = detail.value
  return d?.kind === 'file' || d?.kind === 'diff' ? d.path : ''
})
const fileLikeContent = computed(() => {
  const d = detail.value
  if (d?.kind === 'file') return d.content
  if (d?.kind === 'diff') return d.content ?? ''
  return ''
})
const fileLikeLanguage = computed(() => {
  const d = detail.value
  return d?.kind === 'file' || d?.kind === 'diff' ? d.language : undefined
})

// Markdown content renders as a preview by default (toggle to raw source).
const isMarkdown = computed(() => {
  const lang = (fileLikeLanguage.value ?? '').toLowerCase()
  return lang === 'markdown' || lang === 'md' || /\.(md|markdown|mdx)$/i.test(fileLikePath.value)
})

type FileView = 'preview' | 'raw'
const fileView = ref<FileView>('preview')
const fileViewModes = [
  { value: 'preview' as const, label: 'Preview', icon: Eye },
  { value: 'raw' as const, label: 'Raw', icon: Code2 },
]

const previewRef = useTemplateRef<HTMLElement>('previewRef')
const fileContent = (): string => fileLikeContent.value

// Transient ✓ feedback per copy button.
const copied = ref<'text' | 'raw' | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const flashCopied = (kind: 'text' | 'raw') => {
  copied.value = kind
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = null), 1200)
}
const writeClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard may be unavailable (non-secure context) — ignore
  }
}
// Raw = the markdown/file source. Text = the rendered preview's plain text
// (markdown stripped); falls back to the source when not in preview mode.
const copyRaw = async () => {
  await writeClipboard(fileContent())
  flashCopied('raw')
}
const copyText = async () => {
  await writeClipboard(previewRef.value?.textContent?.trim() || fileContent())
  flashCopied('text')
}
onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>
