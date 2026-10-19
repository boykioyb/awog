<template>
  <div class="flex h-full w-65 shrink-0 flex-col overflow-hidden border-l bg-sidebar">
    <div class="flex h-7.5 shrink-0 items-center gap-2 pr-2 pl-2.5 text-dim">
      <Icon name="commands" class="size-3.5" />
      <span class="text-sm font-semibold text-foreground">{{ t('terminalSnippet.title') }}</span>
      <Badge variant="secondary" class="min-w-4.5 justify-center px-1.5 font-normal tabular-nums">
        {{ visible.length }}
      </Badge>
      <div class="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="iconSm"
          class="size-5.5 text-dim"
          :title="t('terminalSnippet.new')"
          :aria-label="t('terminalSnippet.new')"
          @click="openNew"
        >
          <Icon name="plus" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-5.5 text-dim"
          :title="t('terminalSnippet.close')"
          :aria-label="t('terminalSnippet.close')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>
    <Separator />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="!visible.length"
        class="flex flex-col items-center gap-2 px-4 py-8 text-center text-dim"
      >
        <Icon name="commands" class="size-6 opacity-50" />
        <span class="font-medium text-foreground">{{ t('terminalSnippet.emptyTitle') }}</span>
        <span>{{ t('terminalSnippet.emptyBody') }}</span>
        <Button size="sm" class="mt-1" @click="openNew">
          <Icon name="plus" />
          {{ t('terminalSnippet.new') }}
        </Button>
      </div>
      <div v-else class="flex flex-col gap-1.5 p-2">
        <div
          v-for="s in visible"
          :key="s.id"
          class="flex items-center gap-1.5 rounded-sm border bg-card px-2 py-2"
        >
          <div class="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5" @dblclick="run(s)">
            <span class="flex items-center gap-1.5 font-medium text-foreground">
              <span class="min-w-0 truncate">{{ s.name }}</span>
              <Badge v-if="s.project === null" variant="outline" class="shrink-0 text-dim">
                {{ t('terminalSnippet.globalBadge') }}
              </Badge>
            </span>
            <!-- mono-ok: lệnh shell, người dùng copy-paste vào terminal -->
            <span class="truncate font-mono text-sm text-dim">{{ s.command }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-px">
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6 text-dim"
              :disabled="!canRun"
              :title="canRun ? t('terminalSnippet.run') : t('terminalSnippet.noTarget')"
              :aria-label="t('terminalSnippet.run')"
              @click="run(s)"
            >
              <Icon name="play" />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6 text-dim"
              :title="t('terminalSnippet.copy')"
              :aria-label="t('terminalSnippet.copy')"
              @click="copy(s)"
            >
              <Icon name="copy" />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6 text-dim"
              :title="t('terminalSnippet.edit')"
              :aria-label="t('terminalSnippet.edit')"
              @click="openEdit(s)"
            >
              <Icon name="edit" />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6 text-dim hover:bg-destructive/10 hover:text-destructive"
              :title="t('terminalSnippet.delete')"
              :aria-label="t('terminalSnippet.delete')"
              @click="del(s)"
            >
              <Icon name="trash" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <TerminalSnippetEditor
      :open="editorOpen"
      :snippet="editing"
      :project="project"
      :project-label="projectLabel"
      @save="onSave"
      @cancel="editorOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// Snippets rail for the GLOBAL terminal dock (right-docked, sibling of the terminal
// body). Lists the snippets visible in the active project — that project's own +
// the shared Global tier — sorted project-first. Run emits the command up to the
// host, which writes it (+ newline) into the active tab via the tab's own transport
// (so it works for local AND SSH tabs). The library is the renderer-only
// terminalSnippets store; nothing crosses IPC.
import { computed, ref } from 'vue'
import TerminalSnippetEditor from '~/components/shell/TerminalSnippetEditor.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useTerminalSnippetsStore, type TerminalSnippet } from '~/stores/terminalSnippets'
import { sidecarErrorText } from '~/composables/useSidecar'

const props = defineProps<{
  // Active project key (null = no project → only Global snippets show).
  project: string | null
  projectLabel?: string
  // Whether there's a live terminal tab to run into (gates the Run action).
  canRun: boolean
}>()
const emit = defineEmits<{ run: [command: string]; close: [] }>()

const { t } = useI18n()
const store = useTerminalSnippetsStore()
const { confirm } = useConfirm()

// This project's snippets + the shared Global tier, project-first then by name.
const visible = computed(() =>
  store.snippets
    .filter((s) => s.project === null || s.project === props.project)
    .slice()
    .sort((a, b) => {
      const ga = a.project === null ? 1 : 0
      const gb = b.project === null ? 1 : 0
      if (ga !== gb) return ga - gb
      return a.name.localeCompare(b.name)
    }),
)

function run(snippet: TerminalSnippet): void {
  if (!props.canRun) return
  emit('run', snippet.command)
  useToast().add({ title: t('terminalSnippet.ran', { name: snippet.name }), color: 'success' })
}

async function copy(snippet: TerminalSnippet): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.command)
    useToast().add({ title: t('terminalSnippet.copied'), color: 'success' })
  } catch {
    useToast().add({ title: t('terminalSnippet.copyFailed'), color: 'error' })
  }
}

const editorOpen = ref(false)
const editing = ref<TerminalSnippet | null>(null)

function openNew(): void {
  editing.value = null
  editorOpen.value = true
}
function openEdit(snippet: TerminalSnippet): void {
  editing.value = snippet
  editorOpen.value = true
}
// Thư viện nằm ở sidecar (dùng chung với tool của agent) — lỗi ghi phải hiện ra,
// không được nuốt thành một Promise không ai bắt.
function reportSaveError(err: unknown): void {
  useToast().add({ title: sidecarErrorText(err), color: 'error' })
}
async function onSave(name: string, command: string, project: string | null): Promise<void> {
  editorOpen.value = false
  try {
    if (editing.value) await store.update(editing.value.id, name, command, project)
    else await store.add(name, command, project)
  } catch (err) {
    reportSaveError(err)
  }
}
async function del(snippet: TerminalSnippet): Promise<void> {
  const ok = await confirm({
    title: t('terminalSnippet.deleteTitle'),
    description: t('terminalSnippet.deleteHint', { name: snippet.name }),
    kind: 'danger',
  })
  if (!ok) return
  try {
    await store.remove(snippet.id)
  } catch (err) {
    reportSaveError(err)
  }
}
</script>
