<template>
  <!-- Khối CPU/RAM của màn Báo cáo — nguồn là `kubectl top nodes` + `kubectl top
       pods` (metrics-server) + `kubectl describe nodes` (sức chứa).

       HAI CON SỐ, HAI CÂU HỎI KHÁC NHAU, VÀ BÁO CÁO CẦN CẢ HAI:
         · **đang dùng** (`top`) — cụm có đang tải nặng không;
         · **đã đặt chỗ** (`requests` trong `Allocated resources`) — cụm có nhận
           thêm pod được không.
       Một node dùng 9% CPU mà đã đặt chỗ 96% thì KHÔNG nhận pod nào nữa, trong khi
       dải "đang dùng" của nó trông rảnh rang. Đó là lý do mỗi dải ở đây xếp chồng
       ba đoạn thay vì một: đang dùng · vượt phần đặt chỗ · đã đặt mà chưa dùng.

       VÌ SAO NODE ĐỨNG TRƯỚC POD. Câu hỏi đầu tiên của người mở báo cáo là "cụm còn
       chỗ không", và câu đó chỉ node trả lời được: một pod ăn 2 core là bình thường
       trên node 16 core và là sự cố trên node 2 core.

       VÌ SAO CÓ Ô TRỐNG NÓI LÝ DO. Cụm không cài metrics-server là chuyện rất bình
       thường, và `kubectl top` khi đó trả lỗi chứ không trả 0. Khối này vì thế phải
       phân biệt được "đo ra 0%" với "không có gì để đo" — im lặng thì người dùng
       tưởng cụm rảnh. -->
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-baseline gap-2.5">
      <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.usage') }}</span>
      <span v-if="podCount" class="text-xs text-faint">
        {{ t('infra.kube.report.usageSum', { n: podCount, cpu: cpuLabel, mem: memLabel }) }}
      </span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gap.top') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>

    <!-- Ba màu ⇒ phải có chú giải. Chỉ hiện khi THẬT SỰ có số đặt chỗ: cụm không
         đọc được `describe nodes` thì dải chỉ còn một đoạn, và ba dòng chú giải
         cho hai màu không tồn tại là nhiễu. -->
    <div v-if="hasReserved" class="flex flex-wrap gap-3.5">
      <span :class="LEG">
        <span :class="[SWATCH, SEG_USE.ok]" />
        {{ t('infra.kube.report.legend.used') }}
      </span>
      <span :class="LEG">
        <span :class="[SWATCH, SEG_OVER]" />
        {{ t('infra.kube.report.legend.over') }}
      </span>
      <span :class="LEG">
        <span :class="[SWATCH, SEG_RES]" />
        {{ t('infra.kube.report.legend.reserved') }}
      </span>
    </div>

    <!-- Một hàng một node. Node nào cũng hiện, kể cả node rảnh — thiếu node trong
         danh sách thì không ai biết cụm có bao nhiêu node đang được đo.

         MỘT NODE MỘT HÀNG (chốt 2026-09-17 sau khi thử lưới hai cột và bị bác). Hai
         cột nhồi được nhiều node hơn vào một tầm mắt, nhưng mắt phải nhảy zigzag để
         đọc bốn dải bar, và tên node dài thì cắt mất đuôi ở nửa cột. Mỗi hàng có gạch
         TRÊN (không phải khung bốn cạnh): khối này nằm trong card của mục "Cụm". -->
    <ul v-if="rows.length" class="flex flex-col gap-2">
      <li
        v-for="node in rows"
        :key="node.name"
        class="grid grid-cols-[minmax(0,1fr)] gap-1 border-t pt-2"
      >
        <div class="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <!-- mono-ok: tên node là thứ người dùng dán vào kubectl -->
          <code class="truncate font-mono text-xs text-foreground" :title="node.name">
            {{ node.name }}
          </code>
          <!-- Ô pod là trần CỨNG của kubelet (`Allocatable.pods`), không phải
               CPU/RAM: node còn rỗng tài nguyên vẫn từ chối pod thứ 18 nếu trần là
               17. Nó chỉ hiện khi đọc được, vì suy ra nó từ bảng khác là bịa. -->
          <span
            v-if="node.podCap !== null"
            class="text-xs tabular-nums"
            :class="node.slotTight ? 'text-warning' : 'text-faint'"
          >
            {{ t('infra.kube.report.podSlots', { used: node.podUsed ?? 0, cap: node.podCap }) }}
          </span>
        </div>
        <div
          v-for="band in node.bands"
          :key="band.key"
          class="grid grid-cols-[2.125rem_minmax(3.75rem,1fr)_2.625rem_4.625rem_auto] items-center gap-2"
        >
          <span class="text-xs text-faint">{{ band.label }}</span>
          <div class="flex h-2 overflow-hidden rounded-full bg-border">
            <span
              class="block h-full"
              :class="SEG_USE[band.rate] ?? SEG_USE.ok"
              :style="{ width: band.usedW }"
            />
            <span class="block h-full" :class="SEG_OVER" :style="{ width: band.overW }" />
            <span class="block h-full" :class="SEG_RES" :style="{ width: band.resW }" />
          </div>
          <span
            class="text-right text-xs tabular-nums"
            :class="PCT_TEXT[band.rate] ?? 'text-foreground'"
          >
            {{ band.usedLabel }}
          </span>
          <span
            class="text-right text-xs text-faint tabular-nums"
            :title="t('infra.kube.report.reservedTitle')"
          >
            {{ band.reqLabel }}
          </span>
          <span class="text-right text-xs text-faint tabular-nums">{{ band.absLabel }}</span>
        </div>
        <!-- AI ĐANG NGỒI TRÊN NODE NÀY. Không có dòng này thì "RAM 100%" là ngõ
             cụt: biết máy nào đầy, không biết vì ai, và phải mở terminal để hỏi
             tiếp. Ba pod ngốn RAM nhất là đủ trả lời; bảng đầy đủ ở mục Pods.
             Một dòng chữ nhỏ xuống hàng được, KHÔNG phải một bảng con — ô node đã có
             hai dải bar, thêm một bảng nữa là hết đọc được. -->
        <div v-if="node.pods" class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-xs text-faint">
            {{ t('infra.kube.report.podsOn', { n: node.pods.n }) }}
          </span>
          <span
            v-for="pod in node.pods.top"
            :key="pod.name"
            class="inline-flex max-w-full min-w-0 items-baseline gap-1"
          >
            <!-- mono-ok: tên pod là thứ dán vào kubectl -->
            <code class="truncate font-mono text-xs text-muted-foreground" :title="pod.name">
              {{ pod.name }}
            </code>
            <span class="text-xs text-faint tabular-nums">{{ memOf(pod.memBytes) }}</span>
          </span>
        </div>
      </li>
    </ul>

    <!-- Hai danh sách "ngốn nhất": dải trong mỗi hàng đo THEO HÀNG ĐẦU của danh
         sách đó, nên trục được NÓI RA ở tiêu đề — một dải dài 100% mà không biết
         100% của cái gì thì không so được với bất kỳ con số nào khác trên màn. -->
    <div v-if="topCpu.length || topMem.length" class="flex flex-col gap-3 border-t pt-2.5">
      <div v-if="topCpu.length" class="flex min-w-0 flex-col gap-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-2.5">
          <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.topCpu') }}</span>
          <span class="text-xs text-faint">
            {{ t('infra.kube.report.axisMax', { max: cpuOf(maxCpu) }) }}
          </span>
        </div>
        <ul class="flex flex-col gap-1">
          <li v-for="pod in topCpu" :key="pod.name" :class="TOP_ROW">
            <!-- mono-ok: tên pod dùng để dán vào kubectl -->
            <code class="truncate font-mono text-xs text-foreground" :title="pod.name">
              {{ pod.name }}
            </code>
            <div class="flex h-1.5 overflow-hidden rounded-full bg-border">
              <span
                class="block h-full"
                :class="SEG_USE.ok"
                :style="{ width: shareOf(pod.cpuMilli, maxCpu) }"
              />
            </div>
            <span class="text-right text-xs text-muted-foreground tabular-nums">
              {{ cpuOf(pod.cpuMilli) }}
            </span>
          </li>
        </ul>
      </div>
      <div v-if="topMem.length" class="flex min-w-0 flex-col gap-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-2.5">
          <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.topMem') }}</span>
          <span class="text-xs text-faint">
            {{ t('infra.kube.report.axisMax', { max: memOf(maxMem) }) }}
          </span>
        </div>
        <ul class="flex flex-col gap-1">
          <li v-for="pod in topMem" :key="pod.name" :class="TOP_ROW">
            <!-- mono-ok: tên pod dùng để dán vào kubectl -->
            <code class="truncate font-mono text-xs text-foreground" :title="pod.name">
              {{ pod.name }}
            </code>
            <div class="flex h-1.5 overflow-hidden rounded-full bg-border">
              <span
                class="block h-full"
                :class="SEG_USE.ok"
                :style="{ width: shareOf(pod.memBytes, maxMem) }"
              />
            </div>
            <span class="text-right text-xs text-muted-foreground tabular-nums">
              {{ memOf(pod.memBytes) }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usageRate } from '~/composables/useInfraKubeReport'
import { formatCpu } from '~/utils/kube-report'
import { formatBytes } from '~/utils/format-bytes'
import type { NodeCapacity, NodePods, NodeUsage, PodUsage } from '~/utils/kube-report'

const props = defineProps<{
  nodes: NodeUsage[]
  /** Pod của từng node, khoá là tên node (`kubectl get pods -o wide`). */
  podsOn: Map<string, NodePods>
  /** Sức chứa của từng node (`kubectl describe nodes`) — rỗng khi không đọc được. */
  capacity: Map<string, NodeCapacity>
  topCpu: PodUsage[]
  topMem: PodUsage[]
  /** Số pod `kubectl top pods` đọc được — mẫu của hai con số tổng. */
  podCount: number
  cpuLabel: string
  memLabel: string
  /** Lý do không có số (rỗng = có số). */
  gap: string
}>()

const { t } = useI18n()

/** Ô pod đã dùng từ mức này là node sắp hết chỗ — cùng ngưỡng với `podSlotTight`. */
const SLOT_TIGHT = 0.9

// ── Màu của dải ───────────────────────────────────────────────────────────────
/** Đoạn "đang dùng": màu đi theo mức (xanh → hổ phách → đỏ), vì đó là con số người
 *  đọc phán xét. Hai đoạn kia luôn một màu — chúng là BỐI CẢNH, không phải mức độ. */
const SEG_USE: Record<string, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}
/** Dùng VƯỢT phần đặt chỗ. */
const SEG_OVER = 'bg-destructive opacity-55'
/** "Đã đặt mà chưa dùng" vẽ bằng sọc chứ không phải màu đặc: nó là chỗ TRỐNG đã bị
 *  giữ — đặc thì đọc thành "đang dùng", trắng thì đọc thành "còn rảnh". */
const SEG_RES =
  'bg-[repeating-linear-gradient(-45deg,var(--color-faint)_0_2px,transparent_2px_5px)] opacity-70'
const PCT_TEXT: Record<string, string> = {
  warn: 'text-warning',
  bad: 'text-destructive',
}
/** Một mục chú giải + ô màu của nó. */
const LEG = 'inline-flex items-center gap-1.5 text-xs text-muted-foreground'
const SWATCH = 'inline-block size-2.5 rounded-sm'
/** Một hàng của danh sách "ngốn nhất": tên · dải · giá trị. */
const TOP_ROW = 'grid min-w-0 grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-2'

const maxCpu = computed(() => Math.max(1, ...props.topCpu.map((p) => p.cpuMilli ?? 0)))
const maxMem = computed(() => Math.max(1, ...props.topMem.map((p) => p.memBytes ?? 0)))
const hasReserved = computed(() => props.capacity.size > 0)

/**
 * Một dải = ba đoạn xếp chồng, tính từ hai phần trăm ĐỘC LẬP:
 *   · `used` từ `kubectl top` (đang tiêu thụ thật),
 *   · `req` từ `Allocated resources` (đã hứa cho pod, dù pod đang rảnh).
 *
 * Chồng lên nhau theo phần chung: `min(used, req)` là phần "đang dùng trong hạn
 * mức của mình". Phần lệch đi về hai phía có nghĩa khác hẳn nhau — dùng VƯỢT phần
 * đặt chỗ (node đang bị bóp, pod có thể bị evict) so với đặt chỗ mà KHÔNG dùng
 * (node hết chỗ nhận pod mới dù đang rảnh) — nên chúng là hai màu, không phải một.
 */
function bandOf(
  key: string,
  label: string,
  usedPct: number | null,
  reqPct: number | null,
  absLabel: string,
): {
  key: string
  label: string
  rate: string
  usedW: string
  overW: string
  resW: string
  usedLabel: string
  reqLabel: string
  absLabel: string
} {
  const used = clamp(usedPct)
  const req = reqPct === null ? null : clamp(reqPct)
  const base = req === null ? used : Math.min(used, req)
  const over = req === null ? 0 : Math.max(0, used - req)
  const reserved = req === null ? 0 : Math.max(0, req - used)
  return {
    key,
    label,
    rate: usageRate(usedPct),
    usedW: `${base}%`,
    overW: `${over}%`,
    resW: `${reserved}%`,
    usedLabel: usedPct === null ? '—' : `${Math.round(usedPct)}%`,
    reqLabel: reqPct === null ? '' : t('infra.kube.report.reservedPct', { n: Math.round(reqPct) }),
    absLabel,
  }
}

function clamp(value: number | null): number {
  if (value === null) return 0
  return Math.min(100, Math.max(0, value))
}

/** Node + sức chứa + pod của nó, gộp một lần để template không tra Map ba lần mỗi hàng. */
const rows = computed(() =>
  props.nodes.map((node) => {
    const cap = props.capacity.get(node.name) ?? null
    const podUsed = cap?.podCount ?? null
    const podCap = cap?.podCapacity ?? null
    return {
      name: node.name,
      pods: props.podsOn.get(node.name) ?? null,
      podUsed,
      podCap,
      slotTight:
        podCap !== null && podUsed !== null && podCap > 0 && podUsed / podCap >= SLOT_TIGHT,
      bands: [
        bandOf('cpu', 'CPU', node.cpuPct, cap?.cpuReqPct ?? null, cpuOf(node.cpuMilli)),
        bandOf('mem', 'RAM', node.memPct, cap?.memReqPct ?? null, memOf(node.memBytes)),
      ],
    }
  }),
)

/** Dải của danh sách pod: tỉ lệ so với hàng đầu của cùng danh sách. */
function shareOf(value: number | null, max: number): string {
  if (value === null) return '0%'
  return `${Math.min(100, (value / max) * 100)}%`
}

function cpuOf(value: number | null): string {
  return value === null ? '—' : formatCpu(value)
}

function memOf(value: number | null): string {
  return value === null ? '—' : formatBytes(value)
}
</script>
