<template>
  <!-- Dialog (reka) tự teleport ra body nên modal thoát mọi stacking context của
       session/panel. Một instance duy nhất, lái bởi useSessionExportModal(). -->
  <Dialog :open="!!session" @update:open="(v) => !v && close()">
    <DialogContent
      class="flex h-[82vh] w-[94vw] max-w-225 flex-col gap-0 overflow-hidden rounded-lg bg-card p-0 text-card-foreground sm:max-w-225"
      :aria-describedby="undefined"
    >
      <div class="flex h-12 shrink-0 items-center gap-2 pr-12 pl-4">
        <Icon name="save" class="size-3.5 text-primary" />
        <DialogTitle>{{ t('sessions.export.title') }}</DialogTitle>
      </div>
      <Separator />

      <div class="flex shrink-0 items-center gap-2 px-3.5 py-2">
        <!-- Chọn định dạng (segmented: trong suốt + viền + tint accent khi chọn). Nhấp
             lại mục đang chọn KHÔNG bỏ chọn — luôn có đúng một định dạng. -->
        <ToggleGroup
          type="single"
          variant="outline"
          :spacing="1"
          :model-value="format"
          @update:model-value="(v) => v && (format = v as ExportFormat)"
        >
          <ToggleGroupItem
            value="md"
            class="h-auto gap-1 rounded-sm px-2.5 py-1 font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-primary [&_svg]:size-3"
          >
            <Icon name="file" />
            {{ t('sessions.export.md') }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="html"
            class="h-auto gap-1 rounded-sm px-2.5 py-1 font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-primary [&_svg]:size-3"
          >
            <Icon name="code" />
            {{ t('sessions.export.html') }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="prompt"
            class="h-auto gap-1 rounded-sm px-2.5 py-1 font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-primary [&_svg]:size-3"
            :title="t('sessions.export.promptHint')"
          >
            <!-- Icon tab Prompt nhấp nháy khi bản tóm tắt đang stream — tín hiệu tải trên tab. -->
            <Icon
              name="sparkles"
              :class="promptLoading && 'animate-pulse text-primary motion-reduce:animate-none'"
            />
            {{ t('sessions.export.prompt') }}
          </ToggleGroupItem>
        </ToggleGroup>
        <span class="flex-1" />
        <span
          v-if="status"
          class="max-w-90 truncate text-sm"
          :class="statusErr ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ status }}
        </span>
        <Button
          v-if="format === 'prompt'"
          variant="outline"
          size="sm"
          :disabled="promptLoading"
          @click="onRegenerate"
        >
          <Icon name="refresh" class="size-3.5" />
          {{ t('sessions.export.regenerate') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!contentReady" @click="onCopy">
          <Icon name="copy" class="size-3.5" />
          {{ t('sessions.export.copy') }}
        </Button>
        <Button size="sm" :disabled="!canSave || !contentReady" :title="saveTitle" @click="onSave">
          <Icon name="save" class="size-3.5" />
          {{ t('sessions.export.save') }}
        </Button>
      </div>
      <Separator />

      <!-- Saved bar — appears after a successful save. Shows the destination in a
           readable form (folder dimmed, filename bold, full path on hover) plus the
           file actions: reveal in the OS file manager and open in VS Code. -->
      <template v-if="saved">
        <div class="flex shrink-0 flex-col gap-1.5 bg-success/8 px-3.5 py-2.5">
          <div class="flex items-center gap-2">
            <Icon name="check" class="size-3.5 text-success" />
            <span class="flex-1 font-semibold">{{ t('sessions.export.savedLabel') }}</span>
            <Button variant="outline" size="sm" @click="onReveal">
              <Icon name="folder" class="size-3.5" />
              {{ t('sessions.export.reveal') }}
            </Button>
            <Button v-if="vscodeAvailable" variant="outline" size="sm" @click="onOpenVscode">
              <Icon name="code" class="size-3.5" />
              {{ t('sessions.export.openInVscode') }}
            </Button>
            <Button
              variant="outline"
              size="iconMd"
              :title="t('sessions.export.copyPath')"
              :aria-label="t('sessions.export.copyPath')"
              @click="onCopyPath"
            >
              <Icon name="copy" class="size-3.5" />
            </Button>
          </div>
          <!-- mono: đường dẫn file vừa export -->
          <div class="font-mono text-sm wrap-anywhere" :title="saved.path">
            <span class="text-muted-foreground">{{ savedDir }}</span>
            <span class="font-semibold text-foreground">{{ savedName }}</span>
          </div>
        </div>
        <Separator />
      </template>

      <div class="min-h-0 flex-1 overflow-auto p-3.5">
        <template v-if="format === 'prompt'">
          <div
            v-if="promptError"
            class="flex h-full flex-col items-center justify-center gap-3 text-center text-destructive"
          >
            <span>{{ promptError }}</span>
            <Button variant="outline" size="sm" @click="onRegenerate">
              <Icon name="refresh" class="size-3.5" />
              {{ t('sessions.export.retry') }}
            </Button>
          </div>
          <div
            v-else-if="promptLoading && !promptText"
            class="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"
          >
            <Icon
              name="sparkles"
              class="size-5 animate-pulse text-primary motion-reduce:animate-none"
            />
            <span>{{ t('sessions.export.promptGenerating') }}</span>
          </div>
          <!-- Editable so the user can tweak the prompt before copy/save. Readonly
               while streaming (deltas append programmatically); editable once done.
               resize-none: thân modal quyết chiều cao (ô nhập của modal một mục đích).
               mono: văn bản prompt được export. -->
          <Textarea
            v-else
            v-model="promptText"
            class="block size-full min-h-0 resize-none rounded-none border-none bg-transparent p-0 font-mono text-sm leading-5 wrap-anywhere whitespace-pre-wrap text-foreground shadow-none focus-visible:ring-0"
            :readonly="promptLoading"
            :aria-label="t('sessions.export.prompt')"
            spellcheck="false"
          />
        </template>
        <!-- mono: bản xem trước markdown export -->
        <pre
          v-else
          class="m-0 font-mono text-sm leading-5 wrap-anywhere whitespace-pre-wrap text-foreground"
          >{{ content }}</pre
        >
      </div>
    </DialogContent>
  </Dialog>
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
