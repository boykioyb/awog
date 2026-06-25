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
        <span class="dsep">/</span>
        <span class="dttitle">{{ session.title }}</span>
      </div>
      <span style="flex: 1" />

      <span
        class="ctxmini chipbtn"
        :title="t('sessions.detail.contextUsage')"
        style="cursor: pointer; position: relative"
        @click.stop="openMenu('usage')"
      >
        <span class="ctxbar">
          <i class="i2" :style="{ width: `${cache}%` }" />
          <i class="i1" :style="{ width: `${inp}%` }" />
          <i class="i3" :style="{ width: `${out}%` }" />
        </span>
        <span class="ctxn">{{ tokLabel }}/200k</span>

        <div
          v-if="menu === 'usage'"
          class="pop"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div class="pr2">
            <div class="pl">
              <span>{{ t('sessions.detail.contextUsage') }}</span>
              <span class="ctxn">{{ tokLabel }}/200k</span>
            </div>
            <span class="ctxbar" style="width: 100%; height: 8px">
              <i class="i1" :style="{ width: `${pct * 0.12}%` }" />
              <i class="i2" :style="{ width: `${pct * 0.66}%` }" />
              <i class="i3" :style="{ width: `${pct * 0.22}%` }" />
            </span>
            <div style="margin-top: 9px; display: flex; flex-direction: column; gap: 5px">
              <div
                v-for="row in usageRows"
                :key="row.label"
                style="display: flex; align-items: center; gap: 7px; font-size: 0.8846rem"
              >
                <span
                  style="width: 8px; height: 8px; border-radius: 2px"
                  :style="{ background: row.color }"
                />
                {{ row.label }}
                <span style="margin-left: auto; font-family: var(--code); color: var(--textDim)">
                  {{ kfmt(row.tok) }}
                </span>
              </div>
            </div>
          </div>
          <div class="pr2">
            <div class="pl">
              <span>Plan usage · {{ provider }}</span>
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
      <button
        class="iconbtn"
        :title="t('sessions.detail.workspacePanel')"
        style="width: 28px; height: 28px"
        :style="wpOpen ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' } : {}"
        @click="wpOpen = !wpOpen"
      >
        <Icon name="workflows" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.detail.delete')"
        style="width: 28px; height: 28px"
        @click="store.remove(session.id)"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="chatwrap">
      <div class="chat" @mouseup="onSelectQuote" @mousedown="quoteSel = null">
        <SessionTodoPanel
          v-if="session.todos && session.todos.length"
          :todos="session.todos"
          @toggle="(i) => store.toggleTodo(session.id, i)"
        />
        <SessionTranscript :messages="session.msgs" :fallback-when="session.when" />
        <SessionComposer
          :attachments="pendingAtt"
          @send="onSend"
          @pick="openPicker"
          @remove-att="removeAtt"
          @add-att="onAddAtt"
          @preview="previewAtt"
          @open-more="moreOpen = true"
        />
      </div>
      <template v-if="wpOpen">
        <div class="rszwp" :class="{ drag: wpDragging }" @pointerdown="onWpResize" />
        <SessionWorkspacePanel :session="session" :width="wpWidth" @close="wpOpen = false" />
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
import type { Session, SessionAttachment } from '~/composables/useSessionsMock'
import PreviewModal, { type PreviewItem } from '~/components/common/PreviewModal.vue'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { providerOf, CIRCLED } = useSessionsMock()
const { projects, projectName } = useProjects()
const store = useSessionsStore()

// Single popover open at a time (project switcher · usage · config). The shared
// backdrop closes whichever is open.
type Menu = 'proj' | 'usage' | 'config'
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
function onSend(text: string) {
  store.sendMessage(props.session.id, text, pendingAtt.value)
  pendingAtt.value = []
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
        if (a) a.text = tx.slice(0, 20000)
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
type SelQuote = { text: string; src: number; x: number; y: number; range: Range }
// shallowRef so the DOM Range isn't deep-unwrapped by reactivity (keeps it a Range).
const quoteSel = shallowRef<SelQuote | null>(null)
const notePop = shallowRef<SelQuote | null>(null)
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
    range: range.cloneRange(),
  }
}
// Quote button → open the note popover at the same spot (keeps the captured range).
function openNote() {
  if (!quoteSel.value) return
  notePop.value = { ...quoteSel.value }
  noteText.value = ''
  quoteSel.value = null
}
// Save → add the follow-up (with note) + mark the selection in place with its number.
function saveQuote() {
  const np = notePop.value
  if (!np) return
  const idx = store.active?.followups?.length ?? 0
  store.addQuote(props.session.id, np.src, np.text, noteText.value.trim())
  markRange(np.range, idx)
  window.getSelection()?.removeAllRanges()
  notePop.value = null
  noteText.value = ''
}
// Wrap the saved range in a coloured <mark> + a circled number (visual marker).
function markRange(range: Range, idx: number) {
  try {
    const mark = document.createElement('mark')
    mark.className = 'qmark'
    mark.appendChild(range.extractContents())
    const sup = document.createElement('sup')
    sup.className = 'qnum'
    sup.textContent = CIRCLED[idx] ?? `${idx + 1}`
    mark.appendChild(sup)
    range.insertNode(mark)
  } catch {
    // Selection crossed element boundaries we can't cleanly wrap — skip the mark.
  }
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

const wpOpen = ref(false)
const {
  width: wpWidth,
  dragging: wpDragging,
  onPointerDown: onWpResize,
} = useResizable(322, { min: 240, max: 560, edge: 'left' })

// tokN (~1235): chars/3 over messages; pct against a 2000-char baseline (≈200k tok).
const totalTok = computed(() => {
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
const tokLabel = computed(() =>
  totalTok.value > 999 ? `${(totalTok.value / 1000).toFixed(0)}k` : String(totalTok.value),
)
const pct = computed(() => Math.min(100, totalTok.value / 2000))
const cache = computed(() => Math.round(pct.value * 0.66))
const inp = computed(() => Math.round(pct.value * 0.12))
const out = computed(() => pct.value - cache.value - inp.value)

// Compact token formatter (kfmt ~1234): 1.2k / 999.
const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))

// Usage breakdown rows (ctxPop ~1297) — proportional split of the context window.
const usageRows = computed(() => [
  { label: 'Input', tok: Math.round(totalTok.value * 0.12), color: 'var(--accent)' },
  { label: 'Cache read', tok: Math.round(totalTok.value * 0.6), color: 'var(--blue)' },
  { label: 'Cache write', tok: Math.round(totalTok.value * 0.06), color: 'var(--blue)' },
  { label: 'Output', tok: Math.round(totalTok.value * 0.22), color: 'var(--violet)' },
])

// Plan rate-limit rows (ctxPop ~1300) — mock, provider-shaped.
const provider = computed(() => providerOf(props.session.account))
type RateLimit = { label: string; used: number; reset: string }
const rateLimits = computed<RateLimit[]>(() => {
  if (provider.value === 'OpenAI') {
    return [
      { label: '5-hour limit', used: 0.34, reset: '4h 02m' },
      { label: 'Weekly · all', used: 0.51, reset: '5d 1h' },
    ]
  }
  if (provider.value === 'Google') {
    return [
      { label: 'RPM', used: 0.18, reset: '—' },
      { label: 'RPD', used: 0.44, reset: '9h' },
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
</style>
