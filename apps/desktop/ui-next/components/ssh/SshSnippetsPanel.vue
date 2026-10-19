<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div class="flex shrink-0 items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Icon name="commands" class="size-3.5" />
      <span class="font-semibold">{{ t('ssh.nav.snippets') }}</span>
      <Badge variant="secondary">{{ snippetsStore.snippets.length }}</Badge>
      <div class="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.snippet.new')"
          :aria-label="t('ssh.snippet.new')"
          @click="openNew"
        >
          <Icon name="plus" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.panel.close')"
          :aria-label="t('ssh.panel.close')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>
    <Separator />

    <template v-if="!connId">
      <div class="shrink-0 px-3 py-2 text-sm text-muted-foreground">
        {{ t('ssh.snippet.noTarget') }}
      </div>
      <Separator />
    </template>

    <div class="min-h-0 flex-auto overflow-y-auto">
      <div
        v-if="!snippetsStore.snippets.length"
        class="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground"
      >
        <Icon name="commands" class="size-5 opacity-50" />
        <span class="text-base font-medium text-foreground">{{ t('ssh.snippet.emptyTitle') }}</span>
        <span class="text-sm">{{ t('ssh.snippet.emptyBody') }}</span>
      </div>
      <div v-else class="flex flex-col gap-1.5 p-2">
        <Card
          v-for="s in snippetsStore.snippets"
          :key="s.id"
          class="flex-row items-center gap-2 rounded-md px-2.5 py-2 shadow-none"
        >
          <div class="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5" @dblclick="run(s)">
            <span class="text-sm font-medium text-foreground">{{ s.name }}</span>
            <span class="truncate font-mono text-sm text-muted-foreground">{{ s.command }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-px">
            <Button
              variant="ghost"
              size="iconSm"
              class="text-muted-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
              :disabled="!connId"
              :title="connId ? t('ssh.snippet.run') : t('ssh.snippet.noTarget')"
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
          </div>
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
// Snippets dock for a live terminal tab (right-docked, sibling of the SFTP + co-
// pilot docks). Unlike the Hosts-view SshSnippetsSection (which has a target
// picker), this is bound to the CURRENT tab's connection — Run writes the command
// (+ newline) straight into that shell. The library is the shared renderer-only
// sshSnippets store; nothing crosses IPC but the write.
import { ref } from 'vue'
import SshSnippetEditor from '~/components/ssh/SshSnippetEditor.vue'
import { useConfirm } from '~/composables/useConfirm'
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
