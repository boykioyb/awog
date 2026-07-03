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

      <!-- Config gear → Budget / Tools / MCP (Model · Account · Effort · Style moved
           to the status-bar chips). -->
      <span style="position: relative">
        <button
          class="iconbtn"
          :title="t('sessions.detail.config')"
          style="width: 28px; height: 28px"
          :style="
            menu === 'config' ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' } : {}
          "
          @click.stop="openMenu('config')"
        >
          <Icon name="settings" style="width: 14px; height: 14px" />
        </button>
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
          <SessionTodoPanel :session="session" />
          <SessionTranscript
            :messages="session.msgs"
            :fallback-when="session.when"
            :loading="!!session.loading"
          />
          <SessionComposer
            :attachments="pendingAtt"
            @send="onSend"
            @pick="openPicker"
            @pick-folder="pickFolders"
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
        <textarea
          v-model="noteText"
          class="npinput"
          rows="3"
          autofocus
          :placeholder="t('sessions.quote.notePlaceholder')"
          @keydown.enter.meta.prevent="saveQuote"
          @keydown.enter.ctrl.prevent="saveQuote"
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
import type { Session, SessionAttachment, SlashCommandRef } from '~/composables/useSessionsData'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import type { WorkspaceDockSide } from '~/stores/settings'
import PreviewModal, { type PreviewItem } from '~/components/common/PreviewModal.vue'
import { previewKindFromAttachment } from '~/composables/usePreview'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { wpIcon } = useSessionsData()
const { projects, projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()
const exportModal = useSessionExportModal()

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

// Single popover open at a time (project switcher · config · workspace). The shared
// backdrop closes whichever is open.
type Menu = 'proj' | 'config' | 'workspace'
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
  // Folder attachments ride into the user message (bubble) and, via the store, to
  // the turn's `contextFolders` (read-only <workspace_tree> context). They do NOT
  // set the session cwd — the tools' working dir stays the project/home.
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
    // Absolute on-disk path (Electron webUtils) so binary / document files can ride
    // to the model as a Read-able reference. '' outside the shell / for synthetic
    // (clipboard) blobs — then a non-text file simply has no way to reach the model.
    const path = window.awog?.getPathForFile?.(f) || ''
    const att: SessionAttachment = { name: f.name, img, size: f.size }
    if (mime) att.mime = mime
    if (path) att.path = path
    const idx = pendingAtt.value.push(att) - 1
    if (img || isPdf) {
      // Images AND PDFs are read as a base64 `data:` URL: the engine forwards images
      // as image blocks and PDFs as document blocks (Anthropic path — Pi degrades to
      // the `path` reference). A `blob:` object URL is dropped before send, so the
      // model would never receive them. Mirrors the composer's paste path.
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const a = pendingAtt.value[idx]
        if (a && dataUrl) {
          a.dataUrl = dataUrl
          a.src = dataUrl
        }
      }
      reader.readAsDataURL(f)
    } else if (isTextLike(f)) {
      void f.text().then((tx) => {
        const a = pendingAtt.value[idx]
        if (a) a.text = tx.slice(0, ATTACHMENT_TEXT_MAX)
      })
    }
    // else: binary file with no inline content → rides as a `path` reference (above).
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
// Attach one or more FOLDERS via the native directory picker (multi-select). Each
// becomes a read-only <workspace_tree> context chip (does not change the cwd). No-op
// outside the Electron shell (browser dev). Dedupe against already-attached folders.
async function pickFolders() {
  const paths =
    (await window.awog?.pickFolders?.({ title: t('sessions.composer.attachFolder') })) ?? []
  for (const path of paths) {
    if (!path || pendingAtt.value.some((a) => a.folder && a.path === path)) continue
    const name =
      path
        .replace(/[/\\]+$/, '')
        .split(/[/\\]/)
        .pop() || path
    pendingAtt.value.push({ name, img: false, folder: true, path })
  }
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
function previewAtt(i: number) {
  const a = pendingAtt.value[i]
  if (!a) return
  if (a.folder && a.path) {
    preview.value = { name: a.name, kind: 'folder', workspaceRoot: a.path }
    return
  }
  preview.value = {
    name: a.name,
    kind: previewKindFromAttachment(a),
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
  const dt = e.dataTransfer
  if (!dt) return
  // `dt.items` carries the folder/file distinction (webkitGetAsEntry); `dt.files`
  // does not. Read synchronously — the list is only valid during this event. Files
  // AND folders can be dropped together (multi-file, multi-folder): folders become
  // read-only <workspace_tree> context chips; everything else is a file attachment.
  const items = Array.from(dt.items)
  if (items.length) {
    const droppedFiles: File[] = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        const path = file ? (window.awog?.getPathForFile?.(file) ?? '') : ''
        if (!path || pendingAtt.value.some((a) => a.folder && a.path === path)) continue
        const name =
          path
            .replace(/[/\\]+$/, '')
            .split(/[/\\]/)
            .pop() || path
        pendingAtt.value.push({ name, img: false, folder: true, path })
      } else if (file) {
        droppedFiles.push(file)
      }
    }
    if (droppedFiles.length) addFiles(droppedFiles)
    return
  }
  if (dt.files.length) addFiles(dt.files)
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
// Status-bar bridge: the footer's Files/Terminal buttons request a view toggle here;
// publish the open views back so those footer chips can reflect active state.
const wpBridge = useWorkspacePanel()
watch(
  () => wpBridge.requested.value,
  (req) => {
    if (req) toggleView(req.view)
  },
)
watch(openViews, (v) => wpBridge.publishOpenViews(v), { immediate: true })
onBeforeUnmount(() => wpBridge.publishOpenViews([]))
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
  align-items: flex-start;
  gap: 6px;
  color: var(--accent);
  font-size: 0.8462rem;
}
.npq svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.npex {
  color: var(--textMuted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 8em;
  overflow-y: auto;
}
.npinput {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bgInput);
  color: var(--text);
  outline: none;
  resize: vertical;
  min-height: 4.5em;
  line-height: 1.4;
  font-family: var(--sans);
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
</style>
