<template>
  <div class="ghdrawer" :class="{ full: isFull }" :style="drawerStyle">
    <div v-show="!isFull" class="ghdwrsz" @mousedown.prevent="onHandleDown" />
    <div class="ghdwin">
      <div class="ghdwhd">
        <span class="ghnum">#{{ thread?.number ?? '' }}</span>
        <span v-if="thread" class="ghstate" :style="{ color: stateColor, borderColor: stateColor }">
          {{ t('projects.gh.state.' + thread.state.toLowerCase()) }}
        </span>
        <span
          v-if="kind === 'pr' && thread?.isDraft"
          class="ghstate"
          style="color: var(--textDim); border-color: var(--border)"
        >
          {{ t('projects.gh.state.draft') }}
        </span>
        <span style="flex: 1" />
        <button
          v-for="lang in LANGS"
          :key="lang"
          class="iconbtn"
          :title="t('projects.drawer.viewLang.' + lang)"
          :style="{
            width: 'auto',
            height: '28px',
            padding: '0 8px',
            fontSize: '0.8462rem',
            ...(viewLang === lang
              ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
              : {}),
          }"
          @click="emit('set-lang', lang)"
        >
          {{ t('projects.drawer.viewLang.' + lang) }}
        </button>
        <button
          class="iconbtn"
          :title="isFull ? t('projects.drawer.exitFullscreen') : t('projects.drawer.fullscreen')"
          :aria-label="
            isFull ? t('projects.drawer.exitFullscreen') : t('projects.drawer.fullscreen')
          "
          style="width: 28px; height: 28px"
          @click="isFull = !isFull"
        >
          <Icon :name="isFull ? 'minimize' : 'maximize'" style="width: 14px; height: 14px" />
        </button>
        <a
          v-if="thread?.url"
          class="iconbtn"
          :href="thread.url"
          target="_blank"
          rel="noopener"
          :title="t('projects.drawer.openOnGithub')"
          style="width: 28px; height: 28px"
        >
          <Icon name="git" style="width: 14px; height: 14px" />
        </a>
        <button
          class="iconbtn"
          :title="t('projects.drawer.close')"
          style="width: 28px; height: 28px"
          @click="emit('close')"
        >
          <Icon name="x" style="width: 14px; height: 14px" />
        </button>
      </div>
      <div class="ghdwbody">
        <div v-if="loading" class="fd" style="padding: 24px; text-align: center">
          {{ t('projects.gh.loading') }}
        </div>
        <template v-else-if="thread">
          <div class="ghdwtitle">{{ segText('title', thread.title) }}</div>
          <div class="ghdwmeta">
            <span class="mono">{{ thread.author.login }}</span>
            {{ t('projects.drawer.opened') }} · {{ relativeWhen(thread.createdAt) }}
            <template v-if="kind === 'pr' && thread.baseRefName">
              ·
              <span class="mono">{{ thread.baseRefName }} ← {{ thread.headRefName }}</span>
            </template>
          </div>
          <div
            v-if="thread.labels.length"
            style="display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px"
          >
            <span
              v-for="l in thread.labels"
              :key="l.name"
              class="ghlabel"
              :style="ghLabelStyle(l.color, isDark)"
            >
              {{ l.name }}
            </span>
          </div>
          <div v-if="viewLang !== 'orig'" class="trbadge">
            {{ t('projects.drawer.translatedBadge') }}
          </div>
          <div class="ghmd">
            <p v-for="(par, i) in bodyParagraphs" :key="i">{{ par }}</p>
          </div>

          <!-- PR-only: changed files (path + line delta). -->
          <template v-if="kind === 'pr' && files.length">
            <div class="sech">{{ t('projects.drawer.filesChanged', { n: files.length }) }}</div>
            <div class="ghfiles">
              <div v-for="f in files" :key="f.path" class="ghfile">
                <span class="ghfile-p mono">{{ f.path }}</span>
                <span class="ghfile-d">
                  <span v-if="f.additions" style="color: var(--add)">+{{ f.additions }}</span>
                  <span v-if="f.deletions" style="color: var(--del)">−{{ f.deletions }}</span>
                </span>
              </div>
            </div>
          </template>

          <div class="sech">{{ t('projects.drawer.comments', { n: thread.comments.length }) }}</div>
          <template v-if="thread.comments.length">
            <div v-for="(c, i) in thread.comments" :key="i" class="ghcomment">
              <div class="ghchd">
                <span class="mono">{{ c.author.login }}</span>
                · {{ relativeWhen(c.createdAt) }}
              </div>
              <div class="ghmd">
                <p v-for="(par, j) in paragraphs(segText(i, c.body))" :key="j">{{ par }}</p>
              </div>
            </div>
          </template>
          <div v-else-if="!reviews.length" class="fd">{{ t('projects.drawer.noComment') }}</div>

          <!-- PR-only: reviews carrying a body (bare approvals are dropped server-side). -->
          <template v-if="kind === 'pr' && reviews.length">
            <div class="sech">{{ t('projects.drawer.reviews', { n: reviews.length }) }}</div>
            <div v-for="(r, i) in reviews" :key="`r${i}`" class="ghcomment">
              <div class="ghchd">
                <span class="mono">{{ r.author.login }}</span>
                <span
                  class="ghstate"
                  :style="{ color: reviewColor(r.state), borderColor: reviewColor(r.state) }"
                >
                  {{ reviewLabel(r.state) }}
                </span>
                · {{ relativeWhen(r.createdAt) }}
              </div>
              <div class="ghmd">
                <p v-for="(par, j) in paragraphs(r.body)" :key="j">{{ par }}</p>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Right-docked issue/PR detail — binds a live gh.get thread. Per-segment
// translation: each block (title / body / comment-by-index) renders its cached
// translation when a language tab is active (orig/vi/en), or the original prose.
// Markdown renders as plain paragraphs (no v-html). The parent (ProjectGh) owns
// the useProjectGh controller and forwards thread + segment lookups. The panel is
// user-resizable (left-edge drag, persisted) and has a fullscreen toggle. PRs add
// a Files-changed list + a Reviews section (review bodies).
import { computed, onBeforeUnmount, ref } from 'vue'
import type {
  GhKind,
  GhSegmentId,
  GhSegmentState,
  GhThread,
  ViewLang,
} from '~/composables/useProjectGh'
import { ghLabelStyle } from '~/utils/gh-label'

const { isDark } = useTheme()

const props = defineProps<{
  thread: GhThread | null
  kind: GhKind
  loading: boolean
  width: number
  viewLang: ViewLang
  segment: (id: GhSegmentId) => GhSegmentState | null
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'set-lang', lang: ViewLang): void }>()

const { t } = useI18n()

const LANGS: ViewLang[] = ['orig', 'vi', 'en']

// ── Resize (left-edge drag) + fullscreen ──────────────────────────────────────
const STORAGE_W = 'awog.gh.drawerWidth'
const MIN_W = 320
const MAX_W = 900
const clampW = (n: number): number => Math.max(MIN_W, Math.min(MAX_W, Math.round(n)))
const loadW = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_W)
    if (raw) return clampW(Number(raw))
  } catch {
    // localStorage unavailable — fall through to the prop default.
  }
  return clampW(props.width)
}
const panelWidth = ref(loadW())
const isFull = ref(false)

const drawerStyle = computed(() =>
  isFull.value ? undefined : { flex: `0 0 ${panelWidth.value}px`, width: `${panelWidth.value}px` },
)

let startX = 0
let startW = 0
const onMove = (e: MouseEvent): void => {
  // Docked on the right → dragging the left handle leftwards widens it.
  panelWidth.value = clampW(startW + (startX - e.clientX))
}
const onUp = (): void => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  try {
    localStorage.setItem(STORAGE_W, String(panelWidth.value))
  } catch {
    // ignore — width just won't persist.
  }
}
const onHandleDown = (e: MouseEvent): void => {
  startX = e.clientX
  startW = panelWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
onBeforeUnmount(onUp)

// ── Display helpers ───────────────────────────────────────────────────────────
const files = computed(() => props.thread?.files ?? [])
const reviews = computed(() => props.thread?.reviews ?? [])

// Resolve a segment's display text: the cached translation when the active lang
// tab has one (and isn't erroring), else the original.
function segText(id: GhSegmentId, original: string): string {
  const s = props.segment(id)
  if (!s) return original
  if (s.error || s.translated === undefined) return original
  return s.translated
}

const stateColor = computed(() => {
  const st = props.thread?.state
  return st === 'OPEN' ? 'var(--green)' : st === 'MERGED' ? 'var(--violet)' : 'var(--textDim)'
})

const REVIEW_LABEL_KEY: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
}
function reviewLabel(state: string): string {
  const key = REVIEW_LABEL_KEY[state]
  return key ? t('projects.drawer.reviewState.' + key) : state.toLowerCase()
}
function reviewColor(state: string): string {
  if (state === 'APPROVED') return 'var(--green)'
  if (state === 'CHANGES_REQUESTED') return 'var(--danger)'
  if (state === 'DISMISSED') return 'var(--textDim)'
  return 'var(--textMuted)'
}

function paragraphs(text: string): string[] {
  return String(text).split('\n\n')
}

const bodyParagraphs = computed(() => {
  if (!props.thread) return []
  return paragraphs(segText('body', props.thread.body))
})

function relativeWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ms).toLocaleDateString()
}
</script>

<style scoped>
.ghfiles {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.ghfile {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
}
.ghfile:first-child {
  border-top: none;
}
.ghfile-p {
  flex: 1;
  min-width: 0;
  font-size: 0.8462rem;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.ghfile-d {
  flex: 0 0 auto;
  display: flex;
  gap: 7px;
  font-family: var(--code);
  font-size: 0.7692rem;
}
</style>
