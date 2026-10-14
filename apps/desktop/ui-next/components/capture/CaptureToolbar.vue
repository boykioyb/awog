<template>
  <div class="cap-toolbar">
    <div class="cap-row">
      <Button
        type="button"
        size="sm"
        :variant="cap.recording.value ? 'danger' : 'outline'"
        :disabled="cap.busy.value"
        :title="cap.recording.value ? t('capture.toolbar.stop') : t('capture.toolbar.record')"
        @click="cap.toggleRecording()"
      >
        <span class="cap-recdot" :class="{ on: cap.recording.value }" aria-hidden="true" />
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

      <div class="cap-filter">
        <Icon name="filter" class="cap-filter-ic" />
        <!-- `cap-filterin`: miễn min-height toàn cục của prototype.css để Input giữ chiều cao sm. -->
        <Input
          v-model="cap.filterText.value"
          class="cap-filterin h-[var(--ctrl-h-sm)] pl-7 text-xs"
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
        :class="{ 'cap-on': cap.searchBodies.value }"
        :aria-pressed="cap.searchBodies.value"
        :title="t('capture.toolbar.searchBodiesHint')"
        @click="cap.searchBodies.value = !cap.searchBodies.value"
      >
        <Icon name="search" />
        {{ t('capture.toolbar.searchBodies') }}
        <span v-if="cap.searching.value" class="cap-spin" aria-hidden="true" />
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
        :class="{ 'cap-on': cap.onlySite.value }"
        :aria-pressed="cap.onlySite.value"
        :title="t('capture.toolbar.onlySiteHint')"
        @click="cap.onlySite.value = !cap.onlySite.value"
      >
        <Icon name="globe" />
        {{ t('capture.toolbar.onlySite') }}
      </Button>

      <span class="cap-grow" />

      <span class="cap-count tnum" :title="t('capture.toolbar.countHint')">
        {{ t('capture.toolbar.count', { shown: cap.rows.value.length, total: cap.total.value }) }}
        <template v-if="(cap.capState.value?.dropped ?? 0) > 0">
          ·
          <span class="cap-warn">
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

    <div class="cap-row cap-chips">
      <Button
        type="button"
        size="xs"
        variant="outline"
        class="rounded-full"
        :class="{ 'cap-on': cap.typeSel.value.length === 0 }"
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
        :class="{ 'cap-on': cap.typeSel.value.includes(c) }"
        :aria-pressed="cap.typeSel.value.includes(c)"
        @click="cap.toggleType(c)"
      >
        {{ t(`capture.type.${c}`) }}
      </Button>
      <Separator orientation="vertical" class="cap-sep" />
      <Button
        v-for="c in STATUS_CHIPS"
        :key="c"
        type="button"
        size="xs"
        variant="outline"
        class="rounded-full"
        :class="[`st-${c}`, { 'cap-on': cap.statusSel.value.includes(c) }]"
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
import { STATUS_CHIPS, TYPE_CHIPS } from '~/utils/capture-filter'
import { useNetworkCaptureContext } from '~/composables/useNetworkCapture'

const { t } = useI18n()
const cap = useNetworkCaptureContext()

const methodOptions = computed<AppSelectOption[]>(() => [
  { label: t('capture.toolbar.methodAll'), value: '' },
  ...cap.methods.value.map((m) => ({ label: m, value: m })),
])
</script>

<style scoped>
.cap-toolbar {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-chips {
  gap: 4px;
}
.cap-count {
  color: var(--textMuted);
}
.cap-recdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--textDim);
}
.cap-recdot.on {
  background: var(--danger);
}
.cap-spin {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--borderStrong);
  border-top-color: var(--accent);
  animation: cap-rot 0.8s linear infinite;
}
@keyframes cap-rot {
  to {
    transform: rotate(360deg);
  }
}
/* Ô lọc: icon nằm trong Input (padding-left đã chừa chỗ). */
.cap-filter {
  position: relative;
  min-width: 200px;
  flex: 1 1 200px;
  max-width: 420px;
}
.cap-filter-ic {
  position: absolute;
  left: 8px;
  top: 50%;
  width: var(--icon-xs);
  height: var(--icon-xs);
  transform: translateY(-50%);
  color: var(--textDim);
  pointer-events: none;
}
.cap-sep {
  height: 16px;
  margin: 0 4px;
}
</style>
