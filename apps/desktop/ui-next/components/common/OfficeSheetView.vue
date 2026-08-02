<template>
  <div class="osv">
    <div class="osscroll">
      <table class="osgrid">
        <colgroup>
          <col class="oshcol" />
          <col
            v-for="(label, c) in colLabels"
            :key="label"
            :style="{ width: `${colWidth(c)}px` }"
          />
        </colgroup>
        <thead>
          <tr>
            <th class="oscorner" />
            <th v-for="label in colLabels" :key="label" class="oshead">{{ label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in visibleRows" :key="r">
            <th class="osrowh">{{ r + 1 }}</th>
            <template v-for="(label, c) in colLabels" :key="label">
              <td
                v-if="!isCovered(r, c)"
                class="oscell"
                :class="{ num: row[c]?.num }"
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

      <div v-if="!visibleRows.length" class="osblank">{{ t('common.preview.sheetEmpty') }}</div>

      <div v-if="hiddenRowCount > 0" class="osmore">
        <button class="osmorebtn" @click="showMoreRows()">
          {{ t('common.preview.sheetMoreRows', { n: hiddenRowCount }) }}
        </button>
      </div>
      <div v-if="truncated" class="ostrunc">{{ t('common.preview.officeTruncated') }}</div>
    </div>

    <!-- sheet tabs (workbook navigation), Excel-style along the bottom -->
    <div v-if="sheetNames.length > 1" class="ostabs">
      <button
        v-for="(name, i) in sheetNames"
        :key="name + i"
        class="ostab"
        :class="{ on: i === sheetIndex }"
        :title="name"
        @click="selectSheet(i)"
      >
        {{ name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Renders the active sheet of a parsed XLSX (utils/office-xlsx) as a grid with
// column letters, row numbers and sheet tabs. Rows paint in pages (the controller
// owns the window) so a 5000-row sheet opens instantly.
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

const colWidth = (index: number) => sheet.value?.colWidths[index] ?? SHEET_DEFAULT_COL_PX
</script>

<style scoped>
.osv {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.osscroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.osgrid {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-variant-numeric: tabular-nums;
}
.oshcol {
  width: 52px;
}
/* Sticky header row + sticky row-number column; the corner needs the higher
   z-index so it stays above both while scrolling diagonally. */
.oshead,
.oscorner {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 26px;
  padding: 0 8px;
  background: var(--bgSubtle);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--textFaint);
  font-family: var(--code);
  font-size: 12px;
  font-weight: 500;
}
.oscorner {
  left: 0;
  z-index: 3;
  width: 52px;
}
.osrowh {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0 8px;
  background: var(--bgSubtle);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--textFaint);
  font-family: var(--code);
  font-size: 12px;
  font-weight: 500;
  text-align: right;
}
.oscell {
  max-width: 420px;
  padding: 4px 8px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.oscell.num {
  text-align: right;
}
/* Blank sheet: an inline note keeps the tab strip (and the other sheets) reachable. */
.osblank {
  padding: 26px 18px;
  color: var(--textFaint);
}
.osmore {
  display: flex;
  justify-content: center;
  padding: 14px;
}
.osmorebtn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.osmorebtn:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.ostrunc {
  padding: 10px 14px 18px;
  color: var(--amber);
}
/* Sheet tabs — above the floating toolbar's reach (it docks bottom-center), so
   leave room on the right for it by keeping the strip scrollable. */
.ostabs {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
  padding: 6px 8px 6px;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  background: var(--bgSubtle);
}
.ostab {
  flex: 0 0 auto;
  max-width: 220px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--textDim);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ostab:hover {
  color: var(--text);
  background: var(--bgHover);
}
.ostab.on {
  color: var(--accent);
  border-color: var(--accentBorder);
}
</style>
