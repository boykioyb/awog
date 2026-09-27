<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowUp,
  Camera,
  Check,
  File,
  Plus,
  Square,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-vue-next'
import { MAX_ATTACHMENT_BYTES, toAttachment } from '../attachments'
import { AGENT_MODES } from '../catalog'
import { showToast } from '../store'
import { errMsg } from '../util'
import AppSheet from './AppSheet.vue'
import type { AgentMode, SessionAttachment } from '../types'

const props = defineProps<{
  // A turn is in flight: the primary action becomes "steer into the running turn"
  // and a stop button appears (the desktop's send/steer split).
  streaming: boolean
  mode: AgentMode
  disabled?: boolean
  // The desktop's status chips (model · account · effort · style) as one
  // scrollable strip — a tap opens the session menu over the same settings.
  config?: string[]
}>()

const emit = defineEmits<{
  (e: 'send', text: string, attachments: SessionAttachment[]): void
  (e: 'steer', text: string): void
  (e: 'stop'): void
  (e: 'update:mode', mode: AgentMode): void
  (e: 'open-menu'): void
}>()

const MAX_ATTACHMENTS = 4

// Inline base64/text rides in the same WS frame as the message, and the gateway
// caps a frame at 1 MB — budget the whole batch, not just each file.
const payloadBytes = (a: SessionAttachment): number =>
  (a.url?.length ?? 0) + (a.preview?.length ?? 0)

const text = ref('')
const attachments = ref<SessionAttachment[]>([])
const busy = ref(false)
const modeOpen = ref(false)
const attachOpen = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const filePicker = ref<HTMLInputElement | null>(null)
const cameraPicker = ref<HTMLInputElement | null>(null)

const canSend = computed(
  () => !props.disabled && (text.value.trim().length > 0 || attachments.value.length > 0),
)

// Grow with the content up to the CSS max-height, then scroll.
watch(text, () => {
  void nextTick(() => {
    const el = box.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  })
})

function submit(): void {
  if (!canSend.value) return
  const body = text.value
  if (props.streaming) {
    // Steering carries text only — attachments belong to a new turn.
    emit('steer', body)
  } else {
    emit('send', body, attachments.value)
    attachments.value = []
  }
  text.value = ''
}

async function pick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  busy.value = true
  let used = attachments.value.reduce((n, a) => n + payloadBytes(a), 0)
  for (const file of files) {
    if (attachments.value.length >= MAX_ATTACHMENTS) {
      showToast(`Tối đa ${MAX_ATTACHMENTS} tệp đính kèm`)
      break
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps peak memory low on a phone
      const att = await toAttachment(file)
      if (used + payloadBytes(att) > MAX_ATTACHMENT_BYTES) {
        showToast('Tổng dung lượng đính kèm vượt giới hạn một tin nhắn')
        break
      }
      used += payloadBytes(att)
      attachments.value.push(att)
    } catch (e) {
      showToast(errMsg(e))
    }
  }
  busy.value = false
}

function remove(id: string): void {
  attachments.value = attachments.value.filter((a) => a.id !== id)
}

function pickFile(): void {
  attachOpen.value = false
  filePicker.value?.click()
}

function pickCamera(): void {
  attachOpen.value = false
  cameraPicker.value?.click()
}

// Four modes don't fit a toggle, and cycling through them would put `execute`
// (gate off) one stray tap away — so the chip opens a picker that spells out what
// each mode lets the agent do unattended.
const modeRow = computed(() => AGENT_MODES.find((m) => m.id === props.mode))

function pickMode(mode: AgentMode): void {
  modeOpen.value = false
  emit('update:mode', mode)
}
</script>

<template>
  <div class="wrap">
    <div v-if="attachments.length" class="atts">
      <div v-for="a in attachments" :key="a.id" class="att">
        <img v-if="a.type === 'image' && a.url" :src="a.url" alt="" />
        <span v-else class="doc">{{ a.name }}</span>
        <button class="rm" title="Bỏ" aria-label="Bỏ tệp đính kèm" @click="remove(a.id)">
          <X class="icn-xs" />
        </button>
      </div>
    </div>

    <div class="ctx">
      <button
        class="chip"
        :class="[mode, { ungated: modeRow?.ungated }]"
        :title="modeRow?.hint"
        @click="modeOpen = true"
      >
        {{ modeRow?.label ?? mode }}
      </button>
      <button v-if="config?.length" class="cfgs" @click="emit('open-menu')">
        <span class="cfgtxt">{{ config.join(' · ') }}</span>
        <span class="cfg-edit">Đổi</span>
      </button>
      <span v-if="streaming" class="hint muted">Gửi = chen vào lượt đang chạy</span>
    </div>

    <!-- One rounded box, not a pill row: the textarea sits on top, the tool row
         (+ / stop / send) lives inside the same border as the box's footer. -->
    <div class="composer">
      <!-- Enter inserts a NEWLINE (a phone keyboard's return key must not fire a
           turn); ⌘/Ctrl+Enter sends, for when a hardware keyboard is attached. -->
      <textarea
        ref="box"
        v-model="text"
        rows="2"
        enterkeyhint="enter"
        :placeholder="streaming ? 'Chen thêm hướng dẫn…' : 'Nhắn cho agent…'"
        @keydown.enter.meta.prevent="submit"
        @keydown.enter.ctrl.prevent="submit"
      />

      <div class="tools">
        <button
          class="tool"
          title="Đính kèm"
          aria-label="Đính kèm tệp hoặc ảnh"
          :disabled="busy"
          @click="attachOpen = true"
        >
          <span v-if="busy" class="spin" />
          <Plus v-else class="icn-lg" />
        </button>
        <span class="tspace" />
        <button
          v-if="streaming"
          class="tool stop"
          title="Dừng lượt"
          aria-label="Dừng lượt"
          @click="emit('stop')"
        >
          <Square class="icn-sm" fill="currentColor" />
        </button>
        <button
          class="tool send"
          :class="{ steer: streaming }"
          :disabled="!canSend"
          :title="streaming ? 'Chen vào lượt' : 'Gửi'"
          :aria-label="streaming ? 'Chen vào lượt đang chạy' : 'Gửi'"
          @click="submit"
        >
          <Zap v-if="streaming" class="icn-lg" />
          <ArrowUp v-else class="icn-lg" />
        </button>
      </div>
    </div>

    <input
      ref="filePicker"
      type="file"
      accept="image/*,text/*,.md,.json,.log,.yaml,.yml,.ts,.js,.vue,.py,.go,.rs"
      multiple
      hidden
      @change="pick"
    />
    <input ref="cameraPicker" type="file" accept="image/*" capture="environment" hidden @change="pick" />

    <!-- One "+" like iMessage: the attachment picker is an action sheet, not two
         dedicated buttons in the composer. -->
    <AppSheet :open="attachOpen" title="Đính kèm" @close="attachOpen = false">
      <button class="act" @click="pickFile">
        <File class="icn-lg" />
        <span class="act-txt">
          <span class="act-name">Tệp / ảnh</span>
          <span class="act-hint">Ảnh, markdown, log, mã nguồn — tối đa 4 tệp</span>
        </span>
      </button>
      <button class="act" @click="pickCamera">
        <Camera class="icn-lg" />
        <span class="act-txt">
          <span class="act-name">Chụp ảnh</span>
          <span class="act-hint">Camera sau — ảnh mới chụp</span>
        </span>
      </button>
    </AppSheet>

    <AppSheet :open="modeOpen" title="Chế độ" @close="modeOpen = false">
      <button
        v-for="m in AGENT_MODES"
        :key="m.id"
        class="mode-row"
        :class="{ sel: m.id === mode }"
        @click="pickMode(m.id)"
      >
        <span class="mode-name" :class="{ ungated: m.ungated }">
          {{ m.label }}
          <TriangleAlert v-if="m.ungated" class="icn-xs warn-ic" />
        </span>
        <span class="mode-hint">{{ m.hint }}</span>
        <Check v-if="m.id === mode" class="icn-sm mode-tick" />
      </button>
    </AppSheet>
  </div>
</template>

<style scoped>
.wrap {
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
  background: var(--bg);
  /* --sab collapses to 0 while the keyboard is up (viewport.ts) — home-bar
     padding there would just push the composer off-screen. */
  padding-bottom: var(--sab, env(safe-area-inset-bottom));
}
.atts {
  display: flex;
  gap: 8px;
  padding: 8px 12px 0;
  overflow-x: auto;
}
.att {
  position: relative;
  flex-shrink: 0;
}
.att img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  display: block;
}
.doc {
  display: flex;
  align-items: center;
  height: 56px;
  max-width: 140px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* mono-ok: a file name — the user may retype or compare it against a path. */
  font-family: var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The one control that cannot reach 44px on its own: it is a badge floating on a
   56px thumbnail, so a 44px box would cover the image it belongs to. Compromise:
   28px visible, and a transparent ::before that stretches the touch area to 44
   without moving anything. */
.rm {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rm::before {
  content: '';
  position: absolute;
  /* design-token-ok: -8px on each side turns the 28px box into a 44px touch area. */
  inset: -8px;
}
.rm:active {
  background: var(--surface-2);
}
/* One context row instead of the old stack (mode row + config bar): the mode
   chip stays pinned at the left, the config strip scrolls if it overflows. */
.ctx {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 0;
}
/* A mode SELECTOR, not an action — it sits inside the context row, so it reads
   as a 30px label chip. The ::before stretches the touch area back to ~44px so
   shrinking it doesn't cost the tap target. */
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--r-btn);
  padding: 0 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.chip::before {
  content: '';
  position: absolute;
  inset: -7px -4px;
}
.chip:active {
  background: var(--surface-2);
}
.chip.plan {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
/* accept-edits/execute run tools with no approval prompt — the chip has to read
   as a live warning, not a neutral state. */
.chip.ungated {
  color: var(--warn);
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.chip.execute {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}
.cfgs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  padding: 0 2px;
  text-align: left;
}
.cfgs:active {
  opacity: 0.6;
}
.cfgtxt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfg-edit {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
}
.hint {
  flex: 0 0 auto;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.mode-row {
  position: relative;
  display: block;
  width: 100%;
  min-height: var(--tap);
  text-align: left;
  padding: 11px 40px 11px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface-2);
  color: var(--text);
}
.mode-row:active {
  background: var(--surface-3);
}
.mode-row.sel {
  border-color: var(--accent);
}
.mode-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.mode-name.ungated,
.warn-ic {
  color: var(--warn);
}
.mode-hint {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
}
.mode-tick {
  position: absolute;
  top: 14px;
  right: 14px;
  color: var(--accent);
}
/* The composer is ONE bordered box: textarea on top, tool row as its footer.
   56px of textarea minimum keeps the box substantial even when empty. */
.composer {
  display: flex;
  flex-direction: column;
  margin: 8px 12px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-panel);
  background: var(--surface-2);
}
.composer:focus-within {
  border-color: var(--accent);
}
textarea {
  width: 100%;
  /* resize:none on purpose — a phone has no resize gutter, and the box already
     grows with its content (watch on `text` above). */
  resize: none;
  max-height: 140px;
  min-height: 56px;
  border: none;
  background: transparent;
  padding: 12px 14px 4px;
  line-height: var(--lh-md);
}
textarea:focus {
  outline: none;
  border: none;
}
.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 8px;
}
.tspace {
  flex: 1;
}
/* Footer buttons are 36px tall — under --tap — so ::before stretches the touch
   area to 44 without growing the box's footer visually. */
.tool {
  position: relative;
  min-width: 44px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--r-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-dim);
}
.tool::before {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.tool:active {
  background: var(--surface-3);
  color: var(--text);
}
.tool:disabled {
  opacity: 0.45;
}
.send {
  background: var(--accent);
  color: var(--on-accent);
}
.send.steer {
  background: var(--warn);
  color: var(--on-warn);
}
.send:active {
  background: var(--accent);
  color: var(--on-accent);
  opacity: 0.7;
}
.send:disabled {
  opacity: 0.4;
}
.stop {
  border: 1px solid var(--danger);
  color: var(--danger);
}
/* Attachment action-sheet rows. */
.act {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap);
  padding: 11px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface-2);
  color: var(--text);
  text-align: left;
}
.act:active {
  background: var(--surface-3);
}
.act .lucide {
  color: var(--accent);
  flex-shrink: 0;
}
.act-txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.act-name {
  font-weight: 600;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.act-hint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
}
</style>
