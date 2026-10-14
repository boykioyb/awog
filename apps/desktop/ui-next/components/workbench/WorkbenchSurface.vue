<template>
  <!-- Vùng render của doc đang active (ADR 0098). Mỗi doc một component surface
       theo kind; KeepAlive :max=12 khớp trần doc của store nên đổi tab là tức thì
       (Monaco giữ undo/cursor, WebContentsView detach/attach đúng cơ chế riêng).
       Kind 'task' chưa có surface — placeholder để không vỡ stage. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <template v-if="doc">
      <KeepAlive :max="12">
        <component :is="surfaceOf(doc)" :key="doc.id" :doc="doc" />
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
import { computed } from 'vue'
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
import DocUnknown from '~/components/workbench/stage/DocUnknown.vue'

const wb = useWorkbenchStore()
const { t } = useI18n()
const doc = computed(() => wb.docs.find((d) => d.id === wb.activeDoc))

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
    default:
      return DocUnknown
  }
}
</script>
