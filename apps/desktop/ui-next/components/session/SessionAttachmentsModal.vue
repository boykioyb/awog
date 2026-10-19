<template>
  <!-- Card mang `role="dialog"` + `data-state="open"` để khớp selector
       `[role="dialog"][data-state="open"]` trong OVERLAYS (composables/useEmbeddedBrowser.ts)
       — trình duyệt nhúng nhường chỗ khi modal mở. -->
  <div
    v-if="open"
    class="fixed inset-0 z-100 flex cursor-default items-center justify-center bg-black/55 p-12 [-webkit-app-region:no-drag]"
    @click.self="emit('close')"
  >
    <Card
      role="dialog"
      aria-modal="true"
      data-state="open"
      class="flex max-h-[80vh] w-full max-w-170 flex-col gap-0 overflow-hidden rounded-lg py-0 shadow-lg"
    >
      <div class="flex items-center gap-2 px-3.5 py-2.5 text-foreground">
        <Icon name="clip" class="size-3.5" />
        <span class="flex-1 font-semibold">
          {{ t('sessions.attachment.allTitle', { n: attachments.length }) }}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </div>
      <Separator />

      <div
        class="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-2 overflow-auto p-3.5"
      >
        <div
          v-for="(a, i) in attachments"
          :key="i"
          class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-muted px-2 py-1.5 hover:border-ring"
          :title="t('sessions.attachment.preview')"
          @click="emit('preview', i)"
        >
          <span
            class="grid size-7.5 shrink-0 place-items-center overflow-hidden rounded-sm text-muted-foreground"
          >
            <img v-if="a.img && a.src" :src="a.src" class="size-full object-cover" :alt="a.name" />
            <span v-else-if="a.img" class="size-5 rounded-sm bg-linear-135 from-info to-lavender" />
            <Icon v-else name="rules" class="size-4" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <!-- mono: tên file đính kèm -->
            <span class="truncate font-mono text-foreground">{{ a.name }}</span>
            <span v-if="fmtSize(a.size)" class="text-sm text-muted-foreground tabular-nums">
              {{ fmtSize(a.size) }}
            </span>
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :title="t('sessions.attachment.remove')"
            :aria-label="t('sessions.attachment.remove')"
            @click.stop="emit('remove', i)"
          >
            <Icon name="x" class="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
// Overflow modal: lists ALL pending attachments when the composer has too many to
// show inline. Each row → click previews, × removes. Scrim tự dựng (không phải Dialog reka): preview ảnh mở CHỒNG lên modal này qua
// PreviewModal (overlay thường) — Dialog modal của reka khoá pointer-events của body
// nên preview sẽ không bấm được.
import type { SessionAttachment } from '~/composables/useSessionsData'
import { formatBytes } from '~/utils/format-bytes'

const props = defineProps<{ open: boolean; attachments: SessionAttachment[] }>()
const emit = defineEmits<{ close: []; preview: [i: number]; remove: [i: number] }>()
const { t } = useI18n()

// Absent size → no label (the row just drops it).
const fmtSize = (n?: number): string => (n == null ? '' : formatBytes(n))

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
