<template>
  <div class="flex flex-col gap-3">
    <SettingsPaneHeader
      :title="t('settings.pricing.heading')"
      :subtitle="t('settings.pricing.intro')"
    />

    <div class="flex items-center gap-2.5">
      <span class="flex-1 text-sm text-dim">
        <template v-if="fetchedAt">
          {{ t('settings.pricing.fetchedAt', { when: fetchedLabel }) }}
        </template>
        <template v-else>{{ t('settings.pricing.neverFetched') }}</template>
      </span>
      <Button type="button" :disabled="fetching" variant="outline" size="sm" @click="onFetch">
        <Icon
          name="refresh"
          class="size-3.5"
          :class="{ 'animate-spin motion-reduce:animate-none': fetching }"
        />
        {{ t('settings.pricing.fetch') }}
      </Button>
    </div>

    <Alert
      v-if="error"
      variant="destructive"
      class="border-destructive/50 bg-destructive/10 px-2.5 py-1.5"
    >
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card class="gap-0 overflow-hidden p-0 shadow-none">
      <div v-if="loading && !models.length" class="p-4 text-sm text-faint">
        {{ t('settings.pricing.loading') }}
      </div>
      <div v-else-if="!models.length" class="p-4 text-sm text-faint">
        {{ t('settings.pricing.empty') }}
      </div>
      <Table v-else>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="px-3 text-xs text-dim">
              {{ t('settings.pricing.col.model') }}
            </TableHead>
            <TableHead class="px-3 text-right text-xs text-dim">
              {{ t('settings.pricing.col.input') }}
            </TableHead>
            <TableHead class="px-3 text-right text-xs text-dim">
              {{ t('settings.pricing.col.output') }}
            </TableHead>
            <TableHead class="px-3 text-right text-xs text-dim">
              {{ t('settings.pricing.col.cacheRead') }}
            </TableHead>
            <TableHead class="px-3 text-right text-xs text-dim">
              {{ t('settings.pricing.col.cacheWrite') }}
            </TableHead>
            <TableHead class="px-3" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="m in models" :key="m.model" class="last:border-b-0">
            <TableCell class="px-3 py-2">
              <div class="flex flex-wrap items-center gap-2">
                <!-- mono-ok: id model -->
                <span class="font-mono">{{ m.model }}</span>
                <Badge variant="outline" class="text-muted-foreground">{{ m.provider }}</Badge>
                <Badge
                  v-if="isOverridden(m.model)"
                  variant="outline"
                  class="border-primary/45 bg-primary/10 text-primary"
                >
                  {{ t('settings.pricing.overridden') }}
                </Badge>
                <Badge
                  v-else-if="m.source === 'remote'"
                  variant="outline"
                  class="text-muted-foreground"
                >
                  {{ t('settings.pricing.remote') }}
                </Badge>
              </div>
            </TableCell>
            <TableCell class="px-3 py-2 text-right">
              <Input
                type="number"
                min="0"
                step="0.01"
                :model-value="effectivePrice(m).input"
                class="tabular-nums"
                @update:model-value="onInput(m, 'input', $event)"
              />
            </TableCell>
            <TableCell class="px-3 py-2 text-right">
              <Input
                type="number"
                min="0"
                step="0.01"
                :model-value="effectivePrice(m).output"
                class="tabular-nums"
                @update:model-value="onInput(m, 'output', $event)"
              />
            </TableCell>
            <TableCell class="px-3 py-2 text-right">
              <Input
                type="number"
                min="0"
                step="0.01"
                :model-value="effectivePrice(m).cacheRead"
                class="tabular-nums"
                @update:model-value="onInput(m, 'cacheRead', $event)"
              />
            </TableCell>
            <TableCell class="px-3 py-2 text-right">
              <Input
                type="number"
                min="0"
                step="0.01"
                :model-value="effectivePrice(m).cacheWrite"
                class="tabular-nums"
                @update:model-value="onInput(m, 'cacheWrite', $event)"
              />
            </TableCell>
            <TableCell class="px-3 py-2 text-right">
              <Button
                type="button"
                variant="outline"
                size="iconSm"
                class="text-dim disabled:opacity-40"
                :disabled="!isOverridden(m.model)"
                :title="t('settings.pricing.reset')"
                :aria-label="t('settings.pricing.reset')"
                @click="resetModel(m.model)"
              >
                <Icon name="refresh" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <div class="flex items-center gap-2.5">
      <span class="flex-1 text-sm text-dim">{{ t('settings.pricing.unit') }}</span>
      <span v-if="dirty" class="text-sm text-warning">
        {{ t('settings.pricing.unsaved') }}
      </span>
      <Button type="button" :disabled="!dirty || loading" variant="default" size="sm" @click="save">
        {{ t('settings.pricing.save') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Model pricing editor — per-model USD/1M price overrides used by activity cost
// calc. Loads the effective table (default + override) from the sidecar via
// useModelPricing; edits promote a row into the overrides map; Save persists the
// whole map (settings.set 'modelPricing'). Reset drops a single override. All
// strings via i18n; numeric inputs are Input type=number (AppSelect is for choice
// fields, not numeric entry).
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

function onInput(model: ModelPrice, field: keyof PriceFields, v: string): void {
  setField(model, field, Number(v))
}

function onFetch(): void {
  void fetchRemote()
}
</script>
