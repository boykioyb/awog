<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- Tiêu đề tuần: nhảy tuần trước/sau + nhãn + dòng meta, và nút Báo cáo tuần.
         Cùng thanh tiêu đề với màn Ngày. -->
    <div class="flex min-h-12.5 shrink-0 flex-wrap items-center gap-2 border-b px-6 py-2">
      <Button
        variant="outline"
        size="iconSm"
        class="shrink-0 text-dim"
        type="button"
        :title="t('logtime.week.prev')"
        :aria-label="t('logtime.week.prev')"
        @click="gotoWeek(-1)"
      >
        <Icon name="chev-left" />
      </Button>
      <Button
        variant="outline"
        size="iconSm"
        class="shrink-0 text-dim"
        type="button"
        :title="t('logtime.week.next')"
        :aria-label="t('logtime.week.next')"
        @click="gotoWeek(1)"
      >
        <Icon name="chev-right" />
      </Button>
      <span class="flex min-w-0 flex-col gap-0.5">
        <b class="text-lg font-semibold">{{ weekLabel }}</b>
        <span class="text-xs text-dim">{{ weekMeta }}</span>
      </span>
      <span class="flex-1" />
      <Button
        type="button"
        :disabled="weekRows.length === 0"
        variant="outline"
        @click="openWeekReport"
      >
        <Icon name="file" />
        {{ t('logtime.week.report') }}
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 pt-3.5 pb-4.5">
      <!-- 4 tile tổng (2 cột khi panel ≤720px) -->
      <div class="mb-4 grid grid-cols-4 gap-2.5 max-[720px]:grid-cols-2">
        <Card class="gap-1 px-3.5 py-3">
          <span class="text-xs text-dim">{{ t('logtime.week.tile.total') }}</span>
          <span class="text-2xl font-semibold tracking-tight tabular-nums">
            {{ fmt(weekTiles.total) }}h
          </span>
          <span class="text-xs tabular-nums text-faint">
            {{ weekBudgetPct }}% {{ t('logtime.week.of', { h: fmt(weekBudget) }) }}
          </span>
        </Card>
        <Card class="gap-1 px-3.5 py-3">
          <span class="text-xs text-dim">{{ t('logtime.week.tile.posted') }}</span>
          <span class="text-2xl font-semibold tracking-tight tabular-nums">
            {{ fmt(weekTiles.posted) }}h
          </span>
          <span class="text-xs tabular-nums text-faint">
            {{ t('logtime.week.draftLeft', { h: fmt(weekTiles.draft) }) }}
          </span>
        </Card>
        <Card class="gap-1 px-3.5 py-3">
          <span class="text-xs text-dim">{{ t('logtime.week.tile.top') }}</span>
          <!-- Nhãn dự án dài hơn số nên nhỏ hơn một bậc để không tràn. -->
          <span class="truncate text-lg font-semibold">{{ weekTiles.topLabel }}</span>
          <span class="text-xs tabular-nums text-faint">
            {{ fmt(weekTiles.topHours) }}h · {{ weekTiles.topPct }}%
          </span>
        </Card>
        <Card class="gap-1 px-3.5 py-3">
          <span class="text-xs text-dim">{{ t('logtime.week.tile.short') }}</span>
          <span class="text-2xl font-semibold tracking-tight tabular-nums">
            {{ weekTiles.shortDays }}
          </span>
          <span class="text-xs text-faint">{{ weekTiles.shortDayLabel }}</span>
        </Card>
      </div>

      <div v-if="weekRows.length === 0" class="py-6 text-center text-sm text-faint">
        {{ t('logtime.week.empty') }}
      </div>

      <!-- Bảng dự án × 7 ngày. Cuộn ngang trong khung riêng để thân trang không bao giờ
           cuộn ngang. -->
      <div v-else class="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead
                class="px-2.5 py-2 whitespace-nowrap h-auto min-w-37.5 font-semibold text-dim"
              >
                {{ t('logtime.week.col.project') }}
              </TableHead>
              <TableHead
                v-for="(c, i) in weekColLabels"
                :key="i"
                class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums h-auto font-semibold text-dim"
              >
                {{ c }}
              </TableHead>
              <TableHead
                class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums h-auto font-semibold text-dim"
              >
                {{ t('logtime.week.col.total') }}
              </TableHead>
              <TableHead class="px-2.5 py-2 whitespace-nowrap h-auto font-semibold text-dim">
                {{ t('logtime.week.col.source') }}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in weekRows" :key="row.projectKey" class="hover:bg-transparent">
              <TableCell class="px-2.5 py-2 whitespace-nowrap min-w-37.5">
                <span class="flex items-center gap-2">
                  <!-- Màu chấm là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style. -->
                  <i class="size-2 shrink-0 rounded-full" :style="{ background: row.color }" />
                  <span class="truncate">{{ row.label }}</span>
                </span>
              </TableCell>
              <TableCell
                v-for="(cell, i) in row.cells"
                :key="i"
                class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums"
              >
                <!-- Heat chip: đã đẩy = accent-tint đặc; còn nháp = viền đứt, nền trong. -->
                <span
                  v-if="cell.total > 0"
                  class="inline-block min-w-8.5 rounded-sm border px-2 py-0.5 text-center tabular-nums"
                  :class="
                    cell.draft > 0
                      ? 'border-dashed border-input bg-transparent text-dim'
                      : 'border-transparent bg-selected text-primary'
                  "
                >
                  {{ fmt(cell.total) }}
                </span>
                <span v-else class="text-faint">·</span>
              </TableCell>
              <TableCell class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums">
                <span class="font-semibold">{{ fmt(row.total) }}</span>
              </TableCell>
              <TableCell class="px-2.5 py-2 whitespace-nowrap text-xs text-faint">
                {{ row.sourceName || '—' }}
              </TableCell>
            </TableRow>
          </TableBody>
          <tfoot class="border-t border-input font-semibold text-dim">
            <TableRow class="border-b-0 hover:bg-transparent">
              <TableCell class="px-2.5 py-2 whitespace-nowrap min-w-37.5">
                {{ t('logtime.week.col.dayTotal') }}
              </TableCell>
              <TableCell
                v-for="(dayHours, i) in weekDayTotals"
                :key="i"
                class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums"
              >
                <span :class="{ 'text-faint': dayHours === 0 }">
                  {{ dayHours > 0 ? fmt(dayHours) : '·' }}
                </span>
              </TableCell>
              <TableCell class="px-2.5 py-2 whitespace-nowrap text-right tabular-nums">
                <span class="font-semibold">{{ fmt(weekTotal) }}</span>
              </TableCell>
              <TableCell class="px-2.5 py-2 whitespace-nowrap" />
            </TableRow>
          </tfoot>
        </Table>
      </div>

      <!-- Chú giải heat: đã đẩy (accent tint) · còn nháp (viền đứt) · ô trống. -->
      <div
        v-if="weekRows.length > 0"
        class="mt-3 flex flex-wrap gap-4 text-xs text-dim *:inline-flex *:items-center *:gap-1.5"
      >
        <span>
          <span
            class="inline-block min-w-8.5 rounded-sm border px-2 py-0.5 text-center tabular-nums border-transparent bg-selected text-primary"
          >
            4.0
          </span>
          {{ t('logtime.week.legend.posted') }}
        </span>
        <span>
          <span
            class="inline-block min-w-8.5 rounded-sm border px-2 py-0.5 text-center tabular-nums border-dashed border-input bg-transparent text-dim"
          >
            2.0
          </span>
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
import Button from '~/components/ui/button/Button.vue'

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
