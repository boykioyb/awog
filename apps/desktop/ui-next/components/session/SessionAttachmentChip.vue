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
    <Icon
      :name="att.folder ? 'folder' : 'rules'"
      style="width: var(--icon-xs); height: var(--icon-xs)"
    />
    {{ att.name }}
  </span>
</template>

<script setup lang="ts">
// attChip (~1743): file vs image attachment chip inside a user bubble (.uatt).
// Clicking opens the shared full-window PreviewModal (§7) via usePreview() — the
// single modal instance (mounted in SessionDetail) reads the shared store.
import type { SessionAttachment } from '~/composables/useSessionsData'
import { imageSiblingsFromAttachments, previewRefFromAttachment } from '~/composables/usePreview'

// `siblings` = every attachment on the same message. Handed to the preview so ‹ › steps
// through THIS message's images instead of whatever else lives in their folder.
const props = withDefaults(
  defineProps<{ att: SessionAttachment; siblings?: SessionAttachment[] }>(),
  { siblings: () => [] },
)
const { t } = useI18n()
const { open } = usePreview()

function openPreview() {
  open(previewRefFromAttachment(props.att), imageSiblingsFromAttachments(props.siblings))
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
  border-radius: var(--r-xs);
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--blue), var(--violet));
}
.a1thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--r-xs);
  object-fit: cover;
  flex: 0 0 auto;
}
</style>
