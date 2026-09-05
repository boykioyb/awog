<template>
  <div class="ssh-sn-surface">
    <div class="ssh-sn-head">
      <Icon name="commands" style="width: 13px; height: 13px" />
      <span class="ssh-sn-head-t">{{ t('ssh.nav.snippets') }}</span>
      <span class="ssh-sn-count">{{ snippetsStore.snippets.length }}</span>
      <div class="ssh-sn-tools">
        <button
          class="ssh-sn-tool"
          :title="t('ssh.snippet.new')"
          :aria-label="t('ssh.snippet.new')"
          @click="openNew"
        >
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <button
          class="ssh-sn-tool"
          :title="t('ssh.panel.close')"
          :aria-label="t('ssh.panel.close')"
          @click="emit('close')"
        >
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </div>
    </div>

    <div v-if="!connId" class="ssh-sn-note">{{ t('ssh.snippet.noTarget') }}</div>

    <div class="ssh-sn-scroll">
      <div v-if="!snippetsStore.snippets.length" class="ssh-sn-empty">
        <Icon name="commands" style="width: 22px; height: 22px; opacity: 0.5" />
        <span class="ssh-sn-empty-t">{{ t('ssh.snippet.emptyTitle') }}</span>
        <span class="ssh-sn-empty-b">{{ t('ssh.snippet.emptyBody') }}</span>
      </div>
      <div v-else class="ssh-sn-list">
        <div v-for="s in snippetsStore.snippets" :key="s.id" class="ssh-sn-row">
          <div class="ssh-sn-main" @dblclick="run(s)">
            <span class="ssh-sn-name">{{ s.name }}</span>
            <span class="ssh-sn-cmd mono">{{ s.command }}</span>
          </div>
          <div class="ssh-sn-acts">
            <button
              class="ssh-sn-act"
              :disabled="!connId"
              :title="connId ? t('ssh.snippet.run') : t('ssh.snippet.noTarget')"
              :aria-label="t('ssh.snippet.run')"
              @click="run(s)"
            >
              <Icon name="play" style="width: 13px; height: 13px" />
            </button>
            <button
              class="ssh-sn-act"
              :title="t('ssh.snippet.copy')"
              :aria-label="t('ssh.snippet.copy')"
              @click="copy(s)"
            >
              <Icon name="copy" style="width: 13px; height: 13px" />
            </button>
            <button
              class="ssh-sn-act"
              :title="t('ssh.snippet.edit')"
              :aria-label="t('ssh.snippet.edit')"
              @click="openEdit(s)"
            >
              <Icon name="edit" style="width: 13px; height: 13px" />
            </button>
            <button
              class="ssh-sn-act del"
              :title="t('ssh.snippet.delete')"
              :aria-label="t('ssh.snippet.delete')"
              @click="del(s)"
            >
              <Icon name="trash" style="width: 13px; height: 13px" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <SshSnippetEditor
      :open="editorOpen"
      :snippet="editing"
      @save="onSave"
      @cancel="editorOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// Snippets dock for a live terminal tab (right-docked, sibling of the SFTP + co-
// pilot docks). Unlike the Hosts-view SshSnippetsSection (which has a target
// picker), this is bound to the CURRENT tab's connection — Run writes the command
// (+ newline) straight into that shell. The library is the shared renderer-only
// sshSnippets store; nothing crosses IPC but the write.
import { ref } from 'vue'
import SshSnippetEditor from '~/components/ssh/SshSnippetEditor.vue'
import { useConfirm } from '~/composables/useConfirm'
import { pushActionToast } from '~/composables/useActionToasts'
import { useSshApi } from '~/composables/useSshApi'
import { useSshSnippetsStore, type SshSnippet } from '~/stores/sshSnippets'

const props = defineProps<{ connId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const snippetsStore = useSshSnippetsStore()
const api = useSshApi()
const { confirm } = useConfirm()

async function run(snippet: SshSnippet): Promise<void> {
  if (!props.connId) return
  try {
    // Append a newline so the command executes in the remote shell.
    await api.write(props.connId, `${snippet.command}\n`)
    pushActionToast(t('ssh.snippet.ran', { name: snippet.name }), 'success')
  } catch (err) {
    pushActionToast(
      t('ssh.snippet.runFailed', { error: err instanceof Error ? err.message : '' }),
      'error',
    )
  }
}

async function copy(snippet: SshSnippet): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.command)
    pushActionToast(t('ssh.snippet.copied'), 'success')
  } catch {
    pushActionToast(t('ssh.snippet.copyFailed'), 'error')
  }
}

const editorOpen = ref(false)
const editing = ref<SshSnippet | null>(null)

function openNew(): void {
  editing.value = null
  editorOpen.value = true
}
function openEdit(snippet: SshSnippet): void {
  editing.value = snippet
  editorOpen.value = true
}
function onSave(name: string, command: string): void {
  if (editing.value) snippetsStore.update(editing.value.id, name, command)
  else snippetsStore.add(name, command)
  editorOpen.value = false
}
async function del(snippet: SshSnippet): Promise<void> {
  const ok = await confirm({
    title: t('ssh.snippet.deleteTitle'),
    description: t('ssh.snippet.deleteHint', { name: snippet.name }),
    kind: 'danger',
  })
  if (ok) snippetsStore.remove(snippet.id)
}
</script>

<style scoped>
.ssh-sn-surface {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ssh-sn-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 6px 10px;
  font-size: var(--fs-xs);
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.ssh-sn-head-t {
  font-weight: 600;
}
.ssh-sn-count {
  font-size: 12px;
  line-height: 1;
  padding: 2px 7px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.ssh-sn-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.ssh-sn-tool {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sn-tool:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sn-note {
  flex: 0 0 auto;
  padding: 8px 12px;
  font-size: var(--fs-sm);
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.ssh-sn-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.ssh-sn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
  color: var(--textDim);
}
.ssh-sn-empty-t {
  font-size: var(--fs-md);
  font-weight: 550;
  color: var(--text);
}
.ssh-sn-empty-b {
  font-size: var(--fs-sm);
}
.ssh-sn-list {
  padding: 8px;
}
.ssh-sn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}
.ssh-sn-row + .ssh-sn-row {
  margin-top: 6px;
}
.ssh-sn-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
}
.ssh-sn-name {
  font-size: var(--fs-sm);
  font-weight: 550;
  color: var(--text);
}
.ssh-sn-cmd {
  font-size: 12px;
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssh-sn-acts {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}
.ssh-sn-act {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sn-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-sn-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ssh-sn-act.del:hover:not(:disabled) {
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
