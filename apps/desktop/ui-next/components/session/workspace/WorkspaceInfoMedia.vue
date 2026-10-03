<template>
  <div class="mt-3.5">
    <div class="mb-1.5 text-sm text-dim">{{ t('sessions.info.mld.title') }}</div>

    <!-- Segmented picker — one bucket at a time, each with its own count. -->
    <div class="mb-2 flex gap-1">
      <button
        v-for="tab in TABS"
        :key="tab"
        type="button"
        :class="[
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium leading-4 transition-colors',
          tab === active
            ? 'border-ring bg-primary/10 text-primary'
            : 'border-transparent text-dim hover:bg-accent hover:text-foreground',
        ]"
        @click="pick(tab)"
      >
        <span>{{ t(`sessions.info.mld.tab.${tab}`) }}</span>
        <span
          v-if="counts[tab]"
          class="text-xs leading-4 tabular-nums"
          :class="tab === active ? 'text-primary' : 'text-faint'"
        >
          {{ counts[tab] }}
        </span>
      </button>
    </div>

    <!-- Media — thumbnail grid (images resolve their bytes lazily; video/audio show
         a play tile). Clicking opens the shared PreviewModal. -->
    <template v-if="active === 'media'">
      <div v-if="media.length" class="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
        <button
          v-for="m in media"
          :key="m.key"
          type="button"
          class="group flex min-w-0 flex-col items-stretch gap-1 overflow-hidden text-left"
          :title="m.detail"
          @click="openFile(m)"
        >
          <img
            v-if="thumbOf(m)"
            class="aspect-square w-full rounded-md border border-border bg-muted object-cover transition-colors group-hover:border-ring"
            :src="thumbOf(m)"
            :alt="m.name"
          />
          <span
            v-else
            class="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-muted text-faint transition-colors group-hover:border-ring"
          >
            <component :is="m.isImage ? File : Play" class="size-4" />
          </span>
          <span
            class="line-clamp-2 w-full min-w-0 text-xs leading-4 text-dim [overflow-wrap:anywhere]"
          >
            {{ m.name }}
          </span>
        </button>
      </div>
      <p v-else class="py-1 text-faint">{{ t('sessions.info.mld.emptyMedia') }}</p>
    </template>

    <!-- Links — every http(s) URL the session mentioned. Opens in the OS browser. -->
    <template v-else-if="active === 'links'">
      <div
        v-for="l in links"
        :key="l.key"
        class="flex w-full items-center border-b border-border text-left transition-colors hover:bg-accent"
      >
        <Button
          variant="ghost"
          type="button"
          class="h-auto p-0 flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left"
          :title="l.url"
          @click="openLink(l)"
        >
          <Link class="size-3 shrink-0 text-dim" />
          <span class="flex min-w-0 flex-1 flex-col gap-px">
            <span class="truncate text-foreground">{{ l.label }}</span>
            <span class="truncate text-xs leading-4 text-faint">{{ l.host }}</span>
          </span>
          <ExternalLink class="size-3 shrink-0 text-faint" />
        </Button>
        <Button
          variant="ghost"
          type="button"
          class="h-auto p-0 flex size-6 shrink-0 items-center justify-center rounded-sm text-faint transition-colors hover:bg-accent hover:text-foreground"
          :title="copiedKey === l.key ? t('common.copied') : t('common.copy')"
          :aria-label="copiedKey === l.key ? t('common.copied') : t('common.copy')"
          @click="copyLink(l)"
        >
          <component :is="copiedKey === l.key ? Check : Copy" class="size-3" />
        </Button>
      </div>
      <p v-if="!links.length" class="py-1 text-faint">{{ t('sessions.info.mld.emptyLinks') }}</p>
    </template>

    <!-- Docs — every non-media file: attachments, files the session wrote, files the
         model handed over. Opens in the shared PreviewModal. -->
    <template v-else>
      <Button
        v-for="d in docs"
        :key="d.key"
        variant="outline"
        type="button"
        class="h-auto p-0 flex w-full items-center gap-2 border-b border-border px-1 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
        :title="d.detail"
        @click="openFile(d)"
      >
        <File class="size-3 shrink-0 text-dim" />
        <span class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="truncate">{{ d.name }}</span>
          <span class="truncate text-xs leading-4 text-faint">{{ d.detail }}</span>
        </span>
        <span v-if="d.size != null" class="shrink-0 text-xs leading-4 tabular-nums text-faint">
          {{ formatBytes(d.size) }}
        </span>
        <span class="shrink-0 text-xs leading-4 text-muted-foreground">
          {{ t(`sessions.info.mld.origin.${d.origin}`) }}
        </span>
      </Button>
      <p v-if="!docs.length" class="py-1 text-faint">{{ t('sessions.info.mld.emptyDocs') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
// Info tab → "Media, links & docs": everything that flowed through this session,
// bucketed the way a chat app's info panel buckets it. Derivation lives in
// useSessionMediaIndex; this component only presents it and resolves thumbnails.
//
// Thumbnails: an attachment already carries its bytes in memory (src/dataUrl); a
// workspace image is read through useFilePreview.imageSrc (fs.readFileBase64 behind
// assertInsideWorkspace, cached per path). Reads happen only while the Media tab is
// open and are capped — a session that wrote hundreds of screenshots must not turn
// opening the Info tab into hundreds of IPC reads.
import { Check, Copy, ExternalLink, File, Link, Play } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import {
  useSessionMediaIndex,
  type SessionFileItem,
  type SessionLinkItem,
} from '~/composables/useSessionMediaIndex'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { formatBytes } from '~/utils/format-bytes'
import { copyText } from '~/utils/clipboard'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const filePreview = useFilePreview()
const { root } = useWorkspaceData(() => props.session.project)
const { media, docs, links, openFile, openLink } = useSessionMediaIndex(
  () => props.session,
  () => root.value,
)

const TABS = ['media', 'links', 'docs'] as const
type MldTab = (typeof TABS)[number]
const active = ref<MldTab>('media')
// Until the user picks a bucket, land on the first non-empty one — a code session
// usually has no media at all, and opening Info on an empty grid says nothing. Once
// they choose, their choice stands (a bucket filling up mid-turn must not steal it).
const picked = ref(false)

const counts = computed<Record<MldTab, number>>(() => ({
  media: media.value.length,
  links: links.value.length,
  docs: docs.value.length,
}))
watch(
  counts,
  (c) => {
    if (!picked.value) active.value = TABS.find((tab) => c[tab] > 0) ?? 'media'
  },
  { immediate: true },
)

// Copy a link's URL. The glyph flips to a check for a moment so the click has an
// answer — a one-shot row action doesn't warrant toast plumbing. The timer is cleared
// on unmount so a copy right before the panel closes can't tick into nothing.
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyLink(item: SessionLinkItem): Promise<void> {
  await copyText(item.url)
  copiedKey.value = item.key
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copiedKey.value = null), 1500)
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

function pick(tab: MldTab): void {
  picked.value = true
  active.value = tab
}

// Resolved workspace-image thumbnails, keyed by item key. '' = tried and failed
// (missing / too large / not an image) → the tile falls back to its icon.
const THUMB_MAX = 40
const thumbs = ref<Record<string, string>>({})

function thumbOf(item: SessionFileItem): string {
  if (item.att) return item.att.src || item.att.dataUrl || ''
  return thumbs.value[item.key] || ''
}

async function resolveThumbs(): Promise<void> {
  if (active.value !== 'media') return
  for (const m of media.value.slice(0, THUMB_MAX)) {
    if (!m.path || !m.isImage || thumbs.value[m.key] !== undefined) continue
    thumbs.value[m.key] = '' // claim the slot so a re-render doesn't re-read
    const url = await filePreview.imageSrc(m.path)
    if (url) thumbs.value[m.key] = url
  }
}
watch([active, media], () => void resolveThumbs(), { immediate: true })
// A finished turn drops the resolved-image cache (a file can be rewritten in place),
// so re-read what we're showing instead of serving stale bytes.
watch(filePreview.imagesVersion, () => {
  thumbs.value = {}
  void resolveThumbs()
})
</script>
