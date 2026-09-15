<template>
  <div class="ape-process">
    <div class="ape-process-head">
      <Icon
        name="shield"
        style="width: var(--icon-sm); height: var(--icon-sm); color: var(--accent)"
      />
      <span class="ape-process-title">{{ t('infra.editor.process.title') }}</span>
    </div>
    <p class="ape-process-body">{{ t('infra.editor.process.body') }}</p>
    <div class="ape-process-path">
      <code class="ape-process-code">~/.aws/config</code>
      <button type="button" class="btn sm" @click="copyConfigPath">
        <Icon name="copy" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ copied ? t('common.copied') : t('common.copy') }}
      </button>
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

<style scoped>
.ape-process {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 14px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.ape-process-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.ape-process-body {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.ape-process-path {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ape-process-code {
  /* mono-ok: đường dẫn file copy-paste được vào terminal/file manager. */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
</style>
