<template>
  <!-- Một node của graph kiến trúc, vẽ trong canvas VueFlow. Nhận props chuẩn của
       VueFlow (id/data/selected); `data` mang node + cờ điểm vào + callback mở rộng
       (node VueFlow không emit được lên canvas nên handler đi qua `data`, cùng khuôn
       với WorkflowNode). -->
  <!-- G4: `dim` (mờ) nghĩa là NGOÀI đường đi của request đang lần theo, không phải
       "không quan trọng" — và nó chỉ bật khi thật sự có một đường đi đang tô
       (`matchOf` trả `null` khi không có, xem `useInfraTraceHighlight`). Node ngoài
       đường MỜ ĐI chứ không bị ẩn: ẩn sẽ làm sơ đồ đứt quãng và người đọc mất luôn
       ngữ cảnh "request này KHÔNG đi qua chỗ kia", vốn là nửa câu trả lời.
       Node ngoài ngữ cảnh đang ghim (`external`) viền đứt để nó không đọc như một
       tài nguyên trong tài khoản hiện tại. -->
  <div
    class="relative w-52 cursor-pointer rounded-lg border border-input bg-card px-3 pt-2 pb-2 shadow-md"
    :class="[
      data.node.kind === 'external' && 'border-dashed',
      data.offPath && 'opacity-35',
      data.failed
        ? 'border-destructive ring-1 ring-destructive'
        : (selected || data.onPath) && 'border-primary ring-1 ring-primary',
    ]"
  >
    <Handle type="target" :position="Position.Left" />

    <div class="flex items-center gap-2">
      <span class="grid size-5.5 shrink-0 place-items-center rounded-sm bg-selected text-primary">
        <Icon :name="icon" class="size-3.5" />
      </span>
      <span class="min-w-0 truncate text-sm font-semibold text-foreground" :title="data.node.label">
        {{ data.node.label }}
      </span>
    </div>

    <div class="mt-1.5 flex min-w-0 items-center gap-1.5">
      <!-- `service`/`region` là ĐỊNH DANH, không dịch: chúng là thứ người dùng tra
           tiếp trong console/CLI. -->
      <span class="truncate text-xs text-dim">{{ data.node.service }}</span>
      <span v-if="data.node.region" class="shrink-0 text-xs text-faint tabular-nums">
        {{ data.node.region }}
      </span>
    </div>

    <div class="mt-2 flex min-h-5 items-center gap-1 border-t pt-1.5">
      <Badge v-if="data.isRoot" variant="outline" class="border-selected-border text-primary">
        {{ t('infra.graph.node.root') }}
      </Badge>
      <!-- Nhãn "suy luận" phải đọc được như một CẢNH BÁO về độ tin, không phải trang trí. -->
      <Badge v-if="data.node.inferred" variant="outline" class="border-warning text-warning">
        {{ t('infra.graph.node.inferred') }}
      </Badge>
      <Badge
        v-if="data.node.kind === 'external'"
        variant="outline"
        class="border-dashed text-muted-foreground"
      >
        {{ t('infra.graph.node.external') }}
      </Badge>
      <span class="flex-1" />
      <Button
        v-if="data.node.expandable"
        variant="outline"
        size="iconSm"
        class="size-5.5 text-muted-foreground hover:border-selected-border hover:bg-selected hover:text-primary"
        type="button"
        :disabled="data.isExpanding"
        :title="data.isExpanding ? t('infra.graph.node.expanding') : t('infra.graph.node.expand')"
        :aria-label="
          data.isExpanding ? t('infra.graph.node.expanding') : t('infra.graph.node.expand')
        "
        @click.stop="onExpand"
      >
        <Icon
          :name="data.isExpanding ? 'refresh' : 'plus'"
          :class="{ 'motion-safe:animate-spin': data.isExpanding }"
        />
      </Button>
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
