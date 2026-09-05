<template>
  <div class="odbody">
    <template v-for="(block, i) in doc.blocks" :key="i">
      <OfficeDocPara v-if="block.type === 'p'" :para="block" />

      <img
        v-else-if="block.type === 'image'"
        class="odimg"
        :src="block.src"
        :alt="block.alt"
        :style="block.width ? { width: `${block.width}px` } : undefined"
      />

      <div v-else class="odtwrap">
        <table class="odtable">
          <tbody>
            <tr v-for="(row, r) in block.rows" :key="r">
              <td v-for="(cell, c) in row" :key="c" :colspan="cell.colSpan">
                <OfficeDocPara v-for="(para, p) in cell.paras" :key="p" :para="para" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="doc.truncated" class="odtrunc">{{ t('common.preview.officeTruncated') }}</div>
  </div>
</template>

<script setup lang="ts">
// Renders a parsed DOCX (utils/office-docx) as a reading column. Structured
// blocks → normal templates, so no v-html and no sanitizer in the path; embedded
// images arrive as data URLs from the parser.
import OfficeDocPara from '~/components/common/OfficeDocPara.vue'
import type { DocxDoc } from '~/utils/office-docx'

defineProps<{ doc: DocxDoc }>()

const { t } = useI18n()
</script>

<style scoped>
.odbody {
  width: 100%;
  max-width: 880px;
  color: var(--text);
}
.odimg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.9em 0;
  border-radius: var(--r-xs);
}
/* Wide tables scroll inside their own box instead of stretching the column. */
.odtwrap {
  margin: 0.9em 0;
  overflow-x: auto;
}
.odtable {
  border-collapse: collapse;
  width: 100%;
}
.odtable td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  vertical-align: top;
}
/* Word's first row is conventionally the header — give it the same weight the
   markdown renderer gives <th> so tables read the same way across previews. */
.odtable tr:first-child td {
  background: var(--bgActive);
  font-weight: 600;
}
.odtable :deep(.odp) {
  margin: 0.15em 0;
}
.odtrunc {
  margin: 1.4em 0 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--amber);
  background: var(--bgSubtle);
}
</style>
