<template>
  <div class="shf">
    <div v-if="block.caption" class="shfcap">{{ block.caption }}</div>
    <div v-if="block.files.length" class="shflist">
      <button
        v-for="f in block.files"
        :key="f.path"
        class="shfcard"
        :title="t('sessionsSurfaces.files.open', { path: f.path })"
        @click="openFile(f)"
      >
        <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <span class="shfmain">
          <span class="shfname">{{ f.name }}</span>
          <span class="shfpath">{{ f.path }}</span>
        </span>
        <span v-if="fmtSize(f.size)" class="shfsize">{{ fmtSize(f.size) }}</span>
      </button>
    </div>
    <div v-else-if="block.status === 'running'" class="shfwait">
      {{ t('sessionsSurfaces.files.preparing') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Files the model handed to the user (#26, send_user_file) as openable cards.
//
// Clicking goes through the SHARED file-preview infrastructure (useFilePreview →
// usePreview → PreviewModal, the repo's "every file read opens the one preview
// modal" rule) — no viewer of its own. The path is workspace-relative and was
// already validated inside the tool (assertInsideWorkspace); the read it triggers
// is gated by the same check again in the sidecar.
import type { FilesBlock, SharedFile } from '~/composables/useSessionsData'
import { formatBytes } from '~/utils/format-bytes'

defineProps<{ block: FilesBlock }>()
const { t } = useI18n()
const filePreview = useFilePreview()

function openFile(f: SharedFile): void {
  filePreview.open(f.path)
}

// Unknown / zero size → no label at all (a "0 B" chip says nothing useful here).
const fmtSize = (n?: number): string => (n == null || n <= 0 ? '' : formatBytes(n))
</script>

<style scoped>
.shf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0;
}
.shfcap {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.shflist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shfcard {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.shfcard:hover {
  background: var(--bgHover);
  border-color: var(--borderStrong);
}
.shfcard .icn {
  flex: 0 0 auto;
  color: var(--accent);
}
.shfmain {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.shfname {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shfpath {
  font-family: var(--code); /* mono-ok: a workspace path the user may paste into a shell */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shfsize {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.shfwait {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
@media (prefers-reduced-motion: reduce) {
  .shfcard {
    transition: none;
  }
}
</style>
