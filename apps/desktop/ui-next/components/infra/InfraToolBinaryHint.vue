<template>
  <!-- Cảnh báo + đường sửa khi CLI của một công cụ hạ tầng không dùng được.
       Task 0.1b dựng sẵn cơ chế bảo lãnh đường dẫn (`infra.policy.vouchBinary`)
       nhưng chưa có bề mặt nào gọi nó: trên máy có kubectl qua OrbStack,
       `/usr/local/bin/kubectl` trỏ vào `/Applications/OrbStack.app/…` — ngoài
       allowlist prefix — nên `kubectl_cli` luôn trả "Không tìm thấy kubectl".
       Không có khối này thì tính năng sống mà không chạy được, và cách duy nhất
       để sửa là tự gọi RPC bằng tay. -->
  <div v-if="status && !status.found" class="mt-3 border-t pt-2.5">
    <p class="mt-2 mb-0 text-xs text-warning">{{ t('infra.binary.missing', { tool }) }}</p>
    <p v-if="status.hint" class="mt-1.5 mb-0 text-xs text-faint">{{ status.hint }}</p>

    <template v-if="status.rejectedPath">
      <p class="mt-1.5 mb-0 text-xs text-faint">{{ t('infra.binary.outside') }}</p>
      <div class="mt-2.5 grid gap-1">
        <div class="flex gap-2 text-xs">
          <span class="flex-none text-faint">{{ t('infra.binary.path') }}</span>
          <!-- mono-ok: đường dẫn binary — người dùng copy-paste sang terminal. -->
          <span class="min-w-0 font-mono break-all text-foreground">
            {{ status.rejectedPath }}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="mt-3 w-full justify-start"
        :disabled="busy"
        :aria-busy="busy"
        @click="vouch()"
      >
        <Icon
          :name="busy ? 'refresh' : 'shield'"
          class="size-3.5 text-dim"
          :class="{ 'animate-spin': busy }"
        />
        {{ busy ? t('infra.binary.vouching') : t('infra.binary.vouch') }}
      </Button>
      <p class="mt-1.5 mb-0 text-xs text-faint">{{ t('infra.binary.vouchNote') }}</p>
      <p v-if="error" class="mt-1.5 mb-0 text-xs text-destructive">{{ error }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
// Khối này CHỈ gọi RPC của CON NGƯỜI (`infra.status` đọc, `infra.policy.vouchBinary`
// ghi có chủ đích). Không agent tool nào map tới hai RPC đó, nên một cú bấm ở đây
// là một lần nới rào chắn có người chịu trách nhiệm — và sidecar tự ghi nhật ký.
import type { InfraTool } from '~/types'

const props = defineProps<{ tool: InfraTool }>()

const { t } = useI18n()
const sc = useSidecar()
const toast = useToast()

type Status = {
  found: boolean
  path: string | null
  version: string | null
  hint: string | null
  rejectedPath: string | null
}

const status = ref<Status | null>(null)
const busy = ref(false)
const error = ref('')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

async function load(): Promise<void> {
  if (!sc.available) return
  try {
    const raw = await sc.request<unknown>('infra.status')
    const tools = isRecord(raw) && Array.isArray(raw.tools) ? raw.tools : []
    const mine = tools.find((item) => isRecord(item) && item.tool === props.tool)
    if (!isRecord(mine)) return
    status.value = {
      found: mine.found === true,
      path: text(mine.path) || null,
      version: text(mine.version) || null,
      hint: text(mine.hint) || null,
      rejectedPath: text(mine.rejectedPath) || null,
    }
  } catch (err) {
    // Không đọc được trạng thái thì im lặng: một cảnh báo bịa ra còn tệ hơn.
    console.warn('[infra] infra.status failed', err)
  }
}

async function vouch(): Promise<void> {
  const path = status.value?.rejectedPath
  if (!path || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await sc.request('infra.policy.vouchBinary', { path })
    // Sidecar xoá cache dò binary sau khi bảo lãnh, nên lần đọc này thấy ngay.
    await load()
    if (status.value && !status.value.found) {
      // Bảo lãnh đã THÀNH CÔNG (sidecar không ném lỗi) mà tool vẫn chưa dùng được:
      // lý do nằm ở chỗ khác (không thấy file, version sai). Nói "không bảo lãnh
      // được" ở đây là đổ lỗi sai chỗ, và người dùng sẽ đi bấm lại mãi.
      fail(t('infra.binary.vouchStillBroken', { tool: props.tool }))
      return
    }
    // Thành công là một lần NỚI RÀO CHẮN có người chịu trách nhiệm (sidecar đã ghi
    // nhật ký) — phải nói ra, vì khối cảnh báo này biến mất ngay sau đó và người
    // dùng không thấy gì đã xảy ra.
    toast.add({
      title: t('infra.binary.vouchDone', { tool: props.tool }),
      color: 'success',
      icon: 'shield',
    })
  } catch (err) {
    fail(err instanceof Error && err.message ? err.message : t('infra.binary.vouchFailed'))
  } finally {
    busy.value = false
  }
}

/** Thất bại: chữ ngay trong khối (không mất khi toast trôi) + toast để không bỏ lỡ. */
function fail(detail: string): void {
  const title = t('infra.binary.vouchFailed')
  error.value = detail
  toast.add({
    title,
    // Không lặp lại đúng câu đó hai lần khi chi tiết chỉ là chính nó.
    ...(detail && detail !== title ? { description: detail } : {}),
    color: 'error',
    icon: 'alert',
  })
}

onMounted(() => {
  void load()
})
</script>
