<template>
  <!-- Một node của graph kiến trúc, vẽ trong canvas VueFlow. Nhận props chuẩn của
       VueFlow (id/data/selected); `data` mang node + cờ điểm vào + callback mở rộng
       (node VueFlow không emit được lên canvas nên handler đi qua `data`, cùng khuôn
       với WorkflowNode). -->
  <!-- G4: `dim` nghĩa là NGOÀI đường đi của request đang lần theo, không phải
       "không quan trọng" — và nó chỉ bật khi thật sự có một đường đi đang tô
       (`matchOf` trả `null` khi không có, xem `useInfraTraceHighlight`). -->
  <div
    class="ign"
    :class="{
      sel: selected,
      ext: data.node.kind === 'external',
      dim: data.offPath,
      path: data.onPath,
      bad: data.failed,
    }"
  >
    <Handle type="target" :position="Position.Left" />

    <div class="ign-hd">
      <span class="ign-ico">
        <Icon :name="icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
      <span class="ign-name" :title="data.node.label">{{ data.node.label }}</span>
    </div>

    <div class="ign-sub">
      <!-- `service`/`region` là ĐỊNH DANH, không dịch: chúng là thứ người dùng tra
           tiếp trong console/CLI. -->
      <span class="ign-svc">{{ data.node.service }}</span>
      <span v-if="data.node.region" class="ign-reg">{{ data.node.region }}</span>
    </div>

    <div class="ign-foot">
      <span v-if="data.isRoot" class="ign-chip root">{{ t('infra.graph.node.root') }}</span>
      <span v-if="data.node.inferred" class="ign-chip inf">
        {{ t('infra.graph.node.inferred') }}
      </span>
      <span v-if="data.node.kind === 'external'" class="ign-chip ext">
        {{ t('infra.graph.node.external') }}
      </span>
      <span class="ign-gap" />
      <button
        v-if="data.node.expandable"
        class="ign-exp"
        type="button"
        :disabled="data.isExpanding"
        :title="data.isExpanding ? t('infra.graph.node.expanding') : t('infra.graph.node.expand')"
        @click.stop="onExpand"
      >
        <Icon
          :name="data.isExpanding ? 'refresh' : 'plus'"
          :class="{ spin: data.isExpanding }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
      </button>
    </div>

    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { graphServiceIcon } from '~/composables/useInfraGraph'
import type { InfraGraphNode as GraphNode } from '~/composables/useInfraGraphApi'

type NodeData = {
  node: GraphNode
  /** Node này là điểm vào của lượt dựng đang xem. */
  isRoot: boolean
  /** Nằm TRÊN đường đi của request đang lần theo (G4). */
  onPath: boolean
  /** Có đường đi đang tô, và node này KHÔNG nằm trên đó. */
  offPath: boolean
  /** Là chặng mà request HỎNG ở đó. */
  failed: boolean
  /** Lượt `graph-expand` của CHÍNH node này đang bay. */
  isExpanding: boolean
  /** Mở rộng đúng node này một bước (chạy ở page-controller). */
  onExpand: (id: string) => void
}

const props = defineProps<{ id: string; data: NodeData; selected: boolean }>()

const { t } = useI18n()

const icon = computed(() => graphServiceIcon(props.data.node.service))

function onExpand(): void {
  props.data.onExpand(props.id)
}
</script>

<style scoped>
.ign {
  width: 208px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  padding: 9px 11px 8px;
  box-shadow: var(--shadow-md);
  position: relative;
  cursor: pointer;
}

.ign.sel {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    var(--shadow-md);
}

/* ── Tô đường đi của một request (G4) ────────────────────────────────────────
   Node ngoài đường MỜ ĐI chứ không bị ẩn: ẩn sẽ làm sơ đồ đứt quãng và người đọc
   mất luôn ngữ cảnh "request này KHÔNG đi qua chỗ kia", vốn là nửa câu trả lời. */
.ign.dim {
  opacity: 0.35;
}

.ign.path {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    var(--shadow-md);
}

.ign.bad {
  border-color: var(--danger);
  box-shadow:
    0 0 0 1px var(--danger),
    var(--shadow-md);
}

/* Node ngoài ngữ cảnh đang ghim: viền đứt để nó không đọc như một tài nguyên
   trong tài khoản hiện tại. */
.ign.ext {
  border-style: dashed;
}

.ign-hd {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ign-ico {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}

.ign-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ign-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
}

.ign-svc {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ign-reg {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.ign-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--border);
  min-height: 20px;
}

.ign-gap {
  flex: 1;
}

.ign-chip {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--textDim);
  white-space: nowrap;
}

/* Nhãn "suy luận" phải đọc được như một CẢNH BÁO về độ tin, không phải trang trí. */
.ign-chip.inf {
  color: var(--amber);
  border-color: var(--amber);
}

.ign-chip.root {
  color: var(--accent);
  border-color: var(--accentBorder);
}

.ign-chip.ext {
  color: var(--textMuted);
  border-style: dashed;
}

.ign-exp {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  border: 1px solid var(--borderStrong);
  background: var(--bgEl);
  color: var(--textMuted);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.ign-exp:hover:not(:disabled) {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--accent);
}

.ign-exp:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Cùng khuôn với `.iad-spin` của InfraAccountsDetail.vue — `.spin` không phải class
   toàn cục nên SFC tự khai keyframes. */
.spin {
  animation: ign-spin 0.8s linear infinite;
}

@keyframes ign-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
