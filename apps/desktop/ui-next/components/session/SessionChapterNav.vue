<template>
  <div class="absolute top-2.5 right-13 z-4">
    <!-- Nút mở = chip nổi; menu mở → wash sáng lên. -->
    <Button
      variant="outline"
      size="iconSm"
      class="bg-popover text-muted-foreground opacity-70 shadow-sm hover:text-foreground hover:opacity-100 motion-reduce:transition-none"
      :class="open && 'bg-accent text-accent-foreground opacity-100'"
      :title="t('sessionsSurfaces.chapters.tooltip')"
      :aria-label="t('sessionsSurfaces.chapters.tooltip')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="listol" class="size-3.5" />
    </Button>
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      enter-from-class="scale-95 opacity-0 motion-reduce:scale-100 motion-reduce:opacity-100"
      leave-to-class="scale-95 opacity-0 motion-reduce:scale-100 motion-reduce:opacity-100"
    >
      <!-- Bảng mục lục = popover chuẩn: bg-popover + viền mảnh + shadow-md. -->
      <div
        v-if="open"
        class="absolute top-8.5 right-0 max-h-80 w-65 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
        @click.stop
      >
        <div class="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
          {{ t('sessionsSurfaces.chapters.title') }}
        </div>
        <Button
          v-for="(c, i) in chapters"
          :key="`${c.msgIndex}-${i}`"
          variant="ghost"
          size="sm"
          class="h-auto w-full items-baseline justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-normal text-popover-foreground"
          @click="jump(c.msgIndex)"
        >
          <span class="shrink-0 text-muted-foreground tabular-nums">{{ i + 1 }}</span>
          <span class="min-w-0 truncate">{{ c.title }}</span>
        </Button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// Floating chapter menu for the transcript (#24). Lists the chapters the model
// marked and jumps to the message each one sits in.
//
// The jump goes through useSessionScroll — the ONE contract that grows the render
// window first and queries inside the transcript root of THIS surface (ADR 0074 §Q2
// + ADR 0075). No document.querySelector, no template ref, no scroll maths here.
export type ChapterEntry = { title: string; msgIndex: number }

defineProps<{ chapters: ChapterEntry[] }>()
const { t } = useI18n()
const { scrollToMessage } = useSessionScroll()

const open = ref(false)

async function jump(msgIndex: number): Promise<void> {
  open.value = false
  await scrollToMessage(msgIndex)
}

// Click anywhere else closes the menu. The toggle + the panel stop propagation, so
// this only ever fires for a click outside them.
function closeOnOutside(): void {
  open.value = false
}
onMounted(() => document.addEventListener('click', closeOnOutside))
onUnmounted(() => document.removeEventListener('click', closeOnOutside))
</script>
