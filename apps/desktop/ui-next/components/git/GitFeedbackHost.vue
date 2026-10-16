<template>
  <!-- Phản hồi của MỌI thao tác git trong renderer này: lỗi (store.lastError) và
       thông báo thành công (store.lastNotice — pull/push/fetch, kể cả "đã cập nhật")
       thành toast, lỗi xác thực mở hộp hướng dẫn đăng nhập. Gắn một lần ở
       AppGlobalHosts — thao tác bấm từ /git, modal Git của phiên hay view Source
       Control của workbench đều nhận cùng phản hồi, không chỗ nào im lặng. -->
  <GitAuthErrorModal :error="store.pendingAuthError" @close="() => store.clearAuthError()" />
</template>

<script setup lang="ts">
import { useGitStore } from '~/stores/git'

const store = useGitStore()
const { t } = useI18n()
const toast = useToast()
const { surfaceGitError } = useGitErrorToast()

watch(
  () => store.lastError,
  (e) => {
    if (e) surfaceGitError(e.code, e.message)
  },
)

watch(
  () => store.lastNotice,
  (n) => {
    if (n) toast.add({ title: t(n.key, n.params ?? {}), color: 'success' })
  },
)
</script>
