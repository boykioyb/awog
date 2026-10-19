<template>
  <div class="flex flex-none flex-col gap-1.5 p-2 shadow-[inset_0_-1px_0_var(--color-border)]">
    <div class="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        :variant="cap.recording.value ? 'danger' : 'outline'"
        :disabled="cap.busy.value"
        :title="cap.recording.value ? t('capture.toolbar.stop') : t('capture.toolbar.record')"
        @click="cap.toggleRecording()"
      >
        <span
          class="size-2 rounded-full"
          :class="cap.recording.value ? 'bg-destructive' : 'bg-dim'"
          aria-hidden="true"
        />
        {{ cap.recording.value ? t('capture.toolbar.stop') : t('capture.toolbar.record') }}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="[&_svg]:size-3.5"
        :title="t('capture.toolbar.clear')"
        @click="cap.clearAll()"
      >
        <Icon name="trash" />
        {{ t('capture.toolbar.clear') }}
      </Button>

      <!-- Ô lọc: icon nằm trong Input (padding-left đã chừa chỗ). -->
      <div class="relative max-w-105 min-w-50 flex-[1_1_12.5rem]">
        <Icon
          name="filter"
          class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-dim"
        />
        <!-- `min-h-0`: gỡ min-height toàn cục của ô nhập trong prototype.css để Input giữ
             chiều cao sm. -->
        <Input
          v-model="cap.filterText.value"
          class="h-ctrl-sm min-h-0 pl-7 text-xs"
          :class="{ 'border-destructive': cap.regexInvalid.value }"
          type="text"
          spellcheck="false"
          :placeholder="t('capture.toolbar.filterPlaceholder')"
          :title="
            cap.regexInvalid.value
              ? t('capture.toolbar.regexInvalid')
              : t('capture.toolbar.filterHint')
          "
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="[&_svg]:size-3.5"
        :class="cap.searchBodies.value && CAP_ON"
        :aria-pressed="cap.searchBodies.value"
        :title="t('capture.toolbar.searchBodiesHint')"
        @click="cap.searchBodies.value = !cap.searchBodies.value"
      >
        <Icon name="search" />
        {{ t('capture.toolbar.searchBodies') }}
        <span
          v-if="cap.searching.value"
          class="size-2.5 animate-spin rounded-full border-2 border-input border-t-primary"
          aria-hidden="true"
        />
      </Button>

      <AppSelect
        v-model="cap.method.value"
        size="sm"
        :options="methodOptions"
        :title="t('capture.toolbar.method')"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="[&_svg]:size-3.5"
        :class="cap.onlySite.value && CAP_ON"
        :aria-pressed="cap.onlySite.value"
        :title="t('capture.toolbar.onlySiteHint')"
        @click="cap.onlySite.value = !cap.onlySite.value"
      >
        <Icon name="globe" />
        {{ t('capture.toolbar.onlySite') }}
      </Button>

      <span class="flex-auto" />

      <span class="tnum text-muted-foreground" :title="t('capture.toolbar.countHint')">
        {{ t('capture.toolbar.count', { shown: cap.rows.value.length, total: cap.total.value }) }}
        <template v-if="(cap.capState.value?.dropped ?? 0) > 0">
          ·
          <span class="text-destructive">
            {{ t('capture.toolbar.dropped', { n: cap.capState.value?.dropped ?? 0 }) }}
          </span>
        </template>
      </span>

      <Button
        type="button"
        size="sm"
        variant="outline"
        class="[&_svg]:size-3.5"
        :disabled="cap.total.value === 0"
        :title="t('capture.toolbar.exportAllHint')"
        @click="cap.exportHar(false)"
      >
        <Icon name="download" />
        {{ t('capture.toolbar.exportAll') }}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="[&_svg]:size-3.5"
        :disabled="cap.rows.value.length === 0"
        :title="t('capture.toolbar.exportFilteredHint')"
        @click="cap.exportHar(true)"
      >
        <Icon name="download" />
        {{ t('capture.toolbar.exportFiltered') }}
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        class="rounded-full"
        :class="cap.typeSel.value.length === 0 && CAP_ON"
        :aria-pressed="cap.typeSel.value.length === 0"
        @click="cap.clearTypes()"
      >
        {{ t('capture.type.all') }}
      </Button>
      <Button
        v-for="c in TYPE_CHIPS"
        :key="c"
        type="button"
        size="xs"
        variant="outline"
        class="rounded-full"
        :class="cap.typeSel.value.includes(c) && CAP_ON"
        :aria-pressed="cap.typeSel.value.includes(c)"
        @click="cap.toggleType(c)"
      >
        {{ t(`capture.type.${c}`) }}
      </Button>
      <Separator orientation="vertical" class="mx-1 h-4" />
      <Button
        v-for="c in STATUS_CHIPS"
        :key="c"
        type="button"
        size="xs"
        variant="outline"
        class="rounded-full"
        :class="cap.statusSel.value.includes(c) && [CAP_ON, STATUS_ON[c]]"
        :aria-pressed="cap.statusSel.value.includes(c)"
        @click="cap.toggleStatus(c)"
      >
        {{ c === 'failed' ? t('capture.status.failed') : c }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import { STATUS_CHIPS, TYPE_CHIPS, type StatusChip } from '~/utils/capture-filter'
import { useNetworkCaptureContext } from '~/composables/useNetworkCapture'
import { CAP_ON } from './capture-ui'

const { t } = useI18n()
const cap = useNetworkCaptureContext()

// Chip trạng thái đang BẬT nhuộm chữ theo nhóm mã (2xx xanh, 3xx lam, 4xx vàng, 5xx/lỗi đỏ).
const STATUS_ON: Record<StatusChip, string> = {
  '2xx': 'text-success',
  '3xx': 'text-info',
  '4xx': 'text-warning',
  '5xx': 'text-destructive',
  failed: 'text-destructive',
}

const methodOptions = computed<AppSelectOption[]>(() => [
  { label: t('capture.toolbar.methodAll'), value: '' },
  ...cap.methods.value.map((m) => ({ label: m, value: m })),
])
</script>
