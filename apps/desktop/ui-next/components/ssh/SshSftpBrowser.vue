<template>
  <div class="ssh-sf-surface">
    <div class="ssh-sf-head">
      <Icon name="folder" style="width: 13px; height: 13px" />
      <span class="ssh-sf-head-t">{{ t('ssh.section.sftp') }}</span>
      <div class="ssh-sf-tools">
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.mkdir')"
          :aria-label="t('ssh.sftp.mkdir')"
          @click="mkdir"
        >
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.upload')"
          :aria-label="t('ssh.sftp.upload')"
          @click="upload"
        >
          <Icon name="download" style="width: 13px; height: 13px; transform: rotate(180deg)" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.sftp.refresh')"
          :aria-label="t('ssh.sftp.refresh')"
          @click="load"
        >
          <Icon name="refresh" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ssh-sf-tool"
          :title="t('ssh.panel.close')"
          :aria-label="t('ssh.panel.close')"
          @click="emit('close')"
        >
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </div>
    </div>

    <!-- Path bar: clickable breadcrumb, or an editable input (click the pencil, or
         double-click the bar) to type a path directly + Enter to go. -->
    <div class="ssh-sf-path">
      <template v-if="!editingPath">
        <div class="ssh-sf-crumbs" @dblclick="startEditPath">
          <button class="ssh-sf-crumb" :disabled="cwd === '.'" @click="navigate('.')">~</button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <span class="ssh-sf-sep">/</span>
            <button class="ssh-sf-crumb" @click="navigate(seg.path)">{{ seg.name }}</button>
          </template>
        </div>
        <button
          class="ssh-sf-pathedit"
          :title="t('ssh.sftp.editPath')"
          :aria-label="t('ssh.sftp.editPath')"
          @click="startEditPath"
        >
          <Icon name="edit" style="width: 12px; height: 12px" />
        </button>
      </template>
      <input
        v-else
        ref="pathInput"
        v-model="pathDraft"
        class="ssh-sf-pathinput mono"
        spellcheck="false"
        :placeholder="t('ssh.sftp.pathPh')"
        @keydown.enter="commitPath"
        @keydown.esc="editingPath = false"
        @blur="editingPath = false"
      />
    </div>

    <div class="ssh-sf-list">
      <div v-if="loading" class="ssh-sf-empty">{{ t('ssh.sftp.loading') }}</div>
      <div v-else-if="error" class="ssh-sf-err mono">{{ error }}</div>
      <template v-else>
        <button v-if="cwd !== '.'" class="ssh-sf-row ssh-sf-up" @click="navigate(parentPath)">
          <Icon name="chev" class="ssh-sf-up-icn" style="width: 13px; height: 13px" />
          <span class="ssh-sf-name">..</span>
        </button>
        <div v-if="!sorted.length" class="ssh-sf-empty">{{ t('ssh.sftp.empty') }}</div>
        <div
          v-for="e in sorted"
          :key="e.name"
          class="ssh-sf-row"
          :class="{ dir: e.type === 'dir' }"
          @click="onRowClick(e)"
        >
          <Icon :name="iconFor(e)" class="ssh-sf-icn" style="width: 13px; height: 13px" />
          <span class="ssh-sf-name">{{ e.name }}</span>
          <span class="ssh-sf-size mono">{{ e.type === 'dir' ? '' : sizeLabel(e.size) }}</span>
          <span class="ssh-sf-acts" @click.stop>
            <button
              v-if="e.type !== 'dir'"
              class="ssh-sf-act"
              :title="t('ssh.sftp.download')"
              :aria-label="t('ssh.sftp.download')"
              @click="download(e)"
            >
              <Icon name="download" style="width: 12px; height: 12px" />
            </button>
            <button
              class="ssh-sf-act"
              :title="t('ssh.sftp.rename')"
              :aria-label="t('ssh.sftp.rename')"
              @click="rename(e)"
            >
              <Icon name="edit" style="width: 12px; height: 12px" />
            </button>
            <button
              class="ssh-sf-act ssh-sf-del"
              :title="t('ssh.sftp.delete')"
              :aria-label="t('ssh.sftp.delete')"
              @click="del(e)"
            >
              <Icon name="trash" style="width: 12px; height: 12px" />
            </button>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// SFTP browser (ADR 0063 P3) — a single-pane remote file browser over an open
// SSH connection (connId). Navigate dirs, mkdir, rename, delete, and up/download
// files. Local upload target / download source are sandboxed to the user's home
// dir sidecar-side. Paths are relative to the remote login dir (cwd '.' == ~).
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useSshApi, type SftpEntry } from '~/composables/useSshApi'
import { useSidecar } from '~/composables/useSidecar'
import { useTextPrompt } from '~/composables/useTextPrompt'
import { useConfirm } from '~/composables/useConfirm'
import { useToasts } from '~/composables/useToasts'

const props = defineProps<{ connId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const api = useSshApi()
const sc = useSidecar()
const { prompt } = useTextPrompt()
const { confirm } = useConfirm()
const { pushToast } = useToasts()

const cwd = ref('.')
const entries = ref<SftpEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Editable path bar: `~` for the login dir, `~/sub` for home-relative, or an
// absolute `/path`. The breadcrumb stays clickable; the pencil / double-click
// swaps in an input so a path can be typed directly.
const editingPath = ref(false)
const pathDraft = ref('')
const pathInput = useTemplateRef<HTMLInputElement>('pathInput')
const displayPath = computed(() => {
  if (cwd.value === '.') return '~'
  if (cwd.value.startsWith('/')) return cwd.value
  return `~/${cwd.value}`
})
const startEditPath = (): void => {
  pathDraft.value = displayPath.value
  editingPath.value = true
  void nextTick(() => {
    pathInput.value?.focus()
    pathInput.value?.select()
  })
}
const commitPath = (): void => {
  const s = pathDraft.value.trim()
  editingPath.value = false
  let next = '.'
  if (s && s !== '~') next = s.startsWith('~/') ? s.slice(2) || '.' : s
  navigate(next)
}

const sorted = computed(() =>
  [...entries.value]
    .filter((e) => e.name !== '.' && e.name !== '..')
    .sort((a, b) => {
      const ad = a.type === 'dir' ? 0 : 1
      const bd = b.type === 'dir' ? 0 : 1
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name)
    }),
)

// Breadcrumb segments with their cumulative path. Handles both home-relative
// (cwd '.'-rooted) and absolute (`/...`) paths — an absolute segment keeps its
// leading slash so clicking it navigates correctly.
const crumbs = computed(() => {
  if (cwd.value === '.') return [] as { name: string; path: string }[]
  const abs = cwd.value.startsWith('/')
  const parts = cwd.value.split('/').filter(Boolean)
  const out: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : abs ? `/${p}` : p
    out.push({ name: p, path: acc })
  }
  return out
})

const parentPath = computed(() => {
  if (cwd.value === '.') return '.'
  const idx = cwd.value.lastIndexOf('/')
  return idx < 0 ? '.' : cwd.value.slice(0, idx)
})

const join = (name: string): string => (cwd.value === '.' ? name : `${cwd.value}/${name}`)
const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p

const iconFor = (e: SftpEntry): string =>
  e.type === 'dir' ? 'folder' : e.type === 'symlink' ? 'link' : 'rules'

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

async function load(): Promise<void> {
  if (!sc.available) {
    error.value = t('ssh.sftp.offline')
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await api.sftpList(props.connId, cwd.value)
    entries.value = res.entries
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function navigate(path: string): void {
  cwd.value = path || '.'
  void load()
}

function onRowClick(e: SftpEntry): void {
  if (e.type === 'dir' || e.type === 'symlink') navigate(join(e.name))
}

async function mkdir(): Promise<void> {
  const name = await prompt({ title: t('ssh.sftp.mkdirTitle'), placeholder: 'new-folder' })
  if (!name?.trim()) return
  try {
    await api.sftpMkdir(props.connId, join(name.trim()))
    await load()
  } catch (err) {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

async function rename(e: SftpEntry): Promise<void> {
  const name = await prompt({ title: t('ssh.sftp.renameTitle'), value: e.name })
  if (!name?.trim() || name.trim() === e.name) return
  try {
    await api.sftpRename(props.connId, join(e.name), join(name.trim()))
    await load()
  } catch (err) {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

async function del(e: SftpEntry): Promise<void> {
  const ok = await confirm({
    title: t('ssh.sftp.deleteTitle'),
    description: t('ssh.sftp.deleteHint', { name: e.name }),
    kind: 'danger',
  })
  if (!ok) return
  try {
    await api.sftpDelete(props.connId, join(e.name), e.type === 'dir')
    await load()
  } catch (err) {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

async function download(e: SftpEntry): Promise<void> {
  const local = await prompt({
    title: t('ssh.sftp.downloadTitle', { name: e.name }),
    value: `~/${e.name}`,
    placeholder: '~/Downloads/file',
  })
  if (!local?.trim()) return
  pushToast(t('ssh.sftp.transferring', { name: e.name }), 'info')
  try {
    const res = await api.sftpDownload(props.connId, join(e.name), local.trim())
    pushToast(t('ssh.sftp.downloaded', { name: e.name, bytes: res.bytes }), 'success')
  } catch (err) {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

async function upload(): Promise<void> {
  const local = await prompt({
    title: t('ssh.sftp.uploadTitle'),
    placeholder: '~/path/to/file',
  })
  if (!local?.trim()) return
  const remote = join(basename(local.trim()))
  pushToast(t('ssh.sftp.transferring', { name: basename(local.trim()) }), 'info')
  try {
    const res = await api.sftpUpload(props.connId, local.trim(), remote)
    pushToast(t('ssh.sftp.uploaded', { name: basename(remote), bytes: res.bytes }), 'success')
    await load()
  } catch (err) {
    pushToast(t('ssh.sftp.opFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

// Reset to the login dir + reload when pointed at a different connection.
watch(
  () => props.connId,
  () => {
    cwd.value = '.'
    void load()
  },
)
onMounted(() => void load())
</script>

<style scoped>
/* Live surface shown inside the detail's panel area — mirrors SshDetail's terminal
   surface: a hairline-bordered card with a sentence-case head. A scoped parent
   reaches only a child's root, so the head/rows are styled locally. */
/* Fills its host area flush (the SFTP split's divider + edge delimit it) — no
   extra card border/radius, tight padding. */
.ssh-sf-surface {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ssh-sf-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 6px 10px;
  font-size: 0.8462rem;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.ssh-sf-head-t {
  font-weight: 600;
  min-width: 0;
}
.ssh-sf-empty {
  padding: 12px 14px;
  font-size: 0.9231rem;
  color: var(--textDim);
}
.ssh-sf-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.ssh-sf-tool {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sf-tool:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sf-tool:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-sf-path {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.ssh-sf-crumbs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
  font-size: 0.8846rem;
  cursor: text;
}
.ssh-sf-pathedit {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  margin-right: 4px;
}
.ssh-sf-pathedit:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sf-pathinput {
  flex: 1;
  min-width: 0;
  margin: 4px 8px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--bgInput);
  color: var(--text);
  font-size: 0.8846rem;
  outline: none;
}
.ssh-sf-crumb {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 1px 3px;
  border-radius: 5px;
  font-family: var(--code);
}
.ssh-sf-crumb:disabled {
  color: var(--textDim);
  cursor: default;
}
.ssh-sf-crumb:not(:disabled):hover {
  background: var(--bgHover);
}
.ssh-sf-sep {
  color: var(--textDim);
}
.ssh-sf-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.ssh-sf-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 0.9231rem;
}
.ssh-sf-row + .ssh-sf-row {
  border-top: 1px solid var(--border);
}
.ssh-sf-row.dir {
  cursor: pointer;
}
.ssh-sf-row.dir:hover,
.ssh-sf-up:hover {
  background: var(--bgHover);
}
.ssh-sf-up {
  cursor: pointer;
}
.ssh-sf-up-icn {
  transform: rotate(90deg);
  color: var(--textDim);
}
.ssh-sf-icn {
  flex: 0 0 auto;
  color: var(--textDim);
}
.ssh-sf-row.dir .ssh-sf-icn {
  color: var(--accent);
}
.ssh-sf-name {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.ssh-sf-size {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--textDim);
}
.ssh-sf-acts {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.12s;
}
.ssh-sf-row:hover .ssh-sf-acts {
  opacity: 1;
}
.ssh-sf-act {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sf-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sf-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-sf-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
.ssh-sf-err {
  padding: 12px 14px;
  font-size: 0.8846rem;
  color: var(--danger);
  word-break: break-word;
}
</style>
