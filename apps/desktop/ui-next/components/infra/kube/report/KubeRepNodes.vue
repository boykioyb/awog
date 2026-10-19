<template>
  <!-- Khối node — nguồn là `kubectl get nodes`.

       VÌ SAO BÁO CÁO PHẢI CÓ NODE. Bản đầu của màn này chỉ đọc pod + deployment, và
       một cụm mất một node vẫn hiện 100 điểm cho tới khi pod bắt đầu chết: node
       `NotReady` là nguyên nhân, pod `Pending` chỉ là hệ quả xuất hiện muộn hơn.

       `SchedulingDisabled` (cordon) có chip riêng chứ không gộp vào `NotReady`: node
       cordon không hỏng — nó chỉ không nhận pod mới, và đó thường là việc ai đó đang
       cố ý làm (drain để nâng cấp). Gộp lại thì báo cáo hét lên vì một việc bình
       thường; bỏ đi thì không ai giải thích được vì sao pod mới không lên. -->
  <div class="flex flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline gap-2.5">
      <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.nodes') }}</span>
      <span v-if="versions.length > 1" class="text-xs text-warning">
        {{ t('infra.kube.report.nodeSkew', { list: versions.join(', ') }) }}
      </span>
      <span v-else-if="versions.length === 1" class="text-xs text-faint">{{ versions[0] }}</span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gap.nodes') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>

    <ul v-else class="flex flex-wrap gap-1.5">
      <li
        v-for="node in nodes"
        :key="node.name"
        class="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2 py-1"
        :class="TONE[chipRate(node)].border"
      >
        <span class="size-2 shrink-0 rounded-full" :class="TONE[chipRate(node)].dot" />
        <!-- mono-ok: tên node dùng để dán vào kubectl -->
        <code class="truncate font-mono text-xs text-foreground" :title="node.name">
          {{ node.name }}
        </code>
        <span class="text-xs" :class="TONE[chipRate(node)].text">{{ node.status }}</span>
        <!-- `kubectl get nodes` in `Ready` cho một node đang `MemoryPressure`, nên
             không có mấy chip này thì một node sắp evict pod trông y hệt node khoẻ.
             Nguồn là `kubectl describe nodes` (khoá theo tên node). Condition là TIN
             XẤU trên một node mà cột STATUS vẫn in `Ready`: nó phải đọc khác hẳn phần
             còn lại của chip, nếu không nó chỉ là thêm chữ. -->
        <span
          v-for="cond in condsOf(node.name)"
          :key="cond"
          class="shrink-0 rounded-full bg-destructive/10 px-1.5 py-px text-xs text-destructive"
          :title="t('infra.kube.report.nodeCond', { list: condsOf(node.name).join(', ') })"
        >
          {{ cond }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { NodeCapacity, NodeStat } from '~/utils/kube-report'

const props = defineProps<{
  nodes: NodeStat[]
  /** Các phiên bản kubelet khác nhau đọc được. */
  versions: string[]
  /** Sức chứa + condition của từng node (`kubectl describe nodes`), khoá theo TÊN
   *  node — bảng `get nodes` không có cột nào cho condition ngoài `Ready`. */
  capacity: Map<string, NodeCapacity>
  /** Lý do không đọc được bảng node (rỗng = đọc được). */
  gap: string
}>()

const { t } = useI18n()

/** Condition đang bật của một node, trừ `Ready` (xem docblock của `NodeCapacity`).
 *  Node không đọc được sức chứa ⇒ mảng rỗng ⇒ không thêm chip nào. */
function condsOf(name: string): string[] {
  return props.capacity.get(name)?.conditions ?? []
}

type NodeRate = 'ok' | 'warn' | 'bad'

function chipRate(node: NodeStat): NodeRate {
  if (!node.ready) return 'bad'
  return node.cordoned ? 'warn' : 'ok'
}

const TONE: Record<NodeRate, { border: string; dot: string; text: string }> = {
  ok: { border: '', dot: 'bg-success', text: 'text-muted-foreground' },
  warn: { border: 'border-warning/40', dot: 'bg-warning', text: 'text-warning' },
  bad: { border: 'border-destructive/40', dot: 'bg-destructive', text: 'text-destructive' },
}
</script>
