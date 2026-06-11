<template>
  <div>
    <template v-for="(block, bi) in blocks" :key="bi">
      <MermaidBlock v-if="block.type === 'mermaid'" :code="block.code" />

      <pre
        v-else-if="block.type === 'code'"
        class="rounded p-3 my-3 overflow-x-auto text-[1em] font-mono"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}`, color: t.syntax.code }"
      ><div
          v-if="block.lang"
          class="text-[1em] mb-2 pb-1"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >{{ block.lang }}</div>{{ block.code }}</pre>

      <h1
        v-else-if="block.type === 'h1'"
        class="text-2xl font-bold mt-6 mb-3 pb-2"
        :style="{ color: t.syntax.h1, borderBottom: `1px solid ${t.border}` }"
      >
        <MarkdownInline :parts="block.parts" />
      </h1>

      <h2
        v-else-if="block.type === 'h2'"
        class="text-xl font-bold mt-5 mb-2"
        :style="{ color: t.syntax.h2 }"
      >
        <MarkdownInline :parts="block.parts" />
      </h2>

      <h3
        v-else-if="block.type === 'h3'"
        class="text-base font-semibold mt-4 mb-2"
        :style="{ color: t.syntax.h3 }"
      >
        <MarkdownInline :parts="block.parts" />
      </h3>

      <ul v-else-if="block.type === 'ul'" class="my-2 space-y-1">
        <li v-for="(item, ii) in block.items" :key="ii" class="text-[1em] leading-relaxed">
          <div class="flex gap-2">
            <span :style="{ color: t.syntax.listMark }">•</span>
            <span :style="{ color: t.text }">
              <MarkdownInline :parts="item.parts" />
            </span>
          </div>
          <MarkdownRenderer v-if="item.children.length" :blocks="item.children" class="ml-4" />
        </li>
      </ul>

      <ol v-else-if="block.type === 'ol'" class="my-2 space-y-1">
        <li v-for="(item, ii) in block.items" :key="ii" class="text-[1em] leading-relaxed">
          <div class="flex gap-2">
            <span class="font-mono" :style="{ color: t.syntax.listMark }">{{ ii + 1 }}.</span>
            <span :style="{ color: t.text }">
              <MarkdownInline :parts="item.parts" />
            </span>
          </div>
          <MarkdownRenderer v-if="item.children.length" :blocks="item.children" class="ml-4" />
        </li>
      </ol>

      <div v-else-if="block.type === 'table'" class="my-2 overflow-x-auto">
        <table class="text-[1em]" :style="{ borderCollapse: 'collapse' }">
          <thead>
            <tr>
              <th
                v-for="(cell, ci) in block.headers"
                :key="ci"
                class="px-2 py-1 font-semibold"
                :style="{
                  border: `1px solid ${t.border}`,
                  background: t.bgSubtle,
                  color: t.text,
                  textAlign: block.aligns[ci] ?? 'left',
                  whiteSpace: 'nowrap',
                }"
              >
                <MarkdownInline :parts="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in block.rows" :key="ri">
              <td
                v-for="(cell, ci) in row"
                :key="ci"
                class="px-2 py-1 align-top"
                :style="{
                  border: `1px solid ${t.border}`,
                  color: t.text,
                  textAlign: block.aligns[ci] ?? 'left',
                }"
              >
                <MarkdownInline :parts="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr
        v-else-if="block.type === 'hr'"
        class="my-3 border-0 border-t"
        :style="{ borderColor: t.border }"
      />

      <blockquote
        v-else-if="block.type === 'blockquote'"
        class="border-l-2 pl-3 my-2 italic text-[1em]"
        :style="{ borderColor: t.syntax.blockquote, color: t.syntax.blockquote }"
      >
        <MarkdownInline :parts="block.parts" muted />
      </blockquote>

      <div v-else-if="block.type === 'empty'" class="h-2" />

      <p
        v-else-if="block.type === 'p'"
        class="text-[1em] leading-relaxed my-1"
        :style="{ color: t.text }"
      >
        <MarkdownInline :parts="block.parts" />
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { parseMarkdown, type Block } from '~/utils/markdown-parse'

// `content` for the top-level call (raw markdown string); `blocks` for recursive
// rendering of an already-parsed nested sub-list. Exactly one is supplied.
const props = defineProps<{ content?: string; blocks?: Block[] }>()
const { t } = useTheme()

const blocks = computed<Block[]>(() => props.blocks ?? parseMarkdown(props.content ?? ''))
</script>
