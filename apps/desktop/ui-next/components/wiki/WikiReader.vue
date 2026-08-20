<template>
  <div class="wreader">
    <header class="wr-head" :style="{ borderBottom: '1px solid var(--border)' }">
      <div class="wr-crumbs" :style="{ color: 'var(--textFaint)' }">
        <span v-for="(crumb, i) in crumbs" :key="crumb.path">
          <span v-if="i > 0" class="wr-sep">/</span>
          <!-- Ancestors navigate; the last crumb IS this page so it stays text. A crumb
               with no page behind it routes through follow-link, which offers to create
               it — the same affordance a dead [[link]] gets. -->
          <button
            v-if="i < crumbs.length - 1"
            class="wr-crumb"
            @click="emit('follow-link', crumb.path)"
          >
            {{ crumb.label }}
          </button>
          <span v-else>{{ crumb.label }}</span>
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
      <article ref="bodyRef" class="wr-body" @click="onBodyClick">
        <div class="wr-doc mdbody">
          <h1 class="wr-title">{{ page.title }}</h1>
          <div v-if="page.tags.length > 0" class="wr-tags">
            <!-- keyed by index: frontmatter can legitimately repeat a tag -->
            <span
              v-for="(tag, ti) in page.tags"
              :key="`${tag}:${ti}`"
              class="tag"
              style="padding: 1px 6px"
            >
              {{ tag }}
            </span>
          </div>
          <p v-if="droppedHtml > 0" class="wr-htmlnote" :style="{ color: 'var(--amber)' }">
            {{ t('wiki.page.htmlStripped', { n: droppedHtml }) }}
          </p>
          <template v-for="(seg, i) in segments" :key="i">
            <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
            <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
            <div v-else v-html="seg.html" />
          </template>
          <p v-if="truncated" class="wr-trunc" :style="{ color: 'var(--amber)' }">
            {{ t('wiki.page.truncated') }}
          </p>
        </div>
      </article>

      <aside class="wr-rail" :style="{ borderLeft: '1px solid var(--border)' }">
        <div v-if="outline.length > 0" class="wr-railsec">
          <div class="sech">{{ t('wiki.rail.outline') }}</div>
          <button
            v-for="item in outline"
            :key="`${item.id}:${item.index}`"
            class="wr-tocitem"
            :style="{ paddingLeft: `${(item.depth - 1) * 10}px` }"
            @click="scrollTo(item)"
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
            :key="`${link.source}|${link.projectId ?? ''}|${link.path}`"
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
//
// The page `description` is deliberately NOT shown here. It is index metadata (the
// one line the LLM sees in <wiki_index>, and the tree row's tooltip); when it was
// derived from the body it IS the body's first line, and even an authored one is a
// summary the author would put in the content if they wanted it read. Printing it
// above the body only ever duplicated a sentence.
// heading outline, and backlinks. `[[wikilink]]` targets are rewritten into
// clickable spans before render, so a click is resolved against the loaded tree
// instead of hitting the SPA router (a dead route would 404 the whole page).
import MermaidView from '~/components/common/MermaidView.vue'
import { useCodeCopy } from '~/composables/useCodeCopy'
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

// Each crumb carries the slug of the ancestor it points at, not just its label.
const crumbs = computed(() => {
  const segments = props.page.path.split('/')
  return segments.map((label, i) => ({ label, path: segments.slice(0, i + 1).join('/') }))
})

// Rewrite `[[target]]` / `[[target|label]]` into an anchor the click handler picks
// up. Done on the SOURCE (before markdown parsing) because the renderer has no
// concept of wikilinks; `data-wikilink` carries the raw target.
const WIKILINK_RE = /\[\[\s*([^\]|#\n]+?)\s*(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Most imported pages open with `# Their Title`, and the reader already shows the
// page title above the body — rendering both prints the title twice. Drop a
// LEADING h1 whose text matches the title; a different h1 is real content and stays.
function stripDuplicateTitle(body: string): string {
  const m = body.match(/^\s*#\s+(.+?)\s*(?:\n|$)/)
  if (!m?.[1]) return body
  const norm = (v: string): string => v.replace(/[*_`]/g, '').trim().toLowerCase()
  if (norm(m[1]) !== norm(props.page.title)) return body
  return body.slice(m[0].length).replace(/^\n+/, '')
}

const linkedBody = computed(() =>
  stripDuplicateTitle(props.body).replace(WIKILINK_RE, (_m, target: string, label?: string) => {
    const text = (label ?? target).trim()
    return `<a href="#" data-wikilink="${escapeHtml(target.trim())}">${escapeHtml(text)}</a>`
  }),
)

const segments = computed(() => renderMarkdown(linkedBody.value))

// Per-code-block copy button + language chip. The buttons are injected into the
// v-html output from outside (utils/code-copy), so this must re-run whenever the
// rendered segments change — the composable watches them.
useCodeCopy(bodyRef, () => segments.value)

// Raw HTML is removed by the shared markdown renderer — it feeds `v-html`, and the
// same pipeline renders untrusted model output in the transcript, so author HTML is
// an XSS surface we do not open. Dropping it SILENTLY is the problem: an imported doc
// using `<details>` or `<img>` just looks broken. Count the blocks and say so.
// Conservative tag list — prose like `<placeholder>` or `Array<string>` must not
// trigger it.
const HTML_BLOCK_RE =
  /<\/?(details|summary|div|span|table|thead|tbody|tr|td|th|br|hr|img|iframe|video|audio|picture|source|figure|figcaption|p|b|i|u|em|strong|kbd|sub|sup|small|mark|dl|dt|dd|center|font)\b[^>]*>/gi

const droppedHtml = computed(() => {
  let inFence = false
  let count = 0
  for (const raw of props.body.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    count += [...line.matchAll(HTML_BLOCK_RE)].length
  }
  return count
})

// Heading outline from the body source — cheaper and more stable than walking the
// rendered DOM, and it matches the anchor ids the renderer assigns.
const outline = computed(() => {
  // `index` exists because two headings can share text ("Active Record" under two
  // sections): keying the list by slug alone produced duplicate Vue keys, and a click
  // could only ever reach the first of them.
  const items: { id: string; text: string; depth: number; index: number }[] = []
  let inFence = false
  // Built from the SAME body the reader renders, so a stripped duplicate title
  // does not leave a phantom entry that scrolls nowhere.
  for (const raw of stripDuplicateTitle(props.body).split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,4})\s+(.+)$/)
    if (!m?.[1] || !m[2]) continue
    const text = m[2].replace(/[*_`]/g, '').trim()
    items.push({ id: slugifyHeading(text), text, depth: m[1].length, index: items.length })
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

function scrollTo(item: { id: string; index: number }): void {
  const host = bodyRef.value
  if (!host) return
  // Which occurrence of this slug the clicked row is, so a repeated heading scrolls to
  // ITS own position instead of always the first one.
  const occurrence = outline.value
    .filter((o) => o.id === item.id)
    .findIndex((o) => o.index === item.index)
  const matches = [...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(
    (h) => slugifyHeading(h.textContent ?? '') === item.id,
  )
  const target = matches[Math.max(0, occurrence)] ?? host.querySelector(`#${CSS.escape(item.id)}`)
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
.wr-crumb {
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.wr-crumb:hover {
  color: var(--text);
  text-decoration: underline;
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
/* Cap the measure: a full-width line on a 27" display is unreadable prose. Tables
   and code blocks scroll inside this column rather than widening it. */
.wr-doc {
  max-width: 82ch;
  margin: 0 auto;
}
.wr-title {
  font-size: 1.6em;
  font-weight: 600;
  line-height: 1.25;
  margin: 0 0 4px;
}
.wr-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.wr-trunc,
.wr-htmlnote {
  margin-top: 16px;
  font-size: 1em;
}
.wr-htmlnote {
  margin: 0 0 12px;
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
