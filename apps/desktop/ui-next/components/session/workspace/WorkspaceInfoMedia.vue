<template>
  <div class="wsmld">
    <div class="wsmld-h">{{ t('sessions.info.mld.title') }}</div>

    <!-- Segmented picker — one bucket at a time, each with its own count. -->
    <div class="wsmld-seg">
      <button
        v-for="tab in TABS"
        :key="tab"
        type="button"
        class="wsmld-segbtn"
        :class="{ on: tab === active }"
        @click="pick(tab)"
      >
        <span>{{ t(`sessions.info.mld.tab.${tab}`) }}</span>
        <span v-if="counts[tab]" class="wsmld-n tnum">{{ counts[tab] }}</span>
      </button>
    </div>

    <!-- Media — thumbnail grid (images resolve their bytes lazily; video/audio show
         a play tile). Clicking opens the shared PreviewModal. -->
    <template v-if="active === 'media'">
      <div v-if="media.length" class="wsmld-grid">
        <button
          v-for="m in media"
          :key="m.key"
          type="button"
          class="wsmld-tile"
          :title="m.detail"
          @click="openFile(m)"
        >
          <img v-if="thumbOf(m)" class="wsmld-thumb" :src="thumbOf(m)" :alt="m.name" />
          <span v-else class="wsmld-tileic">
            <Icon
              :name="m.isImage ? 'file' : 'play'"
              style="width: var(--icon-md); height: var(--icon-md)"
            />
          </span>
          <span class="wsmld-tilename">{{ m.name }}</span>
        </button>
      </div>
      <p v-else class="wsmld-empty">{{ t('sessions.info.mld.emptyMedia') }}</p>
    </template>

    <!-- Links — every http(s) URL the session mentioned. Opens in the OS browser. -->
    <template v-else-if="active === 'links'">
      <div v-for="l in links" :key="l.key" class="wsmld-row">
        <button type="button" class="wsmld-rowmain" :title="l.url" @click="openLink(l)">
          <Icon
            name="link"
            style="
              width: var(--icon-xs);
              height: var(--icon-xs);
              flex: 0 0 auto;
              color: var(--textDim);
            "
          />
          <span class="wsmld-main">
            <span class="wsmld-name">{{ l.label }}</span>
            <span class="wsmld-sub">{{ l.host }}</span>
          </span>
          <Icon
            name="external"
            style="
              width: var(--icon-xs);
              height: var(--icon-xs);
              flex: 0 0 auto;
              color: var(--textFaint);
            "
          />
        </button>
        <button
          type="button"
          class="wsmld-act"
          :title="copiedKey === l.key ? t('common.copied') : t('common.copy')"
          @click="copyLink(l)"
        >
          <Icon
            :name="copiedKey === l.key ? 'check' : 'copy'"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
        </button>
      </div>
      <p v-if="!links.length" class="wsmld-empty">{{ t('sessions.info.mld.emptyLinks') }}</p>
    </template>

    <!-- Docs — every non-media file: attachments, files the session wrote, files the
         model handed over. Opens in the shared PreviewModal. -->
    <template v-else>
      <button
        v-for="d in docs"
        :key="d.key"
        type="button"
        class="wsmld-row wsmld-rowmain"
        :title="d.detail"
        @click="openFile(d)"
      >
        <Icon
          name="file"
          style="
            width: var(--icon-xs);
            height: var(--icon-xs);
            flex: 0 0 auto;
            color: var(--textDim);
          "
        />
        <span class="wsmld-main">
          <span class="wsmld-name">{{ d.name }}</span>
          <span class="wsmld-sub">{{ d.detail }}</span>
        </span>
        <span v-if="d.size != null" class="wsmld-size tnum">{{ formatBytes(d.size) }}</span>
        <span class="wsmld-kind">{{ t(`sessions.info.mld.origin.${d.origin}`) }}</span>
      </button>
      <p v-if="!docs.length" class="wsmld-empty">{{ t('sessions.info.mld.emptyDocs') }}</p>
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
import type { Session } from '~/composables/useSessionsData'
import {
  useSessionMediaIndex,
  type SessionFileItem,
  type SessionLinkItem,
} from '~/composables/useSessionMediaIndex'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { formatBytes } from '~/utils/format-bytes'
import { copyText } from '~/utils/clipboard'

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

<style scoped>
.wsmld {
  margin-top: 14px;
}
/* Section title — same weight as the Context files header above it. */
.wsmld-h {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin-bottom: 6px;
}
/* Segmented picker — transparent + accent-tint when on (no gray surface fills). */
.wsmld-seg {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.wsmld-segbtn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  cursor: pointer;
}
.wsmld-segbtn:hover {
  color: var(--text);
  background: var(--bgHover);
}
.wsmld-segbtn.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.wsmld-n {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wsmld-segbtn.on .wsmld-n {
  color: var(--accent);
}
/* Media grid — square thumbnails, filename under each tile. */
.wsmld-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px;
}
.wsmld-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.wsmld-thumb,
.wsmld-tileic {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgInput);
  object-fit: cover;
}
.wsmld-tileic {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textFaint);
}
.wsmld-tile:hover .wsmld-thumb,
.wsmld-tile:hover .wsmld-tileic {
  border-color: var(--accentBorder);
}
.wsmld-tilename {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Link / doc rows — same rhythm as the context-files rows above them. The shell owns
   the divider + hover; `.wsmld-rowmain` is the clickable body. A link row needs both
   (its copy action is a second button, which cannot nest inside the first); a doc row
   carries both classes on one element. */
.wsmld-row {
  display: flex;
  align-items: center;
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  text-align: left;
}
.wsmld-row:hover {
  background: var(--bgHover);
}
.wsmld-rowmain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.wsmld-act {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textFaint);
  cursor: pointer;
}
.wsmld-act:hover {
  color: var(--text);
  background: var(--bgActive);
}
.wsmld-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.wsmld-name,
.wsmld-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsmld-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.wsmld-size,
.wsmld-kind {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.wsmld-size {
  color: var(--textFaint);
}
.wsmld-empty {
  color: var(--textFaint);
  padding: 4px 0;
}
</style>
