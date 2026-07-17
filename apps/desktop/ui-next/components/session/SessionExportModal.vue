<template>
  <!-- Teleport to body so the modal escapes any session/panel stacking context.
       Single instance, driven by useSessionExportModal(). -->
  <Teleport to="body">
    <div v-if="session" class="ovl on expovl" @click.self="close">
      <div class="expmodal">
        <div class="expmodal-head">
          <Icon name="save" style="width: 14px; height: 14px; color: var(--accent)" />
          <span class="expmodal-title">{{ t('sessions.export.title') }}</span>
          <span style="flex: 1" />
          <button class="expmodal-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div class="expmodal-bar">
          <!-- Format toggle (segmented: transparent + border + accent tint when active). -->
          <div class="expseg" role="tablist">
            <button
              class="expseg-btn"
              :class="{ on: format === 'md' }"
              role="tab"
              :aria-selected="format === 'md'"
              @click="format = 'md'"
            >
              <Icon name="file" style="width: 12px; height: 12px" />
              {{ t('sessions.export.md') }}
            </button>
            <button
              class="expseg-btn"
              :class="{ on: format === 'html' }"
              role="tab"
              :aria-selected="format === 'html'"
              @click="format = 'html'"
            >
              <Icon name="code" style="width: 12px; height: 12px" />
              {{ t('sessions.export.html') }}
            </button>
            <button
              class="expseg-btn"
              :class="{ on: format === 'prompt' }"
              role="tab"
              :aria-selected="format === 'prompt'"
              :title="t('sessions.export.promptHint')"
              @click="format = 'prompt'"
            >
              <Icon
                name="sparkles"
                :class="{ 'expseg-busy': promptLoading }"
                style="width: 12px; height: 12px"
              />
              {{ t('sessions.export.prompt') }}
            </button>
          </div>
          <span style="flex: 1" />
          <span v-if="status" class="expstatus" :class="{ err: statusErr }">{{ status }}</span>
          <button
            v-if="format === 'prompt'"
            class="expbtn"
            :disabled="promptLoading"
            @click="onRegenerate"
          >
            <Icon name="refresh" style="width: 13px; height: 13px" />
            {{ t('sessions.export.regenerate') }}
          </button>
          <button class="expbtn" :disabled="!contentReady" @click="onCopy">
            <Icon name="copy" style="width: 13px; height: 13px" />
            {{ t('sessions.export.copy') }}
          </button>
          <button
            class="expbtn pri"
            :disabled="!canSave || !contentReady"
            :title="saveTitle"
            @click="onSave"
          >
            <Icon name="save" style="width: 13px; height: 13px" />
            {{ t('sessions.export.save') }}
          </button>
        </div>

        <!-- Saved bar — appears after a successful save. Shows the destination in a
             readable form (folder dimmed, filename bold, full path on hover) plus the
             file actions: reveal in the OS file manager and open in VS Code. -->
        <div v-if="saved" class="expsaved">
          <div class="expsaved-top">
            <Icon name="check" class="expsaved-ok" style="width: 14px; height: 14px" />
            <span class="expsaved-label">{{ t('sessions.export.savedLabel') }}</span>
            <span style="flex: 1" />
            <button class="expbtn" @click="onReveal">
              <Icon name="folder" style="width: 13px; height: 13px" />
              {{ t('sessions.export.reveal') }}
            </button>
            <button v-if="vscodeAvailable" class="expbtn" @click="onOpenVscode">
              <Icon name="code" style="width: 13px; height: 13px" />
              {{ t('sessions.export.openInVscode') }}
            </button>
            <button class="expbtn" :title="t('sessions.export.copyPath')" @click="onCopyPath">
              <Icon name="copy" style="width: 13px; height: 13px" />
            </button>
          </div>
          <div class="expsaved-path" :title="saved.path">
            <span class="expsaved-dir">{{ savedDir }}</span>
            <span class="expsaved-name">{{ savedName }}</span>
          </div>
        </div>

        <div class="expmodal-body">
          <template v-if="format === 'prompt'">
            <div v-if="promptError" class="expgen err">
              <span>{{ promptError }}</span>
              <button class="expbtn" @click="onRegenerate">
                <Icon name="refresh" style="width: 13px; height: 13px" />
                {{ t('sessions.export.retry') }}
              </button>
            </div>
            <div v-else-if="promptLoading && !promptText" class="expgen">
              <Icon name="sparkles" class="expgen-spin" style="width: 20px; height: 20px" />
              <span>{{ t('sessions.export.promptGenerating') }}</span>
            </div>
            <!-- Editable so the user can tweak the prompt before copy/save. Readonly
                 while streaming (deltas append programmatically); editable once done. -->
            <textarea
              v-else
              v-model="promptText"
              class="exppromptarea"
              :readonly="promptLoading"
              :aria-label="t('sessions.export.prompt')"
              spellcheck="false"
            />
          </template>
          <pre v-else class="exppreview">{{ content }}</pre>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Session export dialog — preview the transcript as Markdown or standalone HTML and
// copy it / save it to disk. Rendering + IPC live in useSessionExport; this is the
// thin presentation shell. Mounted once in the default layout.
import { computed, ref, watch } from 'vue'
import { useSessionExportModal } from '~/composables/useSessionExportModal'
import {
  useSessionExport,
  type ExportFormat,
  type SaveResult,
} from '~/composables/useSessionExport'
import { useSessionsStore } from '~/stores/sessions'

const { t } = useI18n()
const { sessionId, close } = useSessionExportModal()
const store = useSessionsStore()
const {
  buildContent,
  copyToClipboard,
  saveToDisk,
  revealExport,
  openExportInVscode,
  canSave,
  vscodeAvailable,
} = useSessionExport()

const format = ref<ExportFormat>('md')
const status = ref('')
const statusErr = ref(false)
// The last successful save — drives the readable "saved" bar + its file actions.
const saved = ref<SaveResult | null>(null)

// 'prompt' mode: the LLM-generated summary prompt + its async state. Cached so toggling
// formats doesn't re-run the model — Regenerate forces a fresh one.
const promptText = ref('')
const promptLoading = ref(false)
const promptError = ref('')

const session = computed(() => store.sessions.find((s) => s.id === sessionId.value) ?? null)

// Make sure the transcript is loaded (a session exported from the list context menu
// may not be the active one). Reset the dialog state each time it (re)opens.
watch(sessionId, (id) => {
  resetState()
  promptText.value = ''
  promptError.value = ''
  format.value = 'md'
  if (id != null) void store.ensureLoaded(id)
})

// Switching format invalidates the saved bar. Entering 'prompt' the first time (per
// session) kicks off the summary; a cached prompt is reused on later toggles.
watch(format, (f) => {
  resetState()
  if (f === 'prompt' && !promptText.value && !promptLoading.value) void generatePrompt()
})

const content = computed(() => {
  if (!session.value) return ''
  if (format.value === 'prompt') return promptText.value
  return buildContent(session.value, format.value)
})

// Copy/Save need real content — for 'prompt' that means the async summary finished.
const contentReady = computed(
  () => format.value !== 'prompt' || (!promptLoading.value && !!promptText.value),
)

// Streaming summarize of the session into a reusable handoff prompt. Deltas append to
// promptText live (the textarea shows it building); the returned string is the
// authoritative final text in case any chunk was dropped.
async function generatePrompt(): Promise<void> {
  const id = sessionId.value
  if (id == null) return
  promptLoading.value = true
  promptError.value = ''
  promptText.value = ''
  try {
    const full = await store.summarizeToPrompt(id, (delta) => {
      promptText.value += delta
    })
    promptText.value = full
  } catch (err) {
    promptError.value = err instanceof Error ? err.message : t('sessions.export.promptFailed')
    promptText.value = ''
  } finally {
    promptLoading.value = false
  }
}

function onRegenerate(): void {
  void generatePrompt()
}

const saveTitle = computed(() => (canSave ? '' : t('sessions.export.saveUnavailable')))

// Split the absolute saved path into a (dimmed) folder + (bold) filename so the
// full name stays readable instead of being ellipsized away. Cross-platform: the
// separator is `/` (posix) or `\` (win).
const savedName = computed(() => saved.value?.path.split(/[\\/]/).pop() ?? '')
const savedDir = computed(() => {
  const p = saved.value?.path ?? ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i + 1) : ''
})

async function onCopy() {
  const ok = await copyToClipboard(content.value)
  setStatus(ok ? t('sessions.export.copied') : t('sessions.export.copyFailed'), !ok)
}

async function onSave() {
  if (!session.value) return
  const result = await saveToDisk(session.value, format.value, content.value)
  if (result) {
    saved.value = result
    setStatus('', false)
  } else {
    saved.value = null
    setStatus(t('sessions.export.saveFailed'), true)
  }
}

async function onReveal() {
  if (!saved.value) return
  if (!(await revealExport(saved.value))) setStatus(t('sessions.export.revealFailed'), true)
}

async function onOpenVscode() {
  if (!saved.value) return
  if (!(await openExportInVscode(saved.value))) setStatus(t('sessions.export.openFailed'), true)
}

async function onCopyPath() {
  if (!saved.value) return
  const ok = await copyToClipboard(saved.value.path)
  setStatus(ok ? t('sessions.export.pathCopied') : t('sessions.export.copyFailed'), !ok)
}

function setStatus(msg: string, err: boolean) {
  status.value = msg
  statusErr.value = err
}

function resetState() {
  status.value = ''
  statusErr.value = false
  saved.value = null
}

// Esc closes (only while open).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && session.value) {
    e.preventDefault()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.expovl {
  align-items: center;
  padding: 24px;
  z-index: 130;
}
.expmodal {
  width: min(900px, 94vw);
  height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--borderStrong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.expmodal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bgEl);
}
.expmodal-title {
  font-weight: 600;
}
.expmodal-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
}
.expmodal-x:hover {
  color: var(--text);
  background: var(--bgHover);
}
.expmodal-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}
.expseg {
  display: inline-flex;
  gap: 4px;
}
.expseg-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.expseg-btn:hover {
  color: var(--text);
  border-color: var(--borderStrong);
}
.expseg-btn.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.expstatus {
  color: var(--textDim);
  font-size: 12px;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expstatus.err {
  color: var(--danger);
}
.expbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.expbtn:hover {
  background: var(--bgHover);
}
.expbtn.pri {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.expbtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.expsaved {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--accentDim);
}
.expsaved-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.expsaved-ok {
  color: var(--accent);
}
.expsaved-label {
  font-weight: 600;
}
.expsaved-path {
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.expsaved-dir {
  color: var(--textDim);
}
.expsaved-name {
  color: var(--text);
  font-weight: 600;
}
.expmodal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.exppreview {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
}
/* Prompt mode: editable text area filling the body — user can tweak before copy/save.
   resize:none because the modal body governs the height (single-purpose modal input). */
.exppromptarea {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  margin: 0;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Prompt tab icon pulses while the summary is streaming — a loading cue on the tab. */
.expseg-busy {
  color: var(--accent);
  animation: expgen-pulse 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .expseg-busy {
    animation: none;
  }
}
/* Prompt-mode placeholder: centered generating / error state. */
.expgen {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--textDim);
  text-align: center;
}
.expgen.err {
  color: var(--danger);
}
.expgen-spin {
  color: var(--accent);
  animation: expgen-pulse 1.2s ease-in-out infinite;
}
@keyframes expgen-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .expgen-spin {
    animation: none;
  }
}
</style>
