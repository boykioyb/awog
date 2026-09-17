<template>
  <!-- Khối node — nguồn là `kubectl get nodes`.

       VÌ SAO BÁO CÁO PHẢI CÓ NODE. Bản đầu của màn này chỉ đọc pod + deployment, và
       một cụm mất một node vẫn hiện 100 điểm cho tới khi pod bắt đầu chết: node
       `NotReady` là nguyên nhân, pod `Pending` chỉ là hệ quả xuất hiện muộn hơn.

       `SchedulingDisabled` (cordon) có chip riêng chứ không gộp vào `NotReady`: node
       cordon không hỏng — nó chỉ không nhận pod mới, và đó thường là việc ai đó đang
       cố ý làm (drain để nâng cấp). Gộp lại thì báo cáo hét lên vì một việc bình
       thường; bỏ đi thì không ai giải thích được vì sao pod mới không lên. -->
  <div class="ikrn">
    <div class="ikrn-head">
      <span class="ikrn-t">{{ t('infra.kube.report.nodes') }}</span>
      <span v-if="versions.length > 1" class="ikrn-skew">
        {{ t('infra.kube.report.nodeSkew', { list: versions.join(', ') }) }}
      </span>
      <span v-else-if="versions.length === 1" class="ihint">{{ versions[0] }}</span>
    </div>

    <p v-if="gap" class="ikrn-gap">
      {{ t('infra.kube.report.gap.nodes') }}
      <span class="ihint">{{ gap }}</span>
    </p>

    <ul v-else class="ikrn-list">
      <li v-for="node in nodes" :key="node.name" class="ikrn-i" :class="chipRate(node)">
        <span class="ikrn-dot" />
        <code class="ikrn-name" :title="node.name">{{ node.name }}</code>
        <span class="ikrn-st">{{ node.status }}</span>
        <!-- `kubectl get nodes` in `Ready` cho một node đang `MemoryPressure`, nên
             không có mấy chip này thì một node sắp evict pod trông y hệt node khoẻ.
             Nguồn là `kubectl describe nodes` (khoá theo tên node). -->
        <span
          v-for="cond in condsOf(node.name)"
          :key="cond"
          class="ikrn-cond"
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

function chipRate(node: NodeStat): string {
  if (!node.ready) return 'n-bad'
  return node.cordoned ? 'n-warn' : 'n-ok'
}
</script>

<style scoped>
.ikrn {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ikrn-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.ikrn-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrn-skew {
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrn-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikrn-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ikrn-i {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgEl);
}
.ikrn-i.n-warn {
  border-color: var(--amberBorder);
}
.ikrn-i.n-bad {
  border-color: var(--dangerBorder);
}
.ikrn-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--green);
}
.n-warn .ikrn-dot {
  background: var(--amber);
}
.n-bad .ikrn-dot {
  background: var(--danger);
}
.ikrn-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên node dùng để dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrn-st {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.n-bad .ikrn-st {
  color: var(--danger);
}
.n-warn .ikrn-st {
  color: var(--amber);
}
/* Condition là TIN XẤU trên một node mà cột STATUS vẫn in `Ready`: nó phải đọc
   khác hẳn phần còn lại của chip, nếu không nó chỉ là thêm chữ. */
.ikrn-cond {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: var(--dangerDim);
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
