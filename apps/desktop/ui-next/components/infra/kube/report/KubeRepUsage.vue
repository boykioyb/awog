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
  <div class="ikru">
    <div class="ikru-head">
      <span class="ikru-t">{{ t('infra.kube.report.usage') }}</span>
      <span v-if="podCount" class="ihint">
        {{ t('infra.kube.report.usageSum', { n: podCount, cpu: cpuLabel, mem: memLabel }) }}
      </span>
    </div>

    <p v-if="gap" class="ikru-gap">
      {{ t('infra.kube.report.gap.top') }}
      <span class="ihint">{{ gap }}</span>
    </p>

    <!-- Ba màu ⇒ phải có chú giải. Chỉ hiện khi THẬT SỰ có số đặt chỗ: cụm không
         đọc được `describe nodes` thì dải chỉ còn một đoạn, và ba dòng chú giải
         cho hai màu không tồn tại là nhiễu. -->
    <div v-if="hasReserved" class="ikru-legend">
      <span class="ikru-leg">
        <span class="ikru-sw sw-use" />
        {{ t('infra.kube.report.legend.used') }}
      </span>
      <span class="ikru-leg">
        <span class="ikru-sw sw-over" />
        {{ t('infra.kube.report.legend.over') }}
      </span>
      <span class="ikru-leg">
        <span class="ikru-sw sw-res" />
        {{ t('infra.kube.report.legend.reserved') }}
      </span>
    </div>

    <!-- Một hàng một node. Node nào cũng hiện, kể cả node rảnh — thiếu node trong
         danh sách thì không ai biết cụm có bao nhiêu node đang được đo. -->
    <ul v-if="rows.length" class="ikru-nodes">
      <li v-for="node in rows" :key="node.name" class="ikru-node">
        <div class="ikru-nhead">
          <code class="ikru-name" :title="node.name">{{ node.name }}</code>
          <!-- Ô pod là trần CỨNG của kubelet (`Allocatable.pods`), không phải
               CPU/RAM: node còn rỗng tài nguyên vẫn từ chối pod thứ 18 nếu trần là
               17. Nó chỉ hiện khi đọc được, vì suy ra nó từ bảng khác là bịa. -->
          <span v-if="node.podCap !== null" class="ikru-slots" :class="{ tight: node.slotTight }">
            {{ t('infra.kube.report.podSlots', { used: node.podUsed ?? 0, cap: node.podCap }) }}
          </span>
        </div>
        <div v-for="band in node.bands" :key="band.key" class="ikru-pair">
          <span class="ikru-lbl">{{ band.label }}</span>
          <div class="ikru-bar">
            <span
              class="ikru-seg sw-use"
              :class="`u-${band.rate}`"
              :style="{ width: band.usedW }"
            />
            <span class="ikru-seg sw-over" :style="{ width: band.overW }" />
            <span class="ikru-seg sw-res" :style="{ width: band.resW }" />
          </div>
          <span class="ikru-pct" :class="`u-${band.rate}`">{{ band.usedLabel }}</span>
          <span class="ikru-req" :title="t('infra.kube.report.reservedTitle')">
            {{ band.reqLabel }}
          </span>
          <span class="ikru-abs ihint">{{ band.absLabel }}</span>
        </div>
        <!-- AI ĐANG NGỒI TRÊN NODE NÀY. Không có dòng này thì "RAM 100%" là ngõ
             cụt: biết máy nào đầy, không biết vì ai, và phải mở terminal để hỏi
             tiếp. Ba pod ngốn RAM nhất là đủ trả lời; bảng đầy đủ ở mục Pods. -->
        <div v-if="node.pods" class="ikru-pods">
          <span class="ikru-podn">
            {{ t('infra.kube.report.podsOn', { n: node.pods.n }) }}
          </span>
          <span v-for="pod in node.pods.top" :key="pod.name" class="ikru-pod">
            <code :title="pod.name">{{ pod.name }}</code>
            <span class="ikru-podv">{{ memOf(pod.memBytes) }}</span>
          </span>
        </div>
      </li>
    </ul>

    <!-- Hai danh sách "ngốn nhất": dải trong mỗi hàng đo THEO HÀNG ĐẦU của danh
         sách đó, nên trục được NÓI RA ở tiêu đề — một dải dài 100% mà không biết
         100% của cái gì thì không so được với bất kỳ con số nào khác trên màn. -->
    <div v-if="topCpu.length || topMem.length" class="ikru-tops">
      <div v-if="topCpu.length" class="ikru-top">
        <div class="ikru-tophead">
          <span class="ikru-t">{{ t('infra.kube.report.topCpu') }}</span>
          <span class="ihint">{{ t('infra.kube.report.axisMax', { max: cpuOf(maxCpu) }) }}</span>
        </div>
        <ul class="ikru-list">
          <li v-for="pod in topCpu" :key="pod.name">
            <code :title="pod.name">{{ pod.name }}</code>
            <div class="ikru-bar ikru-barsm">
              <span
                class="ikru-seg sw-use u-ok"
                :style="{ width: shareOf(pod.cpuMilli, maxCpu) }"
              />
            </div>
            <span class="ikru-val">{{ cpuOf(pod.cpuMilli) }}</span>
          </li>
        </ul>
      </div>
      <div v-if="topMem.length" class="ikru-top">
        <div class="ikru-tophead">
          <span class="ikru-t">{{ t('infra.kube.report.topMem') }}</span>
          <span class="ihint">{{ t('infra.kube.report.axisMax', { max: memOf(maxMem) }) }}</span>
        </div>
        <ul class="ikru-list">
          <li v-for="pod in topMem" :key="pod.name">
            <code :title="pod.name">{{ pod.name }}</code>
            <div class="ikru-bar ikru-barsm">
              <span
                class="ikru-seg sw-use u-ok"
                :style="{ width: shareOf(pod.memBytes, maxMem) }"
              />
            </div>
            <span class="ikru-val">{{ memOf(pod.memBytes) }}</span>
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

<style scoped>
.ikru {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ikru-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.ikru-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikru-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikru-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.ikru-leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikru-sw {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: var(--r-xs);
}
.ikru-nodes,
.ikru-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
/* MỘT NODE MỘT HÀNG (chốt 2026-09-17 sau khi thử lưới hai cột và bị bác). Hai cột
   nhồi được nhiều node hơn vào một tầm mắt, nhưng mắt phải nhảy zigzag để đọc bốn
   dải bar, và tên node dài (`ip-10-50-81-241.ap-southeast-1.compute.internal`) thì
   cắt mất đuôi ở nửa cột.

   Mỗi hàng có gạch TRÊN (không phải khung bốn cạnh): khối này nằm trong card của
   mục "Cụm", khung riêng cho từng hàng là card-trong-card — xem ghi chú ở
   `InfraKubeReport.vue`. */
.ikru-nodes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ikru-node {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.ikru-nhead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.ikru-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên node là thứ người dùng dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikru-slots {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.ikru-slots.tight {
  color: var(--amber);
}
.ikru-pair {
  display: grid;
  grid-template-columns: 34px minmax(60px, 1fr) 42px 74px auto;
  align-items: center;
  gap: 8px;
}
.ikru-lbl {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikru-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--bgActive);
}
.ikru-barsm {
  height: 6px;
}
.ikru-seg {
  display: block;
  height: 100%;
}
/* Đang dùng: màu đi theo mức (xanh → hổ phách → đỏ), vì đó là con số người đọc
   phán xét. Hai đoạn kia luôn một màu — chúng là BỐI CẢNH, không phải mức độ. */
.sw-use {
  background: var(--green);
}
.ikru-seg.u-warn {
  background: var(--amber);
}
.ikru-seg.u-bad {
  background: var(--danger);
}
.sw-over {
  background: var(--danger);
  opacity: 0.55;
}
/* "Đã đặt mà chưa dùng" vẽ bằng sọc chứ không phải màu đặc: nó là chỗ TRỐNG đã bị
   giữ — đặc thì đọc thành "đang dùng", trắng thì đọc thành "còn rảnh". */
.sw-res {
  background: repeating-linear-gradient(-45deg, var(--textFaint) 0 2px, transparent 2px 5px);
  opacity: 0.7;
}
.ikru-pct {
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ikru-pct.u-warn {
  color: var(--amber);
}
.ikru-pct.u-bad {
  color: var(--danger);
}
.ikru-req {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ikru-abs {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* Danh sách pod của node: một dòng chữ nhỏ xuống hàng được, KHÔNG phải một bảng
   con — ô node đã có hai dải bar, thêm một bảng nữa là hết đọc được. */
.ikru-pods {
  display: flex;
  align-items: baseline;
  gap: 4px 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.ikru-podn {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikru-pod {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
}
.ikru-pod code {
  color: var(--textMuted);
  font-family: var(--code); /* mono-ok: tên pod là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikru-podv {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.ikru-tops {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.ikru-top {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ikru-tophead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.ikru-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 56px auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ikru-list li + li {
  margin-top: 4px;
}
.ikru-list code {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên pod dùng để dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikru-val {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
