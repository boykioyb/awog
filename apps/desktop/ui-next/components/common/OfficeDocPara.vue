<template>
  <p
    :class="cn('text-foreground', para.marker ? LIST_ROW : STYLE_CLASS[para.style])"
    :style="paraStyle"
  >
    <!-- Hàng list: marker cột riêng để chữ xuống dòng thẳng hàng dưới chữ. -->
    <span v-if="para.marker" class="min-w-4.5 shrink-0 text-dim tabular-nums">
      {{ para.marker }}
    </span>
    <!-- Run DOCX mang xuống dòng (w:br) và tab của chính nó — giữ nguyên (pre-wrap). -->
    <span class="min-w-0 whitespace-pre-wrap">
      <template v-for="(run, i) in para.runs" :key="i">
        <a
          v-if="run.href"
          class="text-primary underline"
          :class="runClass(run)"
          :href="run.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ run.text }}
        </a>
        <sub v-else-if="run.vert === 'sub'" :class="runClass(run)">
          {{ run.text }}
        </sub>
        <sup v-else-if="run.vert === 'sup'" :class="runClass(run)">
          {{ run.text }}
        </sup>
        <span v-else :class="runClass(run)">{{ run.text }}</span>
      </template>
    </span>
  </p>
</template>

<script setup lang="ts">
// One DOCX paragraph: optional list marker + its formatted runs. Shared by the
// document body and by table cells (which hold paragraphs too), which is why this
// is its own component rather than markup inlined in OfficeDocView.
import { cn } from '~/lib/utils'
import type { DocxParaStyle, DocxParagraph, DocxRun } from '~/utils/office-docx'

const props = defineProps<{ para: DocxParagraph }>()

// Indent steps mirror Word's list levels / left indent; 18px reads as one step.
const paraStyle = computed(() => ({
  ...(props.para.indent ? { paddingLeft: `${props.para.indent * 18}px` } : {}),
  ...(props.para.align ? { textAlign: props.para.align } : {}),
}))

// Kiểu đoạn → class. Cỡ heading tính bằng `em` (tương đối với cột đọc), nên leading
// cũng là hệ số tương đối — không có một px chẵn nào đúng cho cả nhóm h1…h4.
// `leading-*` luôn đứng SAU cỡ chữ: tailwind-merge coi cỡ chữ đứng sau là ghi đè leading.
const PROSE = 'leading-(--lh-prose)'
const HEADING = 'mt-[1.15em] mb-[0.5em] font-semibold'
const STYLE_CLASS: Record<DocxParaStyle, string> = {
  body: `my-[0.55em] ${PROSE}`,
  h1: `${HEADING} border-b pb-[0.3em] text-[1.6em] leading-[1.3]`,
  h2: `${HEADING} text-[1.35em] leading-[1.3]`,
  h3: `${HEADING} text-[1.15em] leading-[1.3]`,
  h4: `${HEADING} text-[1.05em] leading-[1.3]`,
  quote: `my-[0.55em] border-l-3 pl-[1em] text-muted-foreground ${PROSE}`,
  // mono: đoạn code trong .docx
  code: `my-[0.55em] rounded-md border bg-muted px-3 py-2.5 font-mono text-[0.9em] ${PROSE}`,
  caption: 'my-[0.55em] text-sm text-faint',
}

// Hàng list: marker cột riêng để chữ xuống dòng thẳng hàng dưới chữ.
const LIST_ROW = `my-[0.2em] flex gap-2 ${PROSE}`

// Gạch chân + gạch ngang cùng lúc phải gộp vào MỘT text-decoration-line (hai utility
// `underline` / `line-through` ghi đè nhau).
const runClass = (run: DocxRun) => {
  let decoration = ''
  if (run.underline && run.strike) decoration = '[text-decoration-line:underline_line-through]'
  else if (run.underline) decoration = 'underline'
  else if (run.strike) decoration = 'line-through'
  return [
    decoration,
    {
      'font-semibold': run.bold,
      italic: run.italic,
      // mono: run monospace mang từ .docx
      'font-mono text-[0.9em]': run.mono,
    },
  ]
}
</script>
