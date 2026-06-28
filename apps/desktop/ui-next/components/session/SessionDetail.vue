<template>
  <div
    class="detail"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="dh">
      <div class="dt">
        <span
          class="dproj"
          :title="t('sessions.detail.changeProject')"
          style="cursor: pointer; position: relative"
          @click.stop="openMenu('proj')"
        >
          {{ projName }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="menu === 'proj'"
            class="smenu"
            style="position: absolute; top: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <div v-for="p in projects" :key="p.id" class="mi" @click="selectProj(p.id)">
              {{ p.name }}
              <Icon
                v-if="p.id === session.project"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </span>
        <span class="dttitle" :title="session.title">{{ session.title }}</span>
      </div>

      <span
        class="ctxmini chipbtn"
        :title="t('sessions.detail.contextUsage')"
        style="cursor: pointer; position: relative"
        @click.stop="openMenu('usage')"
      >
        <span class="ctxbar">
          <i
            v-for="s in barSegments"
            :key="s.key"
            :style="{ width: `${s.pct}%`, background: s.color }"
          />
        </span>
        <span class="ctxn">{{ tokLabel }}/{{ limitLabel }}</span>

        <div
          v-if="menu === 'usage'"
          class="pop"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div class="pr2">
            <div class="pl plnowrap">
              <span>{{ t('sessions.detail.contextWindow') }}</span>
              <span class="ctxn">{{ tokLabel }} / {{ limitLabel }} · {{ Math.round(pct) }}%</span>
            </div>
            <div class="ctxmodel">{{ session.model }}</div>
            <div v-if="sessionCost != null" class="ctxcost">
              <span>{{ t('sessions.detail.cat.cost') }}</span>
              <span class="ctxn">{{ fmtUsd(sessionCost) }}</span>
            </div>
            <span class="ctxbar" style="width: 100%; height: 8px">
              <i
                v-for="s in barSegments"
                :key="s.key"
                :style="{ width: `${s.pct}%`, background: s.color }"
              />
            </span>
            <div class="cattbl">
              <div class="cathead">
                <span class="catlbl">{{ t('sessions.detail.cat.category') }}</span>
                <span class="catnum">{{ t('sessions.detail.cat.tokens') }}</span>
                <span class="catpct">{{ t('sessions.detail.cat.usage') }}</span>
              </div>
              <div v-for="row in catRows" :key="row.key" class="catrow">
                <span class="catsq" :style="{ background: row.color }" />
                <span class="catlbl">{{ row.label }}</span>
                <span class="catnum">{{ kfmt(row.tokens) }}</span>
                <span class="catpct">{{ row.pct < 0.05 ? '0%' : `${row.pct.toFixed(1)}%` }}</span>
              </div>
            </div>

            <!-- Expandable detail: bulk-loaded memory files + custom agents. -->
            <div v-if="memoryFilesList.length" class="ctxsec">
              <button class="ctxsechead" @click.stop="memoryFilesOpen = !memoryFilesOpen">
                <Icon
                  name="chev"
                  class="ctxchev"
                  :class="{ open: memoryFilesOpen }"
                  style="width: 11px; height: 11px"
                />
                {{ t('sessions.detail.cat.memoryFilesSection') }}
                <span class="ctxcount">{{ memoryFilesList.length }}</span>
              </button>
              <div v-if="memoryFilesOpen" class="ctxitems">
                <div v-for="it in memoryFilesList" :key="it.label" class="ctxitem">
                  <span class="ctxipath">{{ it.label }}</span>
                  <span class="ctxinum">{{ kfmt(it.tokens) }}</span>
                </div>
              </div>
            </div>
            <div v-if="agentsList.length" class="ctxsec">
              <button class="ctxsechead" @click.stop="agentsOpen = !agentsOpen">
                <Icon
                  name="chev"
                  class="ctxchev"
                  :class="{ open: agentsOpen }"
                  style="width: 11px; height: 11px"
                />
                {{ t('sessions.detail.cat.agentsSection') }}
                <span class="ctxcount">{{ agentsList.length }}</span>
              </button>
              <div v-if="agentsOpen" class="ctxitems">
                <div v-for="it in agentsList" :key="it.label" class="ctxitem">
                  <span class="ctxipath">{{ it.label }}</span>
                  <span class="ctxinum">{{ kfmt(it.tokens) }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="pr2">
            <div class="pl">
              <span>Plan usage · {{ provider }}</span>
              <button
                class="rlreload"
                :title="t('sessions.detail.refreshUsage')"
                :disabled="usageLoading"
                @click.stop="refreshUsage(true)"
              >
                <Icon
                  name="refresh"
                  :class="{ spin: usageLoading }"
                  style="width: 12px; height: 12px"
                />
              </button>
            </div>
            <div v-for="rl in rateLimits" :key="rl.label" class="rlrow">
              <span class="rln">{{ rl.label }}</span>
              <div class="rlbar2">
                <i
                  :style="{ width: `${Math.round(rl.used * 100)}%`, background: rlColor(rl.used) }"
                />
              </div>
              <span class="rlp">{{ Math.round(rl.used * 100) }}% · {{ rl.reset }}</span>
            </div>
          </div>
        </div>
      </span>

      <span
        class="chip chipbtn"
        :title="t('sessions.detail.config')"
        style="cursor: pointer; position: relative"
        @click.stop="openMenu('config')"
      >
        <Icon name="settings" style="width: 13px; height: 13px" />
        {{ session.model }}

        <SessionConfigPopover
          v-if="menu === 'config'"
          :session="session"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        />
      </span>
      <span style="position: relative">
        <button
          class="iconbtn"
          :title="t('sessions.detail.workspacePanel')"
          style="width: 28px; height: 28px"
          :style="
            wpOpen || menu === 'workspace'
              ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
              : {}
          "
          @click.stop="openMenu('workspace')"
        >
          <Icon name="workflows" style="width: 14px; height: 14px" />
        </button>
        <!-- View picker: clicking the workspace button opens this dropdown; picking
             a view opens it (and the panel). Open views show a check + toggle off. -->
        <div
          v-if="menu === 'workspace'"
          class="smenu"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div v-for="v in ALL_VIEWS" :key="v" class="mi" @click="toggleView(v)">
            <Icon :name="wpIcon(v)" style="width: 13px; height: 13px" />
            {{ v }}
            <Icon
              v-if="openViews.includes(v)"
              name="check"
              class="ck"
              style="width: 13px; height: 13px"
            />
          </div>
        </div>
      </span>
      <button
        class="iconbtn"
        :title="t('sessions.workspace.openGit')"
        style="width: 28px; height: 28px; position: relative"
        @click="gitModal.open(session.project)"
      >
        <Icon name="git" style="width: 14px; height: 14px" />
        <span v-if="dirtyCount" class="fbadge">{{ dirtyCount }}</span>
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.export.title')"
        style="width: 28px; height: 28px"
        @click="exportModal.open(session.id)"
      >
        <Icon name="save" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.detail.delete')"
        style="width: 28px; height: 28px"
        @click="askRemove"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <!-- Discuss banner (ADR 0055): this session was opened to discuss a task. -->
    <button v-if="session.aboutTaskId" class="aboutbar" @click="openTask(session.aboutTaskId)">
      <Icon name="workflows" class="aboutbar-icn" />
      <span class="aboutbar-lbl">{{ t('sessions.detail.aboutTask') }}</span>
      <span class="aboutbar-title">{{ aboutTaskTitle }}</span>
      <Icon name="chev" class="aboutbar-chev" />
    </button>

    <!-- chat + right-docked panel share a row (.wptop); the bottom-docked panel
         stacks full-width beneath them. Right and bottom are independent panel
         instances so e.g. Terminal (bottom) and Files (right) coexist. -->
    <div class="chatwrap">
      <div class="wptop">
        <template v-if="wpOpen && leftTabs.length">
          <SessionWorkspacePanel
            :session="session"
            dock="left"
            :tabs="leftTabs"
            :active="activeLeft"
            :size="wpLeftWidth"
            :addable-views="addableViews"
            @close="closeSide('left')"
            @set-active="activeLeft = $event"
            @close-tab="closeTab"
            @add-view="(v) => addView(v, 'left')"
            @move-dock="moveDock"
          />
          <div
            class="rszwp"
            :class="{ drag: wpDragging }"
            @pointerdown="(e) => onWpResize(e, 'left')"
          />
        </template>
        <div class="chat" @mouseup="onSelectQuote" @mousedown="quoteSel = null">
          <SessionTodoPanel
            v-if="session.todos && session.todos.length"
            :todos="session.todos"
            @toggle="(i) => store.toggleTodo(session.id, i)"
          />
          <SessionTranscript
            :messages="session.msgs"
            :fallback-when="session.when"
            :loading="!!session.loading"
          />
          <SessionComposer
            :attachments="pendingAtt"
            @send="onSend"
            @pick="openPicker"
            @remove-att="removeAtt"
            @add-att="onAddAtt"
            @preview="previewAtt"
            @open-more="moreOpen = true"
            @run-as-task="onRunAsTask"
          />
        </div>
        <template v-if="wpOpen && rightTabs.length">
          <div
            class="rszwp"
            :class="{ drag: wpDragging }"
            @pointerdown="(e) => onWpResize(e, 'right')"
          />
          <SessionWorkspacePanel
            :session="session"
            dock="right"
            :tabs="rightTabs"
            :active="activeRight"
            :size="wpWidth"
            :addable-views="addableViews"
            @close="closeSide('right')"
            @set-active="activeRight = $event"
            @close-tab="closeTab"
            @add-view="(v) => addView(v, 'right')"
            @move-dock="moveDock"
          />
        </template>
      </div>
      <template v-if="wpOpen && bottomTabs.length">
        <div
          class="rszwp vert"
          :class="{ drag: wpDragging }"
          @pointerdown="(e) => onWpResize(e, 'bottom')"
        />
        <SessionWorkspacePanel
          :session="session"
          dock="bottom"
          :tabs="bottomTabs"
          :active="activeBottom"
          :size="wpHeight"
          :addable-views="addableViews"
          @close="closeSide('bottom')"
          @set-active="activeBottom = $event"
          @close-tab="closeTab"
          @add-view="(v) => addView(v, 'bottom')"
          @move-dock="moveDock"
        />
      </template>
    </div>

    <!-- Hidden picker behind the composer's clip button -->
    <input ref="fileInput" type="file" multiple style="display: none" @change="onPick" />

    <!-- Drop anywhere on the detail to attach (pointer-events:none so drop/leave fire on .detail) -->
    <div v-if="dragActive" class="dropzone">
      <div class="dropzone-inner">
        <Icon name="clip" style="width: 22px; height: 22px" />
        {{ t('sessions.composer.dropHint') }}
      </div>
    </div>

    <!-- Select (highlight) text in a message → floating Quote button by the selection -->
    <button
      v-if="quoteSel"
      class="selquote"
      :style="{ left: `${quoteSel.x}px`, top: `${quoteSel.y}px` }"
      @mousedown.prevent
      @click="openNote"
    >
      <Icon name="quote" style="width: 13px; height: 13px" />
      {{ t('sessions.quote.action') }}
    </button>

    <!-- note popover for a selection quote -->
    <template v-if="notePop">
      <div class="notebackdrop" @mousedown="notePop = null" />
      <div class="notepop" :style="{ left: `${notePop.x}px`, top: `${notePop.y}px` }">
        <div class="npq">
          <Icon name="quote" style="width: 12px; height: 12px" />
          <span class="npex">{{ notePop.text }}</span>
        </div>
        <input
          v-model="noteText"
          class="npinput"
          autofocus
          :placeholder="t('sessions.quote.notePlaceholder')"
          @keydown.enter="saveQuote"
          @keydown.esc="notePop = null"
        />
        <div class="nprow">
          <button class="npbtn" @click="notePop = null">{{ t('common.close') }}</button>
          <button class="npbtn pri" @click="saveQuote">{{ t('sessions.quote.save') }}</button>
        </div>
      </div>
    </template>

    <div v-if="menu" style="position: fixed; inset: 0; z-index: 40" @click="menu = null" />

    <SessionAttachmentsModal
      :open="moreOpen"
      :attachments="pendingAtt"
      @close="moreOpen = false"
      @remove="removeAtt"
      @preview="previewAtt"
    />
    <PreviewModal :item="preview" @close="preview = null" />
  </div>
</template>

<script setup lang="ts">
// Session detail (renderDetail ~1342): header (project chip, context bar, config
// chip, info/workspace/delete buttons) + chat (todo · transcript · composer) and
// the optional workspace panel. Context bar math mirrors ctxHtml (~1287); the
// usage + config popovers reuse the `.dproj` dropdown pattern (one menu open at a
// time via `menu`, closed by a fixed full-screen backdrop). Data flows through
// useSessionsStore (remove/setProject/sendMessage) — visual rates are mock.
import type { Session, SessionAttachment, SlashCommandRef } from '~/composables/useSessionsMock'
import { modelIdFromDisplay } from '~/composables/useSessionsMock'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import { contextLimitFor, formatTokenCount } from '~/utils/context-window'
import type { WorkspaceDockSide } from '~/stores/settings'
import PreviewModal, { type PreviewItem } from '~/components/common/PreviewModal.vue'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { providerOf, wpIcon } = useSessionsMock()
const { projects, projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()
const exportModal = useSessionExportModal()
const gitModal = useGitModal()
const { fmtUsd } = useSessionCost()
// Working-tree changed-file count for the chat's project → badges the Git button.
const { dirtyCount } = useGitDirtyCount(() => props.session.project)
// Cumulative session cost (USD) for the usage popover. undefined → no priced turn yet.
const sessionCost = computed(() => props.session.usage?.cost)

// Resolve this session's workspace root once and provide a file opener so file
// paths in chat markdown (e.g. `docs/x.md`) open in the shared PreviewModal.
provideFilePreview(() => props.session.project)

// Header trash → confirm before dropping the session (destructive, no undo).
async function askRemove() {
  const ok = await confirm({
    title: t('sessions.delete.title'),
    description: t('sessions.delete.one', { title: props.session.title }),
  })
  if (ok) store.remove(props.session.id)
}

// Discuss link (ADR 0055): when this session was opened to discuss a task, show a
// banner with the task title (resolved from the tasks store) → click opens it.
const tasksStore = useTasksStore()
const { openTask } = useSessionTaskLink()
const aboutTask = computed(() =>
  props.session.aboutTaskId ? tasksStore.taskById(props.session.aboutTaskId) : undefined,
)
const aboutTaskTitle = computed(() => aboutTask.value?.title ?? props.session.aboutTaskId)
onMounted(() => {
  if (props.session.aboutTaskId && !aboutTask.value) void tasksStore.loadTasks()
})

// Single popover open at a time (project switcher · usage · config). The shared
// backdrop closes whichever is open.
type Menu = 'proj' | 'usage' | 'config' | 'workspace'
const menu = ref<Menu | null>(null)
function openMenu(m: Menu) {
  menu.value = menu.value === m ? null : m
}

// Project switcher (the `.dproj` crumb): the crumb shows the resolved project NAME
// (session.project holds the engine projectId); selecting persists the id.
const projName = computed(() => projectName(props.session.project))
function selectProj(id: string) {
  store.setProject(props.session.id, id)
  menu.value = null
}

// Composer send → mock turn runner (store swaps in the real IPC runner later).
// Pending attachments ride along, then clear (new array so the sent copy is safe).
function onSend(text: string, command?: SlashCommandRef) {
  store.sendMessage(props.session.id, text, pendingAtt.value, command)
  pendingAtt.value = []
}

// "Run as task" (ADR 0055) → open the shared New Task modal seeded with this
// session as the task origin (project + title pre-filled; source = this session).
const { openModal: openNewTaskModal } = useNewTaskModal()
function onRunAsTask() {
  const seed: { projectId?: string; title?: string; originSessionId?: string } = {
    title: props.session.title,
  }
  if (props.session.project) seed.projectId = props.session.project
  if (props.session.engineId) seed.originSessionId = props.session.engineId
  openNewTaskModal(seed)
}

// Pending attachments for the next message. Drag-drop anywhere on the detail and
// the composer's clip button both push here; the composer renders them as chips.
const pendingAtt = ref<SessionAttachment[]>([])
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

// Images get an object URL; text-like files get their content read — both feed the
// shared preview modal. Anything else previews as a metadata card.
const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|csv|tsv|log|ts|tsx|js|jsx|mjs|cjs|vue|css|scss|less|html?|xml|svg|sh|bash|zsh|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sql|env|ini|conf|gitignore)$/i
const isTextLike = (f: File) => (f.type || '').startsWith('text/') || TEXT_EXT.test(f.name)

function addFiles(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    const mime = f.type || ''
    const img = mime.startsWith('image/')
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(f.name)
    const att: SessionAttachment = { name: f.name, img, size: f.size }
    if (mime) att.mime = mime
    if (img || isPdf) att.src = URL.createObjectURL(f)
    const idx = pendingAtt.value.push(att) - 1
    if (!img && isTextLike(f)) {
      void f.text().then((tx) => {
        const a = pendingAtt.value[idx]
        if (a) a.text = tx.slice(0, ATTACHMENT_TEXT_MAX)
      })
    }
  }
}
function removeAtt(i: number) {
  const a = pendingAtt.value[i]
  if (a?.src) URL.revokeObjectURL(a.src)
  pendingAtt.value.splice(i, 1)
}
// Pasted-from-clipboard image (composer @paste → add-att). The composer already
// built the attachment (name/img/dataUrl/mime/size); just append it here.
function onAddAtt(a: SessionAttachment) {
  pendingAtt.value.push(a)
}

// "Add file to chat" from the global PreviewModal arrives via the decoupled
// useChatAttach channel (the modal must not know about sessions — SoC). Register
// this open session view as the consumer and drain queued attachments into the
// composer's pending list.
const chatAttach = useChatAttach()
let unregisterChatAttach: (() => void) | null = null
onMounted(() => {
  unregisterChatAttach = chatAttach.registerConsumer()
})
onBeforeUnmount(() => {
  unregisterChatAttach?.()
  unregisterChatAttach = null
})
watch(
  () => chatAttach.queue.value.length,
  (n) => {
    if (n > 0) pendingAtt.value.push(...chatAttach.drain())
  },
)
function openPicker() {
  fileInput.value?.click()
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = '' // allow re-picking the same file
}

// "+N more" overflow list modal (composer caps inline chips).
const moreOpen = ref(false)

// Selection-to-quote: highlight text in a message → floating Quote button → a note
// popover; on Save the selection is marked (coloured + numbered) in place.
type SelQuote = { text: string; src: number; x: number; y: number }
const quoteSel = ref<SelQuote | null>(null)
const notePop = ref<SelQuote | null>(null)
const noteText = ref('')

function onSelectQuote() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) {
    quoteSel.value = null
    return
  }
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const startEl = node instanceof HTMLElement ? node : node.parentElement
  const msgEl = startEl?.closest('[data-mi]')
  if (!(msgEl instanceof HTMLElement)) {
    quoteSel.value = null
    return
  }
  const rect = range.getBoundingClientRect()
  quoteSel.value = {
    text,
    src: Number(msgEl.dataset.mi),
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
  }
}
// Quote button → open the note popover at the same spot (keeps the captured range).
function openNote() {
  if (!quoteSel.value) return
  notePop.value = { ...quoteSel.value }
  noteText.value = ''
  quoteSel.value = null
}
// Save → add the follow-up (with note). The in-place highlight is painted reactively by
// SessionTextBlock via the CSS Custom Highlight API once the follow-up lands in state, so
// there's no DOM mutation here (which would otherwise strip the rendered markdown).
function saveQuote() {
  const np = notePop.value
  if (!np) return
  store.addQuote(props.session.id, np.src, np.text, noteText.value.trim())
  window.getSelection()?.removeAllRanges()
  notePop.value = null
  noteText.value = ''
}

// Shared preview modal — map an attachment into the generic PreviewItem shape.
const preview = ref<PreviewItem | null>(null)
function kindOf(a: SessionAttachment): PreviewItem['kind'] {
  if (a.img) return 'image'
  if (a.src && (a.mime === 'application/pdf' || /\.pdf$/i.test(a.name))) return 'pdf'
  if (a.text != null && /\.(md|markdown)$/i.test(a.name)) return 'markdown'
  if (a.text != null) return 'text'
  return 'file'
}
function previewAtt(i: number) {
  const a = pendingAtt.value[i]
  if (!a) return
  preview.value = {
    name: a.name,
    kind: kindOf(a),
    src: a.src,
    text: a.text,
    size: a.size,
    mime: a.mime,
  }
}

// Drag-drop file attach — the WHOLE detail is the drop target (not just the
// composer). A depth counter survives dragenter/leave bubbling from children so
// the overlay doesn't flicker; reset on drop.
const dragDepth = ref(0)
const dragActive = computed(() => dragDepth.value > 0)
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
function onDragEnter(e: DragEvent) {
  if (hasFiles(e)) dragDepth.value++
}
function onDragOver(e: DragEvent) {
  if (hasFiles(e) && e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  if (dragDepth.value > 0) dragDepth.value--
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
}

// Workspace panel: dock side is configured per VIEW (Settings store). Open views
// are partitioned by their dock side into two independent panel instances — a
// right-docked one (resizes horizontally) and a bottom-docked one (vertically) —
// which coexist, so e.g. Terminal (bottom) stays put while you browse Files
// (right). Sizes persist per orientation in the store.
const settings = useSettingsStore()
const wpOpen = ref(false)

const ALL_VIEWS = ['Diff', 'Files', 'Terminal', 'Plan', 'Tasks', 'Preview', 'Info'] as const
// Workspace panel starts EMPTY. The header's workspace button opens a view picker
// (dropdown, `menu === 'workspace'`); picking a view is what opens it (+ the panel),
// so clicking the button no longer dumps every default view at once.
const openViews = ref<string[]>([])
// Active view per dock side — kept valid by the watchers below.
const activeLeft = ref<string | null>(null)
const activeRight = ref<string | null>(null)
const activeBottom = ref<string | null>(null)

const leftTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'left'),
)
const rightTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'right'),
)
const bottomTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'bottom'),
)
const addableViews = computed(() => ALL_VIEWS.filter((v) => !openViews.value.includes(v)))

const wpLeftWidth = computed(() => settings.workspacePanel.leftWidth)
const wpWidth = computed(() => settings.workspacePanel.rightWidth)
const wpHeight = computed(() => settings.workspacePanel.bottomHeight)
const wpDragging = ref(false)

// Keep each side's active tab inside that side's tab set (falls back to the first
// tab, or null when the side is empty so its panel unmounts).
watch(
  leftTabs,
  (list) => {
    if (!activeLeft.value || !list.includes(activeLeft.value)) activeLeft.value = list[0] ?? null
  },
  { immediate: true },
)
watch(
  rightTabs,
  (list) => {
    if (!activeRight.value || !list.includes(activeRight.value)) activeRight.value = list[0] ?? null
  },
  { immediate: true },
)
watch(
  bottomTabs,
  (list) => {
    if (!activeBottom.value || !list.includes(activeBottom.value))
      activeBottom.value = list[0] ?? null
  },
  { immediate: true },
)
// Auto-close the panel once every view has been closed from all sides (closing the
// last tab, or toggling them all off in the picker).
watch([leftTabs, rightTabs, bottomTabs], ([l, r, b]) => {
  if (wpOpen.value && !l.length && !r.length && !b.length) wpOpen.value = false
})

// Add a view to a panel (the one whose "+" was clicked): pin its dock side, open
// it, and make it that side's active tab.
function addView(view: string, side: WorkspaceDockSide) {
  settings.setWorkspaceDock(view, side)
  if (!openViews.value.includes(view)) openViews.value.push(view)
  if (side === 'left') activeLeft.value = view
  else if (side === 'right') activeRight.value = view
  else activeBottom.value = view
}
function closeTab(view: string) {
  openViews.value = openViews.value.filter((v) => v !== view)
}
// Header view picker: open a view on its configured dock side (+ open the panel),
// or toggle it back off if already open. The auto-close watcher hides the panel
// once the last view is toggled off.
function openView(view: string) {
  wpOpen.value = true
  addView(view, settings.workspaceDockOf(view))
}
function toggleView(view: string) {
  if (openViews.value.includes(view)) closeTab(view)
  else openView(view)
  menu.value = null // close the picker on selection (single pick per open)
}
// Panel "×": close every view docked on that side.
function closeSide(side: WorkspaceDockSide) {
  const closing =
    side === 'left' ? leftTabs.value : side === 'right' ? rightTabs.value : bottomTabs.value
  openViews.value = openViews.value.filter((v) => !closing.includes(v))
}
// Move a view to a chosen side (reuses addView — the view is already open); it
// becomes that side's active tab.
function moveDock(view: string, side: WorkspaceDockSide) {
  addView(view, side)
}

// One handler for all three docks: drag X to resize a left/right column, Y for the
// bottom row. Each panel grows as the handle moves toward it — the left panel's
// handle sits on its right edge (drag right → grow, sign +1), the right/bottom
// panels' handles sit on their near edge (drag left/up → grow, sign −1).
const WP_SIDE = { min: 240, max: 560 } as const
const WP_BOTTOM = { min: 120, max: 600 } as const
function onWpResize(ev: PointerEvent, side: WorkspaceDockSide) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  wpDragging.value = true
  const vertical = side === 'bottom'
  const start = vertical ? ev.clientY : ev.clientX
  const startSize =
    side === 'left' ? wpLeftWidth.value : side === 'right' ? wpWidth.value : wpHeight.value
  const sign = side === 'left' ? 1 : -1
  const { min, max } = vertical ? WP_BOTTOM : WP_SIDE
  const onMove = (e: PointerEvent) => {
    const delta = (vertical ? e.clientY : e.clientX) - start
    const next = Math.max(min, Math.min(max, startSize + sign * delta))
    if (side === 'left') settings.setWorkspaceLeftWidth(next)
    else if (side === 'right') settings.setWorkspaceRightWidth(next)
    else settings.setWorkspaceBottomHeight(next)
  }
  const onUp = () => {
    wpDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

// Compact token formatter (kfmt ~1234): 1.2k / 999.
const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))

// Real engine usage (set by the store from the send-message result: input /
// output / cache read+write / total / max) when present — i.e. the actual tokens
// the model reported for this session. Falls back to a rough chars/3 estimate in
// browser-dev / before the first real turn finishes (no usage yet).
const usage = computed(() => props.session.usage)
const estTok = computed(() => {
  const chars = props.session.msgs.reduce((a, m) => {
    if (m.role === 'user' || m.role === 'system') return a + m.text.length
    return (
      a +
      m.blocks.reduce(
        (b, k) =>
          b +
          ('text' in k ? k.text.length : 0) +
          ('detail' in k ? (k.detail || '').length : 0) +
          60,
        0,
      )
    )
  }, 0)
  return Math.floor(chars / 3)
})
const totalTok = computed(() => usage.value?.total ?? estTok.value)
// Context window follows the session's SELECTED model id (retains `-1m`); the
// provider's base id collapses 1M → 200k, so we derive from the display the user
// picked, not from usage. Prefer an engine-reported max if one is ever set.
const maxTok = computed(
  () => usage.value?.max ?? contextLimitFor(modelIdFromDisplay(props.session.model)),
)
const tokLabel = computed(() => formatTokenCount(totalTok.value))
const limitLabel = computed(() => formatTokenCount(maxTok.value))
const pct = computed(() =>
  maxTok.value ? Math.min(100, (totalTok.value / maxTok.value) * 100) : 0,
)

// Context-window breakdown by CONTENT category (Claude-Code `/context` style),
// not by token-type. The engine reports char sizes of each prompt segment in
// usage.contextChars (÷4 ≈ tokens): the base System prompt, the appended
// Instructions, System tools + MCP tools schemas, the bulk-loaded Custom agents /
// Skills / Memory files catalogues (Claude Code preloads these so the model knows
// what it can invoke), and the Messages history. An "Other" bucket absorbs the
// cache/thinking/structure overhead the char estimate can't see.
const CTX_DIVISOR = 4
// Breakdown key order = render order = bar-segment order. `other` is derived last.
type BreakdownKey =
  | 'sys'
  | 'instr'
  | 'tools'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'memory'
  | 'msgs'
  | 'other'
type Breakdown = Record<BreakdownKey, number>
const breakdown = computed<Breakdown>(() => {
  const cap = Math.max(totalTok.value, 1)
  const cc = usage.value?.contextChars
  const tok = (chars: number | undefined) => Math.round((chars ?? 0) / CTX_DIVISOR)
  if (cc) {
    // System prompt: prefer the itemised `systemPrompt`, fall back to the legacy
    // aggregate `system`. Likewise tools: split into systemTools + mcpTools when
    // present, else the legacy combined `tools` lands in System tools.
    const sys = tok(cc.systemPrompt ?? cc.system)
    const instr = tok(cc.instructions)
    const tools = tok(cc.systemTools ?? cc.tools)
    const mcp = tok(cc.mcpTools)
    const agents = tok(cc.customAgents)
    const skills = tok(cc.skills)
    const memory = tok(cc.memoryFiles)
    const msgs = tok(cc.history)
    const est = sys + instr + tools + mcp + agents + skills + memory + msgs
    // Overshoot → scale every segment to the real total (Other 0); undershoot →
    // the deficit is the genuine unattributed remainder (prompt-cache, thinking…).
    if (est > cap && est > 0) {
      const k = cap / est
      return {
        sys: sys * k,
        instr: instr * k,
        tools: tools * k,
        mcp: mcp * k,
        agents: agents * k,
        skills: skills * k,
        memory: memory * k,
        msgs: msgs * k,
        other: 0,
      }
    }
    return {
      sys,
      instr,
      tools,
      mcp,
      agents,
      skills,
      memory,
      msgs,
      other: Math.max(0, totalTok.value - est),
    }
  }
  // Fallback before any real turn / in browser-dev: visible message text only.
  const msgs = Math.min(estTok.value, cap)
  return {
    sys: 0,
    instr: 0,
    tools: 0,
    mcp: 0,
    agents: 0,
    skills: 0,
    memory: 0,
    msgs,
    other: Math.max(0, totalTok.value - msgs),
  }
})

// One row per category + Free space; tokens, % of the window, and a colour for the
// square + bar segment. Empty categories (0 tokens) are dropped, except Free space.
// Palette intentionally avoids --del (red): every category here is benign, so a
// red swatch would falsely read as an error. Messages (usually the dominant
// bucket) gets the prominent violet; the rarely-co-shown static-context buckets
// (system prompt / memory files) share the accent family.
const CAT_META = [
  { key: 'sys', labelKey: 'sessions.detail.cat.systemPrompt', color: 'var(--accent)' },
  { key: 'instr', labelKey: 'sessions.detail.cat.instructions', color: 'var(--amber)' },
  { key: 'tools', labelKey: 'sessions.detail.cat.systemTools', color: 'var(--blue)' },
  { key: 'mcp', labelKey: 'sessions.detail.cat.mcpTools', color: 'var(--add)' },
  { key: 'agents', labelKey: 'sessions.detail.cat.customAgents', color: 'var(--mod)' },
  { key: 'skills', labelKey: 'sessions.detail.cat.skills', color: 'var(--green)' },
  { key: 'memory', labelKey: 'sessions.detail.cat.memoryFiles', color: 'var(--accent)' },
  { key: 'msgs', labelKey: 'sessions.detail.cat.messages', color: 'var(--violet)' },
  { key: 'other', labelKey: 'sessions.detail.cat.other', color: 'var(--textFaint)' },
] as const satisfies readonly { key: BreakdownKey; labelKey: string; color: string }[]
type CatRow = { key: string; label: string; tokens: number; color: string; pct: number }
const catRows = computed<CatRow[]>(() => {
  const b = breakdown.value
  const limit = maxTok.value || 1
  const rows: CatRow[] = CAT_META.map((m) => ({
    key: m.key,
    label: t(m.labelKey),
    tokens: Math.round(b[m.key]),
    color: m.color,
    pct: (b[m.key] / limit) * 100,
  })).filter((r) => r.tokens > 0)
  const free = Math.max(0, maxTok.value - totalTok.value)
  rows.push({
    key: 'free',
    label: t('sessions.detail.cat.freeSpace'),
    tokens: free,
    color: 'var(--bgActive)',
    pct: (free / limit) * 100,
  })
  return rows
})
// Filled bar segments (everything except Free space, which is the empty track).
const barSegments = computed(() => catRows.value.filter((r) => r.key !== 'free'))

// Expandable detail sections (MEMORY FILES / CUSTOM AGENTS), each a flat list of
// label + token count from the engine breakdown. Collapsed by default; the
// chevron toggles them. Hidden entirely when the engine reported no items.
type CtxItemRow = { label: string; tokens: number }
const memoryFilesOpen = ref(false)
const agentsOpen = ref(false)
const memoryFilesList = computed<CtxItemRow[]>(() =>
  (usage.value?.contextChars?.memoryFilesList ?? []).map((it) => ({
    label: it.label,
    tokens: Math.round(it.chars / CTX_DIVISOR),
  })),
)
const agentsList = computed<CtxItemRow[]>(() =>
  (usage.value?.contextChars?.customAgentsList ?? []).map((it) => ({
    label: it.label,
    tokens: Math.round(it.chars / CTX_DIVISOR),
  })),
)

// Plan rate-limit rows — REAL usage from the engine (account.usage → claude.ai
// OAuth / Codex). Browser-dev (no bridge) keeps demo rows so the popover isn't empty.
const provider = computed(() => providerOf(props.session.account))
type RateLimit = { label: string; used: number; reset: string }

const {
  entries: usageEntries,
  loading: usageLoading,
  refresh: refreshUsage,
  available: usageAvailable,
} = useAccountUsage(() => ({
  provider: provider.value.toLowerCase(),
  accountId: props.session.accountId,
}))
// Refresh usage when the popover opens (sidecar caches 60s, so this is cheap).
watch(menu, (m) => {
  if (m === 'usage') void refreshUsage()
})

const RL_LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly · all',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  overage: 'Overage',
}
function formatResetsIn(ms?: number): string {
  if (!ms) return '—'
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins % 60}m`
}
const rateLimits = computed<RateLimit[]>(() => {
  if (usageAvailable) {
    return usageEntries.value.map((e) => ({
      label: RL_LABELS[e.rateLimitType] ?? e.rateLimitType,
      used: e.utilization,
      reset: formatResetsIn(e.resetsAt),
    }))
  }
  // Browser-dev demo rows (no bridge).
  if (provider.value === 'OpenAI') {
    return [
      { label: '5-hour limit', used: 0.34, reset: '4h 02m' },
      { label: 'Weekly · all', used: 0.51, reset: '5d 1h' },
    ]
  }
  return [
    { label: '5-hour limit', used: 0.41, reset: '3h 12m' },
    { label: 'Weekly · all', used: 0.62, reset: '2d 4h' },
    { label: 'Weekly · Opus', used: 0.78, reset: '2d 4h' },
    { label: 'Weekly · Sonnet', used: 0.23, reset: '2d 4h' },
  ]
})
function rlColor(u: number): string {
  if (u >= 1) return 'var(--danger)'
  if (u >= 0.9) return 'var(--amber)'
  return 'var(--accent)'
}
</script>

<style scoped>
/* Anchor the drop overlay to the detail. */
.detail {
  position: relative;
}
/* Discuss banner (ADR 0055) — links a discussion session back to its task. */
.aboutbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px 8px;
  padding: 7px 11px;
  border: 1px solid var(--accentBorder);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}
.aboutbar:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.aboutbar-icn {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--accent);
}
.aboutbar-lbl {
  flex: 0 0 auto;
  color: var(--textMuted);
}
.aboutbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.aboutbar-chev {
  flex: 0 0 auto;
  opacity: 0.6;
}
/* Two-axis dock: .chatwrap stacks the top row (chat + right panel) over the
   full-width bottom panel; .wptop is the horizontal row the prototype's .chatwrap
   used to be. */
.chatwrap {
  flex-direction: column;
}
.wptop {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/* Resize handle docked at the bottom: a full-width row gripper (the prototype's
   .rszwp is a vertical col-resize bar for the right dock). The ::after divider
   runs horizontally instead of vertically. */
.rszwp.vert {
  flex: 0 0 6px;
  width: auto;
  align-self: stretch;
  cursor: row-resize;
}
.rszwp.vert::after {
  left: 0;
  right: 0;
  top: 2.5px;
  bottom: auto;
  width: auto;
  height: 1px;
}
.rszwp.vert:hover::after,
.rszwp.vert.drag::after {
  height: 2px;
  top: 2px;
  width: auto;
  left: 0;
}
/* Keep the rate-limit reset (e.g. "3h 12m") on one line — no mid-value wrap. */
.rlp {
  white-space: nowrap;
}
/* Drop-anywhere overlay — dashed accent frame + centred hint. pointer-events:none
   so dragleave/drop fire on .detail itself (no flicker, the drop always lands). */
.dropzone {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  border: 2px dashed var(--accent);
  border-radius: 10px;
}
.dropzone-inner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 18px;
  font-weight: 600;
  color: var(--accent);
  background: var(--bgEl);
  border: 1px solid var(--accentBorder);
  border-radius: 10px;
}
/* Floating quote button next to a text selection (anchored to viewport coords). */
.selquote {
  position: fixed;
  z-index: 80;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  color: var(--text);
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.selquote:hover {
  border-color: var(--accentBorder);
  color: var(--accent);
}
/* Note popover (after clicking the floating Quote button). */
.notebackdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.notepop {
  position: fixed;
  z-index: 81;
  transform: translate(-50%, -100%);
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.npq {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 0.8462rem;
}
.npex {
  color: var(--textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.npinput {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bgInput);
  color: var(--text);
  outline: none;
}
.npinput:focus {
  border-color: var(--accentBorder);
}
.nprow {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.npbtn {
  padding: 4px 12px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--textDim);
}
.npbtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.npbtn.pri {
  background: var(--accent);
  color: var(--bg);
}
/* Plan-usage reload: ghost icon button on the section header; spins while fetching. */
.rlreload {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--textFaint);
  cursor: pointer;
  transition:
    color 0.12s ease,
    background 0.12s ease;
}
.rlreload:hover {
  color: var(--text);
  background: var(--bgHover);
}
.rlreload:disabled {
  cursor: default;
  opacity: 0.6;
}
.spin {
  animation: usage-spin 0.9s linear infinite;
}
@keyframes usage-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

/* ── Context-window breakdown table (Claude-Code /context style) ───────────── */
.ctxmodel {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  margin: 2px 0 8px;
}
.ctxcost {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 8px;
  font-size: 12px;
  color: var(--textDim);
}
/* Header row stays on ONE line (the label + the token/limit count never wrap);
   if the popover is ever too narrow the label ellipsises rather than wrapping. */
.plnowrap {
  white-space: nowrap;
  gap: 10px;
}
.plnowrap > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.plnowrap > .ctxn {
  flex: 0 0 auto;
}
.cattbl {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
}
.cathead,
.catrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.cathead {
  font-size: 12px;
  color: var(--textFaint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 5px;
  margin-bottom: 2px;
}
.catsq {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.cathead .catlbl {
  margin-left: 17px; /* align under the rows' square + gap */
}
.catlbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.catnum,
.catpct {
  flex: 0 0 auto;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  text-align: right;
}
.catnum {
  min-width: 56px;
}
.catpct {
  min-width: 48px;
  color: var(--textFaint);
}

/* ── Expandable bulk-load sections (MEMORY FILES / CUSTOM AGENTS) ──────────── */
.ctxsec {
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.ctxsechead {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--textFaint);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ctxsechead:hover {
  color: var(--text);
}
.ctxchev {
  transition: transform 0.12s ease;
}
.ctxchev.open {
  transform: rotate(90deg);
}
.ctxcount {
  margin-left: auto;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  color: var(--textDim);
}
.ctxitems {
  display: flex;
  flex-direction: column;
  margin-top: 4px;
  /* Long bulk-load lists (12+ agents / many memory files) scroll within their own
     section so they don't push Plan usage off the bottom of the popover. */
  max-height: 184px;
  overflow-y: auto;
}
/* The usage popover is absolutely positioned just below the header chip, so the
   global `.pop` max-height (100vh − 24px) lets the now much taller breakdown +
   plan-usage run off-screen with no scroll. Cap it to the room below the chip. */
.pop {
  max-height: calc(100vh - 96px);
}
.ctxitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.ctxipath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
}
.ctxinum {
  flex: 0 0 auto;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  text-align: right;
}
@media (prefers-reduced-motion: reduce) {
  .ctxchev {
    transition: none;
  }
}
</style>
