<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2.5 px-4 py-3.5">
      <span class="text-lg font-semibold text-foreground">{{ t('ssh.nav.snippets') }}</span>
      <Badge variant="secondary">{{ snippetsStore.snippets.length }}</Badge>
      <Button
        :title="t('ssh.snippet.new')"
        class="ml-auto"
        variant="default"
        size="sm"
        @click="openNew"
      >
        <Icon name="plus" />
        {{ t('ssh.snippet.new') }}
      </Button>
    </div>
    <Separator />

    <!-- Run target: the live terminal connection a snippet is written into. -->
    <div class="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
      <span class="text-xs font-semibold text-muted-foreground">{{ t('ssh.snippet.target') }}</span>
      <AppSelect v-if="hasTarget" v-model="selectedConnId" :options="targetOptions" width="220px" />
      <span v-else class="text-sm text-muted-foreground">{{ t('ssh.snippet.noTarget') }}</span>
    </div>
    <Separator />

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SshEmptyState
        v-if="!snippetsStore.snippets.length"
        icon="commands"
        :title="t('ssh.snippet.emptyTitle')"
        :body="t('ssh.snippet.emptyBody')"
      />
      <div v-else class="flex flex-col gap-2 px-3 py-2">
        <Card
          v-for="s in snippetsStore.snippets"
          :key="s.id"
          class="flex-row items-center gap-3 rounded-lg p-3 shadow-none"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-md bg-selected text-primary">
            <Icon name="commands" class="size-4" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-base font-medium text-foreground">{{ s.name }}</span>
            <span class="truncate font-mono text-sm text-muted-foreground">{{ s.command }}</span>
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
            :disabled="!hasTarget"
            :title="hasTarget ? t('ssh.snippet.run') : t('ssh.snippet.noTarget')"
            :aria-label="t('ssh.snippet.run')"
            @click="run(s)"
          >
            <Icon name="play" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground"
            :title="t('ssh.snippet.copy')"
            :aria-label="t('ssh.snippet.copy')"
            @click="copy(s)"
          >
            <Icon name="copy" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground"
            :title="t('ssh.snippet.edit')"
            :aria-label="t('ssh.snippet.edit')"
            @click="openEdit(s)"
          >
            <Icon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :title="t('ssh.snippet.delete')"
            :aria-label="t('ssh.snippet.delete')"
            @click="del(s)"
          >
            <Icon name="trash" />
          </Button>
        </Card>
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
import { useSshApi } from '~/composables/useSshApi'
import { useSshStore } from '~/stores/ssh'
import { useSshSnippetsStore, type SshSnippet } from '~/stores/sshSnippets'
import Button from '~/components/ui/button/Button.vue'

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
    useToast().add({ title: t('ssh.snippet.ran', { name: snippet.name }), color: 'success' })
  } catch (err) {
    useToast().add({
      title: t('ssh.snippet.runFailed', { error: err instanceof Error ? err.message : '' }),
      color: 'error',
    })
  }
}

async function copy(snippet: SshSnippet): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.command)
    useToast().add({ title: t('ssh.snippet.copied'), color: 'success' })
  } catch {
    useToast().add({ title: t('ssh.snippet.copyFailed'), color: 'error' })
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
