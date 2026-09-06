<template>
  <div class="logtail">
    <div class="logtail-bar">
      <span class="logtail-title mono" :title="logPath || undefined">
        {{ logPath || t('settings.workspace.diagnostics.logTitle') }}
      </span>
      <div class="logtail-actions">
        <button
          class="logtail-act"
          :title="t('settings.workspace.diagnostics.reveal')"
          @click="onReveal"
        >
          <Icon name="folder" />
        </button>
        <button
          class="logtail-act"
          :title="t('settings.workspace.diagnostics.clear')"
          @click="onClear"
        >
          <Icon name="trash" />
        </button>
        <button
          class="logtail-act"
          :title="t('settings.workspace.diagnostics.hideLogs')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </button>
      </div>
    </div>

    <div ref="scrollerRef" class="logtail-body" @scroll="onScroll">
      <div v-if="errorMsg" class="logtail-empty danger">{{ errorMsg }}</div>
      <div v-else-if="!text" class="logtail-empty">
        {{ t('settings.workspace.diagnostics.waiting') }}
      </div>
      <pre v-else class="logtail-pre">{{ text }}</pre>
    </div>

    <button v-if="!following && text" class="logtail-follow" @click="resumeFollow">
      {{ t('settings.workspace.diagnostics.follow') }}
    </button>
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

<style scoped>
.logtail {
  display: flex;
  flex-direction: column;
  position: relative;
  margin: 0 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  overflow: hidden;
  height: 340px;
  background: var(--bg);
}
.logtail-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 8px 6px 12px;
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
}
.logtail-title {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl; /* keep the filename visible when the path overflows */
  text-align: left;
}
.logtail-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.logtail-act {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--textDim);
  border-radius: var(--r-xs);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.logtail-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.logtail-act .icn {
  width: 14px;
  height: 14px;
}
.logtail-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
}
.logtail-pre {
  margin: 0;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.logtail-empty {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  padding: 6px 0;
}
.logtail-empty.danger {
  color: var(--danger);
}
.logtail-follow {
  position: absolute;
  right: 14px;
  bottom: 12px;
  padding: 5px 12px;
  border: none;
  border-radius: var(--r-pill);
  font-size: 12px;
  line-height: 18px;
  font-weight: 650;
  color: var(--accentText);
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
</style>
