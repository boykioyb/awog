<template>
  <div class="wreader">
    <header class="wr-head" :style="{ borderBottom: '1px solid var(--border)' }">
      <div class="wr-crumbs" :style="{ color: 'var(--textFaint)' }">
        <span v-for="(crumb, i) in crumbs" :key="i">
          <span v-if="i > 0" class="wr-sep">/</span>
          {{ crumb }}
        </span>
        <span
          v-if="page.source === 'project'"
          class="tag acc"
          style="padding: 1px 6px; margin-left: 6px"
        >
          {{ t('wiki.tier.project') }}
        </span>
      </div>
      <div class="wr-actions">
        <button
          class="wr-btn"
          :title="page.context ? t('wiki.page.inLlm') : t('wiki.page.hiddenFromLlm')"
          @click="emit('toggle-context')"
        >
          <Icon :name="page.context ? 'eye' : 'eye-off'" :size="13" />
        </button>
        <button class="wr-btn" :title="t('wiki.page.edit')" @click="emit('edit')">
          <Icon name="edit" :size="13" />
        </button>
        <button class="wr-btn" :title="t('common.copy')" @click="onCopyPath">
          <Icon :name="copied ? 'check' : 'copy'" :size="13" />
        </button>
        <button class="wr-btn danger" :title="t('wiki.page.delete')" @click="emit('delete')">
          <Icon name="trash" :size="13" />
        </button>
      </div>
    </header>

    <div class="wr-cols">
      <article ref="bodyRef" class="wr-body mdbody" @click="onBodyClick">
        <h1 class="wr-title">{{ page.title }}</h1>
        <p v-if="page.description" class="wr-desc" :style="{ color: 'var(--textDim)' }">
          {{ page.description }}
        </p>
        <div v-if="page.tags.length > 0" class="wr-tags">
          <span v-for="tag in page.tags" :key="tag" class="tag" style="padding: 1px 6px">
            {{ tag }}
          </span>
        </div>
        <template v-for="(seg, i) in segments" :key="i">
          <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
          <div v-else v-html="seg.html" />
        </template>
        <p v-if="truncated" class="wr-trunc" :style="{ color: 'var(--amber)' }">
          {{ t('wiki.page.truncated') }}
        </p>
      </article>

      <aside class="wr-rail" :style="{ borderLeft: '1px solid var(--border)' }">
        <div v-if="outline.length > 0" class="wr-railsec">
          <div class="sech">{{ t('wiki.rail.outline') }}</div>
          <button
            v-for="item in outline"
            :key="item.id"
            class="wr-tocitem"
            :style="{ paddingLeft: `${(item.depth - 1) * 10}px` }"
            @click="scrollTo(item.id)"
          >
            {{ item.text }}
          </button>
        </div>
        <div class="wr-railsec">
          <div class="sech">{{ t('wiki.rail.backlinks') }}</div>
          <div
            v-if="backlinks.length === 0"
            class="wr-railempty"
            :style="{ color: 'var(--textFaint)' }"
          >
            {{ t('wiki.rail.noBacklinks') }}
          </div>
          <button
            v-for="link in backlinks"
            :key="link.path"
            class="wr-tocitem"
            @click="emit('open', link)"
          >
            {{ link.title }}
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
// Wiki page reader: rendered Markdown (mermaid/KaTeX/shiki via useMarkdown),
// heading outline, and backlinks. `[[wikilink]]` targets are rewritten into
// clickable spans before render, so a click is resolved against the loaded tree
// instead of hitting the SPA router (a dead route would 404 the whole page).
import MermaidView from '~/components/common/MermaidView.vue'
import { useMarkdown } from '~/composables/useMarkdown'
import type { WikiPage } from '~/stores/wiki'

const props = defineProps<{
  page: WikiPage
  body: string
  truncated: boolean
  backlinks: WikiPage[]
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  'toggle-context': []
  open: [page: WikiPage]
  'follow-link': [target: string]
}>()

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()

const bodyRef = useTemplateRef<HTMLElement>('bodyRef')
const copied = ref(false)

const crumbs = computed(() => props.page.path.split('/'))

// Rewrite `[[target]]` / `[[target|label]]` into an anchor the click handler picks
// up. Done on the SOURCE (before markdown parsing) because the renderer has no
// concept of wikilinks; `data-wikilink` carries the raw target.
const WIKILINK_RE = /\[\[\s*([^\]|#\n]+?)\s*(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const linkedBody = computed(() =>
  props.body.replace(WIKILINK_RE, (_m, target: string, label?: string) => {
    const text = (label ?? target).trim()
    return `<a href="#" data-wikilink="${escapeHtml(target.trim())}">${escapeHtml(text)}</a>`
  }),
)

const segments = computed(() => renderMarkdown(linkedBody.value))

// Heading outline from the body source — cheaper and more stable than walking the
// rendered DOM, and it matches the anchor ids the renderer assigns.
const outline = computed(() => {
  const items: { id: string; text: string; depth: number }[] = []
  let inFence = false
  for (const raw of props.body.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,4})\s+(.+)$/)
    if (!m?.[1] || !m[2]) continue
    const text = m[2].replace(/[*_`]/g, '').trim()
    items.push({ id: slugifyHeading(text), text, depth: m[1].length })
  }
  return items
})

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function scrollTo(id: string): void {
  const host = bodyRef.value
  if (!host) return
  const target =
    host.querySelector(`#${CSS.escape(id)}`) ??
    [...host.querySelectorAll('h1,h2,h3,h4')].find(
      (h) => slugifyHeading(h.textContent ?? '') === id,
    )
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onBodyClick(event: MouseEvent): void {
  const el = (event.target as HTMLElement | null)?.closest('[data-wikilink]')
  if (!el) return
  event.preventDefault()
  const target = el.getAttribute('data-wikilink')
  if (target) emit('follow-link', target)
}

async function onCopyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.page.path)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard can fail in a non-secure context — silently keep the icon as-is.
  }
}
</script>

<style scoped>
.wreader {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.wr-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  flex: 0 0 auto;
}
.wr-crumbs {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code);
  font-size: 12px;
}
.wr-sep {
  opacity: 0.5;
  margin: 0 4px;
}
.wr-actions {
  display: flex;
  gap: 2px;
}
.wr-btn {
  padding: 6px;
  border: 0;
  background: transparent;
  border-radius: var(--r);
  color: var(--textDim);
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}
.wr-btn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wr-btn.danger:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.wr-cols {
  display: flex;
  flex: 1;
  min-height: 0;
}
.wr-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px 64px;
}
.wr-title {
  font-size: 1.6em;
  font-weight: 600;
  margin: 0 0 4px;
}
.wr-desc {
  margin: 0 0 8px;
  font-size: 1em;
}
.wr-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.wr-trunc {
  margin-top: 16px;
  font-size: 1em;
}
.wr-rail {
  width: 200px;
  flex: 0 0 200px;
  overflow-y: auto;
  padding: 10px 8px;
}
.wr-railsec {
  margin-bottom: 14px;
}
.wr-tocitem {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--textDim);
  cursor: pointer;
  padding: 3px 4px;
  border-radius: var(--r);
  font-size: 1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wr-tocitem:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wr-railempty {
  padding: 2px 4px;
  font-size: 12px;
}
</style>
