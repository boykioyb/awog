<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent
      class="flex max-h-[78vh] w-[92vw] max-w-180 flex-col gap-3 rounded-lg bg-popover px-4.5 pt-4 pb-4.5 sm:max-w-180"
      :aria-describedby="undefined"
    >
      <!-- Nút đóng (✕) do DialogContent tự vẽ ở góc phải-trên; pr-8 chừa chỗ cho nó. -->
      <div class="flex items-center gap-2 pr-8">
        <Icon name="terminal" class="size-4 shrink-0 text-muted-foreground" />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ t('sessionsBg.title') }}
        </DialogTitle>
        <Badge
          variant="outline"
          class="rounded-sm px-2 py-px text-sm font-normal"
          :class="
            kind === 'ok'
              ? 'border-success/45 text-success'
              : kind === 'fail'
                ? 'border-destructive/45 text-destructive'
                : 'border-primary/45 text-primary'
          "
        >
          {{ statusText }}
        </Badge>
      </div>

      <!-- Lưới khoá / giá trị: cột nhãn, cột giá trị. -->
      <div
        class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground"
      >
        <span class="text-faint">{{ t('sessionsBg.command') }}</span>
        <!-- mono: lệnh shell người dùng có thể dán vào terminal -->
        <code class="font-mono text-sm break-words whitespace-pre-wrap text-foreground">
          {{ shell.command }}
        </code>
        <span class="text-faint">{{ t('sessionsBg.started') }}</span>
        <span>{{ startedText }}</span>
      </div>

      <div class="flex items-center gap-2 text-sm">
        <span class="text-faint">{{ t('sessionsBg.output') }}</span>
        <Button
          v-if="output.text"
          variant="ghost"
          size="iconSm"
          class="ml-auto text-muted-foreground hover:text-foreground"
          :title="copied ? t('common.copied') : t('common.copy')"
          :aria-label="copied ? t('common.copied') : t('common.copy')"
          @click="onCopy"
        >
          <Icon :name="copied ? 'check' : 'copy'" class="size-3.5" />
        </Button>
      </div>

      <!-- Ghi chú "log bị cắt" — thông tin, không phải cảnh báo. -->
      <p v-if="output.truncated" class="m-0 text-sm text-faint">
        {{ t('sessionsBg.truncated', { kb: droppedKb }) }}
      </p>

      <div
        v-if="output.loading && !output.text"
        class="rounded-md border border-dashed px-3 py-3.5 text-sm leading-5 text-faint"
      >
        {{ t('sessionsBg.loading') }}
      </div>
      <!-- Chỉ lỗi ĐỌC mới tô đỏ; output rỗng đúng bản chất thì không. -->
      <div
        v-else-if="output.error"
        class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3.5 text-sm leading-5 text-destructive"
      >
        {{ t('sessionsBg.error', { msg: output.error }) }}
      </div>
      <!-- Phần dài có vùng cuộn riêng để khung card đứng yên. mono: stdout+stderr thô. -->
      <pre
        v-else-if="output.text"
        class="m-0 min-h-0 flex-auto overflow-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm leading-5 break-words whitespace-pre-wrap text-foreground"
        >{{ output.text }}</pre
      >
      <div v-else class="rounded-md border border-dashed px-3 py-3.5 text-sm leading-5 text-faint">
        {{ emptyText }}
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Modal xem output của MỘT lệnh chạy nền (ADR 0066). Mở từ chip job nền, dùng chung
// khung Dialog (reka) với các modal session khác.
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
