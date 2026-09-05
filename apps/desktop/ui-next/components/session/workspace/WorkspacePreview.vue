<template>
  <div class="wsprev">
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
      <div v-if="artifacts.length > 1" class="wsprev-tabs">
        <button
          v-for="(a, i) in artifacts"
          :key="a"
          type="button"
          class="wsprev-tab"
          :class="{ on: i === selectedIdx }"
          :title="a"
          @click="selectedIdx = i"
        >
          {{ baseName(a) }}
        </button>
      </div>

      <!-- Path header + (for html/pdf) an "open in browser" action for full fidelity. -->
      <div class="wsprev-head">
        <span class="wsprev-path mono" :title="selectedPath">{{ selectedPath }}</span>
        <button
          v-if="selectedKind !== 'markdown'"
          type="button"
          class="wsprev-act"
          :title="t('sessions.workspace.preview.openExternal')"
          @click="openExternal"
        >
          <Icon name="globe" style="width: 13px; height: 13px" />
        </button>
      </div>

      <!-- Body: markdown renders inline + scrolls; html/pdf fill the body edge-to-edge. -->
      <div class="wsprev-body">
        <div v-if="loading" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.preview.loading') }}</div>
        </div>
        <div v-else-if="loadError" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.workspace.files.openFailed') }}</div>
        </div>
        <div v-else-if="tooLarge" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.preview.tooLarge') }}</div>
          <button type="button" class="wsprev-extbtn" @click="openExternal">
            {{ t('sessions.workspace.preview.openExternal') }}
          </button>
        </div>

        <!-- Markdown — rendered with the same pipeline as the transcript. -->
        <div v-else-if="selectedKind === 'markdown'" class="wsprev-md">
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
          class="wsprev-frame"
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          :srcdoc="content"
          :title="selectedPath"
        />

        <!-- PDF — Chromium's native embedded viewer via a base64 data: URL. -->
        <iframe
          v-else-if="selectedKind === 'pdf' && pdfSrc"
          class="wsprev-frame"
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
import type { Session } from '~/composables/useSessionsData'
import { useFsApi } from '~/composables/useFsApi'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useSessionTouchedPaths } from '~/composables/useSessionTouchedPaths'
import { useSidecar } from '~/composables/useSidecar'

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
  const kind = kindOf(p)
  loading.value = true
  try {
    if (kind === 'pdf') {
      const res = await fs.readFileBase64(r, p)
      if (seq !== loadSeq) return
      if (res.truncated || !res.base64) {
        tooLarge.value = true
        return
      }
      pdfSrc.value = `data:${res.mimeType};base64,${res.base64}`
    } else {
      const res = await fs.readFile(r, p)
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
  if (root.value && selectedPath.value) await sc.openFileExternal(root.value, selectedPath.value)
}

// Reload when the root resolves or the selected artifact changes.
watch([root, selectedPath], () => void load(), { immediate: true })
</script>

<style scoped>
.wsprev {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
/* Artifact picker — transparent chips with an accent-tinted active state (avoid a
   solid grey fill, per the segmented-control convention). */
.wsprev-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  overflow-x: auto;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.wsprev-tab {
  flex: 0 0 auto;
  max-width: 160px;
  padding: 4px 10px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--textDim);
  font-family: var(--code);
  font-size: var(--fs-xs);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.wsprev-tab:hover {
  color: var(--text);
  background: var(--bgHover);
}
.wsprev-tab.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accentDim);
}
/* Path header — file path + (html/pdf) open-in-browser action. */
.wsprev-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.wsprev-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsprev-act {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 4px;
  border-radius: var(--r-xs);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
}
.wsprev-act:hover {
  color: var(--text);
  background: var(--bgHover);
}
.wsprev-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Markdown scrolls with reading padding; the iframes fill the body edge-to-edge. */
.wsprev-md {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.wsprev-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}
/* "Open in browser" button shown alongside the too-large notice (the parent
   .empty supplies the gap above it). */
.wsprev-extbtn {
  padding: 6px 14px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 500;
}
.wsprev-extbtn:hover {
  background: var(--accentDim);
}
</style>
