<template>
  <Teleport to="body">
    <div
      v-if="item"
      class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      @click.self="close"
      @keydown.esc="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="item.name"
        class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <!-- Header: kind icon · name · size · (render/raw for markdown) · copy · × -->
        <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <component :is="kindIcon" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate text-sm font-medium text-foreground">{{ item.name }}</span>
          <span v-if="item.size" class="shrink-0 text-xs text-muted-foreground tabular-nums">
            {{ item.size }}
          </span>
          <span v-if="item.meta" class="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {{ item.meta }}
          </span>
          <Badge variant="secondary" class="ml-1">{{ item.kind }}</Badge>
          <span class="flex-1" />
          <div v-if="item.kind === 'markdown'" class="flex rounded-md border border-border p-0.5">
            <button
              v-for="v in ['render', 'raw'] as const"
              :key="v"
              :class="[
                'rounded px-2 py-0.5 text-xs capitalize transition-colors',
                view === v
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ]"
              @click="view = v"
            >
              {{ v }}
            </button>
          </div>
          <Button
            v-if="item.text"
            variant="ghost"
            size="iconSm"
            aria-label="Copy content"
            @click="copyText"
          >
            <Check v-if="copied" class="text-success" />
            <Copy v-else />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label="Close preview" @click="close">
            <X />
          </Button>
        </div>

        <!-- Body per kind -->
        <ScrollArea class="min-h-0 flex-1">
          <!-- image: centered, checkerboard-ish muted surface -->
          <div v-if="item.kind === 'image'" class="flex justify-center bg-muted/30 p-6">
            <img :src="item.src" :alt="item.name" class="max-h-[60vh] rounded-lg shadow-md" />
          </div>

          <!-- video: real <video> element (media:// stream inside Electron; the
               dev browser has no file so we show poster + controls shell) -->
          <div v-else-if="item.kind === 'video'" class="bg-black p-0">
            <video
              :poster="item.src"
              controls
              preload="metadata"
              class="mx-auto max-h-[62vh] w-full"
            />
            <p class="px-3 py-2 text-xs text-muted-foreground">
              Streams via
              <code class="rounded bg-muted px-1 font-mono">media://</code>
              protocol with Range support in Electron — placeholder poster in proto.
            </p>
          </div>

          <!-- markdown: rendered (real useMarkdown pipeline) or raw source -->
          <div v-else-if="item.kind === 'markdown' && view === 'render'" class="p-5">
            <ProtoMarkdown :src="item.text ?? ''" />
          </div>
          <pre
            v-else-if="item.kind === 'markdown' || item.kind === 'text'"
            class="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"
            >{{ item.text }}</pre
          >

          <!-- opaque file card -->
          <div v-else class="flex flex-col items-center gap-3 py-14 text-muted-foreground">
            <File class="size-8" />
            <p class="text-sm">Binary file — open externally</p>
          </div>
        </ScrollArea>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Proto PreviewModal — mirrors common/PreviewModal.vue: ONE shared modal fed by
// useProtoPreview() (same shape as usePreview(): teleport-to-body, header chrome,
// kind-specific body, Esc close).
import { computed, ref, watch } from 'vue'
import { Check, Copy, Eye, File, FileText, Image as ImageIcon, Video, X } from 'lucide-vue-next'
import { useProtoPreview } from '~/composables/useProtoPreview'

const { current: item, close } = useProtoPreview()
const view = ref<'render' | 'raw'>('render')
const copied = ref(false)

watch(item, () => {
  view.value = 'render'
})

const kindIcon = computed(() => {
  switch (item.value?.kind) {
    case 'image':
      return ImageIcon
    case 'video':
      return Video
    case 'markdown':
      return Eye
    case 'text':
      return FileText
    default:
      return File
  }
})

async function copyText() {
  if (!item.value?.text) return
  await navigator.clipboard.writeText(item.value.text).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
</script>
