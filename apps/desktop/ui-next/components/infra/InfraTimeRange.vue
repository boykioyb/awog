<template>
  <div class="itr">
    <!-- Thanh gọn kiểu AWS CloudWatch: Clear · các preset nhanh · Custom. -->
    <div class="itr-bar seg" role="group" :aria-label="t('infra.time.label')">
      <span class="itr-cell itr-clear" role="button" @click="onClear">
        {{ t('infra.time.clear') }}
      </span>
      <span
        v-for="s in quickSeconds"
        :key="s"
        class="itr-cell"
        :class="{ on: isQuickOn(s) }"
        role="button"
        :aria-pressed="isQuickOn(s)"
        @click="emit('update:modelValue', relativeWindow(s))"
      >
        {{ shortLabel(s) }}
      </span>
      <span
        ref="customBtn"
        class="itr-cell itr-custom"
        :class="{ on: open || isCustomActive }"
        role="button"
        :aria-expanded="open"
        @click="toggle"
      >
        {{ isCustomActive ? customSummary : t('infra.time.custom') }}
        <Icon name="calendar" class="itr-cal" />
      </span>
    </div>

    <template v-if="open">
      <div class="itr-backdrop" @click="close" />
      <div class="itr-pop" @click.stop>
        <!-- Tab Absolute | Relative -->
        <div class="seg itr-tabs">
          <span
            class="itr-tab"
            :class="{ on: tab === 'absolute' }"
            role="button"
            :aria-pressed="tab === 'absolute'"
            @click="tab = 'absolute'"
          >
            {{ t('infra.time.absolute') }}
          </span>
          <span
            class="itr-tab"
            :class="{ on: tab === 'relative' }"
            role="button"
            :aria-pressed="tab === 'relative'"
            @click="tab = 'relative'"
          >
            {{ t('infra.time.relative') }}
          </span>
        </div>

        <!-- ── Relative ── -->
        <div v-if="tab === 'relative'" class="itr-rel">
          <div v-for="u in UNITS" :key="u" class="itr-grid-row">
            <span class="itr-grid-lbl">{{ t(`infra.time.unit.${u}`) }}</span>
            <div class="itr-grid">
              <button
                v-for="n in RELATIVE_GRID[u]"
                :key="n"
                class="itr-o"
                :class="{ on: amount === n && unit === u }"
                type="button"
                @click="pickGrid(n, u)"
              >
                {{ n }}
              </button>
            </div>
          </div>

          <div class="itr-dur">
            <label class="itr-field">
              <span class="itr-field-lbl">{{ t('infra.time.duration') }}</span>
              <input
                v-model.number="amount"
                class="itr-input"
                type="number"
                min="1"
                max="9999"
                inputmode="numeric"
              />
              <span class="itr-hint">{{ t('infra.time.upTo4') }}</span>
            </label>
            <label class="itr-field">
              <span class="itr-field-lbl">{{ t('infra.time.unitOfTime') }}</span>
              <AppSelect v-model="unit" :options="unitOptions" width="150px" />
            </label>
          </div>
        </div>

        <!-- ── Absolute ── -->
        <div v-else class="itr-abs">
          <label class="itr-field">
            <span class="itr-field-lbl">{{ t('infra.time.from') }}</span>
            <input v-model="absStart" class="itr-input" type="datetime-local" />
          </label>
          <label class="itr-field">
            <span class="itr-field-lbl">{{ t('infra.time.to') }}</span>
            <input v-model="absEnd" class="itr-input" type="datetime-local" />
          </label>
          <p v-if="absError" class="itr-err">{{ absError }}</p>
        </div>

        <!-- Footer -->
        <div class="itr-foot">
          <button class="btn" type="button" @click="onClearDraft">
            {{ t('infra.time.clear') }}
          </button>
          <span class="itr-foot-sp" />
          <button class="btn" type="button" @click="close">{{ t('infra.time.cancel') }}</button>
          <button class="btn pri" type="button" :disabled="!canApply" @click="apply">
            {{ t('infra.time.apply') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Control CỬA SỔ THỜI GIAN kiểu AWS CloudWatch, dùng chung cho Logs · Giám sát ·
// Dashboard. Thanh gọn với vài preset nhanh + nút "Custom" mở popover hai tab:
//   · Relative — lưới đơn vị (Minutes/Hours/Days/Weeks) + ô Duration/Unit ⇒ "N gần đây".
//   · Absolute — hai mốc ngày-giờ từ–đến.
// Chỉ BIND: nhận `modelValue` (InfraWindow) và emit khi Apply/bấm preset — không tự
// chạy truy vấn. Từng màn quyết định đổi cửa sổ thì làm gì (Logs tail lại; Giám sát
// đánh dấu dirty chờ Nạp).
import { computed, ref, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useEscToClose } from '~/composables/useEscToClose'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import {
  RELATIVE_GRID,
  UNIT_SECONDS,
  absoluteWindow,
  parseLocalInput,
  relativeFromUnit,
  relativeWindow,
  toLocalInput,
  windowEquals,
  type InfraWindow,
  type RelativeUnit,
} from '~/utils/infra-window'

const props = withDefaults(
  defineProps<{
    modelValue: InfraWindow
    /** Preset nhanh trên thanh (giây). Mặc định 1m · 30m · 1h · 12h. */
    quickSeconds?: readonly number[]
    /** Cửa sổ khi bấm "Clear". Mặc định 1 giờ. */
    defaultSeconds?: number
  }>(),
  { quickSeconds: () => [60, 1800, 3600, 43_200], defaultSeconds: 3600 },
)

const emit = defineEmits<{ 'update:modelValue': [w: InfraWindow] }>()

const { t } = useI18n()

const UNITS: readonly RelativeUnit[] = ['minutes', 'hours', 'days', 'weeks']
const unitOptions = computed<AppSelectOption[]>(() =>
  UNITS.map((u) => ({ label: t(`infra.time.unit.${u}`), value: u })),
)

// ── Thanh: preset nhanh + nhãn ──────────────────────────────────────────────
function isQuickOn(seconds: number): boolean {
  return windowEquals(props.modelValue, relativeWindow(seconds))
}

/** Cửa sổ hiện tại KHÔNG khớp preset nhanh nào ⇒ đang là "Custom". */
const isCustomActive = computed(() => !props.quickSeconds.some((s) => isQuickOn(s)))

/** Nhãn ngắn của một khoảng giây: phút `m`, giờ `H`, ngày `D`, tuần `W`. */
function shortLabel(seconds: number): string {
  if (seconds % UNIT_SECONDS.weeks === 0) return `${seconds / UNIT_SECONDS.weeks}W`
  if (seconds % UNIT_SECONDS.days === 0) return `${seconds / UNIT_SECONDS.days}D`
  if (seconds % UNIT_SECONDS.hours === 0) return `${seconds / UNIT_SECONDS.hours}H`
  return `${Math.max(1, Math.round(seconds / 60))}m`
}

const customSummary = computed(() => {
  const w = props.modelValue
  if (w.mode === 'absolute') return t('infra.time.customRange')
  return shortLabel(w.seconds)
})

// ── Popover + nháp ──────────────────────────────────────────────────────────
const open = ref(false)
const tab = ref<'absolute' | 'relative'>('relative')
const amount = ref(15)
const unit = ref<RelativeUnit>('minutes')
const absStart = ref('')
const absEnd = ref('')

function close(): void {
  open.value = false
}
useEscToClose(open, close)

/** Biểu diễn một khoảng giây thành (amount, unit) bằng đơn vị LỚN NHẤT chia hết. */
function toAmountUnit(seconds: number): { amount: number; unit: RelativeUnit } {
  const order: RelativeUnit[] = ['weeks', 'days', 'hours', 'minutes']
  for (const u of order) {
    if (seconds % UNIT_SECONDS[u] === 0) return { amount: seconds / UNIT_SECONDS[u], unit: u }
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' }
}

// Mở ra ⇒ gieo nháp từ cửa sổ hiện tại; tab theo loại cửa sổ đang dùng.
watch(open, (isOpen) => {
  if (!isOpen) return
  const w = props.modelValue
  const now = Date.now()
  if (w.mode === 'absolute') {
    tab.value = 'absolute'
    absStart.value = toLocalInput(w.startMs)
    absEnd.value = toLocalInput(w.endMs)
    const rel = toAmountUnit(Math.max(60, Math.round((w.endMs - w.startMs) / 1000)))
    amount.value = rel.amount
    unit.value = rel.unit
  } else {
    tab.value = 'relative'
    const rel = toAmountUnit(w.seconds)
    amount.value = rel.amount
    unit.value = rel.unit
    absEnd.value = toLocalInput(now)
    absStart.value = toLocalInput(now - w.seconds * 1000)
  }
})

function toggle(): void {
  open.value = !open.value
}

function pickGrid(n: number, u: RelativeUnit): void {
  amount.value = n
  unit.value = u
}

const absError = computed(() => {
  if (tab.value !== 'absolute') return ''
  const s = parseLocalInput(absStart.value)
  const e = parseLocalInput(absEnd.value)
  if (Number.isNaN(s) || Number.isNaN(e)) return t('infra.time.absIncomplete')
  if (e <= s) return t('infra.time.absOrder')
  return ''
})

const canApply = computed(() => {
  if (tab.value === 'relative') return Number.isFinite(amount.value) && amount.value >= 1
  return absError.value === ''
})

function apply(): void {
  if (!canApply.value) return
  if (tab.value === 'relative') {
    emit('update:modelValue', relativeFromUnit(amount.value, unit.value))
  } else {
    emit(
      'update:modelValue',
      absoluteWindow(parseLocalInput(absStart.value), parseLocalInput(absEnd.value)),
    )
  }
  close()
}

// "Clear" trên thanh: về cửa sổ mặc định và đóng.
function onClear(): void {
  emit('update:modelValue', relativeWindow(props.defaultSeconds))
  close()
}

// "Clear" trong popover: chỉ dọn NHÁP, không đổi cửa sổ cho tới khi Apply.
function onClearDraft(): void {
  amount.value = 15
  unit.value = 'minutes'
  absStart.value = ''
  absEnd.value = ''
}
</script>

<style scoped>
.itr {
  position: relative;
  display: inline-flex;
}

/* Thanh preset — khung `.seg` toàn cục, các ô chia theo nội dung. */
.itr-bar {
  flex-wrap: wrap;
}

.itr-cell {
  padding: 4px 10px;
  border-radius: var(--r-xs);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    background 0.12s,
    color 0.12s;
}
.itr-cell:hover {
  color: var(--text);
}
.itr-cell.on {
  background: var(--accentDim);
  color: var(--accent);
}

.itr-clear {
  color: var(--textFaint);
}

.itr-custom {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
}
.itr-cal {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

/* ── Popover ── */
.itr-backdrop {
  position: fixed;
  inset: 0;
  z-index: 128;
}
.itr-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 129;
  width: 460px;
  max-width: 92vw;
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 14px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-md);
}

.itr-tabs {
  margin-bottom: 12px;
}
.itr-tab {
  padding: 5px 14px;
  border-radius: var(--r-xs);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--textDim);
  cursor: pointer;
}
.itr-tab.on {
  background: var(--accentDim);
  color: var(--accent);
}

.itr-rel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.itr-grid-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.itr-grid-lbl {
  flex: 0 0 58px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.itr-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.itr-o {
  min-width: 40px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.itr-o:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.itr-o.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}

.itr-dur {
  display: flex;
  gap: 16px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.itr-abs {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.itr-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.itr-field-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.itr-input {
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
}
.itr-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.itr-err {
  flex: 1 1 100%;
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.itr-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.itr-foot-sp {
  flex: 1 1 auto;
}
</style>
