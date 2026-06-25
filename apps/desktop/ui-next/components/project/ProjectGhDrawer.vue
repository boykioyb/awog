<template>
  <div class="ghdrawer" :style="{ flex: `0 0 ${width}px`, width: `${width}px` }">
    <div class="ghdwrsz" />
    <div class="ghdwin">
      <div class="ghdwhd">
        <span v-if="item.repo" class="ghrepo">
          <Icon name="git" style="width: 10px; height: 10px" />
          {{ item.repo }}
        </span>
        <span class="ghnum">#{{ item.n }}</span>
        <span class="ghstate" :style="{ color: stateColor, borderColor: stateColor }">
          {{ t('projects.gh.state.' + item.state) }}
        </span>
        <span
          v-if="kind === 'pr' && item.draft"
          class="ghstate"
          style="color: var(--textDim); border-color: var(--border)"
        >
          {{ t('projects.gh.state.draft') }}
        </span>
        <span style="flex: 1" />
        <button
          class="iconbtn"
          :title="t('projects.drawer.translate')"
          :style="{
            width: '28px',
            height: '28px',
            ...(translated ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' } : {}),
          }"
          @click="translated = !translated"
        >
          <Icon name="skills" style="width: 14px; height: 14px" />
        </button>
        <a
          class="iconbtn"
          :href="ghHref"
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
        <div class="ghdwtitle">{{ tr(item.title, item.titleVi) }}</div>
        <div class="ghdwmeta">
          <span class="mono">{{ remote }}</span>
          ·
          <span class="mono">{{ item.author }}</span>
          {{ t('projects.drawer.opened') }} · {{ item.up }}
          <template v-if="kind === 'pr'">
            ·
            <span class="mono">{{ item.base }} ← {{ item.head }}</span>
          </template>
        </div>
        <div
          v-if="(item.labels ?? []).length"
          style="display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px"
        >
          <span
            v-for="l in item.labels"
            :key="l.n"
            class="ghlabel"
            :style="{ color: l.c, borderColor: l.c }"
          >
            {{ l.n }}
          </span>
        </div>
        <div v-if="translated" class="trbadge">
          {{ t('projects.drawer.translatedBadge') }}
        </div>
        <div class="ghmd">
          <p v-for="(par, i) in bodyParagraphs" :key="i">{{ par }}</p>
        </div>
        <div class="sech">{{ t('projects.drawer.comments', { n: item.comments.length }) }}</div>
        <template v-if="item.comments.length">
          <div v-for="(c, i) in item.comments" :key="i" class="ghcomment">
            <div class="ghchd">
              <span class="mono">{{ c.a }}</span>
              · {{ c.w }}
            </div>
            <div class="ghmd">
              <p v-for="(par, j) in paragraphs(tr(c.b, c.bVi))" :key="j">{{ par }}</p>
            </div>
          </div>
        </template>
        <div v-else class="fd">{{ t('projects.drawer.noComment') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GhItem, Project } from './data'

// Right-docked issue/PR detail — port of ghDrawer() (~2269): header (state/draft/
// translate/open/close), body, labels, comments. Markdown is rendered as plain
// paragraphs (no v-html) — fenced/inline-md richness is deferred. Resize handle is
// visual only (drag wiring deferred). Translate toggle (tr) is local.
const props = defineProps<{ project: Project; item: GhItem; kind: 'issue' | 'pr'; width: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()

const translated = ref(false)

function tr(original: string, vi?: string): string {
  return translated.value && vi ? vi : original
}

const stateColor = computed(() =>
  props.item.state === 'open'
    ? 'var(--green)'
    : props.item.state === 'merged'
      ? 'var(--violet)'
      : 'var(--textDim)',
)

const remote = computed(() => {
  const r = props.project.repos.find((x) => x.n === props.item.repo)
  return (r && r.gh) || props.project.gh || ''
})

const ghHref = computed(
  () =>
    `https://github.com/${remote.value}/${props.kind === 'pr' ? 'pull' : 'issues'}/${props.item.n}`,
)

function paragraphs(text: string): string[] {
  return String(text).split('\n\n')
}

const bodyParagraphs = computed(() => paragraphs(tr(props.item.body, props.item.bodyVi)))
</script>
