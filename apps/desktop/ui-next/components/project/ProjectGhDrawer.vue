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
        <!-- Language picker — collapses the orig/vi/en/ja tabs into one dropdown so
             the header toolbar stays roomy on a narrow drawer. -->
        <button
          class="iconbtn"
          type="button"
          :title="t('projects.drawer.language')"
          :aria-label="t('projects.drawer.language')"
          :style="{
            width: 'auto',
            height: '28px',
            padding: '0 8px',
            gap: '5px',
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: '0.8462rem',
            ...(viewLang !== 'orig'
              ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
              : {}),
          }"
          @click.stop="toggleLangMenu"
        >
          <Icon name="globe" style="width: 13px; height: 13px" />
          <span>{{ t('projects.drawer.viewLang.' + viewLang) }}</span>
          <Icon name="chev" style="width: 12px; height: 12px" />
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
        <button
          v-if="thread"
          class="iconbtn"
          type="button"
          :title="t('projects.drawer.refresh')"
          :aria-label="t('projects.drawer.refresh')"
          :disabled="loading"
          style="width: 28px; height: 28px"
          @click="emit('refresh')"
        >
          <Icon name="refresh" style="width: 14px; height: 14px" />
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

      <!-- GitHub-style tab bar (underline indicator + icon + count badge). Issue →
           Conversation | Comments. PR → Conversation | Comments | Commits | Files. -->
      <div v-if="thread && tabDefs.length > 1" class="ghtabs">
        <button
          v-for="tb in tabDefs"
          :key="tb.key"
          type="button"
          class="ghtab"
          :class="{ on: activeTab === tb.key }"
          @click="selectTab(tb.key)"
        >
          <Icon :name="tb.icon" class="ghtab-ic" style="width: 14px; height: 14px" />
          <span>{{ t('projects.drawer.tab.' + tb.key) }}</span>
          <span v-if="tb.count" class="ghtab-n">{{ tb.count }}</span>
        </button>
      </div>

      <div
        class="ghdwbody"
        :class="{ 'gh-files-full': isFull && activeTab === 'files' && !!thread }"
      >
        <!-- Only a cold open (no list row to seed from) waits on a blank pane —
             normally the header/title/labels are already painted and just the body
             below shimmers. -->
        <div v-if="loading && !thread" class="fd" style="padding: 24px; text-align: center">
          {{ t('projects.gh.loading') }}
        </div>
        <template v-else-if="thread">
          <!-- ── Conversation: the opening post (meta + labels + body), plus PR
               reviews (the description / overview). ─────────────────────────── -->
          <template v-if="activeTab === 'conversation'">
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
            <!-- Body arrives with the core gh.get — shimmer in its place until then. -->
            <div v-if="loading" class="ghsk-body">
              <div v-for="w in BODY_SK" :key="w" class="ghskbar" :style="{ width: w }" />
            </div>
            <div v-else class="ghmd">
              <ProjectGhMarkdown :source="segText('body', thread.body)" />
            </div>
          </template>

          <!-- ── Comments: conversation comments + the review timeline (each review
               with its state + body + nested inline threads), Approve + composer. ── -->
          <template v-else-if="activeTab === 'comments'">
            <!-- Conversation comments (top-level PR/issue comments). -->
            <div v-if="thread.comments.length" class="sech">
              {{ t('projects.drawer.comments', { n: thread.comments.length }) }}
            </div>
            <div v-for="(c, i) in thread.comments" :key="`c${i}`" class="ghcomment">
              <div class="ghchd">
                <span class="mono">{{ c.author.login }}</span>
                · {{ relativeWhen(c.createdAt) }}
                <span style="flex: 1" />
                <button
                  type="button"
                  class="ghreply"
                  :title="t('projects.drawer.reply')"
                  @click="emit('reply', { author: c.author.login, body: c.body })"
                >
                  <Icon name="message" style="width: 12px; height: 12px" />
                  {{ t('projects.drawer.reply') }}
                </button>
              </div>
              <div class="ghmd">
                <ProjectGhMarkdown :source="segText(i, c.body)" />
              </div>
            </div>

            <!-- PR-only: review timeline — each review's state + body + its nested
                 inline comment threads (root + replies), like GitHub. -->
            <template v-if="kind === 'pr' && reviews.length">
              <div class="sech">{{ t('projects.drawer.reviews', { n: reviews.length }) }}</div>
              <div v-for="(r, i) in reviews" :key="`r${i}`" class="ghreview">
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
                <div v-if="r.body.trim()" class="ghmd">
                  <ProjectGhMarkdown :source="segText(`r${i}`, r.body)" />
                </div>
                <!-- Inline comment threads created by this review. -->
                <div v-for="(th, ti) in r.threads" :key="`r${i}t${ti}`" class="ghrthread">
                  <div class="ghrt-loc mono">
                    <Icon name="file" style="width: 12px; height: 12px" />
                    {{ th.path }}
                    <template v-if="th.line">:{{ th.line }}</template>
                  </div>
                  <!-- The commented code snippet (GitHub's diff_hunk). -->
                  <div v-if="th.diffHunk" class="ghrt-hunk">
                    <ProjectGhFileDiff :patch="th.diffHunk" />
                  </div>
                  <div
                    v-for="(c, ci) in th.comments"
                    :key="ci"
                    class="ghcomment"
                    :class="{ 'ghrt-reply': ci > 0 }"
                  >
                    <div class="ghchd">
                      <span class="mono">{{ c.author.login }}</span>
                      · {{ relativeWhen(c.createdAt) }}
                    </div>
                    <div class="ghmd">
                      <ProjectGhMarkdown :source="c.body" />
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Comments come with the core detail, the review timeline behind it
                 (gh.reviews) — shimmer for whichever is still in flight. -->
            <div v-if="loading || reviewsLoading" class="ghsk-body">
              <div v-for="w in COMMENT_SK" :key="w" class="ghskbar" :style="{ width: w }" />
            </div>

            <!-- Empty state when there's no discussion yet. -->
            <div
              v-else-if="!thread.comments.length && !reviews.length"
              class="fd"
              style="margin-bottom: 4px"
            >
              {{ t('projects.drawer.noComment') }}
            </div>

            <!-- Approve PR with an LGTM! review (open PRs only; hidden once approved). -->
            <div v-if="kind === 'pr' && thread.state === 'OPEN' && !reviewed" class="ghapprove-row">
              <button
                type="button"
                class="ghapprove"
                :disabled="reviewing"
                @click="emit('approve')"
              >
                <Icon name="check" style="width: 14px; height: 14px" />
                {{ reviewing ? t('projects.drawer.approving') : t('projects.drawer.approve') }}
              </button>
              <span v-if="reviewError" class="fd ghapprove-err">
                {{ t('projects.drawer.approveFailed') }}
              </span>
            </div>
            <div v-else-if="kind === 'pr' && reviewed" class="ghapproved">
              <Icon name="check" style="width: 13px; height: 13px" />
              {{ t('projects.drawer.approved') }}
            </div>

            <!-- Comment / reply composer (markdown editor + translate + enhance). -->
            <ProjectGhComposer
              ref="composerRef"
              :model-value="commentDraft"
              :posting="posting"
              :enhancing="enhancing"
              :translating="translating"
              :can-undo="canUndo"
              @update:model-value="(v) => emit('update:comment-draft', v)"
              @submit="emit('submit-comment')"
              @enhance="emit('enhance')"
              @translate="(lang) => emit('translate', lang)"
              @undo="emit('undo')"
            />
          </template>

          <!-- ── Commits (PR only): lazy-loaded commit list. ─────────────────── -->
          <ProjectGhCommits
            v-else-if="activeTab === 'commits'"
            :commits="commits"
            :loading="commitsLoading"
          />

          <!-- ── Files changed (PR only). Fullscreen → two-pane (tree | diff, like
               GitHub); docked → directory tree with per-file inline diff. ───────── -->
          <template v-else-if="activeTab === 'files'">
            <div v-if="!files.length" class="fd">
              {{ t('projects.drawer.filesChanged', { n: 0 }) }}
            </div>

            <!-- Two-pane (fullscreen): file tree on the left, selected diff on the right. -->
            <div v-else-if="isFull" class="ghfiles-2pane">
              <div class="ghfiles-tree">
                <ProjectGhFileTree
                  :nodes="fileTree"
                  :expanded="expanded"
                  :diff-files="diffFiles"
                  :diff-loading="diffLoading"
                  :inline-diff="false"
                  @toggle-file="selectFile"
                  @context-file="(ev, p) => ghMenu.open(ev, { path: p })"
                />
              </div>
              <div class="ghfiles-diff">
                <template v-if="expanded">
                  <div class="ghfiles-diffhd">
                    <span class="mono">{{ expanded }}</span>
                  </div>
                  <div v-if="diffLoading" class="fd" style="padding: 14px">
                    {{ t('projects.drawer.diffLoading') }}
                  </div>
                  <ProjectGhFileDiff v-else :patch="patchFor(expanded)" />
                </template>
                <div v-else class="fd ghfiles-pick">{{ t('projects.drawer.pickFile') }}</div>
              </div>
            </div>

            <!-- Docked: tree + inline diff. -->
            <template v-else>
              <div class="sech">{{ t('projects.drawer.filesChanged', { n: files.length }) }}</div>
              <ProjectGhFileTree
                :nodes="fileTree"
                :expanded="expanded"
                :diff-files="diffFiles"
                :diff-loading="diffLoading"
                @toggle-file="toggleFile"
                @context-file="(ev, p) => ghMenu.open(ev, { path: p })"
              />
            </template>
          </template>
        </template>
      </div>
    </div>

    <!-- View-language dropdown (orig / vi / en / ja), anchored under the trigger. -->
    <ContextMenu
      :open="langMenu.pos.value !== null"
      :position="langMenu.pos.value ?? { x: 0, y: 0 }"
      :items="langMenuItems"
      @close="langMenu.close"
      @select="onLangSelect"
    />

    <!-- PR file context menu (copy path / name). -->
    <ContextMenu
      :open="ghMenu.pos.value !== null"
      :position="ghMenu.pos.value ?? { x: 0, y: 0 }"
      :items="ghMenuItems"
      @close="ghMenu.close"
      @select="onGhMenuSelect"
    />
  </div>
</template>

<script setup lang="ts">
// Right-docked issue/PR detail — binds a live gh.get thread. GitHub-style underline
// tabs split the content: Conversation (the opening post — meta + labels + body),
// Comments (reviews + conversation comments + nested review threads + the Approve
// action + composer), Commits (PR only, lazy gh.commits) and Files changed (PR only,
// the changed-file list + inline diffs). Per-segment translation: each block (title /
// body / comment / review) renders its cached translation when a language tab is
// active (orig/vi/en/ja), or the original prose. Body / comments / reviews render as
// sanitized markdown (ProjectGhMarkdown — never raw v-html). The parent (ProjectGh)
// owns the useProjectGh controller and forwards thread + segment lookups + comment/
// diff/commits/review state. The panel is user-resizable (left-edge drag, persisted)
// and has a fullscreen toggle. The composer (markdown editor + translate + LLM
// enhance) sits in the Comments tab; per-comment Reply switches there + focuses it.
// The Approve button hides once the PR is approved this session.
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import ProjectGhMarkdown from './ProjectGhMarkdown.vue'
import ProjectGhFileTree from './ProjectGhFileTree.vue'
import ProjectGhFileDiff from './ProjectGhFileDiff.vue'
import ProjectGhComposer from './ProjectGhComposer.vue'
import ProjectGhCommits from './ProjectGhCommits.vue'
import { buildFileTree } from '~/utils/gh-file-tree'
import type { MenuItem } from '~/composables/useContextMenu'
import { useContextMenu } from '~/composables/useContextMenu'
import { copyText } from '~/utils/clipboard'
import type {
  GhCommit,
  GhDiffFile,
  GhKind,
  GhSegmentId,
  GhSegmentState,
  GhThread,
  ViewLang,
} from '~/composables/useProjectGh'
import type { TranslateLang } from '~/composables/useSelectionTranslate'
import { ghLabelStyle } from '~/utils/gh-label'

const { isDark } = useTheme()

const props = defineProps<{
  thread: GhThread | null
  kind: GhKind
  // The core detail (body + comments) is in flight. The thread prop is already the
  // list-row seed while this is true — header/title/labels paint, body shimmers.
  loading: boolean
  // PR-only: the review timeline is still streaming in behind the thread.
  reviewsLoading: boolean
  width: number
  viewLang: ViewLang
  segment: (id: GhSegmentId) => GhSegmentState | null
  // Comment composer + PR diff state (owned by the useProjectGh controller).
  commentDraft: string
  posting: boolean
  enhancing: boolean
  translating: boolean
  canUndo: boolean
  reviewing: boolean
  reviewError: boolean
  reviewed: boolean
  diffFiles: GhDiffFile[]
  diffLoading: boolean
  // PR commits (lazy — fetched when the Commits tab is first opened).
  commits: GhCommit[]
  commitsLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
  (e: 'set-lang', lang: ViewLang): void
  (e: 'load-diff'): void
  (e: 'load-commits'): void
  (e: 'submit-comment'): void
  (e: 'enhance'): void
  (e: 'undo'): void
  (e: 'approve'): void
  (e: 'translate', lang: TranslateLang): void
  (e: 'update:comment-draft', v: string): void
  (e: 'reply', payload: { author: string; body: string }): void
}>()

const { t } = useI18n()

// Translation tabs, priority order (vi, en, ja) after the original.
const LANGS: ViewLang[] = ['orig', 'vi', 'en', 'ja']

// View-language dropdown — collapses the orig/vi/en/ja tabs into one header button
// (keeps the toolbar roomy on a narrow drawer). Anchored under the trigger; the
// active language carries a trailing check.
const langMenu = useContextMenu()
const langMenuItems = computed<MenuItem[]>(() =>
  LANGS.map((lang) => ({
    id: lang,
    label: t('projects.drawer.viewLang.' + lang),
    active: props.viewLang === lang,
  })),
)
function toggleLangMenu(e: MouseEvent): void {
  if (langMenu.pos.value) {
    langMenu.close()
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  langMenu.pos.value = { x: r.left, y: r.bottom + 4 }
}
function onLangSelect(id: string): void {
  langMenu.close()
  emit('set-lang', id as ViewLang)
}

// ── Content tabs (conditional on kind) ───────────────────────────────────────────
// Conversation = the opening post (description). Comments = the discussion (reviews
// + conversation comments + nested review threads + composer + approve). Issue →
// Conversation | Comments. PR → Conversation | Comments | Commits | Files changed.
// Each tab carries an icon + a count badge (comments / commits / files).
type GhTab = 'conversation' | 'comments' | 'commits' | 'files'
const tabDefs = computed<{ key: GhTab; icon: string; count: number }[]>(() => {
  const commentCount = (props.thread?.comments.length ?? 0) + reviews.value.length
  const defs: { key: GhTab; icon: string; count: number }[] = [
    { key: 'conversation', icon: props.kind === 'pr' ? 'fork' : 'alert', count: 0 },
    { key: 'comments', icon: 'message', count: commentCount },
  ]
  if (props.kind === 'pr') {
    // Commits count is only known once lazily loaded; files count comes from gh.get.
    defs.push({ key: 'commits', icon: 'commit', count: props.commits.length })
    defs.push({ key: 'files', icon: 'file', count: files.value.length })
  }
  return defs
})
const activeTab = ref<GhTab>('conversation')

function selectTab(tab: GhTab): void {
  activeTab.value = tab
  // Lazy-load the commit list the first time the Commits tab is opened.
  if (tab === 'commits') emit('load-commits')
}

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

// Shimmer line widths for the body / discussion placeholders (static descriptors —
// the bar itself is a CSS gradient sweep, see .ghskbar).
const BODY_SK = ['92%', '78%', '85%', '46%'] as const
const COMMENT_SK = ['64%', '88%', '52%'] as const
// Changed files as a directory tree (GitHub-style), single-child chains compressed.
const fileTree = computed(() => buildFileTree(files.value))

// Path of the currently-expanded file row (declared before the watch below, which
// resets it on the initial/immediate run — referencing it later would hit the TDZ).
const expanded = ref<string | null>(null)

// Reset to the Conversation tab + collapse any open diff whenever the opened thread
// changes (the parent re-fetches) — including the initial open.
watch(
  () => props.thread?.number,
  () => {
    expanded.value = null
    activeTab.value = 'conversation'
  },
  { immediate: true },
)

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

// ── PR file diff (lazy reveal) ──────────────────────────────────────────────────
// `expanded` (one open file row at a time) is declared above. Toggling a file in the
// tree asks the parent to fetch the patch once (idempotent in the controller); the
// tree looks up the parsed per-file section from `diffFiles`.
function toggleFile(path: string): void {
  if (expanded.value === path) {
    expanded.value = null
    return
  }
  expanded.value = path
  emit('load-diff')
}

// Two-pane (fullscreen): clicking a file selects it (shows its diff on the right) —
// no toggle-off, the diff pane always reflects a selection.
function selectFile(path: string): void {
  if (expanded.value === path) return
  expanded.value = path
  emit('load-diff')
}

// Look up a parsed per-file patch (used by the two-pane right diff pane).
function patchFor(path: string): string {
  return props.diffFiles.find((f) => f.path === path)?.patch ?? ''
}

// ── PR file context menu (reduced set: copy only) ─────────────────────────────────
// PR changed files are remote diff entries (no local fs), so the menu only offers
// copy-path / copy-name — same generic ContextMenu plumbing as the local-fs trees.
const ghMenu = useContextMenu<{ path: string }>()
const ghMenuItems = computed<MenuItem[]>(() => [
  { id: 'copy-path', label: t('files.ctx.copyPath') },
  { id: 'copy-name', label: t('files.ctx.copyName') },
])
function onGhMenuSelect(id: string): void {
  const tgt = ghMenu.target.value
  ghMenu.close()
  if (!tgt) return
  if (id === 'copy-path') void copyText(tgt.path)
  else if (id === 'copy-name') void copyText(tgt.path.split('/').pop() ?? tgt.path)
}

// ── Composer (Reply focuses it after the parent prefills the draft) ───────────────
const composerRef = useTemplateRef<{ focus: () => void }>('composerRef')
function focusComposer(): void {
  // The composer lives in the Comments tab — switch to it (it may be active already),
  // then focus once mounted.
  activeTab.value = 'comments'
  nextTick(() => composerRef.value?.focus())
}
defineExpose({ focusComposer })

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
/* Placeholder for prose still in flight (body / discussion). Same shimmer as the
   list skeleton: a soft band swept via background-position — paint only. */
.ghsk-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 12px;
}
.ghskbar {
  height: 11px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bgHover) 25%, var(--bgActive) 50%, var(--bgHover) 75%);
  background-size: 200% 100%;
  animation: ghdw-shimmer 1.5s ease-in-out infinite;
}
@keyframes ghdw-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ghskbar {
    animation: none;
    background: var(--bgHover);
  }
}

/* Files-changed two-pane (fullscreen only): turn the scrolling body into a
   non-scrolling flex row so the tree column + diff column each scroll on their own
   (GitHub-style). Higher specificity than the global .ghdwbody so it wins. */
.ghdwbody.gh-files-full {
  padding: 0;
  overflow: hidden;
  display: flex;
}
.ghfiles-2pane {
  flex: 1;
  display: flex;
  min-height: 0;
}
.ghfiles-tree {
  flex: 0 0 260px;
  min-width: 0;
  overflow: auto;
  padding: 8px 6px;
  border-right: 1px solid var(--border);
}
.ghfiles-diff {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.ghfiles-diffhd {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
  font-size: 0.8462rem;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghfiles-pick {
  padding: 28px 16px;
  text-align: center;
}

/* GitHub-style tab bar: underline indicator (not a pill). A bottom border runs the
   full width; the active tab sits on a 2px accent underline that overlaps it, with
   full-color bold text. Inactive = textDim, hover = text. Each tab is icon + label
   + a subtle count badge. */
.ghtabs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.ghtab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 11px;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-size: 1em;
  font-weight: 500;
  white-space: nowrap;
  transition: color 0.12s ease;
}
.ghtab:hover {
  color: var(--text);
}
.ghtab.on {
  color: var(--text);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.ghtab-ic {
  color: var(--textDim);
  flex: 0 0 auto;
}
.ghtab.on .ghtab-ic {
  color: var(--text);
}
.ghtab-n {
  font-size: 12px;
  font-family: var(--code);
  line-height: 1;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--bgActive);
  color: var(--textDim);
  min-width: 18px;
  text-align: center;
}
.ghtab.on .ghtab-n {
  color: var(--text);
}
/* Per-comment Reply action — quiet inline button that quotes the parent. */
.ghreply {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-size: 0.8462rem;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}
.ghreply:hover {
  color: var(--text);
  background: var(--bgHover);
  border-color: var(--borderStrong);
}
.ghchd {
  display: flex;
  align-items: center;
  gap: 5px;
}
/* Comments sit flat on the panel — drop the grey fill, keep the outline + spacing. */
.ghcomment {
  background: transparent;
}
/* A review timeline entry — its header + body + nested threads grouped in a card. */
.ghreview {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 10px 0;
}
.ghreview > .ghchd {
  margin-bottom: 6px;
}
/* Threaded inline review comments: a left rail groups the thread; replies indent. */
.ghrthread {
  border-left: 2px solid var(--border);
  padding-left: 11px;
  margin: 10px 0;
}
.ghrt-loc {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--textDim);
  margin-bottom: 5px;
  overflow-wrap: anywhere;
}
/* The commented code snippet (diff_hunk) above a review thread. */
.ghrt-hunk {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.ghrt-reply {
  margin-left: 18px;
  border-left: 1px solid var(--border);
  padding-left: 11px;
}
/* Approve PR — distinct green outline (not the primary fill, so it doesn't compete
   with the composer's Comment button). */
.ghapprove-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.ghapprove {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--green);
  border-radius: 8px;
  background: transparent;
  color: var(--green);
  font-size: 1em;
  font-weight: 550;
  cursor: pointer;
}
.ghapprove:hover:not(:disabled) {
  background: color-mix(in srgb, var(--green) 12%, transparent);
}
.ghapprove:disabled {
  opacity: 0.5;
  cursor: default;
}
.ghapprove-err {
  font-size: 12px;
  color: var(--danger);
}
/* Post-approve marker (replaces the button once approved). */
.ghapproved {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 1em;
  font-weight: 550;
  color: var(--green);
}
</style>
