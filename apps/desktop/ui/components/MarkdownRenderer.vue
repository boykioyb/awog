<template>
  <div>
    <template v-for="(block, bi) in blocks" :key="bi">
      <MermaidBlock v-if="block.type === 'mermaid'" :code="block.code" />

      <pre
        v-else-if="block.type === 'code'"
        class="rounded p-3 my-3 overflow-x-auto text-[12px] font-mono"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}`, color: t.syntax.code }"
      ><div
          v-if="block.lang"
          class="text-[10px] mb-2 pb-1"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >{{ block.lang }}</div>{{ block.code }}</pre>

      <h1
        v-else-if="block.type === 'h1'"
        class="text-2xl font-bold mt-6 mb-3 pb-2"
        :style="{ color: t.syntax.h1, borderBottom: `1px solid ${t.border}` }"
      >
        <template v-for="(p, pi) in block.parts" :key="pi">
          <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
            {{ p.text }}
          </strong>
          <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
          <code
            v-else-if="p.type === 'code'"
            class="px-1 py-0.5 rounded font-mono text-[12px]"
            :style="{
              background: t.bgInput,
              color: t.syntax.code,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ p.text }}
          </code>
          <a
            v-else-if="p.type === 'link'"
            :href="p.href"
            class="underline"
            :style="{ color: t.syntax.link }"
          >
            {{ p.text }}
          </a>
          <span v-else>{{ p.text }}</span>
        </template>
      </h1>

      <h2
        v-else-if="block.type === 'h2'"
        class="text-xl font-bold mt-5 mb-2"
        :style="{ color: t.syntax.h2 }"
      >
        <template v-for="(p, pi) in block.parts" :key="pi">
          <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
            {{ p.text }}
          </strong>
          <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
          <code
            v-else-if="p.type === 'code'"
            class="px-1 py-0.5 rounded font-mono text-[12px]"
            :style="{
              background: t.bgInput,
              color: t.syntax.code,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ p.text }}
          </code>
          <a
            v-else-if="p.type === 'link'"
            :href="p.href"
            class="underline"
            :style="{ color: t.syntax.link }"
          >
            {{ p.text }}
          </a>
          <span v-else>{{ p.text }}</span>
        </template>
      </h2>

      <h3
        v-else-if="block.type === 'h3'"
        class="text-base font-semibold mt-4 mb-2"
        :style="{ color: t.syntax.h3 }"
      >
        <template v-for="(p, pi) in block.parts" :key="pi">
          <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
            {{ p.text }}
          </strong>
          <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
          <code
            v-else-if="p.type === 'code'"
            class="px-1 py-0.5 rounded font-mono text-[12px]"
            :style="{
              background: t.bgInput,
              color: t.syntax.code,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ p.text }}
          </code>
          <a
            v-else-if="p.type === 'link'"
            :href="p.href"
            class="underline"
            :style="{ color: t.syntax.link }"
          >
            {{ p.text }}
          </a>
          <span v-else>{{ p.text }}</span>
        </template>
      </h3>

      <ul v-else-if="block.type === 'ul'" class="my-2 space-y-1">
        <li
          v-for="(item, ii) in block.items"
          :key="ii"
          class="flex gap-2 text-[13px] leading-relaxed"
        >
          <span :style="{ color: t.syntax.listMark }">•</span>
          <span :style="{ color: t.text }">
            <template v-for="(p, pi) in item" :key="pi">
              <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
                {{ p.text }}
              </strong>
              <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">
                {{ p.text }}
              </em>
              <code
                v-else-if="p.type === 'code'"
                class="px-1 py-0.5 rounded font-mono text-[12px]"
                :style="{
                  background: t.bgInput,
                  color: t.syntax.code,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ p.text }}
              </code>
              <a
                v-else-if="p.type === 'link'"
                :href="p.href"
                class="underline"
                :style="{ color: t.syntax.link }"
              >
                {{ p.text }}
              </a>
              <span v-else>{{ p.text }}</span>
            </template>
          </span>
        </li>
      </ul>

      <ol v-else-if="block.type === 'ol'" class="my-2 space-y-1">
        <li
          v-for="(item, ii) in block.items"
          :key="ii"
          class="flex gap-2 text-[13px] leading-relaxed"
        >
          <span class="font-mono" :style="{ color: t.syntax.listMark }">{{ ii + 1 }}.</span>
          <span :style="{ color: t.text }">
            <template v-for="(p, pi) in item" :key="pi">
              <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
                {{ p.text }}
              </strong>
              <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">
                {{ p.text }}
              </em>
              <code
                v-else-if="p.type === 'code'"
                class="px-1 py-0.5 rounded font-mono text-[12px]"
                :style="{
                  background: t.bgInput,
                  color: t.syntax.code,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ p.text }}
              </code>
              <a
                v-else-if="p.type === 'link'"
                :href="p.href"
                class="underline"
                :style="{ color: t.syntax.link }"
              >
                {{ p.text }}
              </a>
              <span v-else>{{ p.text }}</span>
            </template>
          </span>
        </li>
      </ol>

      <blockquote
        v-else-if="block.type === 'blockquote'"
        class="border-l-2 pl-3 my-2 italic text-[13px]"
        :style="{ borderColor: t.syntax.blockquote, color: t.syntax.blockquote }"
      >
        <template v-for="(p, pi) in block.parts" :key="pi">
          <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
            {{ p.text }}
          </strong>
          <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
          <code
            v-else-if="p.type === 'code'"
            class="px-1 py-0.5 rounded font-mono text-[12px]"
            :style="{
              background: t.bgInput,
              color: t.syntax.code,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ p.text }}
          </code>
          <a
            v-else-if="p.type === 'link'"
            :href="p.href"
            class="underline"
            :style="{ color: t.syntax.link }"
          >
            {{ p.text }}
          </a>
          <span v-else>{{ p.text }}</span>
        </template>
      </blockquote>

      <div v-else-if="block.type === 'empty'" class="h-2" />

      <p
        v-else-if="block.type === 'p'"
        class="text-[13px] leading-relaxed my-1"
        :style="{ color: t.text }"
      >
        <template v-for="(p, pi) in block.parts" :key="pi">
          <strong v-if="p.type === 'bold'" :style="{ color: t.syntax.bold, fontWeight: 600 }">
            {{ p.text }}
          </strong>
          <em v-else-if="p.type === 'italic'" :style="{ color: t.syntax.italic }">{{ p.text }}</em>
          <code
            v-else-if="p.type === 'code'"
            class="px-1 py-0.5 rounded font-mono text-[12px]"
            :style="{
              background: t.bgInput,
              color: t.syntax.code,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ p.text }}
          </code>
          <a
            v-else-if="p.type === 'link'"
            :href="p.href"
            class="underline"
            :style="{ color: t.syntax.link }"
          >
            {{ p.text }}
          </a>
          <span v-else>{{ p.text }}</span>
        </template>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ content: string }>()
const { t } = useTheme()

interface InlinePart {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link'
  text: string
  href?: string
}

type Block =
  | { type: 'mermaid'; code: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'h1' | 'h2' | 'h3'; parts: InlinePart[] }
  | { type: 'ul' | 'ol'; items: InlinePart[][] }
  | { type: 'blockquote'; parts: InlinePart[] }
  | { type: 'empty' }
  | { type: 'p'; parts: InlinePart[] }

function renderInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  let remaining = text
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*/)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*/)
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/)

    type InlineMatch = {
      match: RegExpMatchArray
      type: 'bold' | 'italic' | 'code' | 'link'
      idx: number
    }
    const matches = (
      [
        boldMatch && { match: boldMatch, type: 'bold' as const, idx: boldMatch[1].length },
        italicMatch && { match: italicMatch, type: 'italic' as const, idx: italicMatch[1].length },
        codeMatch && { match: codeMatch, type: 'code' as const, idx: codeMatch[1].length },
        linkMatch && { match: linkMatch, type: 'link' as const, idx: linkMatch[1].length },
      ].filter(Boolean) as InlineMatch[]
    ).sort((a, b) => a.idx - b.idx)

    if (matches.length === 0) {
      parts.push({ type: 'text', text: remaining })
      break
    }

    const first = matches[0]
    if (first.idx > 0) parts.push({ type: 'text', text: remaining.slice(0, first.idx) })

    if (first.type === 'bold') {
      parts.push({ type: 'bold', text: first.match[2] })
      remaining = remaining.slice(first.idx + first.match[2].length + 4)
    } else if (first.type === 'italic') {
      parts.push({ type: 'italic', text: first.match[2] })
      remaining = remaining.slice(first.idx + first.match[2].length + 2)
    } else if (first.type === 'code') {
      parts.push({ type: 'code', text: first.match[2] })
      remaining = remaining.slice(first.idx + first.match[2].length + 2)
    } else if (first.type === 'link') {
      parts.push({ type: 'link', text: first.match[2], href: first.match[3] })
      remaining = remaining.slice(first.idx + first.match[2].length + first.match[3].length + 4)
    }
  }
  return parts
}

const blocks = computed<Block[]>(() => {
  const lines = props.content.split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      const codeContent = codeLines.join('\n')
      if (lang === 'mermaid') {
        out.push({ type: 'mermaid', code: codeContent })
      } else {
        out.push({ type: 'code', lang, code: codeContent })
      }
      i++
      continue
    }

    if (line.startsWith('# ')) {
      out.push({ type: 'h1', parts: renderInline(line.slice(2)) })
      i++
      continue
    }
    if (line.startsWith('## ')) {
      out.push({ type: 'h2', parts: renderInline(line.slice(3)) })
      i++
      continue
    }
    if (line.startsWith('### ')) {
      out.push({ type: 'h3', parts: renderInline(line.slice(4)) })
      i++
      continue
    }

    if (line.match(/^[-*]\s/)) {
      const items: InlinePart[][] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push(renderInline(lines[i].replace(/^[-*]\s/, '')))
        i++
      }
      out.push({ type: 'ul', items })
      continue
    }
    if (line.match(/^\d+\.\s/)) {
      const items: InlinePart[][] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(renderInline(lines[i].replace(/^\d+\.\s/, '')))
        i++
      }
      out.push({ type: 'ol', items })
      continue
    }

    if (line.startsWith('> ')) {
      out.push({ type: 'blockquote', parts: renderInline(line.slice(2)) })
      i++
      continue
    }

    if (line.trim() === '') {
      out.push({ type: 'empty' })
      i++
      continue
    }

    out.push({ type: 'p', parts: renderInline(line) })
    i++
  }
  return out
})
</script>
