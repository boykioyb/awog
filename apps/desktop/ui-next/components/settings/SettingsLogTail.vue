<template>
  <div class="relative mb-3.5 flex h-85 flex-col overflow-hidden rounded-lg border bg-background">
    <div class="flex shrink-0 items-center justify-between gap-2 bg-card py-1.5 pr-2 pl-3">
      <!-- mono-ok: đường dẫn file log. rtl để tên file vẫn thấy khi đường dẫn tràn. -->
      <span
        class="truncate text-left font-mono text-sm text-dim [direction:rtl]"
        :title="logPath || undefined"
      >
        {{ logPath || t('settings.workspace.diagnostics.logTitle') }}
      </span>
      <div class="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :title="t('settings.workspace.diagnostics.reveal')"
          :aria-label="t('settings.workspace.diagnostics.reveal')"
          @click="onReveal"
        >
          <Icon name="folder" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :title="t('settings.workspace.diagnostics.clear')"
          :aria-label="t('settings.workspace.diagnostics.clear')"
          @click="onClear"
        >
          <Icon name="trash" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :title="t('settings.workspace.diagnostics.hideLogs')"
          :aria-label="t('settings.workspace.diagnostics.hideLogs')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>
    <Separator />

    <div ref="scrollerRef" class="min-h-0 flex-1 overflow-auto px-3 py-2" @scroll="onScroll">
      <div v-if="errorMsg" class="py-1.5 text-sm text-destructive">{{ errorMsg }}</div>
      <div v-else-if="!text" class="py-1.5 text-sm text-dim">
        {{ t('settings.workspace.diagnostics.waiting') }}
      </div>
      <!-- mono-ok: nội dung file log -->
      <pre v-else class="m-0 font-mono text-sm break-words whitespace-pre-wrap text-foreground">{{
        text
      }}</pre>
    </div>

    <Button
      v-if="!following && text"
      size="xs"
      class="absolute right-3.5 bottom-3 font-semibold"
      @click="resumeFollow"
    >
      {{ t('settings.workspace.diagnostics.follow') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Diagnostics log viewer — streams the tail of the app log file into a
// terminal-style scroll box instead of only revealing it in the file manager.
// Output rides the dedicated app:logData channel (see preload + logger.ts).
// Subscribe BEFORE startLogTail so the init snapshot isn't lost; stop + unlisten
// on unmount so the main-process watchFile poll doesn't leak.
import { useSidecar, type LogTailEvent, type UnlistenFn } from '~/composables/useSidecar'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const sc = useSidecar()

const scrollerRef = useTemplateRef<HTMLElement>('scrollerRef')

// Cap retained text so a long-running tail can't grow unbounded; trim from the
// front at a line boundary to avoid showing a chopped first line.
const MAX_CHARS = 400_000
const SCROLL_EPS = 24 // px tolerance for "is at bottom"

const text = ref('')
const errorMsg = ref<string | null>(null)
const logPath = ref<string | null>(null)
const following = ref(true)

let unlisten: UnlistenFn | null = null

const append = (chunk: string): void => {
  let next = text.value + chunk
  if (next.length > MAX_CHARS) {
    const cut = next.indexOf('\n', next.length - MAX_CHARS)
    next = next.slice(cut >= 0 ? cut + 1 : next.length - MAX_CHARS)
  }
  text.value = next
}

const scrollToEnd = (): void => {
  const el = scrollerRef.value
  if (el) el.scrollTop = el.scrollHeight
}

const onScroll = (): void => {
  const el = scrollerRef.value
  if (!el) return
  following.value = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_EPS
}

const resumeFollow = (): void => {
  following.value = true
  nextTick(scrollToEnd)
}

const handleEvent = (event: LogTailEvent): void => {
  if (event.type === 'init') {
    errorMsg.value = null
    logPath.value = event.path
    text.value = ''
    append(event.content)
  } else if (event.type === 'data') {
    append(event.chunk)
  } else if (event.type === 'error') {
    errorMsg.value = event.message
  }
  if (following.value) nextTick(scrollToEnd)
}

const onReveal = (): void => {
  sc.openLogs().catch(() => undefined)
}

const onClear = (): void => {
  text.value = ''
  following.value = true
}

onMounted(async () => {
  if (!sc.available) {
    errorMsg.value = t('settings.workspace.diagnostics.unavailable')
    return
  }
  try {
    unlisten = await sc.onLogData(handleEvent)
    await sc.startLogTail()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
})

onBeforeUnmount(() => {
  if (unlisten) unlisten()
  unlisten = null
  sc.stopLogTail().catch(() => undefined)
})
</script>
