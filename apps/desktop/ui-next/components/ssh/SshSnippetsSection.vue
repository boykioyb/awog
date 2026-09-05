<template>
  <div class="sshx-sn">
    <div class="sshx-sn-top">
      <span class="sshx-sn-title">{{ t('ssh.nav.snippets') }}</span>
      <span class="sshx-sn-count">{{ snippetsStore.snippets.length }}</span>
      <button class="btn pri sm sshx-sn-new" :title="t('ssh.snippet.new')" @click="openNew">
        <Icon name="plus" style="width: 13px; height: 13px" />
        {{ t('ssh.snippet.new') }}
      </button>
    </div>

    <!-- Run target: the live terminal connection a snippet is written into. -->
    <div class="sshx-sn-bar">
      <span class="sshx-sn-runon">{{ t('ssh.snippet.target') }}</span>
      <AppSelect v-if="hasTarget" v-model="selectedConnId" :options="targetOptions" width="220px" />
      <span v-else class="sshx-sn-notarget">{{ t('ssh.snippet.noTarget') }}</span>
    </div>

    <div class="sshx-sn-scroll">
      <SshEmptyState
        v-if="!snippetsStore.snippets.length"
        icon="commands"
        :title="t('ssh.snippet.emptyTitle')"
        :body="t('ssh.snippet.emptyBody')"
      />
      <div v-else class="sshx-sn-list">
        <div v-for="s in snippetsStore.snippets" :key="s.id" class="sshx-sn-row">
          <span class="sshx-sn-ic"><Icon name="commands" style="width: 15px; height: 15px" /></span>
          <div class="sshx-sn-main">
            <span class="sshx-sn-name">{{ s.name }}</span>
            <span class="sshx-sn-cmd mono">{{ s.command }}</span>
          </div>
          <button
            class="sshx-sn-act"
            :disabled="!hasTarget"
            :title="hasTarget ? t('ssh.snippet.run') : t('ssh.snippet.noTarget')"
            :aria-label="t('ssh.snippet.run')"
            @click="run(s)"
          >
            <Icon name="play" style="width: 13px; height: 13px" />
          </button>
          <button
            class="sshx-sn-act"
            :title="t('ssh.snippet.copy')"
            :aria-label="t('ssh.snippet.copy')"
            @click="copy(s)"
          >
            <Icon name="copy" style="width: 13px; height: 13px" />
          </button>
          <button
            class="sshx-sn-act"
            :title="t('ssh.snippet.edit')"
            :aria-label="t('ssh.snippet.edit')"
            @click="openEdit(s)"
          >
            <Icon name="edit" style="width: 13px; height: 13px" />
          </button>
          <button
            class="sshx-sn-act sshx-sn-del"
            :title="t('ssh.snippet.delete')"
            :aria-label="t('ssh.snippet.delete')"
            @click="del(s)"
          >
            <Icon name="trash" style="width: 13px; height: 13px" />
          </button>
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
// Snippets section of the SSH workspace — a reusable-command library. Lists each
// snippet (name + mono command preview) with Run / Copy / Edit / Delete. Run
// writes the command (+ a newline to execute it) into a LIVE terminal connection
// chosen by the target picker; the picker lists every open terminal tab that has
// a live connId, defaulting to the most recently opened. With no live connection
// Run is disabled + a hint prompts Connect. The library itself lives in the
// renderer-only sshSnippets store (localStorage) — no secret ever crosses IPC.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import SshSnippetEditor from '~/components/ssh/SshSnippetEditor.vue'
import { useConfirm } from '~/composables/useConfirm'
import { pushActionToast } from '~/composables/useActionToasts'
import { useSshApi } from '~/composables/useSshApi'
import { useSshStore } from '~/stores/ssh'
import { useSshSnippetsStore, type SshSnippet } from '~/stores/sshSnippets'

const { t } = useI18n()
const store = useSshStore()
const snippetsStore = useSshSnippetsStore()
const api = useSshApi()
const { confirm } = useConfirm()

// Every open terminal tab that has a live connection, in open order (so the last
// entry is the most recently opened). One tab per host, so connIds are unique.
const targets = computed(() =>
  store.terminalTabs
    .map((tab) => ({ hostId: tab.hostId, connId: store.connIdForHost(tab.hostId) }))
    .filter((x): x is { hostId: string; connId: string } => !!x.connId)
    .map(({ hostId, connId }) => {
      const host = store.hostById(hostId)
      return { connId, label: host?.name || host?.host || 'ssh' }
    }),
)
const targetOptions = computed<AppSelectOption[]>(() =>
  targets.value.map((tt) => ({ value: tt.connId, label: tt.label })),
)
const hasTarget = computed(() => targets.value.length > 0)

// Keep the selected connId valid as connections open/close: default to the most
// recently opened (last), and re-pick when the current selection disconnects.
const selectedConnId = ref('')
watch(
  targets,
  (list) => {
    if (!list.some((tt) => tt.connId === selectedConnId.value))
      selectedConnId.value = list.at(-1)?.connId ?? ''
  },
  { immediate: true },
)

async function run(snippet: SshSnippet): Promise<void> {
  if (!selectedConnId.value) return
  try {
    // Append a newline so the command executes in the remote shell.
    await api.write(selectedConnId.value, `${snippet.command}\n`)
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

// --- editor + delete -------------------------------------------------------
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
.sshx-sn {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sshx-sn-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-sn-title {
  font-size: var(--fs-lg);
  font-weight: 650;
  color: var(--text);
}
.sshx-sn-count {
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.sshx-sn-new {
  margin-left: auto;
}
.sshx-sn-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-sn-runon {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--textDim);
  flex: 0 0 auto;
}
.sshx-sn-notarget {
  font-size: var(--fs-sm);
  color: var(--textDim);
}
.sshx-sn-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sshx-sn-list {
  padding: 8px 12px;
}
.sshx-sn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
}
.sshx-sn-row + .sshx-sn-row {
  margin-top: 8px;
}
.sshx-sn-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  color: var(--accent);
  background: var(--accentDim);
  flex: 0 0 auto;
}
.sshx-sn-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sshx-sn-name {
  font-size: var(--fs-md);
  font-weight: 550;
  color: var(--text);
}
.sshx-sn-cmd {
  font-size: 12px;
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sshx-sn-act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshx-sn-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.sshx-sn-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sshx-sn-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sshx-sn-del:hover:not(:disabled) {
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
