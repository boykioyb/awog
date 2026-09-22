<template>
  <div class="ltweek">
    <!-- Tiêu đề tuần: nhảy tuần trước/sau + nhãn + dòng meta, và nút Báo cáo tuần. -->
    <div class="lthead">
      <button
        class="ltnav"
        type="button"
        :title="t('logtime.week.prev')"
        :aria-label="t('logtime.week.prev')"
        @click="gotoWeek(-1)"
      >
        <Icon name="chev-left" />
      </button>
      <button
        class="ltnav"
        type="button"
        :title="t('logtime.week.next')"
        :aria-label="t('logtime.week.next')"
        @click="gotoWeek(1)"
      >
        <Icon name="chev-right" />
      </button>
      <span class="ltheadtext">
        <b class="ltheadd">{{ weekLabel }}</b>
        <span class="ltheads">{{ weekMeta }}</span>
      </span>
      <span class="ltsp" />
      <button
        class="btn ltbtn"
        type="button"
        :disabled="weekRows.length === 0"
        @click="openWeekReport"
      >
        <Icon name="file" />
        {{ t('logtime.week.report') }}
      </button>
    </div>

    <div class="ltwbody">
      <!-- 4 tile tổng -->
      <div class="ltwtiles">
        <div class="tile ltwtile">
          <span class="ltwlbl">{{ t('logtime.week.tile.total') }}</span>
          <span class="ltwbig tnum">{{ fmt(weekTiles.total) }}h</span>
          <span class="ltwsub tnum">
            {{ weekBudgetPct }}% {{ t('logtime.week.of', { h: fmt(weekBudget) }) }}
          </span>
        </div>
        <div class="tile ltwtile">
          <span class="ltwlbl">{{ t('logtime.week.tile.posted') }}</span>
          <span class="ltwbig tnum">{{ fmt(weekTiles.posted) }}h</span>
          <span class="ltwsub tnum">
            {{ t('logtime.week.draftLeft', { h: fmt(weekTiles.draft) }) }}
          </span>
        </div>
        <div class="tile ltwtile">
          <span class="ltwlbl">{{ t('logtime.week.tile.top') }}</span>
          <span class="ltwbig ltwbigsm">{{ weekTiles.topLabel }}</span>
          <span class="ltwsub tnum">{{ fmt(weekTiles.topHours) }}h · {{ weekTiles.topPct }}%</span>
        </div>
        <div class="tile ltwtile">
          <span class="ltwlbl">{{ t('logtime.week.tile.short') }}</span>
          <span class="ltwbig tnum">{{ weekTiles.shortDays }}</span>
          <span class="ltwsub">{{ weekTiles.shortDayLabel }}</span>
        </div>
      </div>

      <div v-if="weekRows.length === 0" class="ltwempty">{{ t('logtime.week.empty') }}</div>

      <!-- Bảng dự án × 7 ngày. Cuộn ngang trong khung riêng để thân trang không bao giờ
           cuộn ngang. -->
      <div v-else class="ltwtblwrap">
        <table class="ltwgrid">
          <thead>
            <tr>
              <th class="ltwproj">{{ t('logtime.week.col.project') }}</th>
              <th v-for="(c, i) in weekColLabels" :key="i" class="ltwnum">{{ c }}</th>
              <th class="ltwnum">{{ t('logtime.week.col.total') }}</th>
              <th class="ltwsrc">{{ t('logtime.week.col.source') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in weekRows" :key="row.projectKey">
              <td class="ltwproj">
                <i class="ltdot" :style="{ background: row.color }" />
                <span class="ltwpname">{{ row.label }}</span>
              </td>
              <td v-for="(cell, i) in row.cells" :key="i" class="ltwnum">
                <span v-if="cell.total > 0" class="ltheat tnum" :class="{ draft: cell.draft > 0 }">
                  {{ fmt(cell.total) }}
                </span>
                <span v-else class="ltwzero">·</span>
              </td>
              <td class="ltwnum">
                <span class="ltwtot tnum">{{ fmt(row.total) }}</span>
              </td>
              <td class="ltwsrc">{{ row.sourceName || '—' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="ltwproj">{{ t('logtime.week.col.dayTotal') }}</td>
              <td v-for="(h, i) in weekDayTotals" :key="i" class="ltwnum">
                <span class="tnum" :class="{ ltwfaint: h === 0 }">{{ h > 0 ? fmt(h) : '·' }}</span>
              </td>
              <td class="ltwnum">
                <span class="ltwtot tnum">{{ fmt(weekTotal) }}</span>
              </td>
              <td class="ltwsrc" />
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Chú giải heat: đã đẩy (accent tint) · còn nháp (viền đứt) · ô trống. -->
      <div v-if="weekRows.length > 0" class="ltwlegend">
        <span>
          <span class="ltheat">4.0</span>
          {{ t('logtime.week.legend.posted') }}
        </span>
        <span>
          <span class="ltheat draft">2.0</span>
          {{ t('logtime.week.legend.draft') }}
        </span>
        <span>{{ t('logtime.week.legend.empty') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn Tuần của Logtime — bảng dự án × 7 ngày, tổng hợp thuần từ store. State ở
// singleton `useLogtimeManager` (xem quy ước page-controller).
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'

const { t } = useI18n()
const {
  weekRows,
  weekDayTotals,
  weekTiles,
  weekTotal,
  weekBudget,
  weekLabel,
  weekMeta,
  weekColLabels,
  fmt,
  gotoWeek,
  openWeekReport,
} = useLogtimeManager()

const weekBudgetPct = computed(() =>
  weekBudget.value > 0 ? Math.round((weekTiles.value.total / weekBudget.value) * 100) : 0,
)
</script>

<style scoped>
.ltweek {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Cùng thanh tiêu đề với màn Ngày. */
.lthead {
  flex: 0 0 auto;
  min-height: 50px;
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 8px var(--padX);
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltnav {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltnav:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltnav > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.ltheadtext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ltheadd {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltheads {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltsp {
  flex: 1;
}
.ltbtn {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltwbody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px var(--padX) 18px;
}

/* ── Tiles ── */
.ltwtiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 15px;
}
.ltwtile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
}
.ltwlbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltwbig {
  font-size: var(--fs-2xl);
  line-height: var(--lh-2xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}
/* Nhãn dự án dài hơn số nên nhỏ hơn một bậc để không tràn. */
.ltwbigsm {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltwsub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
@media (max-width: 720px) {
  .ltwtiles {
    grid-template-columns: repeat(2, 1fr);
  }
}

.ltwempty {
  padding: 24px 0;
  text-align: center;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* ── Bảng ── */
.ltwtblwrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.ltwgrid {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltwgrid th,
.ltwgrid td {
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}
.ltwgrid thead th {
  font-weight: 600;
  color: var(--textDim);
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltwgrid tbody tr + tr td {
  box-shadow: inset 0 1px 0 var(--border);
}
.ltwgrid tfoot td {
  box-shadow: inset 0 1px 0 var(--borderStrong);
  color: var(--textDim);
  font-weight: 600;
}
.ltwnum {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ltwproj {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 150px;
}
.ltwpname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltdot {
  width: 8px; /* design-token-ok: chấm màu dự án là hình tròn nhỏ cố định */
  height: 8px; /* design-token-ok: như trên */
  border-radius: 50%;
  flex: 0 0 auto;
}
.ltwsrc {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ltwtot {
  font-weight: 650;
}
.ltwzero,
.ltwfaint {
  color: var(--textFaint);
}
/* Heat chip: đã đẩy = accent-tint đặc; còn nháp = viền đứt, nền trong. */
.ltheat {
  display: inline-block;
  min-width: 34px;
  padding: 2px 7px;
  border-radius: var(--r-xs);
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: var(--accentDim);
  color: var(--accent);
  border: 1px solid transparent;
}
.ltheat.draft {
  background: transparent;
  color: var(--textDim);
  border: 1px dashed var(--borderStrong);
}

/* ── Legend ── */
.ltwlegend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltwlegend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
