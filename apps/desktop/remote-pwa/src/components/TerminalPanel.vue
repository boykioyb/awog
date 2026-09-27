<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Play, Square, TerminalSquare } from 'lucide-vue-next'
import { ensureTerminal, termKill, termWrite, type TermState } from '../terminal'
import { errMsg } from '../util'

// Session-scoped PTY viewer+writer: output streams in through terminal.data
// events (subscription the session already holds), input goes back via
// terminal.write. Creating a terminal needs the desktop's unattended switch —
// the gateway rejects with a clear message otherwise, which becomes our empty
// state.

const props = defineProps<{ sessionId: string; projectId: string }>()

const term = ref<TermState | null>(null)
const loadError = ref('')
const loading = ref(true)
const input = ref('')
const scroller = ref<HTMLElement | null>(null)

const out = computed(() => term.value?.out ?? '')

function scrollToEnd(): void {
  void nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(out, scrollToEnd)

async function open(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    term.value = await ensureTerminal(props.projectId, props.sessionId)
    scrollToEnd()
  } catch (e) {
    loadError.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

function sendLine(): void {
  const t = term.value
  if (!t || t.exited || !input.value.trim()) return
  termWrite(t, input.value + '\n')
  input.value = ''
}

function ctrlC(): void {
  const t = term.value
  if (t && !t.exited) termWrite(t, '\x03')
}

function restart(): void {
  const t = term.value
  if (t) termKill(t)
  term.value = null
  void open()
}

onMounted(() => void open())
</script>

<template>
  <div class="termpanel">
    <div v-if="loading" class="state"><span class="spin" /> Đang mở terminal…</div>
    <div v-else-if="loadError" class="state-block">
      <TerminalSquare class="icn-xl muted-ic" />
      <p class="muted">{{ loadError }}</p>
      <button class="retry" @click="open">Thử lại</button>
    </div>
    <template v-else-if="term">
      <pre ref="scroller" class="term">{{ out || '— terminal sẵn sàng —' }}</pre>
      <div class="tbar">
        <button
          class="tkey"
          title="Ctrl-C"
          aria-label="Gửi Ctrl-C"
          :disabled="term.exited"
          @click="ctrlC"
        >
          ^C
        </button>
        <input
          v-model="input"
          class="tinput"
          :placeholder="term.exited ? 'Process đã thoát' : 'Lệnh…'"
          :disabled="term.exited"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="send"
          @keydown.enter.prevent="sendLine"
        />
        <button
          v-if="!term.exited"
          class="tkey danger"
          title="Kết thúc terminal"
          aria-label="Kết thúc terminal"
          @click="restart"
        >
          <Square class="icn-sm" fill="currentColor" />
        </button>
        <button v-else class="tkey accent" title="Mở terminal mới" @click="restart">
          <Play class="icn-sm" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.termpanel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.term {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  background: var(--surface);
  /* mono-ok: terminal output — alignment IS the information. */
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  -webkit-overflow-scrolling: touch;
}
.tbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  padding-bottom: calc(8px + var(--sab, env(safe-area-inset-bottom)));
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.tinput {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--surface-2);
  padding: 0 12px;
  /* mono-ok: a shell command line. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.tinput:focus {
  border-color: var(--accent);
  outline: none;
}
.tkey {
  position: relative;
  min-width: 44px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tkey:active {
  background: var(--surface-2);
}
.tkey.danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}
.tkey.accent {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
.tkey:disabled {
  opacity: 0.4;
}
.state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--text-dim);
}
.state-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.muted-ic {
  color: var(--text-faint);
}
.retry {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--surface-2);
  color: var(--accent);
  font-weight: 600;
  min-height: 36px;
  padding: 0 16px;
}
</style>
