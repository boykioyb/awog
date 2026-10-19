<template>
  <!-- Tab con "Lãng phí" của nhóm Chi phí (Mốc 7, việc 7.2 · 7.3).
       Xem `InfraCostMonth.vue` cho lý do tách. Hai phép dò có tính tiền
       (`ec2-idle`, `nat-idle`) mặc định TẮT và nói ra giá ngay tại ô bật. -->
  <!-- ── 7.2 Dò lãng phí ────────────────────────────────────────────── -->
  <Card class="gap-2.5 px-3.5 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-base text-foreground">{{ t('infra.cost.waste.title') }}</span>
      <span class="text-xs text-faint">
        {{ t('infra.cost.waste.regionWhy', { r: region || '—' }) }}
      </span>
      <span class="flex-1" />
      <Button
        type="button"
        :disabled="wasteLoading || enabled.size === 0"
        :aria-busy="wasteLoading"
        variant="default"
        size="sm"
        @click="scanWaste"
      >
        <Icon name="search" class="size-3" :class="wasteLoading ? 'animate-spin' : ''" />
        {{ t('infra.cost.waste.scan') }}
      </Button>
    </div>

    <!-- Bảy công tắc. Hai phép trả tiền mang nhãn riêng và mặc định TẮT — bật chúng
         là thêm một lô `get-metric-data` vào lượt dò, và người dùng phải biết trước. -->
    <div class="flex flex-wrap gap-x-3.5 gap-y-1.5">
      <label
        v-for="c in checks"
        :key="c"
        class="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-foreground"
        :title="t(`infra.cost.check.${c}.why`)"
      >
        <Checkbox :model-value="enabled.has(c)" @update:model-value="toggleCheck(c)" />
        {{ t(`infra.cost.check.${c}.label`) }}
        <Badge
          v-if="paidChecks.includes(c)"
          variant="outline"
          class="border-warning/40 px-1.5 py-0 font-normal text-warning"
        >
          {{ t('infra.cost.waste.paid') }}
        </Badge>
      </label>
    </div>
    <p v-if="paidEnabled > 0" class="m-0 text-xs text-warning">
      {{ t('infra.cost.waste.paidWarn', { n: paidEnabled }) }}
    </p>

    <p v-if="wasteError" class="m-0 text-xs text-destructive">{{ wasteError }}</p>

    <template v-if="report">
      <!-- Phép dò HỎNG phải hiện ra. Nuốt nó đi thì bảng trông như đã sạch. -->
      <ul
        v-if="report.failed.length"
        class="m-0 flex list-disc flex-col gap-1 pl-4.5 text-xs text-destructive"
      >
        <li v-for="f in report.failed" :key="f.check">
          {{ t('infra.cost.waste.failed', { c: t(`infra.cost.check.${f.check}.label`) }) }}
          — {{ f.error }}
        </li>
      </ul>

      <div class="flex flex-wrap items-baseline gap-2.5 text-sm text-foreground">
        <span>
          {{ t('infra.cost.waste.found', { n: report.findings.length }) }}
          · {{ t('infra.cost.waste.total', { v: usd(report.totalMonthlyUsd) }) }}
        </span>
        <span v-if="report.unpricedCount > 0" class="text-faint">
          {{ t('infra.cost.waste.unpriced', { n: report.unpricedCount }) }}
        </span>
        <span v-if="pricing" class="text-faint">
          {{ t('infra.cost.waste.pricingWhy', { d: pricing.asOf, r: pricing.region }) }}
        </span>
      </div>

      <Table v-if="report.findings.length">
        <TableHeader>
          <TableRow>
            <TableHead class="w-7">
              <Checkbox
                :model-value="picked.size === report.findings.length && picked.size > 0"
                :title="t('infra.cost.waste.pickAll')"
                :aria-label="t('infra.cost.waste.pickAll')"
                @update:model-value="pickAll()"
              />
            </TableHead>
            <TableHead>{{ t('infra.cost.waste.col.check') }}</TableHead>
            <TableHead>{{ t('infra.cost.waste.col.resource') }}</TableHead>
            <!-- Cột thô (`volumeId gp3 · 120 GiB`…) — chỉ ở Chuyên sâu. -->
            <TableHead v-if="isExpert">{{ t('infra.cost.waste.col.detail') }}</TableHead>
            <TableHead class="text-right">{{ t('infra.cost.waste.col.monthly') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="f in report.findings" :key="findingKey(f)">
            <TableCell class="w-7 align-top">
              <Checkbox
                :model-value="picked.has(findingKey(f))"
                @update:model-value="togglePick(f)"
              />
            </TableCell>
            <TableCell class="align-top">{{ t(`infra.cost.check.${f.check}.label`) }}</TableCell>
            <!-- mono-ok: id tài nguyên, người dùng copy vào lệnh aws -->
            <TableCell class="align-top font-mono break-all">{{ f.label }}</TableCell>
            <TableCell v-if="isExpert" class="align-top text-faint">{{ detailText(f) }}</TableCell>
            <TableCell class="text-right align-top tabular-nums">
              <!-- `null` hiện "—", KHÔNG hiện 0: "không biết giá" khác "miễn phí". -->
              <template v-if="f.monthlyUsd === null">—</template>
              <template v-else>{{ f.overEstimate ? '≤ ' : '' }}{{ usd(f.monthlyUsd) }}</template>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p v-else class="m-0 text-xs text-faint">{{ t('infra.cost.waste.clean') }}</p>

      <!-- ── 7.3 ──────────────────────────────────────────────────── -->
      <div v-if="report.findings.length" class="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          :disabled="pickedFindings.length === 0 || building"
          variant="default"
          size="sm"
          @click="onCleanup"
        >
          <Icon name="book" class="size-3" />
          {{ t('infra.cost.cleanup.build', { n: pickedFindings.length }) }}
        </Button>
        <span v-if="pickedFindings.length" class="text-xs text-faint">
          {{ t('infra.cost.cleanup.picked', { v: usd(pickedMonthlyUsd) }) }}
        </span>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
// Lớp bind của tab con "Lãng phí". State + RPC ở `useInfraCost()` (xem InfraCostMonth);
// hình dạng lệnh AWS của playbook dọn dẹp ở SIDECAR (`infra/cost/cleanup.ts`) —
// renderer không dựng argv.
import { ref } from 'vue'
import { findingKey, useInfraCost } from '~/composables/useInfraCost'
import { useInfraMode } from '~/composables/useInfraMode'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import { usePlaybookEditor } from '~/composables/usePlaybookEditor'
import type { WasteFinding } from '~/composables/useInfraCost'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const { openGenerated } = usePlaybookEditor()
const { isExpert } = useInfraMode()
const { request: requestTab } = useInfraTabOpen()

const {
  region,
  report,
  wasteLoading,
  wasteError,
  pricing,
  paidChecks,
  enabled,
  toggleCheck,
  paidEnabled,
  scanWaste,
  checks,
  picked,
  togglePick,
  pickAll,
  pickedFindings,
  pickedMonthlyUsd,
  buildCleanupDraft,
} = useInfraCost()

const building = ref(false)

/** Hai chữ số, luôn có ký hiệu tiền — mọi con số trên màn này là USD. */
function usd(v: number): string {
  return `$${v.toFixed(2)}`
}

function detailText(f: WasteFinding): string {
  return Object.entries(f.detail)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
}

/**
 * Sinh kế hoạch dọn dẹp rồi MỞ TRÌNH SOẠN — không lưu, không chạy.
 *
 * Màn Kế hoạch là một TAB của chính `/infra`, nên đây chỉ còn là một cú đổi tab chứ
 * không phải điều hướng. `usePlaybookEditor` giữ bản nháp ở mức module nên nó sống
 * qua cú đổi tab; hộp thoại chỉ được mount trong tab kia.
 */
async function onCleanup(): Promise<void> {
  building.value = true
  try {
    const draft = await buildCleanupDraft()
    if (!draft) return
    openGenerated(draft)
    requestTab('playbooks')
  } finally {
    building.value = false
  }
}
</script>
