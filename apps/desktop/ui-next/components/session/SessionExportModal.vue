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
          </div>
          <span style="flex: 1" />
          <span v-if="status" class="expstatus" :class="{ err: statusErr }">{{ status }}</span>
          <button class="expbtn" @click="onCopy">
            <Icon name="copy" style="width: 13px; height: 13px" />
            {{ t('sessions.export.copy') }}
          </button>
          <button class="expbtn pri" :disabled="!canSave" :title="saveTitle" @click="onSave">
            <Icon name="save" style="width: 13px; height: 13px" />
            {{ t('sessions.export.save') }}
          </button>
        </div>

        <div class="expmodal-body">
          <pre class="exppreview">{{ content }}</pre>
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
import { useSessionExport, type ExportFormat } from '~/composables/useSessionExport'
import { useSessionsStore } from '~/stores/sessions'

const { t } = useI18n()
const { sessionId, close } = useSessionExportModal()
const store = useSessionsStore()
const { buildContent, copyToClipboard, saveToDisk, canSave } = useSessionExport()

const format = ref<ExportFormat>('md')
const status = ref('')
const statusErr = ref(false)

const session = computed(() => store.sessions.find((s) => s.id === sessionId.value) ?? null)

// Make sure the transcript is loaded (a session exported from the list context menu
// may not be the active one). Reset the status line each time the dialog (re)opens.
watch(sessionId, (id) => {
  status.value = ''
  statusErr.value = false
  format.value = 'md'
  if (id != null) void store.ensureLoaded(id)
})

const content = computed(() => (session.value ? buildContent(session.value, format.value) : ''))

const saveTitle = computed(() => (canSave ? '' : t('sessions.export.saveUnavailable')))

async function onCopy() {
  const ok = await copyToClipboard(content.value)
  setStatus(ok ? t('sessions.export.copied') : t('sessions.export.copyFailed'), !ok)
}

async function onSave() {
  if (!session.value) return
  const path = await saveToDisk(session.value, format.value, content.value)
  if (path) setStatus(t('sessions.export.saved', { path }), false)
  else setStatus(t('sessions.export.saveFailed'), true)
}

function setStatus(msg: string, err: boolean) {
  status.value = msg
  statusErr.value = err
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
</style>
