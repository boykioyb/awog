<template>
  <div class="flex size-full min-h-0 flex-col">
    <div class="min-h-0 flex-1 overflow-auto">
      <table class="table-fixed border-separate border-spacing-0 tabular-nums">
        <colgroup>
          <col class="w-13" />
          <col
            v-for="(label, c) in colLabels"
            :key="label"
            :style="{ width: `${colWidth(c)}px` }"
          />
        </colgroup>
        <!-- Hàng header + cột số hàng dính (sticky); ô góc z cao hơn để nằm trên cả hai
             khi cuộn chéo. -->
        <thead>
          <tr>
            <th :class="cn(HEAD_CELL, 'left-0 z-3 w-13')" />
            <th v-for="label in colLabels" :key="label" :class="HEAD_CELL">{{ label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in visibleRows" :key="r">
            <th
              class="sticky left-0 z-1 border-r border-b bg-muted px-2 text-right text-sm font-medium text-faint"
            >
              {{ r + 1 }}
            </th>
            <template v-for="(label, c) in colLabels" :key="label">
              <td
                v-if="!isCovered(r, c)"
                class="max-w-105 truncate border-r border-b px-2 py-1 align-top whitespace-pre text-foreground"
                :class="{ 'text-right': row[c]?.num }"
                :rowspan="spanAt(r, c)?.rowSpan"
                :colspan="spanAt(r, c)?.colSpan"
                :title="row[c]?.text"
              >
                {{ row[c]?.text }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>

      <!-- Sheet trống: một dòng ghi chú để dải tab (và các sheet khác) vẫn với tới được. -->
      <div v-if="!visibleRows.length" class="px-4.5 py-6.5 text-faint">
        {{ t('common.preview.sheetEmpty') }}
      </div>

      <div v-if="hiddenRowCount > 0" class="flex justify-center p-3.5">
        <Button variant="outline" size="sm" class="text-dim" @click="showMoreRows()">
          {{ t('common.preview.sheetMoreRows', { n: hiddenRowCount }) }}
        </Button>
      </div>
      <div v-if="truncated" class="px-3.5 pt-2.5 pb-4.5 text-warning">
        {{ t('common.preview.officeTruncated') }}
      </div>
    </div>

    <!-- sheet tabs (workbook navigation), Excel-style along the bottom. Dải cuộn ngang
         để chừa chỗ cho toolbar nổi (neo giữa-dưới). -->
    <div
      v-if="sheetNames.length > 1"
      class="flex flex-none gap-1 overflow-x-auto border-t bg-muted p-1.5 px-2"
    >
      <Button
        v-for="(name, i) in sheetNames"
        :key="name + i"
        variant="ghost"
        size="xs"
        class="max-w-55 flex-none border border-transparent px-3 font-normal text-dim"
        :class="{ 'border-selected-border bg-selected text-primary': i === sheetIndex }"
        :title="name"
        @click="selectSheet(i)"
      >
        <span class="truncate">{{ name }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Renders the active sheet of a parsed XLSX (utils/office-xlsx) as a grid with
// column letters, row numbers and sheet tabs. Rows paint in pages (the controller
// owns the window) so a 5000-row sheet opens instantly.
import { cn } from '~/lib/utils'
import type { OfficePreviewController } from '~/composables/useOfficePreview'
import { SHEET_DEFAULT_COL_PX } from '~/utils/office-xlsx'

const props = defineProps<{ office: OfficePreviewController }>()

const { t } = useI18n()

// Destructure the controller so its refs unwrap in the template (members are
// stable — the controller object is created once by the preview modal).
const {
  sheet,
  sheetNames,
  sheetIndex,
  selectSheet,
  visibleRows,
  hiddenRowCount,
  showMoreRows,
  colLabels,
  spanAt,
  isCovered,
  truncated,
} = props.office

// Ô header cột (và ô góc): dính trên cùng khi cuộn dọc.
const HEAD_CELL =
  'sticky top-0 z-2 h-6.5 border-r border-b bg-muted px-2 text-sm font-medium text-faint'

const colWidth = (index: number) => sheet.value?.colWidths[index] ?? SHEET_DEFAULT_COL_PX
</script>
