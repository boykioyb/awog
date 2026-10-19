<template>
  <div class="flex flex-col gap-2.5 rounded-lg border bg-muted p-3">
    <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon name="shield" class="size-3.5 text-primary" />
      <span>{{ t('infra.editor.process.title') }}</span>
    </div>
    <p class="m-0 text-sm text-muted-foreground">{{ t('infra.editor.process.body') }}</p>
    <div class="flex items-center gap-2">
      <!-- mono-ok: đường dẫn file copy-paste được vào terminal/file manager. -->
      <code class="font-mono text-sm text-foreground">~/.aws/config</code>
      <Button type="button" variant="outline" size="sm" @click="copyConfigPath">
        <Icon name="copy" class="size-3" />
        {{ copied ? t('common.copied') : t('common.copy') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn CHỈ ĐỌC cho profile kind === 'process' (A3, luật cứng #3 — không có
// đường ghi credential_process ở v1). Không nhận props/emit gì — hoàn toàn
// tĩnh, tách riêng khỏi AwsProfileEditor.vue chỉ để giữ file cha ngắn lại.
//
// Không có IPC nào mở được `~/.aws/config` (nằm ngoài mọi workspace, mọi
// `shell:open*` hiện có đều yêu cầu `root` rồi validate bằng
// `resolveInsideWorkspace` — xem apps/desktop/electron/src/ipc.ts) nên nút ở
// đây chỉ SAO CHÉP đường dẫn, không "mở file" như bảng trong
// docs/features/aws-profile-manager.md gợi ý — ghi vào openIssues cho pha
// Tích hợp cân nhắc có nên thêm một IPC mở file ngoài workspace hay không.
import { onBeforeUnmount, ref } from 'vue'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()

const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null
async function copyConfigPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText('~/.aws/config')
    copied.value = true
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch (err) {
    console.error('[infra] copy config path failed', err)
  }
}
onBeforeUnmount(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer)
})
</script>
