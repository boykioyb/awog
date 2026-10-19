<template>
  <!-- Teleport to body: mounted once in the layout (like PreviewModal), floats
       above every surface (page, session, preview modal) at the top of the modal
       z-band so a translation opened from inside the preview overlay is visible. -->
  <Teleport to="body">
    <!-- `surface === 'browser'` KHÔNG render ở đây: selection đó nằm trong trang
         của trình duyệt nhúng, và một view native vẽ trên toàn bộ DOM ⇒ popover
         này sẽ vô hình, còn cách "gỡ trang khỏi màn hình để thấy popover" thì phá
         đúng việc người dùng đang làm (đối chiếu bản dịch với trang). Bề mặt đó
         render kết quả trong chrome của chính nó — BrowserTranslateStrip. -->
    <template v-if="active && active.surface !== 'browser'">
      <!-- Band "trên-modal": bôi đen text trong board item (`.wsed-ovl` 160), peek full
           (`.apeek.full` 400), lượt-fullscreen (`.ftovl` 470) hay preview (`.pvovl` 480)
           đều phải nổi popover lên trên — vượt 480. -->
      <div class="fixed inset-0 z-490" @mousedown="close" />
      <!-- `sttpop` là hook JS: OVERLAYS (useEmbeddedBrowser.ts) dò `.sttpop`. -->
      <div
        class="sttpop fixed z-491 flex max-h-[44vh] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        :style="popStyle"
        @mousedown.stop
      >
        <div class="flex items-center gap-2 border-b px-2.5 py-2 text-muted-foreground">
          <Icon name="book" class="size-3.5" />
          <span class="text-sm font-medium text-foreground">{{ t('translate.title') }}</span>
          <!-- Pill ngôn ngữ — chip tròn nhạt, mục đang chọn mang wash accent. -->
          <ToggleGroup
            type="single"
            :spacing="1"
            class="ml-auto gap-0.5"
            :model-value="lang"
            @update:model-value="onLang"
          >
            <ToggleGroupItem
              v-for="l in TRANSLATE_LANGS"
              :key="l"
              :value="l"
              :title="LANG_LABEL[l]"
              class="h-auto min-w-0 rounded-full bg-muted px-2 py-0.5 font-mono text-sm font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            >
              <!-- mono: mã ngôn ngữ (EN/VI/JA) — cột chữ đều -->
              {{ l.toUpperCase() }}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="ghost"
            size="iconSm"
            class="size-6 text-muted-foreground"
            :title="t('common.close')"
            @click="close"
          >
            <Icon name="x" />
          </Button>
        </div>

        <div class="overflow-y-auto px-3 py-2.5">
          <div v-if="loading" class="flex items-center gap-2 text-base text-dim">
            <span
              class="size-3.5 animate-spin rounded-full border-2 border-border border-t-primary"
            />
            {{ t('translate.loading') }}
          </div>
          <div v-else-if="error" class="flex items-center gap-2 text-base text-destructive">
            <span>{{ t('translate.error') }}</span>
            <Button variant="outline" size="xs" class="font-normal" @click="retry">
              {{ t('translate.retry') }}
            </Button>
          </div>
          <!-- Translated prose can carry the source's links; a workspace path must open in
               the shared preview, never navigate the SPA (dead route → 404). -->
          <div
            v-else
            class="text-base break-words text-foreground select-text"
            @click="onMdLinkClick"
          >
            <template v-for="(seg, i) in resultSegments" :key="i">
              <!-- mono: khối code mermaid giữ nguyên nguồn -->
              <pre
                v-if="seg.type === 'mermaid'"
                class="m-0 overflow-x-auto rounded-sm bg-muted px-2.5 py-2 font-mono text-[0.92em]"
              ><code>{{ seg.code }}</code></pre>
              <pre v-else-if="seg.type === 'widget'"><code>{{ seg.code }}</code></pre>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
              <div v-else class="sttmd" v-html="seg.html" />
            </template>
          </div>
        </div>

        <div v-if="!loading && !error && result" class="flex justify-end border-t px-2.5 py-2">
          <Button
            variant="outline"
            size="xs"
            class="font-normal text-muted-foreground [&_svg]:size-3"
            @click="copyResult"
          >
            <Icon :name="copied ? 'check' : 'copy'" />
            {{ copied ? t('translate.copied') : t('translate.copy') }}
          </Button>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useEscToClose } from '~/composables/useEscToClose'
import { useMarkdown } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()
const { onMdLinkClick } = useMdFileLink()
const {
  active,
  lang,
  loading,
  result,
  error,
  copied,
  TRANSLATE_LANGS,
  LANG_LABEL,
  setLang,
  retry,
  close,
  copyResult,
} = useSelectionTranslate()

// Render the translation as markdown (bold, inline code, lists) — model output is
// sanitized by useMarkdown (raw HTML dropped, hrefs sanitized) → v-html-safe.
const resultSegments = computed(() => (result.value ? renderMarkdown(result.value) : []))

// ToggleGroup single phát rỗng khi bấm lại pill đang bật — bỏ qua.
function onLang(v: unknown) {
  if (typeof v === 'string' && v) setLang(v as (typeof TRANSLATE_LANGS)[number])
}

const POP_WIDTH = 340

// Anchor near the selection: below by default, flip above when the selection sits
// low in the viewport. Clamp left inside the viewport. window.* is read at open
// time (recomputes when `active` changes) — the popover is transient, no resize
// handling needed.
const popStyle = computed(() => {
  const a = active.value?.anchor
  if (!a) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(vw - POP_WIDTH - 8, a.cx - POP_WIDTH / 2))
  const placeAbove = a.bottom > vh * 0.6
  if (placeAbove) {
    return { left: `${left}px`, bottom: `${vh - a.top + 8}px`, width: `${POP_WIDTH}px` }
  }
  return { left: `${left}px`, top: `${a.bottom + 8}px`, width: `${POP_WIDTH}px` }
})

// ESC closes the popover from anywhere (a lang pill focused, the backdrop, …).
useEscToClose(
  () => !!active.value,
  () => close(),
)
</script>

<style scoped>
/* style-ok: HTML markdown render ra (v-html từ useMarkdown) — class không chạm tới được,
   chỉ :deep. */
.sttmd :deep(p) {
  margin: 0 0 8px;
}
.sttmd :deep(strong) {
  font-weight: 650;
}
.sttmd :deep(em) {
  font-style: italic;
}
.sttmd :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.sttmd :deep(ul),
.sttmd :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.sttmd :deep(li) {
  margin: 2px 0;
}
.sttmd :deep(h1),
.sttmd :deep(h2),
.sttmd :deep(h3),
.sttmd :deep(h4) {
  font-size: 1.05em;
  font-weight: 650;
  margin: 4px 0 6px;
}
.sttmd :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
  color: var(--textDim);
}
.sttmd :deep(code) {
  font-family: var(--code, ui-monospace, monospace);
  font-size: 0.92em;
  background: var(--muted);
  padding: 1px 4px;
  border-radius: var(--r-xs); /* rounded-sm */
}
.sttmd :deep(pre) {
  margin: 0 0 8px;
  padding: 8px 10px;
  background: var(--muted);
  border-radius: var(--r-xs); /* rounded-sm */
  overflow-x: auto;
}
.sttmd :deep(pre code) {
  background: none;
  padding: 0;
}
.sttmd :deep(> *:last-child),
.sttmd :deep(li > *:last-child) {
  margin-bottom: 0;
}
</style>
