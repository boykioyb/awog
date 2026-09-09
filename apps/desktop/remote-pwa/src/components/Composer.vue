<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Camera, Check, Plus, Square, TriangleAlert, X, Zap } from 'lucide-vue-next'
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
}>()

const emit = defineEmits<{
  (e: 'send', text: string, attachments: SessionAttachment[]): void
  (e: 'steer', text: string): void
  (e: 'stop'): void
  (e: 'update:mode', mode: AgentMode): void
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

    <div class="bar">
      <button
        class="chip"
        :class="[mode, { ungated: modeRow?.ungated }]"
        :title="modeRow?.hint"
        @click="modeOpen = true"
      >
        {{ modeRow?.label ?? mode }}
      </button>
      <span v-if="streaming" class="hint muted">Gửi = chen vào lượt đang chạy</span>
    </div>

    <div class="composer">
      <button
        class="icon"
        title="Đính kèm"
        aria-label="Đính kèm tệp"
        :disabled="busy"
        @click="filePicker?.click()"
      >
        <span v-if="busy" class="spin" />
        <Plus v-else class="icn-lg" />
      </button>
      <button
        class="icon"
        title="Chụp ảnh"
        aria-label="Chụp ảnh"
        :disabled="busy"
        @click="cameraPicker?.click()"
      >
        <Camera class="icn-lg" />
      </button>

      <!-- Enter inserts a NEWLINE (a phone keyboard's return key must not fire a
           turn); ⌘/Ctrl+Enter sends, for when a hardware keyboard is attached. -->
      <textarea
        ref="box"
        v-model="text"
        rows="1"
        enterkeyhint="enter"
        :placeholder="streaming ? 'Chen thêm hướng dẫn…' : 'Nhắn cho agent…'"
        @keydown.enter.meta.prevent="submit"
        @keydown.enter.ctrl.prevent="submit"
      />

      <button
        v-if="streaming"
        class="stop"
        title="Dừng lượt"
        aria-label="Dừng lượt"
        @click="emit('stop')"
      >
        <Square class="icn-sm" fill="currentColor" />
      </button>
      <button
        class="send"
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

    <input
      ref="filePicker"
      type="file"
      accept="image/*,text/*,.md,.json,.log,.yaml,.yml,.ts,.js,.vue,.py,.go,.rs"
      multiple
      hidden
      @change="pick"
    />
    <input ref="cameraPicker" type="file" accept="image/*" capture="environment" hidden @change="pick" />

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
  border-radius: 50%;
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
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--r-pill);
  padding: 0 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
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
.hint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px 10px;
}
textarea {
  flex: 1;
  /* resize:none on purpose — a phone has no resize gutter, and the box already
     grows with its content (watch on `text` above). */
  resize: none;
  max-height: 140px;
  min-height: var(--tap);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-panel);
  padding: 10px 14px;
  line-height: var(--lh-md);
}
textarea:focus {
  border-color: var(--accent);
}
.icon {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
}
.icon:active {
  color: var(--text);
}
.icon:disabled {
  opacity: 0.45;
}
.send,
.stop {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.send:active,
.stop:active {
  opacity: 0.6;
}
.send {
  background: var(--accent);
  color: var(--on-accent);
}
.send.steer {
  background: var(--warn);
  color: var(--on-warn);
}
.send:disabled {
  opacity: 0.4;
}
.stop {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
}
</style>
