<template>
  <div class="w-full max-w-220 text-foreground">
    <template v-for="(block, i) in doc.blocks" :key="i">
      <OfficeDocPara v-if="block.type === 'p'" :para="block" />

      <img
        v-else-if="block.type === 'image'"
        class="my-[0.9em] block h-auto max-w-full rounded-sm"
        :src="block.src"
        :alt="block.alt"
        :style="block.width ? { width: `${block.width}px` } : undefined"
      />

      <!-- Bảng rộng cuộn trong khung riêng thay vì kéo giãn cột đọc. -->
      <div v-else class="my-[0.9em] overflow-x-auto">
        <table class="w-full border-collapse">
          <tbody>
            <!-- Hàng đầu của Word theo lệ là header — cùng độ đậm renderer markdown cho
                 <th> để bảng đọc giống nhau giữa các preview. -->
            <tr
              v-for="(row, r) in block.rows"
              :key="r"
              :class="{ 'bg-muted font-semibold': r === 0 }"
            >
              <td
                v-for="(cell, c) in row"
                :key="c"
                :colspan="cell.colSpan"
                class="border px-2.5 py-1.5 align-top [&>p]:my-[0.15em]"
              >
                <OfficeDocPara v-for="(para, p) in cell.paras" :key="p" :para="para" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="doc.truncated" class="mt-[1.4em] rounded-md border bg-muted px-3 py-2 text-warning">
      {{ t('common.preview.officeTruncated') }}
    </div>
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
