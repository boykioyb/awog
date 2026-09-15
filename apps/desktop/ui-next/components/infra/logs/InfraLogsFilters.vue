<template>
  <div class="lfl">
    <div class="lfl-row">
      <div class="lfl-field">
        <Icon name="search" class="lfl-field-ic" />
        <input
          :value="quick"
          class="lfl-input"
          type="search"
          spellcheck="false"
          :placeholder="t('infra.logs.filters.quickPh')"
          @input="onQuick"
        />
      </div>
      <div class="lfl-levels" role="group" :aria-label="t('infra.logs.filters.level')">
        <button
          v-for="lv in LEVELS"
          :key="lv || 'all'"
          class="lfl-level"
          :class="[{ on: level === lv }, lv ? `lv-${lv.toLowerCase()}` : '']"
          type="button"
          @click="emit('update:level', lv)"
        >
          {{ lv || t('infra.logs.filters.all') }}
        </button>
      </div>
      <span class="lfl-count">
        {{ t('infra.logs.filters.showing', { shown: shown, total: total }) }}
      </span>
    </div>

    <!-- Facet: bấm một giá trị ⇒ chèn `filter <trường> = "giá trị"` vào câu lệnh.
         Đây là đường NGẮN NHẤT từ "tôi thấy một giá trị lạ" tới "cho tôi mọi dòng
         có giá trị đó" — không phải tự gõ lại tên trường. -->
    <div v-if="facets.length > 0" class="lfl-facets">
      <div v-for="f in facets" :key="f.field" class="lfl-facet">
        <span class="lfl-facet-field">{{ f.field }}</span>
        <button
          v-for="v in f.values"
          :key="v.value"
          class="lfl-chip"
          :class="{ on: active?.field === f.field && active.value === v.value }"
          type="button"
          :title="t('infra.logs.filters.insertHint')"
          @click="emit('insert', f.field, v.value)"
        >
          {{ v.value }}
          <span class="lfl-chip-n">{{ v.count }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Lọc nhanh tại chỗ + chip mức độ + facet theo trường (Mốc 2 việc 2.7).
//
// Lọc ở ĐÂY chạy trên các dòng ĐÃ có trong bộ nhớ — không gọi mạng, không quét
// lại CloudWatch, không tốn thêm xu nào. Muốn thu hẹp ở phía AWS thì đó là việc
// của câu lệnh (facet làm hộ: nó chèn thêm một mệnh đề `filter`).
import type { LogsFacet } from '~/composables/useInfraLogs'

const props = defineProps<{
  quick: string
  level: '' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  facets: LogsFacet[]
  active: { field: string; value: string } | null
  shown: number
  total: number
}>()

const emit = defineEmits<{
  'update:quick': [value: string]
  'update:level': [value: '' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG']
  insert: [field: string, value: string]
}>()

const { t } = useI18n()
const LEVELS: ('' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG')[] = ['', 'ERROR', 'WARN', 'INFO', 'DEBUG']
const active = computed(() => props.active)

function onQuick(e: Event): void {
  emit('update:quick', (e.target as HTMLInputElement).value)
}
</script>

<style scoped>
.lfl {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lfl-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lfl-field {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
}

.lfl-field-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}

.lfl-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
}

.lfl-levels {
  display: flex;
  gap: 3px;
  flex: 0 0 auto;
}

.lfl-level {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.lfl-level.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bgHover);
}

.lfl-level.lv-error.on {
  border-color: var(--danger);
  color: var(--danger);
}

.lfl-level.lv-warn.on {
  border-color: var(--amber);
  color: var(--amber);
}

.lfl-count {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}

.lfl-facets {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.lfl-facet {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.lfl-facet-field {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  min-width: 96px;
  /* mono-ok: tên trường của bản ghi log, không phải câu văn */
  font-family: var(--code);
}

.lfl-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lfl-chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bgHover);
}

.lfl-chip-n {
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}
</style>
