<template>
  <!-- Vùng render của doc đang active (ADR 0098). Mỗi doc một component surface
       theo kind; KeepAlive :max=12 khớp trần doc của store nên đổi tab là tức thì
       (Monaco giữ undo/cursor, WebContentsView detach/attach đúng cơ chế riêng).
       Kind 'task' chưa có surface — placeholder để không vỡ stage. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <template v-if="doc">
      <KeepAlive :max="12">
        <component :is="surfaceOf(doc)" :key="surfaceKey(doc)" :doc="doc" />
      </KeepAlive>
    </template>
    <div
      v-else
      class="grid h-full place-items-center text-[var(--fs-sm)] leading-[var(--lh-sm)] text-[var(--textFaint)]"
    >
      {{ t('workbench.unknown', { kind: '—' }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRaw } from 'vue'
import type { Component } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchStore } from '~/stores/workbench'
import DocChat from '~/components/workbench/stage/DocChat.vue'
import DocFile from '~/components/workbench/stage/DocFile.vue'
import DocMd from '~/components/workbench/stage/DocMd.vue'
import DocWeb from '~/components/workbench/stage/DocWeb.vue'
import DocImage from '~/components/workbench/stage/DocImage.vue'
import DocVid from '~/components/workbench/stage/DocVid.vue'
import DocMermaid from '~/components/workbench/stage/DocMermaid.vue'
import DocSettings from '~/components/workbench/stage/DocSettings.vue'
import DocMonitor from '~/components/workbench/stage/DocMonitor.vue'
import DocDiff from '~/components/workbench/stage/DocDiff.vue'
import DocGitLog from '~/components/workbench/stage/DocGitLog.vue'
import DocCommitDiff from '~/components/workbench/stage/DocCommitDiff.vue'
import DocUnknown from '~/components/workbench/stage/DocUnknown.vue'

const wb = useWorkbenchStore()
const { t } = useI18n()
const doc = computed(() => wb.docs.find((d) => d.id === wb.activeDoc))

// Key theo LẦN MỞ (object doc), không theo `doc.id`: đóng tab rồi mở lại cùng file
// thì KeepAlive vẫn còn instance cũ với key `doc.id`, và instance đó đang giữ object
// state file đã bị bỏ ⇒ tab mở lại hiện nội dung cũ, nút Nạp lại ghi vào object mới
// mà màn hình không đọc (lỗi "reload không ra file mới"). Mỗi lần mở là một object
// mới (`wb.openDoc` push object được truyền vào) ⇒ một số thứ tự mới ⇒ mount mới.
const openSeq = new WeakMap<WorkbenchDoc, number>()
let nextSeq = 0
function surfaceKey(d: WorkbenchDoc): string {
  const raw = toRaw(d)
  let n = openSeq.get(raw)
  if (n === undefined) {
    n = ++nextSeq
    openSeq.set(raw, n)
  }
  return `${d.id}#${n}`
}

function surfaceOf(d: WorkbenchDoc): Component {
  switch (d.kind) {
    case 'chat':
      return DocChat
    case 'file':
      return DocFile
    case 'md':
      return DocMd
    case 'web':
      return DocWeb
    case 'img':
      return DocImage
    case 'vid':
      return DocVid
    case 'mmd':
      return DocMermaid
    case 'settings':
      return DocSettings
    case 'monitor':
      return DocMonitor
    case 'diff':
      return DocDiff
    case 'gitlog':
      return DocGitLog
    case 'cdiff':
      return DocCommitDiff
    default:
      return DocUnknown
  }
}
</script>
