<template>
  <!-- Chip đính kèm: bo nhỏ, nền muted, viền hairline; hover = accent wash vì chip mở
       preview dùng chung. -->
  <span
    v-if="att.img"
    class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums transition-colors hover:border-info hover:bg-accent hover:text-foreground motion-reduce:transition-none"
    role="button"
    tabindex="0"
    :title="t('sessions.attachment.viewImage')"
    @click="openPreview"
    @keydown.enter="openPreview"
  >
    <img
      v-if="att.src"
      :src="att.src"
      class="size-4 shrink-0 rounded-sm object-cover"
      :alt="att.name"
    />
    <span v-else class="size-4 shrink-0 rounded-sm bg-linear-135 from-info to-lavender" />
    {{ att.name }}
  </span>
  <span
    v-else
    class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums transition-colors hover:border-input hover:bg-accent hover:text-foreground motion-reduce:transition-none"
    role="button"
    tabindex="0"
    :title="
      att.folder
        ? t('sessions.folder.chipTitle', { path: att.path ?? '' })
        : t('sessions.preview.openAttachment')
    "
    @click="openPreview"
    @keydown.enter="openPreview"
  >
    <Icon :name="att.folder ? 'folder' : 'rules'" class="size-3" />
    {{ att.name }}
  </span>
</template>

<script setup lang="ts">
// attChip (~1743): file vs image attachment chip inside a user bubble (.uatt).
// Attachment có `path` đĩa thật → mở thành workbench doc tab qua filePreview
// (đọc/sửa được, theo project); không có path (ảnh dán, data inline) → modal
// preview như cũ.
import type { SessionAttachment } from '~/composables/useSessionsData'
import { imageSiblingsFromAttachments, previewRefFromAttachment } from '~/composables/usePreview'
import { useFilePreview } from '~/composables/useFilePreview'

// `siblings` = every attachment on the same message. Handed to the preview so ‹ › steps
// through THIS message's images instead of whatever else lives in their folder.
const props = withDefaults(
  defineProps<{ att: SessionAttachment; siblings?: SessionAttachment[] }>(),
  { siblings: () => [] },
)
const { t } = useI18n()
const { open } = usePreview()
const filePreview = useFilePreview()

function openPreview() {
  if (props.att.path) {
    void filePreview.open(props.att.path)
    return
  }
  open(previewRefFromAttachment(props.att), imageSiblingsFromAttachments(props.siblings))
}
</script>
