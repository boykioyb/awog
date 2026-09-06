<template>
  <div class="spr">
    <SettingsPaneHeader
      :title="t('settings.pricing.heading')"
      :subtitle="t('settings.pricing.intro')"
    />

    <div class="sprtoolbar">
      <span class="fd">
        <template v-if="fetchedAt">
          {{ t('settings.pricing.fetchedAt', { when: fetchedLabel }) }}
        </template>
        <template v-else>{{ t('settings.pricing.neverFetched') }}</template>
      </span>
      <span style="flex: 1" />
      <button class="btn sm" type="button" :disabled="fetching" @click="onFetch">
        <Icon
          name="refresh"
          :class="{ spin: fetching }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ t('settings.pricing.fetch') }}
      </button>
    </div>

    <div v-if="error" class="pcarderror">{{ error }}</div>

    <div class="tile sprpanel">
      <div v-if="loading && !models.length" class="sprhint">
        {{ t('settings.pricing.loading') }}
      </div>
      <div v-else-if="!models.length" class="sprhint">{{ t('settings.pricing.empty') }}</div>
      <table v-else class="sprtable">
        <thead>
          <tr>
            <th class="tl">{{ t('settings.pricing.col.model') }}</th>
            <th class="tr">{{ t('settings.pricing.col.input') }}</th>
            <th class="tr">{{ t('settings.pricing.col.output') }}</th>
            <th class="tr">{{ t('settings.pricing.col.cacheRead') }}</th>
            <th class="tr">{{ t('settings.pricing.col.cacheWrite') }}</th>
            <th class="tr" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in models" :key="m.model">
            <td class="tl">
              <div class="sprmdl">
                <span class="mono">{{ m.model }}</span>
                <span class="tag">{{ m.provider }}</span>
                <span v-if="isOverridden(m.model)" class="tag acc">
                  {{ t('settings.pricing.overridden') }}
                </span>
                <span v-else-if="m.source === 'remote'" class="tag">
                  {{ t('settings.pricing.remote') }}
                </span>
              </div>
            </td>
            <td class="tr">
              <input
                class="sprinp mono"
                type="number"
                min="0"
                step="0.01"
                :value="effectivePrice(m).input"
                @input="onInput(m, 'input', $event)"
              />
            </td>
            <td class="tr">
              <input
                class="sprinp mono"
                type="number"
                min="0"
                step="0.01"
                :value="effectivePrice(m).output"
                @input="onInput(m, 'output', $event)"
              />
            </td>
            <td class="tr">
              <input
                class="sprinp mono"
                type="number"
                min="0"
                step="0.01"
                :value="effectivePrice(m).cacheRead"
                @input="onInput(m, 'cacheRead', $event)"
              />
            </td>
            <td class="tr">
              <input
                class="sprinp mono"
                type="number"
                min="0"
                step="0.01"
                :value="effectivePrice(m).cacheWrite"
                @input="onInput(m, 'cacheWrite', $event)"
              />
            </td>
            <td class="tr">
              <button
                class="sprreset"
                type="button"
                :disabled="!isOverridden(m.model)"
                :title="t('settings.pricing.reset')"
                @click="resetModel(m.model)"
              >
                <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sprfoot">
      <span class="fd">{{ t('settings.pricing.unit') }}</span>
      <span style="flex: 1" />
      <span v-if="dirty" class="fd" style="color: var(--amber)">
        {{ t('settings.pricing.unsaved') }}
      </span>
      <button class="btn pri sm" type="button" :disabled="!dirty || loading" @click="save">
        {{ t('settings.pricing.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Model pricing editor — per-model USD/1M price overrides used by activity cost
// calc. Loads the effective table (default + override) from the sidecar via
// useModelPricing; edits promote a row into the overrides map; Save persists the
// whole map (settings.set 'modelPricing'). Reset drops a single override. All
// strings via i18n; numeric inputs are plain <input type=number> (AppSelect is
// for choice fields, not numeric entry).
import { computed, onMounted } from 'vue'
import { useModelPricing, type ModelPrice, type PriceFields } from '~/composables/useModelPricing'

const { t } = useI18n()
const {
  models,
  loading,
  error,
  dirty,
  fetchedAt,
  fetching,
  load,
  save,
  fetchRemote,
  effectivePrice,
  isOverridden,
  setField,
  resetModel,
} = useModelPricing()

onMounted(() => void load())

// Local-time label for the last remote fetch (browser Date is fine here).
const fetchedLabel = computed(() =>
  fetchedAt.value ? new Date(fetchedAt.value).toLocaleString() : '',
)

function onInput(model: ModelPrice, field: keyof PriceFields, e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  setField(model, field, value)
}

function onFetch(): void {
  void fetchRemote()
}
</script>

<style scoped>
.spr {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sprtoolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spin {
  animation: sprspin 0.9s linear infinite;
}
@keyframes sprspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
.sprpanel {
  padding: 0;
  overflow: hidden;
}
.sprhint {
  padding: 16px;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sprtable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sprtable th {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-weight: 500;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}
.sprtable td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.sprtable tbody tr:last-child td {
  border-bottom: 0;
}
.sprtable .tl {
  text-align: left;
}
.sprtable .tr {
  text-align: right;
}
.sprmdl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sprinp {
  width: 92px;
  border: 1px solid var(--border);
  background: var(--bgInput);
  border-radius: var(--r-xs);
  padding: 5px 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  outline: none;
  text-align: right;
}
.sprinp:focus {
  border-color: var(--borderFocus);
}
.sprreset {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.sprreset:hover:not(:disabled) {
  border-color: var(--borderStrong);
  color: var(--text);
}
.sprreset:disabled {
  opacity: 0.4;
  cursor: default;
}
.sprfoot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pcarderror {
  border-radius: var(--r-sm);
  padding: 6px 10px;
  font-size: 1em;
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
}
</style>
