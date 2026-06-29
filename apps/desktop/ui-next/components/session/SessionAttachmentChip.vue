<template>
  <span
    v-if="att.img"
    class="a1 imgchip"
    role="button"
    tabindex="0"
    :title="t('sessions.attachment.viewImage')"
    style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer"
    @click="openPreview"
    @keydown.enter="openPreview"
  >
    <img v-if="att.src" :src="att.src" class="a1thumb" :alt="att.name" />
    <span v-else class="thumb" />
    {{ att.name }}
  </span>
  <span
    v-else
    class="a1"
    role="button"
    tabindex="0"
    :title="
      att.folder
        ? t('sessions.folder.chipTitle', { path: att.path ?? '' })
        : t('sessions.preview.openAttachment')
    "
    style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer"
    @click="openPreview"
    @keydown.enter="openPreview"
  >
    <Icon :name="att.folder ? 'folder' : 'rules'" style="width: 11px; height: 11px" />
    {{ att.name }}
  </span>
</template>

<script setup lang="ts">
// attChip (~1743): file vs image attachment chip inside a user bubble (.uatt).
// Clicking opens the shared full-window PreviewModal (§7) via usePreview() — the
// single modal instance (mounted in SessionDetail) reads the shared store.
import type { SessionAttachment } from '~/composables/useSessionsData'
import { previewKindFromAttachment, type PreviewRef } from '~/composables/usePreview'

const props = defineProps<{ att: SessionAttachment }>()
const { t } = useI18n()
const { open } = usePreview()

function openPreview() {
  const a = props.att
  if (a.folder && a.path) {
    open({ kind: 'folder', name: a.name, workspaceRoot: a.path })
    return
  }
  const item: PreviewRef = { name: a.name, kind: previewKindFromAttachment(a) }
  if (a.src) item.src = a.src
  if (a.text != null) item.text = a.text
  if (a.size != null) item.size = a.size
  if (a.mime) item.mime = a.mime
  open(item)
}
</script>

<style scoped>
/* Outlined attachment chip: drop the grey fill (prototype .a1 uses var(--bgActive))
   to match the flat step/cluster rows; keep the border, and add a subtle hover so
   the clickable chip still gives feedback (it opens the preview). */
.a1 {
  background: transparent;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.a1:hover {
  background: var(--bgHover);
  border-color: var(--borderStrong);
}
@media (prefers-reduced-motion: reduce) {
  .a1 {
    transition: none;
  }
}
/* prototype `thumb` is an inline gradient swatch (no class) */
.thumb {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--blue), var(--violet));
}
.a1thumb {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: cover;
  flex: 0 0 auto;
}
</style>
