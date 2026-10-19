<template>
  <!-- Fullscreen: phủ cả pane issue/PR (cha ProjectGh là `relative`). Dưới 980px bề
       rộng dock ép về 300px (thắng style inline nhờ `!`). -->
  <div
    class="flex overflow-hidden border-l bg-sidebar"
    :class="isFull ? 'absolute inset-0 z-5 w-auto' : 'relative max-[980px]:basis-75!'"
    :style="drawerStyle"
  >
    <!-- Grip kéo đổi bề rộng ở mép trái (không phải control). -->
    <div
      v-show="!isFull"
      role="separator"
      aria-orientation="vertical"
      class="group/rsz absolute inset-y-0 left-0 z-2 w-1.5 cursor-col-resize"
      @mousedown.prevent="onHandleDown"
    >
      <span
        class="absolute inset-y-0 left-0.5 w-px bg-border group-hover/rsz:w-0.5 group-hover/rsz:bg-primary"
      />
    </div>
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Header: ngôn ngữ + tối đa 6 action không vừa một hàng ở bề rộng tối thiểu
           320px — cho wrap thay vì bóp nhỏ vùng bấm. -->
      <div class="flex flex-none flex-wrap items-center gap-2 gap-y-1.5 border-b px-3 py-2.5">
        <span class="flex-none text-xs text-dim tabular-nums">#{{ thread?.number ?? '' }}</span>
        <Badge v-if="thread" variant="outline" :class="[STATE_CHIP, threadStateClass]">
          {{ t('projects.gh.state.' + thread.state.toLowerCase()) }}
        </Badge>
        <Badge
          v-if="kind === 'pr' && thread?.isDraft"
          variant="outline"
          :class="[STATE_CHIP, 'border-border text-dim']"
        >
          {{ t('projects.gh.state.draft') }}
        </Badge>
        <span class="flex-1" />
        <!-- Language picker — collapses the orig/vi/en/ja tabs into one dropdown so
             the header toolbar stays roomy on a narrow drawer. -->
        <Button
          :title="t('projects.drawer.language')"
          :aria-label="t('projects.drawer.language')"
          variant="outline"
          size="xs"
          class="flex-none gap-1 font-normal"
          :class="{ 'border-selected-border text-primary': viewLang !== 'orig' }"
          @click.stop="toggleLangMenu"
        >
          <Icon name="globe" class="size-3.5" />
          <span>{{ t('projects.drawer.viewLang.' + viewLang) }}</span>
          <Icon name="chev" class="size-3" />
        </Button>
        <Button
          :title="isFull ? t('projects.drawer.exitFullscreen') : t('projects.drawer.fullscreen')"
          :aria-label="
            isFull ? t('projects.drawer.exitFullscreen') : t('projects.drawer.fullscreen')
          "
          class="flex-none"
          variant="outline"
          size="iconSm"
          @click="isFull = !isFull"
        >
          <Icon :name="isFull ? 'minimize' : 'maximize'" class="size-3.5" />
        </Button>
        <!-- Always available, thread or not: a detail that failed to arrive is
             exactly the one the user wants to retry. -->
        <Button
          :title="t('projects.drawer.refresh')"
          :aria-label="t('projects.drawer.refresh')"
          :disabled="loading"
          class="flex-none"
          variant="outline"
          size="iconSm"
          @click="emit('refresh')"
        >
          <Icon name="refresh" class="size-3.5" />
        </Button>
        <!-- PR only: hand the review off to a session in this project. The prompt
             comes from Settings → Git (PR review prompt). -->
        <Button
          v-if="kind === 'pr' && thread"
          :title="t('projects.drawer.startReview')"
          :aria-label="t('projects.drawer.startReview')"
          variant="outline"
          size="xs"
          class="flex-none border-selected-border text-primary"
          @click="emit('start-review')"
        >
          <Icon name="play" class="size-3.5" />
          <span>{{ t('projects.drawer.startReviewShort') }}</span>
        </Button>
        <Button
          v-if="thread?.url"
          :href="thread.url"
          target="_blank"
          rel="noopener"
          :title="t('projects.drawer.openOnGithub')"
          :aria-label="t('projects.drawer.openOnGithub')"
          class="flex-none"
          as="a"
          variant="outline"
          size="iconSm"
        >
          <Icon name="external" class="size-3.5" />
        </Button>
        <Button
          v-if="thread?.url"
          :title="linkCopied ? t('projects.drawer.linkCopied') : t('projects.drawer.copyLink')"
          :aria-label="t('projects.drawer.copyLink')"
          class="flex-none"
          :class="{ 'text-success': linkCopied }"
          variant="outline"
          size="iconSm"
          @click="copyLink"
        >
          <Icon :name="linkCopied ? 'check' : 'copy'" class="size-3.5" />
        </Button>
        <Button
          :title="t('projects.drawer.close')"
          :aria-label="t('projects.drawer.close')"
          class="flex-none"
          variant="outline"
          size="iconSm"
          @click="emit('close')"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </div>

      <!-- GitHub-style tab bar (underline indicator + icon + count badge). Issue →
           Conversation | Comments. PR → Conversation | Comments | Commits | Files. -->
      <Tabs
        v-if="thread && tabDefs.length > 1"
        :model-value="activeTab"
        class="flex-none border-b px-3"
        @update:model-value="(v) => selectTab(v as GhTab)"
      >
        <TabsList class="h-auto gap-0.5 rounded-none bg-transparent p-0">
          <TabsTrigger
            v-for="tb in tabDefs"
            :key="tb.key"
            :value="tb.key"
            class="group/tab -mb-px gap-2 rounded-none border-b-2 border-transparent px-3 py-2.5 text-base text-dim shadow-none hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Icon
              :name="tb.icon"
              class="size-3.5 flex-none text-dim group-data-[state=active]/tab:text-foreground"
            />
            <span>{{ t('projects.drawer.tab.' + tb.key) }}</span>
            <span
              v-if="tb.count"
              class="min-w-4.5 rounded-sm bg-muted px-1.5 py-0.5 text-center text-xs text-dim tabular-nums group-data-[state=active]/tab:text-foreground"
            >
              {{ tb.count }}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Files changed ở fullscreen: thân không cuộn mà thành hàng flex để cột cây
           và cột diff tự cuộn riêng (kiểu GitHub). -->
      <div
        class="flex-1"
        :class="
          isFull && activeTab === 'files' && !!thread
            ? 'flex overflow-hidden p-0'
            : 'overflow-y-auto p-3.5'
        "
      >
        <!-- Only a cold open (no list row to seed from) waits on a blank pane —
             normally the header/title/labels are already painted and just the body
             below shimmers. -->
        <div v-if="loading && !thread" class="p-6 text-center text-sm text-dim">
          {{ t('projects.gh.loading') }}
        </div>
        <template v-else-if="thread">
          <!-- ── Conversation: the opening post (meta + labels + body), plus PR
               reviews (the description / overview). ─────────────────────────── -->
          <template v-if="activeTab === 'conversation'">
            <div class="text-lg font-semibold">{{ segText('title', thread.title) }}</div>
            <div class="mt-1 text-base text-dim">
              <!-- mono-ok: login GitHub -->
              <span class="font-mono">{{ thread.author.login }}</span>
              {{ t('projects.drawer.opened') }} · {{ relativeWhen(thread.createdAt) }}
              <template v-if="kind === 'pr' && thread.baseRefName">
                ·
                <!-- mono-ok: tên nhánh git -->
                <span class="font-mono">{{ thread.baseRefName }} ← {{ thread.headRefName }}</span>
              </template>
            </div>
            <div v-if="thread.labels.length" class="mt-2 flex flex-wrap gap-1">
              <!-- Màu nhãn là dữ liệu GitHub (hex của label), không phải token theme. -->
              <span
                v-for="l in thread.labels"
                :key="l.name"
                class="rounded-sm border px-1.5 text-xs"
                :style="ghLabelStyle(l.color, isDark)"
              >
                {{ l.name }}
              </span>
            </div>
            <div
              v-if="viewLang !== 'orig'"
              class="mt-2.5 rounded-sm border border-selected-border bg-selected px-2 py-1 text-xs text-primary"
            >
              {{ t('projects.drawer.translatedBadge') }}
            </div>
            <!-- Body arrives with the core gh.get — shimmer in its place until then. -->
            <div v-if="loading" :class="SK_WRAP">
              <Skeleton
                v-for="w in BODY_SK"
                :key="w"
                class="h-3 rounded-sm"
                :style="{ width: w }"
              />
            </div>
            <div v-else :class="MD">
              <ProjectGhMarkdown :source="segText('body', thread.body)" />
            </div>
          </template>

          <!-- ── Comments: conversation comments + the review timeline (each review
               with its state + body + nested inline threads), Approve + composer. ── -->
          <template v-else-if="activeTab === 'comments'">
            <!-- Conversation comments (top-level PR/issue comments). -->
            <div v-if="thread.comments.length" :class="SECH">
              {{ t('projects.drawer.comments', { n: thread.comments.length }) }}
            </div>
            <!-- Comment nằm phẳng trên panel: chỉ viền, không nền xám. -->
            <div v-for="(c, i) in thread.comments" :key="`c${i}`" :class="COMMENT">
              <div :class="CHD">
                <!-- mono-ok: login GitHub -->
                <span class="font-mono">{{ c.author.login }}</span>
                · {{ relativeWhen(c.createdAt) }}
                <span class="flex-1" />
                <!-- Reply: nút inline kín đáo, trích lại comment cha. -->
                <Button
                  variant="outline"
                  size="xs"
                  class="h-auto gap-1 rounded-sm px-2 py-0.5 font-normal text-dim"
                  :title="t('projects.drawer.reply')"
                  @click="emit('reply', { author: c.author.login, body: c.body })"
                >
                  <Icon name="message" class="size-3" />
                  {{ t('projects.drawer.reply') }}
                </Button>
              </div>
              <div :class="MD">
                <ProjectGhMarkdown :source="segText(i, c.body)" />
              </div>
            </div>

            <!-- PR-only: review timeline — each review's state + body + its nested
                 inline comment threads (root + replies), like GitHub. -->
            <template v-if="kind === 'pr' && reviews.length">
              <div :class="SECH">{{ t('projects.drawer.reviews', { n: reviews.length }) }}</div>
              <div
                v-for="(r, i) in reviews"
                :key="`r${i}`"
                class="my-2.5 rounded-lg border px-3 py-2.5"
              >
                <div :class="[CHD, 'mb-1.5']">
                  <!-- mono-ok: login GitHub -->
                  <span class="font-mono">{{ r.author.login }}</span>
                  <Badge variant="outline" :class="[STATE_CHIP, reviewClass(r.state)]">
                    {{ reviewLabel(r.state) }}
                  </Badge>
                  · {{ relativeWhen(r.createdAt) }}
                </div>
                <div v-if="r.body.trim()" :class="MD">
                  <ProjectGhMarkdown :source="segText(`r${i}`, r.body)" />
                </div>
                <!-- Inline comment threads created by this review: thanh dọc bên trái
                     gom một thread, reply thụt vào. -->
                <div
                  v-for="(th, ti) in r.threads"
                  :key="`r${i}t${ti}`"
                  class="my-2.5 border-l-2 pl-3"
                >
                  <!-- mono-ok: đường dẫn file trong repo -->
                  <div
                    class="mb-1 flex items-center gap-1 font-mono text-sm break-anywhere text-dim"
                  >
                    <Icon name="file" class="size-3" />
                    {{ th.path }}
                    <template v-if="th.line">:{{ th.line }}</template>
                  </div>
                  <!-- The commented code snippet (GitHub's diff_hunk). -->
                  <div v-if="th.diffHunk" class="mb-2 overflow-hidden rounded-md border">
                    <ProjectGhFileDiff :patch="th.diffHunk" />
                  </div>
                  <div
                    v-for="(c, replyIdx) in th.comments"
                    :key="replyIdx"
                    :class="[COMMENT, { 'ml-4.5 border-l pl-3': replyIdx > 0 }]"
                  >
                    <div :class="CHD">
                      <!-- mono-ok: login GitHub -->
                      <span class="font-mono">{{ c.author.login }}</span>
                      · {{ relativeWhen(c.createdAt) }}
                    </div>
                    <div :class="MD">
                      <ProjectGhMarkdown :source="c.body" />
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Comments come with the core detail, the review timeline behind it
                 (gh.reviews) — shimmer for whichever is still in flight. -->
            <div v-if="loading || reviewsLoading" :class="SK_WRAP">
              <Skeleton
                v-for="w in COMMENT_SK"
                :key="w"
                class="h-3 rounded-sm"
                :style="{ width: w }"
              />
            </div>

            <!-- Empty state when there's no discussion yet. -->
            <div
              v-else-if="!thread.comments.length && !reviews.length"
              class="mb-1 text-sm text-dim"
            >
              {{ t('projects.drawer.noComment') }}
            </div>

            <!-- Approve PR with an LGTM! review (open PRs only; hidden once approved).
                 Viền xanh, không fill primary để không tranh với nút Comment. -->
            <div
              v-if="kind === 'pr' && thread.state === 'OPEN' && !reviewed"
              class="mt-3.5 flex items-center gap-2.5"
            >
              <Button
                variant="outline"
                size="sm"
                class="border-success text-success hover:bg-success/10 hover:text-success"
                :disabled="reviewing"
                @click="emit('approve')"
              >
                <Icon name="check" class="size-3.5" />
                {{ reviewing ? t('projects.drawer.approving') : t('projects.drawer.approve') }}
              </Button>
              <span v-if="reviewError" class="text-sm text-destructive">
                {{ t('projects.drawer.approveFailed') }}
              </span>
            </div>
            <div
              v-else-if="kind === 'pr' && reviewed"
              class="mt-3.5 inline-flex items-center gap-1.5 font-medium text-success"
            >
              <Icon name="check" class="size-3.5" />
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
            <div v-if="!files.length" class="text-sm text-dim">
              {{ t('projects.drawer.filesChanged', { n: 0 }) }}
            </div>

            <!-- Two-pane (fullscreen): file tree on the left, selected diff on the right. -->
            <div v-else-if="isFull" class="flex min-h-0 flex-1">
              <div class="w-65 min-w-0 flex-none overflow-auto border-r px-1.5 py-2">
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
              <div class="min-w-0 flex-1 overflow-auto">
                <template v-if="expanded">
                  <div
                    class="sticky top-0 z-1 truncate border-b bg-sidebar px-3 py-2 text-xs text-muted-foreground"
                  >
                    <!-- mono-ok: đường dẫn file -->
                    <span class="font-mono">{{ expanded }}</span>
                  </div>
                  <div v-if="diffLoading" class="p-3.5 text-sm text-dim">
                    {{ t('projects.drawer.diffLoading') }}
                  </div>
                  <ProjectGhFileDiff v-else :patch="patchFor(expanded)" />
                </template>
                <div v-else class="px-4 py-7 text-center text-sm text-dim">
                  {{ t('projects.drawer.pickFile') }}
                </div>
              </div>
            </div>

            <!-- Docked: tree + inline diff. -->
            <template v-else>
              <div :class="SECH">{{ t('projects.drawer.filesChanged', { n: files.length }) }}</div>
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
    <AppContextMenu
      :open="langMenu.pos.value !== null"
      :position="langMenu.pos.value ?? { x: 0, y: 0 }"
      :items="langMenuItems"
      @close="langMenu.close"
      @select="onLangSelect"
    />

    <!-- PR file context menu (copy path / name). -->
    <AppContextMenu
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
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Skeleton from '~/components/ui/skeleton/Skeleton.vue'
import Tabs from '~/components/ui/tabs/Tabs.vue'
import TabsList from '~/components/ui/tabs/TabsList.vue'
import TabsTrigger from '~/components/ui/tabs/TabsTrigger.vue'

// Chỉ đọc chế độ sáng/tối cho ghLabelStyle (màu nhãn là dữ liệu GitHub) — không
// dùng để tô token theme.
// theme-ok: isDark chọn cách vẽ nhãn GitHub (màu nhãn là dữ liệu)
const { isDark } = useTheme()

// Class dùng lặp trong template.
const STATE_CHIP = 'flex-none rounded-sm px-1.5 py-0 capitalize'
const SECH = 'mt-5 mb-2 text-xs font-semibold text-dim first:mt-0'
const COMMENT = 'mb-2 rounded-md border px-3 py-2.5'
const CHD = 'mb-1 flex items-center gap-1 text-sm text-muted-foreground'
const MD = 'mt-2.5 text-base'
const SK_WRAP = 'mt-3 flex flex-col gap-2'

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
  // PR only: open a session on this pull request and send the review prompt.
  (e: 'start-review'): void
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

// Copy the thread's GitHub URL — the glyph flips to a check for a moment so the
// click has an answer (no toast plumbing for a one-shot header action). The timer
// is cleared on unmount so a copy right before closing can't tick into nothing.
const linkCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyLink(): Promise<void> {
  const url = props.thread?.url
  if (!url) return
  await copyText(url)
  linkCopied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (linkCopied.value = false), 1500)
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

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
// thanh là Skeleton shadcn).
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

// Chip trạng thái thread: chữ + viền cùng một màu.
const threadStateClass = computed(() => {
  const st = props.thread?.state
  if (st === 'OPEN') return 'border-success text-success'
  return st === 'MERGED' ? 'border-lavender text-lavender' : 'border-dim text-dim'
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
function reviewClass(state: string): string {
  if (state === 'APPROVED') return 'border-success text-success'
  if (state === 'CHANGES_REQUESTED') return 'border-destructive text-destructive'
  if (state === 'DISMISSED') return 'border-dim text-dim'
  return 'border-muted-foreground text-muted-foreground'
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
