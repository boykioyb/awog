<template>
  <!-- Icon trạng thái issue kiểu Linear: HÌNH + MÀU cùng nói trạng thái, nên đầu hàng
       phiên đọc được ngay "đang ở đâu" mà không cần chip chữ. Nhãn đầy đủ ở `title`. -->
  <component
    :is="meta.icon"
    class="size-3.5 flex-none"
    :class="meta.cls"
    :aria-label="label"
    role="img"
  >
    <title>{{ label }}</title>
  </component>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  CircleX,
  Contrast,
} from 'lucide-vue-next'
import type { BoardItemStatus } from '~/stores/board'
import { useIssueStatus } from '~/composables/useIssueStatus'

const props = defineProps<{ status: BoardItemStatus }>()

// Cùng bảng màu ngữ nghĩa với STATUS_COLOR của useIssueStatus (backlog/pending/
// cancelled trung tính, todo info, đang làm primary, review warning, cần sửa lavender,
// chặn destructive, xong success) — viết bằng class để theo theme.
const META: Record<BoardItemStatus, { icon: Component; cls: string }> = {
  backlog: { icon: CircleDashed, cls: 'text-muted-foreground' },
  todo: { icon: Circle, cls: 'text-info' },
  in_progress: { icon: CircleDot, cls: 'text-primary' },
  in_review: { icon: Contrast, cls: 'text-warning' },
  changes: { icon: CircleAlert, cls: 'text-lavender' },
  pending: { icon: CirclePause, cls: 'text-muted-foreground' },
  blocked: { icon: CircleSlash, cls: 'text-destructive' },
  done: { icon: CircleCheck, cls: 'text-success' },
  cancelled: { icon: CircleX, cls: 'text-muted-foreground' },
}

const { statusLabel } = useIssueStatus()
const meta = computed(() => META[props.status] ?? META.backlog)
const label = computed(() => statusLabel(props.status))
</script>
