<template>
  <div class="flex h-full min-w-0 flex-1 flex-col">
    <header class="flex flex-none items-center gap-2 border-b px-2.5 py-1.5">
      <div class="min-w-0 flex-1 truncate text-sm text-faint">
        <span v-for="(crumb, i) in crumbs" :key="crumb.path">
          <span v-if="i > 0" class="mx-1 opacity-50">/</span>
          <!-- Ancestors navigate; the last crumb IS this page so it stays text. A crumb
               with no page behind it routes through follow-link, which offers to create
               it — the same affordance a dead [[link]] gets. -->
          <Button
            v-if="i < crumbs.length - 1"
            variant="link"
            class="h-auto p-0 text-sm font-normal text-inherit hover:text-foreground"
            @click="emit('follow-link', crumb.path)"
          >
            {{ crumb.label }}
          </Button>
          <span v-else>{{ crumb.label }}</span>
        </span>
        <Badge
          v-if="page.source === 'project'"
          variant="outline"
          class="ml-1.5 border-primary/40 bg-primary/10 px-1.5 py-0 text-primary"
        >
          {{ t('wiki.tier.project') }}
        </Badge>
      </div>
      <div class="flex gap-0.5">
        <Button
          variant="ghost"
          size="iconMd"
          class="text-dim"
          :title="page.context ? t('wiki.page.inLlm') : t('wiki.page.hiddenFromLlm')"
          :aria-label="page.context ? t('wiki.page.inLlm') : t('wiki.page.hiddenFromLlm')"
          @click="emit('toggle-context')"
        >
          <Icon :name="page.context ? 'eye' : 'eye-off'" class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-dim"
          :title="t('wiki.page.edit')"
          :aria-label="t('wiki.page.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-dim"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="onCopyPath"
        >
          <Icon :name="copied ? 'check' : 'copy'" class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-dim hover:bg-destructive/10 hover:text-destructive"
          :title="t('wiki.page.delete')"
          :aria-label="t('wiki.page.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" class="size-3.5" />
        </Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <article
        ref="bodyRef"
        class="min-w-0 flex-1 overflow-y-auto px-6 pt-4 pb-16"
        @click="onBodyClick"
      >
        <!-- `mdbody` = prose markdown toàn cục (assets/css/markdown.css). Giới hạn bề
             rộng dòng: dòng tràn cả màn 27" không đọc nổi; bảng/code tự cuộn trong cột. -->
        <div class="mdbody mx-auto max-w-[82ch]">
          <h1 class="mt-0 mb-1 text-2xl font-semibold">{{ page.title }}</h1>
          <div v-if="page.tags.length > 0" class="mb-3 flex flex-wrap gap-1">
            <!-- keyed by index: frontmatter can legitimately repeat a tag -->
            <Badge
              v-for="(tag, ti) in page.tags"
              :key="`${tag}:${ti}`"
              variant="outline"
              class="px-1.5 py-0 text-muted-foreground"
            >
              {{ tag }}
            </Badge>
          </div>
          <p v-if="droppedHtml > 0" class="mt-0 mb-3 text-base text-warning">
            {{ t('wiki.page.htmlStripped', { n: droppedHtml }) }}
          </p>
          <template v-for="(seg, i) in segments" :key="i">
            <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
            <pre v-else-if="seg.type === 'widget'"><code>{{ seg.code }}</code></pre>
            <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
            <div v-else v-html="seg.html" />
          </template>
          <p v-if="truncated" class="mt-4 text-base text-warning">
            {{ t('wiki.page.truncated') }}
          </p>
        </div>
      </article>

      <aside class="w-50 flex-none overflow-y-auto border-l px-2 py-2.5">
        <div v-if="outline.length > 0" class="mb-3.5">
          <div class="mb-1 text-xs font-semibold text-dim">{{ t('wiki.rail.outline') }}</div>
          <Button
            v-for="item in outline"
            :key="`${item.id}:${item.index}`"
            variant="ghost"
            size="xs"
            class="w-full justify-start px-1 text-base font-normal text-dim"
            :style="{ paddingLeft: `${(item.depth - 1) * 10 + 4}px` }"
            @click="scrollTo(item)"
          >
            <span class="truncate">{{ item.text }}</span>
          </Button>
        </div>
        <div class="mb-3.5">
          <div class="mb-1 text-xs font-semibold text-dim">{{ t('wiki.rail.backlinks') }}</div>
          <div v-if="backlinks.length === 0" class="px-1 py-0.5 text-sm text-faint">
            {{ t('wiki.rail.noBacklinks') }}
          </div>
          <Button
            v-for="link in backlinks"
            :key="`${link.source}|${link.projectId ?? ''}|${link.path}`"
            variant="ghost"
            size="xs"
            class="w-full justify-start px-1 text-base font-normal text-dim"
            @click="emit('open', link)"
          >
            <span class="truncate">{{ link.title }}</span>
          </Button>
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
import { useCodeBlockControls } from '~/composables/useCodeBlockControls'
import { useMarkdown } from '~/composables/useMarkdown'
import type { WikiPage } from '~/stores/wiki'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'

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
// v-html output from outside (utils/code-block-controls), so this must re-run whenever the
// rendered segments change — the composable watches them.
useCodeBlockControls(bodyRef, () => segments.value)

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
