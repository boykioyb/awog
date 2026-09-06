<template>
  <div class="tsr">
    <div class="tsr-head">
      <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="tsr-head-t">{{ t('terminalSnippet.title') }}</span>
      <span class="tsr-count">{{ visible.length }}</span>
      <div class="tsr-tools">
        <button
          class="tsr-tool"
          :title="t('terminalSnippet.new')"
          :aria-label="t('terminalSnippet.new')"
          @click="openNew"
        >
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="tsr-tool"
          :title="t('terminalSnippet.close')"
          :aria-label="t('terminalSnippet.close')"
          @click="emit('close')"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>

    <div class="tsr-scroll">
      <div v-if="isCute && !visible.length" class="cempty">
        <AwogMascot :size="44" style="color: var(--accent)" />
        <span class="cempty-t">{{ t('terminalSnippet.emptyTitle') }}</span>
        <span class="cempty-b">{{ t('terminalSnippet.emptyBody') }}</span>
        <div class="cempty-cta">
          <button class="btn pri sm" @click="openNew">
            <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('terminalSnippet.new') }}
          </button>
        </div>
      </div>
      <div v-else-if="!visible.length" class="tsr-empty">
        <Icon name="commands" style="width: 22px; height: 22px; opacity: 0.5" />
        <span class="tsr-empty-t">{{ t('terminalSnippet.emptyTitle') }}</span>
        <span class="tsr-empty-b">{{ t('terminalSnippet.emptyBody') }}</span>
      </div>
      <div v-else class="tsr-list">
        <div v-for="s in visible" :key="s.id" class="tsr-row">
          <div class="tsr-main" @dblclick="run(s)">
            <span class="tsr-name">
              {{ s.name }}
              <span v-if="s.project === null" class="tsr-badge">
                {{ t('terminalSnippet.globalBadge') }}
              </span>
            </span>
            <span class="tsr-cmd mono">{{ s.command }}</span>
          </div>
          <div class="tsr-acts">
            <button
              class="tsr-act"
              :disabled="!canRun"
              :title="canRun ? t('terminalSnippet.run') : t('terminalSnippet.noTarget')"
              :aria-label="t('terminalSnippet.run')"
              @click="run(s)"
            >
              <Icon name="play" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button
              class="tsr-act"
              :title="t('terminalSnippet.copy')"
              :aria-label="t('terminalSnippet.copy')"
              @click="copy(s)"
            >
              <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button
              class="tsr-act"
              :title="t('terminalSnippet.edit')"
              :aria-label="t('terminalSnippet.edit')"
              @click="openEdit(s)"
            >
              <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button
              class="tsr-act del"
              :title="t('terminalSnippet.delete')"
              :aria-label="t('terminalSnippet.delete')"
              @click="del(s)"
            >
              <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
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
import { pushActionToast } from '~/composables/useActionToasts'
import { useTerminalSnippetsStore, type TerminalSnippet } from '~/stores/terminalSnippets'

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
const { isCute } = useThemeFamily()

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
  pushActionToast(t('terminalSnippet.ran', { name: snippet.name }), 'success')
}

async function copy(snippet: TerminalSnippet): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.command)
    pushActionToast(t('terminalSnippet.copied'), 'success')
  } catch {
    pushActionToast(t('terminalSnippet.copyFailed'), 'error')
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
function onSave(name: string, command: string, project: string | null): void {
  if (editing.value) store.update(editing.value.id, name, command, project)
  else store.add(name, command, project)
  editorOpen.value = false
}
async function del(snippet: TerminalSnippet): Promise<void> {
  const ok = await confirm({
    title: t('terminalSnippet.deleteTitle'),
    description: t('terminalSnippet.deleteHint', { name: snippet.name }),
    kind: 'danger',
  })
  if (ok) store.remove(snippet.id)
}
</script>

<style scoped>
.tsr {
  flex: 0 0 260px;
  width: 260px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: var(--bgPanel);
}
/* Hairline as an INSET SHADOW, not a border: a 1px border eats a pixel of the CONTENT
   box under `box-sizing: border-box`, leaving an odd height (30 - 1 = 29) that puts every
   vertically centred child on a half pixel. A shadow takes no layout space. Inset rather
   than outset so the next sibling's background cannot paint over the line. */
.tsr-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 8px 0 10px;
  color: var(--textDim);
  box-shadow: inset 0 -1px 0 var(--border);
}
.tsr-head-t {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text);
}
.tsr-count {
  font-size: 12px;
  line-height: 1;
  min-width: 18px;
  padding: 2px 6px;
  border-radius: var(--r-pill);
  text-align: center;
  color: var(--textDim);
  background: var(--bgHover);
  font-variant-numeric: tabular-nums;
}
.tsr-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.tsr-tool {
  width: 22px;
  height: 22px;
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
.tsr-tool:hover {
  background: var(--bgHover);
  color: var(--text);
}
.tsr-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.tsr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 18px;
  text-align: center;
  color: var(--textDim);
}
.tsr-empty-t {
  font-size: 1em;
  font-weight: 550;
  color: var(--text);
}
.tsr-empty-b {
  font-size: 1em;
}
.tsr-list {
  padding: 8px;
}
.tsr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}
.tsr-row + .tsr-row {
  margin-top: 6px;
}
.tsr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
}
.tsr-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 1em;
  font-weight: 550;
  color: var(--text);
}
.tsr-badge {
  font-size: 12px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  border: 1px solid var(--border);
  font-weight: 500;
}
.tsr-cmd {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tsr-acts {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}
.tsr-act {
  width: 24px;
  height: 24px;
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
.tsr-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.tsr-act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tsr-act.del:hover:not(:disabled) {
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
