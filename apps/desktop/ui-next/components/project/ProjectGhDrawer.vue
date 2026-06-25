<template>
  <div class="ghdrawer" :style="{ flex: `0 0 ${width}px`, width: `${width}px` }">
    <div class="ghdwrsz" />
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
              :style="labelStyle(l.color)"
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
          <div v-else class="fd">{{ t('projects.drawer.noComment') }}</div>
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
// the useProjectGh controller and forwards thread + segment lookups.
import { computed } from 'vue'
import type {
  GhKind,
  GhSegmentId,
  GhSegmentState,
  GhThread,
  ViewLang,
} from '~/composables/useProjectGh'

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

function paragraphs(text: string): string[] {
  return String(text).split('\n\n')
}

const bodyParagraphs = computed(() => {
  if (!props.thread) return []
  return paragraphs(segText('body', props.thread.body))
})

function labelStyle(color: string): Record<string, string> {
  const c = color ? `#${color}` : 'var(--textDim)'
  return { color: c, borderColor: c }
}

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
