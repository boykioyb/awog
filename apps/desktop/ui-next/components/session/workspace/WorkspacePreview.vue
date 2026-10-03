<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Unavailable / no-root (browser-dev or unknown project). -->
    <div v-if="!ready" class="empty" style="padding: 30px">
      <div class="et">{{ unavailableMsg }}</div>
    </div>

    <!-- No previewable artifacts produced by this session yet. -->
    <div v-else-if="!artifacts.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.preview.empty') }}</div>
    </div>

    <template v-else>
      <!-- Artifact picker — one chip per previewable file the session wrote (only when
           there's more than one; a single artifact renders straight away). -->
      <div
        v-if="artifacts.length > 1"
        class="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-1.5"
      >
        <button
          v-for="(a, i) in artifacts"
          :key="a"
          type="button"
          :class="[
            'max-w-40 shrink-0 truncate rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
            i === selectedIdx
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          ]"
          :title="a"
          @click="selectedIdx = i"
        >
          {{ baseName(a) }}
        </button>
      </div>

      <!-- Path header + (for html/pdf) an "open in browser" action for full fidelity. -->
      <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          :title="selectedPath"
        >
          {{ selectedPath }}
        </span>
        <Button
          v-if="selectedKind !== 'markdown'"
          variant="ghost"
          type="button"
          class="h-auto p-0 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('sessions.workspace.preview.openExternal')"
          :aria-label="t('sessions.workspace.preview.openExternal')"
          @click="openExternal"
        >
          <Globe class="size-3.5" />
        </Button>
      </div>

      <!-- Body: markdown renders inline + scrolls; html/pdf fill the body edge-to-edge. -->
      <div class="flex min-h-0 flex-1 flex-col">
        <div v-if="loading" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.preview.loading') }}</div>
        </div>
        <div v-else-if="loadError" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.workspace.files.openFailed') }}</div>
        </div>
        <div v-else-if="tooLarge" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.preview.tooLarge') }}</div>
          <Button
            variant="outline"
            type="button"
            class="h-auto p-0 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            @click="openExternal"
          >
            {{ t('sessions.workspace.preview.openExternal') }}
          </Button>
        </div>

        <!-- Markdown — rendered with the same pipeline as the transcript. -->
        <div v-else-if="selectedKind === 'markdown'" class="min-h-0 flex-1 overflow-y-auto p-4">
          <div v-if="!content.trim()" class="empty" style="padding: 24px">
            <div class="et">{{ t('sessions.workspace.preview.noContent') }}</div>
          </div>
          <SessionTextBlock v-else :text="content" />
        </div>

        <!-- HTML — sandboxed, opaque-origin iframe (allow-scripts but NO
             allow-same-origin → the artifact's JS runs isolated, can't reach app://
             or the parent). Relative assets won't resolve here; "open in browser" is
             the full-fidelity path. -->
        <iframe
          v-else-if="selectedKind === 'html'"
          class="min-h-0 w-full flex-1 border-0 bg-white"
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          :srcdoc="content"
          :title="selectedPath"
        />

        <!-- PDF — Chromium's native embedded viewer via a base64 data: URL. -->
        <iframe
          v-else-if="selectedKind === 'pdf' && pdfSrc"
          class="min-h-0 w-full flex-1 border-0 bg-white"
          :src="pdfSrc"
          :title="selectedPath"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Preview tab (§5/§10) — renders the previewable documents this session produced
// (plan docs, ADRs, reports…), ported + extended from the old UI's WorkspacePreviewTab.
// Artifacts are derived from the session's Write/Edit steps (useSessionTouchedPaths)
// filtered to previewable types, then the selected file's real content is read from
// disk and rendered: markdown via SessionTextBlock (same pipeline as the transcript),
// HTML in a sandboxed iframe, PDF in Chromium's embedded viewer. Degrades to an
// empty/disabled state in browser-dev or when the workspace root can't resolve.
import { Globe } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import { useFsApi } from '~/composables/useFsApi'
import { absFileScope } from '~/composables/useFilePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useSessionTouchedPaths } from '~/composables/useSessionTouchedPaths'
import { useSidecar } from '~/composables/useSidecar'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const fs = useFsApi()
const { root, ready } = useWorkspaceData(() => props.session.project)
const { touchedPaths } = useSessionTouchedPaths(
  () => props.session,
  () => root.value,
)

const unavailableMsg = computed(() =>
  sc.available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable'),
)

type ArtifactKind = 'markdown' | 'html' | 'pdf'
function kindOf(path: string): ArtifactKind {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.html?$/i.test(path)) return 'html'
  return 'markdown'
}

// Documents the session wrote that this tab can render (markdown / HTML / PDF) —
// Files/Diff already cover arbitrary files. Stable first-touch order from the Set.
const artifacts = computed<string[]>(() =>
  touchedPaths.value.filter((p) => /\.(md|markdown|html?|pdf)$/i.test(p)),
)

const selectedIdx = ref(0)
// Fall back to the first artifact when the selection points past the end (the list
// shrinks on session switch or as streamed writes change the set).
const selectedPath = computed<string>(
  () => artifacts.value[selectedIdx.value] ?? artifacts.value[0] ?? '',
)
const selectedKind = computed<ArtifactKind>(() => kindOf(selectedPath.value))

const baseName = (p: string): string => p.split('/').pop() || p

// ── Load the selected artifact's content ─────────────────────────────────────
const content = ref('') // markdown / html text
const pdfSrc = ref('') // base64 data: URL for the PDF viewer
const loading = ref(false)
const loadError = ref(false)
const tooLarge = ref(false)
// Guards against an out-of-order resolve when the selection changes mid-load.
let loadSeq = 0

async function load(): Promise<void> {
  const seq = ++loadSeq
  const r = root.value
  const p = selectedPath.value
  content.value = ''
  pdfSrc.value = ''
  loadError.value = false
  tooLarge.value = false
  if (!r || !p) return
  // Artifact path tuyệt đối ngoài workspace (session worktree) → scope về thư
  // mục cha; ghép vào project root chỉ tạo ra path hợp cất không tồn tại.
  const scope = p.startsWith('/') && !p.startsWith(r + '/') ? absFileScope(p) : null
  const rr = scope?.root ?? r
  const rp = scope?.rel ?? (p.startsWith(r + '/') ? p.slice(r.length + 1) : p)
  const kind = kindOf(p)
  loading.value = true
  try {
    if (kind === 'pdf') {
      const res = await fs.readFileBase64(rr, rp)
      if (seq !== loadSeq) return
      if (res.truncated || !res.base64) {
        tooLarge.value = true
        return
      }
      pdfSrc.value = `data:${res.mimeType};base64,${res.base64}`
    } else {
      const res = await fs.readFile(rr, rp)
      if (seq !== loadSeq) return
      if (res.isBinary) {
        loadError.value = true
        return
      }
      content.value = res.content
    }
  } catch {
    if (seq === loadSeq) loadError.value = true
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function openExternal(): Promise<void> {
  const r = root.value
  const p = selectedPath.value
  if (!r || !p) return
  // Cùng scoping của load(): abs ngoài workspace → root = thư mục cha.
  const scope = p.startsWith('/') && !p.startsWith(r + '/') ? absFileScope(p) : null
  const rr = scope?.root ?? r
  const rp = scope?.rel ?? (p.startsWith(r + '/') ? p.slice(r.length + 1) : p)
  await sc.openFileExternal(rr, rp)
}

// Reload when the root resolves or the selected artifact changes.
watch([root, selectedPath], () => void load(), { immediate: true })
</script>
