<template>
  <!-- Cảnh báo + đường sửa khi CLI của một công cụ hạ tầng không dùng được.
       Task 0.1b dựng sẵn cơ chế bảo lãnh đường dẫn (`infra.policy.vouchBinary`)
       nhưng chưa có bề mặt nào gọi nó: trên máy có kubectl qua OrbStack,
       `/usr/local/bin/kubectl` trỏ vào `/Applications/OrbStack.app/…` — ngoài
       allowlist prefix — nên `kubectl_cli` luôn trả "Không tìm thấy kubectl".
       Không có khối này thì tính năng sống mà không chạy được, và cách duy nhất
       để sửa là tự gọi RPC bằng tay. -->
  <div v-if="status && !status.found" class="ibin">
    <p class="iwarn">{{ t('infra.binary.missing', { tool }) }}</p>
    <p v-if="status.hint" class="ihint">{{ status.hint }}</p>

    <template v-if="status.rejectedPath">
      <p class="ihint">{{ t('infra.binary.outside') }}</p>
      <div class="iout">
        <div class="iout-row">
          <span class="iout-k">{{ t('infra.binary.path') }}</span>
          <span class="iout-v">{{ status.rejectedPath }}</span>
        </div>
      </div>
      <button type="button" class="iact" :disabled="busy" :aria-busy="busy" @click="vouch()">
        <Icon
          :name="busy ? 'refresh' : 'shield'"
          :class="{ ikspin: busy }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ busy ? t('infra.binary.vouching') : t('infra.binary.vouch') }}
      </button>
      <p class="ihint">{{ t('infra.binary.vouchNote') }}</p>
      <p v-if="error" class="ierr">{{ error }}</p>
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

<style scoped>
.ibin {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
</style>
