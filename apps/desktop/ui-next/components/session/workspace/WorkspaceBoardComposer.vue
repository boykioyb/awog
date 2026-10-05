<template>
  <!-- Ô giao việc của board — clone của SessionComposer ở mức lõi: cùng card
       .cbox, textarea .ci, chip đính kèm .att, thanh .cbar (menu `+` → Attach /
       chèn `/` / `@`) và hai menu autocomplete thật. Không có mode/model/queue
       vì đây là giao việc một lần, không phải lượt chat của phiên đang mở. -->
  <div class="bcomp">
    <div
      class="cresize"
      :class="{ drag: resizing }"
      :title="t('sessions.composer.resize')"
      @pointerdown="onResize"
    />
    <div
      class="cbox"
      :class="{ dragover }"
      @dragover.prevent="dragover = true"
      @dragleave.self="dragover = false"
      @drop.prevent="onDrop"
    >
      <!-- slash `/` (commands + skills) + `@`-mention (agents/skills/wiki/files) -->
      <SessionSlashMenu
        v-if="autocomplete === 'slash'"
        :items="slashMatches"
        :active="acIndex"
        @select="applySlash"
        @hover="(i) => (acIndex = i)"
      />
      <SessionMentionMenu
        v-else-if="autocomplete === 'mention'"
        :items="mentionMatches"
        :active="acIndex"
        @select="applyMention"
        @hover="(i) => (acIndex = i)"
      />

      <!-- Notice thoáng (vd. dán bị cắt) — cùng khuôn .cmdnotice của session. -->
      <div v-if="commandNotice" class="cmdnotice">{{ commandNotice }}</div>

      <!-- Chip đính kèm ngay trên textarea — cùng markup SessionComposer. -->
      <div v-if="attachments.length" class="attc pattc">
        <span
          v-for="(a, i) in visibleAtt"
          :key="i"
          class="att"
          :title="t('sessions.attachment.preview')"
          :style="{ cursor: 'pointer', paddingLeft: a.img ? '5px' : undefined }"
          @click="previewAtt(i)"
        >
          <img v-if="a.img && a.src" :src="a.src" class="attthumb" :alt="a.name" />
          <span v-else-if="a.img" class="thumb" />
          <Folder v-else-if="a.folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
          <FileText v-else style="width: var(--icon-xs); height: var(--icon-xs)" />
          <span class="attn">{{ a.name }}</span>
          <span
            class="x"
            :title="t('sessions.attachment.remove')"
            @click.stop="emit('remove-att', i)"
          >
            ×
          </span>
        </span>
        <span
          v-if="overflowCount"
          class="att attmore"
          :title="t('sessions.attachment.allTitle', { n: attachments.length })"
          @click="showAllAtt = !showAllAtt"
        >
          {{ showAllAtt ? '−' : t('sessions.attachment.more', { n: overflowCount }) }}
        </span>
      </div>

      <textarea
        ref="ta"
        v-model="draft"
        class="ci"
        rows="1"
        :disabled="disabled"
        :placeholder="placeholder"
        @input="onInput"
        @keydown.down="onAcArrow($event, 1)"
        @keydown.up="onAcArrow($event, -1)"
        @keydown.esc="onEsc"
        @keydown.enter="onEnter"
        @paste="onPaste"
      />

      <div class="cbar">
        <!-- Menu `+` y hệt session: Attach mở file picker, `/` và `@` gõ sẵn
             trigger để menu autocomplete tự mở — một nguồn duy nhất. -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="iconSm"
              class="cico"
              :title="t('sessions.composer.attach')"
              :aria-label="t('sessions.composer.attach')"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-56">
            <DropdownMenuLabel>{{ t('sessions.composer.attachTitle') }}</DropdownMenuLabel>
            <DropdownMenuItem @click="emit('pick')">
              <Paperclip />
              {{ t('sessions.composer.attach') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{{ t('sessions.composer.insert') }}</DropdownMenuLabel>
            <DropdownMenuItem @click="insertSlash">
              <span class="cmat">/</span>
              {{ t('sessions.composer.slashCommands') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="insertMention">
              <span class="cmat">@</span>
              {{ t('sessions.composer.mentionTitle') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span class="csep" />
        <span class="grow1" />
        <span class="ccount">{{ draft.length }}</span>
        <!-- Nút send — chỉ bề mặt CHAT (thread) truyền `show-send`; ô brief của
             tab General không có vì dispatch là nút "Giao việc" ở footer modal. -->
        <Button
          v-if="showSend"
          :disabled="disabled || !hasContent"
          :title="t('sessions.composer.send')"
          class="cicon"
          variant="default"
          size="iconSm"
          @click="submit"
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Composer giao việc của board — tái dùng NGUYÊN cỗ máy của SessionComposer:
//   • catalogs `/` (commands + skills) và `@` (agents/skills/wiki/files) qua
//     useComposerData, scoped theo projectId đích của item;
//   • chip đính kèm + paste ảnh/paste-as-file (cùng hằng ATTACHMENT_TEXT_MAX);
//   • preview chip qua usePreview (modal preview chung toàn app);
//   • slash `/cmd args` bung thành body khi Giao (expanded() — cha gọi).
// Khác biệt có chủ đích: không built-in command (/compact, /mode… — đó là hành
// động của một phiên đang chạy), không CLI commands (provider của phiên đích
// chưa biết lúc soạn), không model/mode/queue. Nút send ở .cbar là OPT-IN qua
// prop `show-send`: thread chat bật (giống SessionComposer); ô brief "giao
// việc" của editor tắt vì dispatch là nút "Giao việc" ở footer modal — một nút
// send ở đó bị hiểu nhầm là hành động thứ hai.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { FileText, Folder, Paperclip, Plus, SendHorizontal } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useSettingsStore } from '~/stores/settings'
import { useWikiStore } from '~/stores/wiki'
import { useComposerData } from '~/composables/useComposerData'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import {
  imageSiblingsFromAttachments,
  previewRefFromAttachment,
  usePreview,
} from '~/composables/usePreview'
import type { SessionAttachment } from '~/composables/useSessionsData'
import type { MentionRow, SlashItem } from '../session-composer-commands'
import SessionSlashMenu from '../SessionSlashMenu.vue'
import SessionMentionMenu from '../SessionMentionMenu.vue'
import Button from '~/components/ui/button/Button.vue'
import {
  expandCommandBody,
  findInvocableCommand,
  parseSlashInvocation,
} from '~/utils/slash-command'

const props = withDefaults(
  defineProps<{
    // Project đích của item — scope cho catalog agent/skill/command + file
    // index + wiki tier. '' = chỉ global (create mode chưa chọn project).
    projectId: string
    placeholder: string
    attachments?: SessionAttachment[]
    disabled?: boolean
    // Hiện nút send ở .cbar — bề mặt chat (thread) cần nó giống SessionComposer;
    // ô "brief giao việc" của editor thì không (dispatch nằm ở footer modal).
    showSend?: boolean
  }>(),
  { attachments: () => [], disabled: false, showSend: false },
)
const emit = defineEmits<{
  pick: []
  'add-att': [att: SessionAttachment]
  'add-files': [files: FileList | File[]]
  'remove-att': [i: number]
  // Chord gửi (Enter / Shift+Enter theo composerSendKey) → cha chạy nhịp mặc
  // định = "Xếp vào backlog" (đỗ spec, spawn khi item được bốc).
  submit: []
}>()

const draft = defineModel<string>({ default: '' })

const { t } = useI18n()
const settings = useSettingsStore()
const wiki = useWikiStore()
const { open: openPreview } = usePreview()
const ta = useTemplateRef<HTMLTextAreaElement>('ta')

// Catalogs thật — CLI catalogue không truyền (arg optional): phiên đích chưa
// biết provider nên section đó không bao giờ được request.
const projectIdRef = computed(() => props.projectId || null)
const data = useComposerData(projectIdRef)
const wikiPagesInScope = computed(() => wiki.pages.filter((p) => p.context))

// ── Chip đính kèm: cap 6 inline, phần dư gom vào "+N" (toggle inline — board
// không có modal danh sách như session). ──
const MAX_INLINE = 6
const showAllAtt = ref(false)
const visibleAtt = computed(() =>
  showAllAtt.value ? props.attachments : props.attachments.slice(0, MAX_INLINE),
)
const overflowCount = computed(() => Math.max(0, props.attachments.length - MAX_INLINE))

function previewAtt(i: number) {
  const a = props.attachments[i]
  if (!a) return
  openPreview(previewRefFromAttachment(a), imageSiblingsFromAttachments(props.attachments))
}

// ── Autocomplete: `/` (commands + skills) + `@` (agents/skills/wiki/files) ──
// Nguyên tắc giữ y SessionComposer: trigger theo caret, mũi tên ↑↓ điều hướng,
// Enter accept khi menu mở, Esc đóng menu (và chặn đóng modal khi còn menu).
type Autocomplete = 'slash' | 'mention' | null
const autocomplete = ref<Autocomplete>(null)
const acIndex = ref(0)
const mentionQuery = ref('')
const RESULT_CAP = 80
const SLASH_RESULT_CAP = 240
// Wiki chỉ nạp khi menu @ mở lần đầu — khỏi fetch khi người dùng chỉ gõ chữ.
let wikiLoaded = false

function caretText(): string {
  const el = ta.value
  const v = draft.value
  if (!el) return v
  const pos = el.selectionStart ?? v.length
  return v.slice(0, pos)
}

// In-scope: global luôn; project entries chỉ khi cùng project đích.
function inScope(source: 'global' | 'project' | undefined, projId: string | undefined): boolean {
  if ((source ?? 'global') === 'global') return true
  return !!projectIdRef.value && projId === projectIdRef.value
}

const agentHandle = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

const slashMatches = computed<SlashItem[]>(() => {
  if (autocomplete.value !== 'slash') return []
  const q = draft.value.slice(1).toLowerCase().split(/\s/)[0] ?? ''
  const cmds: SlashItem[] = data.userCommands.value
    .filter(
      (c) =>
        c.enabled !== false &&
        inScope(c.source, c.projectId) &&
        (q === '' || c.id.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)),
    )
    .map((c) => ({ key: `c:${c.id}`, label: c.id, desc: c.description, kind: 'command' }))
  const sk: SlashItem[] = data.skills.value
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (q === '' || s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)),
    )
    .map((s) => ({ key: `s:${s.id}`, label: s.id, desc: s.description, kind: 'skill' }))
  return [...cmds, ...sk].slice(0, SLASH_RESULT_CAP)
})

const mentionMatches = computed<MentionRow[]>(() => {
  if (autocomplete.value !== 'mention') return []
  const q = mentionQuery.value.toLowerCase()
  const unprefixed = (prefix: string) => (q.startsWith(prefix) ? q.slice(prefix.length) : q)
  const qSkill = unprefixed('skill:')
  const qWiki = unprefixed('wiki:')
  const agents: MentionRow[] = data.agents.value
    .filter(
      (a) =>
        inScope(a.source, a.projectId) &&
        (q === '' || agentHandle(a.name).startsWith(q) || a.name.toLowerCase().includes(q)),
    )
    .map((a) => ({
      key: `a:${a.id}`,
      kind: 'agent',
      insert: agentHandle(a.name),
      label: a.name,
      hint: a.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  // Team spec cũng là đích @ hợp lệ trên board: comment đánh thức được spec
  // (boards.comment materialize thành run mới) — liệt kê để người dùng khỏi
  // nhớ slug. Slug cùng luật agentHandle.
  const teams: MentionRow[] = (data.teams?.value ?? [])
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (q === '' || agentHandle(s.name).startsWith(q) || s.name.toLowerCase().includes(q)),
    )
    .map((s) => ({
      key: `t:${s.id}`,
      kind: 'team',
      insert: agentHandle(s.name),
      label: s.name,
      hint: s.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  const skills: MentionRow[] = data.skills.value
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (qSkill === '' ||
          s.id.toLowerCase().startsWith(qSkill) ||
          s.name.toLowerCase().includes(qSkill)),
    )
    .map((s) => ({
      key: `s:${s.source}:${s.id}`,
      kind: 'skill',
      insert: `skill:${s.id}`,
      label: s.id,
      hint: s.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  const wikiRows: MentionRow[] = wikiPagesInScope.value
    .filter(
      (w) =>
        qWiki === '' ||
        w.title.toLowerCase().includes(qWiki) ||
        w.path.toLowerCase().includes(qWiki),
    )
    .map((w) => ({
      key: `w:${w.source}:${w.path}`,
      kind: 'wiki',
      insert: `wiki:${w.path}`,
      label: w.title,
      hint: w.path,
    }))
  const matched = data.files.value.filter(
    (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
  )
  const ranked = q
    ? [...matched].sort((a, b) => {
        const an = a.name.toLowerCase().includes(q) ? 0 : 1
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1
        return an - bn || a.path.localeCompare(b.path)
      })
    : matched
  const files: MentionRow[] = ranked.map((f) => ({
    key: `f:${f.path}`,
    kind: 'file',
    insert: f.path,
    label: f.name,
    hint: f.path,
  }))
  return [...agents, ...teams, ...skills, ...wikiRows, ...files].slice(0, RESULT_CAP)
})

function refreshAutocomplete() {
  const v = draft.value
  if (v.startsWith('/')) {
    data.ensureCatalogs()
    autocomplete.value = 'slash'
    if (acIndex.value >= slashMatches.value.length) acIndex.value = 0
    if (!slashMatches.value.length) autocomplete.value = null
    return
  }
  const m = /(^|\s)@([\w./:-]*)$/.exec(caretText())
  if (m) {
    data.ensureCatalogs()
    data.ensureFiles()
    // Wiki pages của scope đích — nạp một lần mỗi lần mount (store cache chia
    // sẻ; reload trả pages theo projectIds của board, KHÔNG theo session).
    if (!wikiLoaded) {
      wikiLoaded = true
      void wiki.loadTree(projectIdRef.value ? [projectIdRef.value] : [])
    }
    mentionQuery.value = m[2] ?? ''
    autocomplete.value = 'mention'
    if (acIndex.value >= mentionMatches.value.length) acIndex.value = 0
    if (!mentionMatches.value.length) autocomplete.value = null
    return
  }
  autocomplete.value = null
}
function closeAutocomplete() {
  autocomplete.value = null
  acIndex.value = 0
}
function onInput() {
  grow()
  acIndex.value = 0
  refreshAutocomplete()
}
function onAcArrow(e: KeyboardEvent, dir: 1 | -1) {
  if (!autocomplete.value) return
  const len =
    autocomplete.value === 'slash' ? slashMatches.value.length : mentionMatches.value.length
  if (!len) return
  e.preventDefault()
  acIndex.value = (acIndex.value + dir + len) % len
}
function acceptActive() {
  if (autocomplete.value === 'slash') applySlash(acIndex.value)
  else if (autocomplete.value === 'mention') applyMention(acIndex.value)
}
function applySlash(i: number) {
  const item = slashMatches.value[i]
  if (!item) return
  const rest = draft.value.replace(/^\/\S*\s?/, '')
  draft.value = `/${item.label} ${rest}`.trimEnd() + (rest ? '' : ' ')
  closeAutocomplete()
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}
function applyMention(i: number) {
  const item = mentionMatches.value[i]
  if (!item) return
  draft.value = draft.value.replace(
    /(^|\s)@([\w./:-]*)$/,
    (_m, pre: string) => `${pre}@${item.insert} `,
  )
  closeAutocomplete()
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}

// Esc: menu mở → đóng menu và NUỐT sự kiện (modal cha có Esc-to-close).
function onEsc(e: KeyboardEvent) {
  if (autocomplete.value) {
    e.stopPropagation()
    closeAutocomplete()
  }
}

// Chord gửi theo Settings → Defaults → composerSendKey — y hệt session.
function onEnter(e: KeyboardEvent) {
  if (autocomplete.value && !e.shiftKey) {
    e.preventDefault()
    acceptActive()
    return
  }
  const sendOnShiftEnter = settings.appearance.composerSendKey === 'shift-enter'
  const isSendChord = sendOnShiftEnter ? e.shiftKey : !e.shiftKey
  if (!isSendChord) return
  e.preventDefault()
  submit()
}
// Gửi được khi có text HOẶC chỉ có đính kèm (post của thread cho phép atts-only).
const hasContent = computed(() => !!draft.value.trim() || !!props.attachments.length)
function submit() {
  if (props.disabled || !hasContent.value) return
  closeAutocomplete()
  emit('submit')
}

// `/cmd args` → body đã bung (cha chèn vào tin giao). Không bung thì trả raw —
// lệnh lạ đi nguyên như văn bản.
function expanded(): string {
  const raw = draft.value
  const inv = parseSlashInvocation(raw)
  if (!inv) return raw
  const cmd = findInvocableCommand(data.userCommands.value, inv.name, projectIdRef.value)
  if (!cmd) return raw
  return expandCommandBody(cmd.body, inv.args)
}

// ── `+` menu → Insert (proto parity) ──
function refocusDraft() {
  setTimeout(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    onInput()
  }, 0)
}
function insertSlash() {
  draft.value = draft.value.startsWith('/') ? draft.value : `/${draft.value}`
  refocusDraft()
}
function insertMention() {
  draft.value += /(^|\s)$/.test(draft.value) ? '@' : ' @'
  refocusDraft()
}

// ── Chiều cao: auto-grow tới trần 40vh + kéo tay bằng handle .cresize — cùng
// cặp MIN/MAX với SessionComposer để hai bề mặt đồng nhất. ──
const COMPOSER_MIN_H = 52
const composerMaxH = ref(Math.round(window.innerHeight * 0.4))
const composerH = ref(COMPOSER_MIN_H)
const userSizedManually = ref(false)
const resizing = ref(false)
function grow() {
  const el = ta.value
  if (!el) return
  if (userSizedManually.value) {
    el.style.height = `${Math.min(Math.max(composerH.value, COMPOSER_MIN_H), composerMaxH.value)}px`
    return
  }
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_H), composerMaxH.value)}px`
}
function onResize(e: PointerEvent) {
  e.preventDefault()
  resizing.value = true
  const el = ta.value
  const startH = el
    ? Math.min(Math.max(el.offsetHeight, COMPOSER_MIN_H), composerMaxH.value)
    : composerH.value
  composerH.value = startH
  userSizedManually.value = true
  const startY = e.clientY
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    composerH.value = Math.min(
      Math.max(COMPOSER_MIN_H, startH - (ev.clientY - startY)),
      composerMaxH.value,
    )
    grow()
  }
  const up = () => {
    resizing.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function onWindowResize() {
  composerMaxH.value = Math.round(window.innerHeight * 0.4)
  composerH.value = Math.min(composerH.value, composerMaxH.value)
  grow()
}
onMounted(() => {
  grow()
  window.addEventListener('resize', onWindowResize)
  ta.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

// ── Notice thoáng (paste truncated…) ──
const commandNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(msg: string) {
  commandNotice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    commandNotice.value = null
  }, 4000)
}
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})

// ── Kéo-thả file lên card → đính kèm (cha addFiles qua useComposerAttachments). ──
const dragover = ref(false)
function onDrop(e: DragEvent) {
  dragover.value = false
  const files = e.dataTransfer?.files
  if (files?.length) emit('add-files', files)
}

// ── Clipboard paste → attachment (y hệt SessionComposer) ──
const byteLen = (s: string): number => new TextEncoder().encode(s).length
function onPaste(e: ClipboardEvent) {
  const clipboard = e.clipboardData
  if (!clipboard) return

  let handledImage = false
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    handledImage = true
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) return
      const ext = file.type.split('/')[1] || 'png'
      const att: SessionAttachment = {
        name: file.name || `pasted-${Date.now()}.${ext}`,
        img: true,
        dataUrl,
        src: dataUrl,
        mime: file.type,
        size: file.size,
      }
      emit('add-att', att)
    }
    reader.readAsDataURL(file)
  }
  if (handledImage) return

  if (!settings.sessions.pasteAsFile) return
  const text = clipboard.getData('text/plain')
  if (!text || text.length < settings.sessions.pasteThreshold) return
  e.preventDefault()
  const value = text.slice(0, ATTACHMENT_TEXT_MAX)
  const truncated = value.length < text.length
  const index = props.attachments.filter((a) => a.name.startsWith('pasted-text-')).length + 1
  const att: SessionAttachment = {
    name: `pasted-text-${index}.txt`,
    img: false,
    text: value,
    mime: 'text/plain',
    size: byteLen(value),
  }
  emit('add-att', att)
  if (truncated) showNotice(t('sessions.composer.pasteTruncated'))
}

defineExpose({
  focus: () => ta.value?.focus(),
  // Text đã bung slash — cha đọc lúc Giao (v-model vẫn giữ raw draft).
  expanded,
})
</script>

<style scoped>
/* Frame ngoài: bỏ border-top/padding của `.composer` (đó là strip đáy màn
   session) — trong modal, card .cbox tự nổi giữa các field. Chiều cao ta do
   grow()/onResize ghi inline, giống session. */
.bcomp .cbox {
  max-width: none;
}
.bcomp .cbox.dragover {
  outline: 2px dashed var(--accent);
  outline-offset: -5px;
}
</style>
