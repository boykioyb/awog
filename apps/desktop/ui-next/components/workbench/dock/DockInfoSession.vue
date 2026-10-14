<template>
  <WorkspaceInfo :session="session" compact />
</template>

<script setup lang="ts">
// Lớp vỏ cung cấp `provideFilePreview` cho Info trong dock của Workbench.
//
// Ở /sessions cũ, WorkspaceInfo nằm DƯỚI SessionDetail — nơi gọi provideFilePreview —
// nên bấm một file trong "Media, link & tài liệu" mở PreviewModal. Dock của Workbench
// không nằm dưới SessionDetail ⇒ `useFilePreview()` rơi về NOOP và mọi cú bấm file im
// lặng. Tách thành component riêng vì provide phải chạy trong setup của một TỔ TIÊN có
// session KHÁC null (DockInfo có thể chưa có phiên), và `:key` theo phiên ở chỗ gọi để
// root workspace + danh sách file của phiên trước không bị dùng lại.
import WorkspaceInfo from '~/components/session/workspace/WorkspaceInfo.vue'
import { provideFilePreview } from '~/composables/useFilePreview'
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()

provideFilePreview(
  () => props.session.project,
  () => props.session,
)
</script>
