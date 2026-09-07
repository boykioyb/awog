<template>
  <Teleport to="body">
    <div class="ovl on bgo-ovl" @click.self="emit('close')">
      <div class="bgo-card" role="dialog" aria-modal="true">
        <div class="bgo-head">
          <Icon name="terminal" class="bgo-hicn" />
          <span class="bgo-title">{{ t('sessionsBg.title') }}</span>
          <span class="bgo-status" :class="`is-${kind}`">{{ statusText }}</span>
          <button
            class="p-1.5 rounded transition bgo-x"
            :title="t('common.close')"
            @click="emit('close')"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="bgo-meta">
          <span class="bgo-k">{{ t('sessionsBg.command') }}</span>
          <code class="bgo-cmd">{{ shell.command }}</code>
          <span class="bgo-k">{{ t('sessionsBg.started') }}</span>
          <span>{{ startedText }}</span>
        </div>

        <div class="bgo-outhd">
          <span class="bgo-k">{{ t('sessionsBg.output') }}</span>
          <button
            v-if="output.text"
            class="p-1.5 rounded transition bgo-x"
            :title="copied ? t('common.copied') : t('common.copy')"
            @click="onCopy"
          >
            <Icon
              :name="copied ? 'check' : 'copy'"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </div>

        <p v-if="output.truncated" class="bgo-note">
          {{ t('sessionsBg.truncated', { kb: droppedKb }) }}
        </p>

        <div v-if="output.loading && !output.text" class="bgo-empty">
          {{ t('sessionsBg.loading') }}
        </div>
        <div v-else-if="output.error" class="bgo-empty is-err">
          {{ t('sessionsBg.error', { msg: output.error }) }}
        </div>
        <pre v-else-if="output.text" class="bgo-out">{{ output.text }}</pre>
        <div v-else class="bgo-empty">{{ emptyText }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Modal xem output của MỘT lệnh chạy nền (ADR 0066). Mở từ chip job nền, dùng chung
// scrim `.ovl` với các modal session khác.
//
// `output` là state do `useSessionBackgroundOutput` fetch từ sidecar (RPC
// `sessions.backgroundRead` đọc file log thật). Rỗng KHÔNG mặc nhiên là lỗi: lệnh
// đang chạy chưa in gì, hoặc job của nhánh Claude SDK vốn không có file log — mỗi
// trường hợp một câu giải thích riêng, chỉ lỗi đọc thật mới tô đỏ.
//
// Output do một tiến trình bất kỳ sinh ra (L1 — không tin): render bằng text node
// (`{{ }}`), tuyệt đối không `v-html`.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { BgOutputState } from '~/composables/useSessionBackgroundOutput'
import type { BgShellState } from '~/stores/sessions'

const props = defineProps<{ shell: BgShellState; output: BgOutputState }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const kind = computed<'running' | 'ok' | 'fail'>(() => {
  if (props.shell.status === 'running') return 'running'
  if (props.shell.status === 'exited' && (props.shell.exitCode ?? 1) === 0) return 'ok'
  return 'fail'
})
const statusText = computed<string>(() => {
  if (props.shell.status === 'running') return t('sessions.bg.running')
  if (props.shell.status === 'exited-unknown') return t('sessions.bg.interrupted')
  return t('sessions.bg.exit', { code: props.shell.exitCode ?? '?' })
})
// startedAt is absent for a shell first seen through session.background-done.
const startedText = computed<string>(() => {
  if (!props.shell.startedAt) return '—'
  const d = new Date(props.shell.startedAt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
})

// Phần đầu log bị cắt, quy ra KB (làm tròn lên để không bao giờ báo "0 KB").
const droppedKb = computed<number>(() => Math.max(1, Math.ceil(props.output.droppedBytes / 1024)))

// Rỗng vì lý do gì — câu chữ khác nhau, không cái nào là lỗi.
const emptyText = computed<string>(() => {
  if (props.output.external) return t('sessionsBg.external')
  if (props.shell.status === 'running') return t('sessionsBg.pending')
  return t('sessionsBg.noOutput')
})

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.output.text)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch (err) {
    console.warn('[sessions] copy background output failed', err)
  }
}

const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
/* Centre the card (the shared .ovl aligns to top for the command palette) and sit
   in the modal band, above the session page chrome. */
.bgo-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 120;
}
.bgo-card {
  width: 720px;
  max-width: 92vw;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.bgo-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.bgo-hicn {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  color: var(--textDim);
}
.bgo-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.bgo-status {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.bgo-status.is-ok {
  border-color: color-mix(in srgb, var(--add) 45%, var(--border));
  color: var(--add);
}
.bgo-status.is-fail {
  border-color: color-mix(in srgb, var(--amber) 45%, var(--border));
  color: var(--amber);
}
.bgo-status.is-running {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
}
.bgo-x {
  color: var(--textDim);
}
.bgo-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.bgo-head .bgo-x {
  margin-left: auto;
}
/* Key / value grid: label column, value column. */
.bgo-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  align-items: baseline;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.bgo-k {
  color: var(--textFaint);
}
.bgo-cmd {
  /* mono-ok: the shell command the user can paste into a terminal */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.bgo-outhd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bgo-outhd .bgo-x {
  margin-left: auto;
}
/* The long part: its own scroll area so the card chrome stays put. */
.bgo-out {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  /* mono-ok: raw stdout+stderr of a shell command */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
/* Ghi chú "log bị cắt" — thông tin, không phải cảnh báo. */
.bgo-note {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.bgo-empty {
  padding: 14px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--textFaint);
}
/* Chỉ lỗi ĐỌC mới tô đỏ; output rỗng đúng bản chất thì không. */
.bgo-empty.is-err {
  border-style: solid;
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
