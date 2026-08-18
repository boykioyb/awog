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

      <!-- Open the session's project folder in VS Code (falls back to the OS file
           manager when `code` is unavailable). Hidden while the root is unresolved
           (browser-dev / session with no project). -->
      <button
        v-if="codeRoot"
        class="iconbtn"
        :title="t('sessions.detail.openCode')"
        style="width: 28px; height: 28px"
        @click="openInCode"
      >
        <Icon name="code" style="width: 14px; height: 14px" />
      </button>

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
      <!-- Move this session to its own OS window (session-popout-window.md). Hidden
           inside a popout — a window must not clone itself — and disabled mid-turn,
           since a running turn streams into THIS renderer and can't be handed over. -->
      <button
        v-if="canOpenInWindow"
        class="iconbtn"
        :title="turnBusy ? t('sessions.window.busy') : t('sessions.window.open')"
        style="width: 28px; height: 28px"
        :disabled="turnBusy"
        :style="turnBusy ? { opacity: 0.45, cursor: 'not-allowed' } : {}"
        @click="openInWindow"
      >
        <Icon name="external" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn"
        :title="t('minimize.session')"
        style="width: 28px; height: 28px"
        @click="minimizeSession"
      >
        <Icon name="minimize" style="width: 14px; height: 14px" />
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

    <!-- Work banner (ADR 0064): this session was opened to work with an SSH host.
         The approval selector governs the agent's mutating SSH tools (P2). -->
    <div v-if="session.aboutSshHostId" class="sshbar">
      <button class="aboutbar sshbar-open" @click="openSshHost(session.aboutSshHostId)">
        <Icon name="ssh" class="aboutbar-icn" />
        <span class="aboutbar-lbl">{{ t('sessions.detail.aboutSshHost') }}</span>
        <span class="aboutbar-title">{{ aboutSshHostName }}</span>
        <Icon name="chev" class="aboutbar-chev" />
      </button>
      <div class="sshbar-approval">
        <span class="sshbar-approval-lbl">{{ t('sessions.detail.sshApproval.label') }}</span>
        <AppSelect
          :model-value="sshApprovalMode"
          :options="sshApprovalOptions"
          width="132px"
          @update:model-value="onSshApprovalMode"
        />
      </div>
      <p v-if="sshApprovalMode === 'auto'" class="sshbar-warn">
        {{ t('sessions.detail.sshApproval.autoWarn') }}
      </p>
    </div>

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
        <div
          class="chat"
          @mouseup="onSelectQuote"
          @mousedown="onChatMouseDown"
          @contextmenu="onQuoteContextMenu"
        >
          <SessionTodoPanel :session="session" />
          <SessionTranscript
            :messages="session.msgs"
            :fallback-when="session.when"
            :loading="!!session.loading"
          />
          <SessionBackgroundWakeCard :session="session" />
          <SessionBackgroundChips :session="session" />
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

    <!-- Select (highlight) text in a message → floating action bar (Quote + Translate) -->
    <div
      v-if="quoteSel"
      class="selactions"
      :style="{ left: `${quoteSel.x}px`, top: `${quoteSel.y}px` }"
      @mousedown.prevent
    >
      <button class="selquote" @click="openNote">
        <Icon name="quote" style="width: 13px; height: 13px" />
        {{ t('sessions.quote.action') }}
      </button>
      <button class="selquote" @click="onTranslate">
        <Icon name="globe" style="width: 13px; height: 13px" />
        {{ t('translate.action') }}
      </button>
    </div>

    <!-- note popover for a selection quote -->
    <template v-if="notePop">
      <div class="notebackdrop" />
      <div
        class="notepop"
        :class="{ moved: notePos, dragging: notePopDragging }"
        :style="notePopStyle"
        @mousedown.stop
      >
        <div class="npq" @pointerdown="onNoteDragStart">
          <Icon name="quote" style="width: 12px; height: 12px" />
          <span class="npex">{{ notePop.text }}</span>
        </div>
        <textarea
          ref="noteInput"
          v-model="noteText"
          class="npinput"
          rows="3"
          :placeholder="t('sessions.quote.notePlaceholder')"
          @keydown.enter.exact.prevent="saveQuote"
          @keydown.enter.meta.prevent="saveQuote"
          @keydown.enter.ctrl.prevent="saveQuote"
        />
        <div class="nprow">
          <button class="npbtn" @click="notePop = null">{{ t('common.close') }}</button>
          <button class="npbtn pri" @click="saveQuote">{{ t('sessions.quote.save') }}</button>
        </div>
        <div class="npresize" @pointerdown="onNoteResizeStart" />
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
  </div>
</template>

<script setup lang="ts">
// Session detail (renderDetail ~1342): header (project chip, context bar, config
// chip, info/workspace/delete buttons) + chat (todo · transcript · composer) and
// the optional workspace panel. Context bar math mirrors ctxHtml (~1287); the
// usage + config popovers reuse the `.dproj` dropdown pattern (one menu open at a
// time via `menu`, closed by a fixed full-screen backdrop). Data flows through
// useSessionsStore (remove/setProject/sendMessage) — visual rates are presentational.
import type {
  Session,
  SessionAttachment,
  SlashCommandRef,
  SshApprovalMode,
} from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import type { WorkspaceDockSide } from '~/stores/settings'
import {
  imageSiblingsFromAttachments,
  previewRefFromAttachment,
  usePreview,
} from '~/composables/usePreview'
import { useMinimizeDock } from '~/composables/useMinimizeDock'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { wpIcon } = useSessionsData()
const { projects, projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()
const exportModal = useSessionExportModal()
const translate = useSelectionTranslate()

// Whether THIS instance is the one currently shown. Under <KeepAlive> (pages/sessions
// caches recent detail instances so switching back is instant) inactive instances stay
// mounted, so effects that touch app-wide singletons — the chatAttach consumer and the
// workspace footer bridge — gate on this. Otherwise every cached session would drain
// the same "add to chat" queue and react to the footer's view toggles at once.
const isActive = computed(() => props.session.id === store.activeId)

// Resolve this session's workspace root once and provide a file opener so file
// paths in chat markdown (e.g. `docs/x.md`) open in the shared PreviewModal.
provideFilePreview(
  () => props.session.project,
  () => props.session,
)

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
const { openTask, openSshHost } = useSessionTaskLink()
const aboutTask = computed(() =>
  props.session.aboutTaskId ? tasksStore.taskById(props.session.aboutTaskId) : undefined,
)
const aboutTaskTitle = computed(() => aboutTask.value?.title ?? props.session.aboutTaskId)
onMounted(() => {
  if (props.session.aboutTaskId && !aboutTask.value) void tasksStore.loadTasks()
})

// Work link (ADR 0064): when this session was opened to work with an SSH host,
// show a banner with the host name (resolved from the ssh store) → click opens
// the SSH page. Falls back to the raw id if the host was deleted.
const sshStore = useSshStore()
const aboutSshHost = computed(() =>
  props.session.aboutSshHostId ? sshStore.hostById(props.session.aboutSshHostId) : undefined,
)
const aboutSshHostName = computed(() => aboutSshHost.value?.name ?? props.session.aboutSshHostId)
onMounted(() => {
  if (props.session.aboutSshHostId && !aboutSshHost.value) void sshStore.loadAll()
})

// Per-session SSH tool approval mode (ADR 0064 P2). Governs the agent's mutating
// SSH tools (ssh_exec / ssh_write_file); 'prompt' by default. Takes effect on the
// next turn (engine reads it per turn).
const sshApprovalMode = computed<SshApprovalMode>(() => props.session.sshApprovalMode ?? 'prompt')
const sshApprovalOptions = computed<AppSelectOption[]>(() => [
  { label: t('sessions.detail.sshApproval.prompt'), value: 'prompt' },
  { label: t('sessions.detail.sshApproval.session'), value: 'session' },
  { label: t('sessions.detail.sshApproval.auto'), value: 'auto' },
])
function onSshApprovalMode(v: string) {
  store.setSshApprovalMode(props.session.id, v as SshApprovalMode)
}

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

// Header "Open in VS Code" → the session's project folder, resolved the same way the
// workspace tabs resolve it (name-or-id → path). Falls back to the OS file manager when
// `code` isn't on PATH; no-op in browser-dev.
const sc = useSidecar()
const { root: codeRoot } = useWorkspaceData(() => props.session.project)
async function openInCode() {
  const root = codeRoot.value
  if (!root || !sc.available) return
  try {
    if (await sc.isVscodeAvailable()) await sc.openInVscode(root, '.')
    else await sc.openPath(root, '.')
  } catch (err) {
    console.warn('[sessions] open in code failed', err)
  }
}
function selectProj(id: string) {
  store.setProject(props.session.id, id)
  menu.value = null
}

// Composer send → the store's turn runner (IPC).
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
// Only the active instance registers as the attach consumer and drains the queue, so a
// cached (backgrounded) session never steals the "add to chat" attachment.
watch(
  isActive,
  (active) => {
    if (active && !unregisterChatAttach) unregisterChatAttach = chatAttach.registerConsumer()
    else if (!active && unregisterChatAttach) {
      unregisterChatAttach()
      unregisterChatAttach = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  unregisterChatAttach?.()
  unregisterChatAttach = null
})
watch(
  () => chatAttach.queue.value.length,
  (n) => {
    if (n > 0 && isActive.value) pendingAtt.value.push(...chatAttach.drain())
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
const noteInput = ref<HTMLTextAreaElement | null>(null)

// Note popover drag/resize state (AN-2). When the user drags the header or resizes,
// we switch from selection-anchored (`transform: translate(-50%,-100%)`) to explicit
// top-left coords + fixed size. Ephemeral — reset to defaults each time it opens.
const NOTE_POP_DEFAULT_WIDTH = 280
const NOTE_POP_MIN_WIDTH = 240
const NOTE_POP_MIN_HEIGHT = 160
const NOTE_POP_MARGIN = 16
const NOTE_POP_EDGE = 8
const notePos = ref<{ x: number; y: number } | null>(null)
const noteSize = ref<{ w: number; h: number } | null>(null)
const notePopDragging = ref(false)
// Teardown for an in-flight note drag/resize gesture. Set on each gesture start,
// invoked (and cleared) on pointerup and on unmount — so listeners + pointer capture
// don't leak if the popover tears down mid-drag (session switch, keyboard save, etc.).
let activeNoteCleanup: (() => void) | null = null

// Once moved/resized, anchor by explicit top-left (drop the selection-anchored
// transform) so drag coords map intuitively; otherwise use the selection anchor.
const notePopStyle = computed<Record<string, string>>(() => {
  const np = notePop.value
  if (!np) return {}
  const size = noteSize.value
  const w = size ? `${size.w}px` : `${NOTE_POP_DEFAULT_WIDTH}px`
  const h = size ? `${size.h}px` : ''
  const pos = notePos.value
  if (pos) return { left: `${pos.x}px`, top: `${pos.y}px`, width: w, ...(h ? { height: h } : {}) }
  return { left: `${np.x}px`, top: `${np.y}px`, width: w }
})

// Auto-focus the note textarea once the popover mounts (AN-1). The HTML `autofocus`
// attribute only fires on the initial page load, but `.notepop` is inserted
// dynamically via v-if — so focus it manually each time it opens, caret at the end.
function focusNoteInput() {
  nextTick(() => {
    const el = noteInput.value
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  })
}

// Validate the current selection lives inside a message and extract its text +
// source index + bounding rect. Returns null when there is no valid selection.
// Shared by the mouseup (onSelectQuote) and right-click (onQuoteContextMenu) triggers.
function resolveSelectionQuote(): { text: string; src: number; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const startEl = node instanceof HTMLElement ? node : node.parentElement
  const msgEl = startEl?.closest('[data-mi]')
  if (!(msgEl instanceof HTMLElement)) return null
  return { text, src: Number(msgEl.dataset.mi), rect: range.getBoundingClientRect() }
}

// mouseup: anchor the floating Quote button to the top-centre of the selection.
// Guard to left-click only — right-click also fires `mouseup` (button=2) after
// `contextmenu`, which would otherwise overwrite the cursor-anchored position set by
// `onQuoteContextMenu` and make the button jump back (AN-3).
function onSelectQuote(e: MouseEvent) {
  if (e.button !== 0) return
  const q = resolveSelectionQuote()
  if (!q) {
    quoteSel.value = null
    return
  }
  quoteSel.value = {
    text: q.text,
    src: q.src,
    x: q.rect.left + q.rect.width / 2,
    y: q.rect.top - 8,
  }
}

// Right-click (AN-3): show the Quote button at the cursor. Only prevent the default
// context menu when there is a valid selection inside a message — otherwise leave the
// platform menu intact. Ignored while the note popover is already open.
function onQuoteContextMenu(e: MouseEvent) {
  if (notePop.value) return
  const q = resolveSelectionQuote()
  if (!q) return
  e.preventDefault()
  quoteSel.value = { text: q.text, src: q.src, x: e.clientX, y: e.clientY }
}

// Left-click clears the floating Quote button; right-click must NOT clear it, or it
// would wipe `quoteSel` before `contextmenu` re-sets it (mousedown fires first).
function onChatMouseDown(e: MouseEvent) {
  if (e.button === 0) quoteSel.value = null
}
// Quote button → open the note popover at the same spot (keeps the captured range).
function openNote() {
  if (!quoteSel.value) return
  notePop.value = { ...quoteSel.value }
  noteText.value = ''
  quoteSel.value = null
  // No persist: reset to default (selection-anchored, default width, auto height).
  notePos.value = null
  noteSize.value = null
  notePopDragging.value = false
  focusNoteInput()
}
// Translate button → open the shared translation popover anchored to the live
// selection rect (`@mousedown.prevent` on the action bar keeps the range alive).
// LLM defaults resolve from the session's project (→ app defaults).
function onTranslate() {
  const q = quoteSel.value
  if (!q) return
  const sel = window.getSelection()
  const rect =
    sel && sel.rangeCount > 0
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { left: q.x, top: q.y, bottom: q.y, width: 0 }
  translate.open(q.text, rect, props.session.project)
  quoteSel.value = null
}

// Drag the popover by its header. Native pointer + setPointerCapture (mirrors
// onWpResize). Switches to top-left anchoring; keeps `noteText` (no textarea remount).
function onNoteDragStart(ev: PointerEvent) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  const pop = handle.closest('.notepop') as HTMLElement | null
  if (!pop) return
  handle.setPointerCapture(ev.pointerId)
  notePopDragging.value = true
  const box = pop.getBoundingClientRect()
  // Anchor to current top-left so the popover doesn't jump when switching modes.
  if (!notePos.value) notePos.value = { x: box.left, y: box.top }
  if (!noteSize.value) noteSize.value = { w: box.width, h: box.height }
  const grabX = ev.clientX - notePos.value.x
  const grabY = ev.clientY - notePos.value.y
  const onMove = (e: PointerEvent) => {
    const w = noteSize.value?.w ?? box.width
    const h = noteSize.value?.h ?? box.height
    const maxX = window.innerWidth - w - NOTE_POP_EDGE
    const maxY = window.innerHeight - h - NOTE_POP_EDGE
    notePos.value = {
      x: Math.max(NOTE_POP_EDGE, Math.min(maxX, e.clientX - grabX)),
      y: Math.max(NOTE_POP_EDGE, Math.min(maxY, e.clientY - grabY)),
    }
  }
  const cleanup = () => {
    notePopDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId)
    if (activeNoteCleanup === cleanup) activeNoteCleanup = null
  }
  const onUp = () => cleanup()
  activeNoteCleanup = cleanup
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

// Resize the popover via the bottom-right handle. Clamp width [240, min(560, vw−16)]
// and height [160, vh−16].
function onNoteResizeStart(ev: PointerEvent) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  const pop = handle.closest('.notepop') as HTMLElement | null
  if (!pop) return
  handle.setPointerCapture(ev.pointerId)
  notePopDragging.value = true
  const box = pop.getBoundingClientRect()
  if (!notePos.value) notePos.value = { x: box.left, y: box.top }
  if (!noteSize.value) noteSize.value = { w: box.width, h: box.height }
  const startX = ev.clientX
  const startY = ev.clientY
  const startW = noteSize.value.w
  const startH = noteSize.value.h
  const onMove = (e: PointerEvent) => {
    const maxW = Math.min(WP_SIDE.max, window.innerWidth - NOTE_POP_MARGIN)
    const maxH = window.innerHeight - NOTE_POP_MARGIN
    const w = Math.max(NOTE_POP_MIN_WIDTH, Math.min(maxW, startW + (e.clientX - startX)))
    const h = Math.max(NOTE_POP_MIN_HEIGHT, Math.min(maxH, startH + (e.clientY - startY)))
    noteSize.value = { w, h }
    // Re-clamp the top-left so growing near the right/bottom edge doesn't push the
    // popover (and its Save button) off-screen. Keep it fully inside the viewport.
    const pos = notePos.value ?? { x: box.left, y: box.top }
    const maxX = window.innerWidth - w - NOTE_POP_EDGE
    const maxY = window.innerHeight - h - NOTE_POP_EDGE
    notePos.value = {
      x: Math.max(NOTE_POP_EDGE, Math.min(maxX, pos.x)),
      y: Math.max(NOTE_POP_EDGE, Math.min(maxY, pos.y)),
    }
  }
  const cleanup = () => {
    notePopDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId)
    if (activeNoteCleanup === cleanup) activeNoteCleanup = null
  }
  const onUp = () => cleanup()
  activeNoteCleanup = cleanup
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}
// Tear down a live note drag/resize gesture if the component unmounts mid-drag, so the
// captured pointer + document listeners don't leak (mirrors the composer/tab cleanup).
onBeforeUnmount(() => activeNoteCleanup?.())

// ESC closes the note popover even when focus isn't inside its textarea (drag handle,
// a button, the backdrop). Gated on `isActive` so a cached <KeepAlive> instance that
// still holds an open popover (session switched away without closing it) can't swallow
// ESC for the session now on screen.
useEscToClose(
  () => isActive.value && !!notePop.value,
  () => {
    notePop.value = null
  },
)
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

// Shared preview modal (mounted app-wide in the shell) — map an attachment into
// the generic PreviewRef shape and open the shared viewer.
const { open: openPreview } = usePreview()
function previewAtt(i: number) {
  const a = pendingAtt.value[i]
  if (!a) return
  // Siblings = the other pending attachments, so ‹ › walks what the user just attached
  // (these have no folder on disk to fall back to).
  openPreview(previewRefFromAttachment(a), imageSiblingsFromAttachments(pendingAtt.value))
}

// Minimize this session to the corner dock as a live PiP tile (keeps tracking its
// status while the user works elsewhere; click the pill to jump back).
const { minimize: dockMinimize } = useMinimizeDock()
function minimizeSession() {
  dockMinimize({
    id: `session:${props.session.id}`,
    kind: 'session',
    icon: 'sessions',
    title: props.session.title,
    sessionId: props.session.id,
  })
}

// Move this session to its own OS window (docs/features/session-popout-window.md).
// Only a session the sidecar knows about can go: the popout is a fresh renderer that
// re-reads the transcript from disk and addresses the session by its ENGINE id (the
// numeric client id is per-renderer). Hidden inside a popout — `windowSessionId` is
// set only there — so a window can't clone itself.
const canOpenInWindow = computed(
  () => sc.available && !store.windowSessionId && !!props.session.engineId,
)
// A turn in flight streams into THIS renderer's copy of the message, so handing the
// session over mid-turn would strand it. Wait for the turn (or cancel it) first.
const turnBusy = computed(
  () => props.session.status === 'streaming' || props.session.status === 'awaiting',
)
function openInWindow() {
  if (turnBusy.value) return
  void store.openInWindow(props.session.id)
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

const ALL_VIEWS = ['Diff', 'Files', 'Terminal', 'Plan', 'Tasks', 'Preview', 'Cost', 'Info'] as const
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
    if (req && isActive.value) toggleView(req.view)
  },
)
// Only the active instance owns the shared footer bridge: it publishes its open views
// (incl. when it becomes active), and the next active session overwrites them. Cached
// inactive instances never publish, so a switch can't race to an empty state.
watch(
  [openViews, isActive],
  ([v, active]) => {
    if (active) wpBridge.publishOpenViews(v)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (isActive.value) wpBridge.publishOpenViews([])
})
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
  font-weight: 500;
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
/* SSH work banner (ADR 0064): the open-host button + per-session approval selector
   (governs the agent's mutating ssh_exec / ssh_write_file). */
.sshbar {
  margin: 0 14px 8px;
}
.sshbar-open {
  margin: 0 0 6px;
  width: 100%;
}
.sshbar-approval {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}
.sshbar-approval-lbl {
  font-weight: 500;
  color: var(--textMuted);
}
.sshbar-warn {
  margin: 6px 2px 0;
  color: var(--amber);
  line-height: 1.4;
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
/* Floating action bar next to a text selection (anchored to viewport coords). */
.selactions {
  position: fixed;
  z-index: 80;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.selquote {
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
/* Once dragged/resized, anchor by explicit top-left (drop the selection transform). */
.notepop.moved {
  transform: none;
}
.notepop.dragging {
  user-select: none;
}
.npq {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--accent);
  font-size: 0.8462rem;
  cursor: grab;
  touch-action: none;
}
.notepop.dragging .npq {
  cursor: grabbing;
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
/* When the popover has an explicit height (resized), grow the textarea to fill and
   let the popover own the sizing — its own resize handle replaces textarea resize. */
.notepop.moved .npinput {
  flex: 1 1 auto;
  resize: none;
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
/* Bottom-right resize handle (single corner — AN-2 / OQ-B3). */
.npresize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(
    135deg,
    transparent 0 50%,
    var(--border) 50% 60%,
    transparent 60% 75%,
    var(--border) 75% 85%,
    transparent 85%
  );
}
</style>
