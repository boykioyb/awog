<template>
  <div class="relative inline-flex">
    <!-- Thanh gọn kiểu AWS CloudWatch: Clear · các preset nhanh · Custom.

         ⚠ `whitespace-nowrap` + `flex-auto` trên từng ô là bản vá cho cột hẹp của màn
         Nhật ký (240–320px): ở đó thanh bị kéo giãn bằng cả cột, sáu ô không đủ chỗ
         một hàng, và bản trước bẻ CHỮ trong ô — "Tuỳ chọn" thành "Tuỳ / chọn" — thay
         vì xuống hàng theo ô. Nay ô không bao giờ vỡ chữ, và khi phải xuống hàng thì
         các ô giãn đều nên hàng thứ hai đọc ra như một hàng có chủ đích. Ở màn Giám
         sát / Bảng điều khiển thanh là `inline-flex` nên co theo nội dung. -->
    <div
      class="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5"
      role="group"
      :aria-label="t('infra.time.label')"
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class="flex-auto px-2 font-normal text-faint hover:bg-transparent hover:text-foreground"
        @click="onClear"
      >
        {{ t('infra.time.clear') }}
      </Button>
      <Button
        v-for="s in quickSeconds"
        :key="s"
        type="button"
        variant="ghost"
        size="xs"
        class="flex-auto px-2 font-normal tabular-nums hover:bg-transparent hover:text-foreground"
        :class="isQuickOn(s) ? 'bg-selected text-primary hover:bg-selected' : 'text-dim'"
        :aria-pressed="isQuickOn(s)"
        @click="emit('update:modelValue', relativeWindow(s))"
      >
        {{ shortLabel(s) }}
      </Button>
      <Button
        ref="customBtn"
        type="button"
        variant="ghost"
        size="xs"
        class="flex-auto gap-1 px-2 font-normal text-primary tabular-nums hover:bg-transparent"
        :class="{ 'bg-selected hover:bg-selected': open || isCustomActive }"
        :aria-expanded="open"
        @click="toggle"
      >
        {{ isCustomActive ? customSummary : t('infra.time.custom') }}
        <Icon name="calendar" class="size-3" />
      </Button>
    </div>

    <!-- Teleport ra <body> + định vị FIXED.
         ⚠ Bản trước là `position: absolute` trong khung control, và nó bị CẮT ở màn
         Nhật ký: cột trái có `overflow-y: auto`, mà theo CSS khi một trục khác
         `visible` thì trục kia cũng thành `auto` — nên cột rộng 320px xén mất popover
         rộng 460px. Không phải "bị che": nó bị tổ tiên cắt, nên không z-index nào cứu
         được. Cùng khuôn `AppSelect` đã dùng cho đúng vấn đề này.
         `left`/`top`|`bottom`/`width`/`max-height` do `updatePopPosition()` đặt inline. -->
    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-128" @click="close" />
        <div
          ref="popRef"
          data-infra-overlay
          class="fixed z-129 overflow-y-auto rounded-xl border border-input bg-popover p-3.5 text-popover-foreground shadow-md"
          :style="popStyle"
          @click.stop
        >
          <!-- Tab Absolute | Relative -->
          <Tabs
            :model-value="tab"
            class="mb-3"
            @update:model-value="
              (v: string | number) => (tab = v === 'absolute' ? 'absolute' : 'relative')
            "
          >
            <TabsList class="h-ctrl-sm">
              <TabsTrigger value="absolute">{{ t('infra.time.absolute') }}</TabsTrigger>
              <TabsTrigger value="relative">{{ t('infra.time.relative') }}</TabsTrigger>
            </TabsList>
          </Tabs>

          <!-- ── Relative ── -->
          <div v-if="tab === 'relative'" class="flex flex-col gap-2">
            <div v-for="u in UNITS" :key="u" class="flex items-center gap-2.5">
              <span class="w-15 flex-none text-sm text-dim">{{ t(`infra.time.unit.${u}`) }}</span>
              <div class="flex flex-wrap gap-1.5">
                <Button
                  v-for="n in RELATIVE_GRID[u]"
                  :key="n"
                  type="button"
                  variant="outline"
                  size="xs"
                  class="min-w-10 font-normal tabular-nums"
                  :class="
                    amount === n && unit === u
                      ? 'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
                      : 'text-muted-foreground'
                  "
                  @click="pickGrid(n, u)"
                >
                  {{ n }}
                </Button>
              </div>
            </div>

            <div class="mt-1.5 flex flex-wrap gap-4 border-t pt-3">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-foreground">
                  {{ t('infra.time.duration') }}
                </span>
                <Input
                  v-model.number="amount"
                  type="number"
                  min="1"
                  max="9999"
                  inputmode="numeric"
                  class="h-ctrl-sm"
                />
                <span class="text-xs text-faint">{{ t('infra.time.upTo4') }}</span>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-foreground">
                  {{ t('infra.time.unitOfTime') }}
                </span>
                <AppSelect v-model="unit" :options="unitOptions" width="150px" />
              </label>
            </div>
          </div>

          <!-- ── Absolute ── -->
          <div v-else class="flex flex-wrap gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-semibold text-foreground">{{ t('infra.time.from') }}</span>
              <Input v-model="absStart" type="datetime-local" class="h-ctrl-sm" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-semibold text-foreground">{{ t('infra.time.to') }}</span>
              <Input v-model="absEnd" type="datetime-local" class="h-ctrl-sm" />
            </label>
            <p v-if="absError" class="m-0 basis-full text-sm text-destructive">{{ absError }}</p>
          </div>

          <!-- Footer -->
          <div class="mt-3.5 flex items-center gap-2 border-t pt-3">
            <Button type="button" variant="outline" @click="onClearDraft">
              {{ t('infra.time.clear') }}
            </Button>
            <span class="flex-auto" />
            <Button type="button" variant="outline" @click="close">
              {{ t('infra.time.cancel') }}
            </Button>
            <Button type="button" :disabled="!canApply" variant="default" @click="apply">
              {{ t('infra.time.apply') }}
            </Button>
          </div>
        </div>
      </template>
    </Teleport>
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
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useEscToClose } from '~/composables/useEscToClose'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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

// ── Định vị popover (teleported, fixed) ─────────────────────────────────────
//
// Cùng phép của `AppSelect`: neo dưới nút, lật LÊN khi dưới không đủ chỗ, và kẹp
// trong viewport theo cả hai trục. Phải tính bằng JS vì phần tử đã rời khỏi cây
// bố cục của nút — đó chính là cái giá của việc thoát khỏi tổ tiên bị cắt.
// Khai bằng `useTemplateRef` theo luật của repo (không dùng `ref<HTMLElement>(null)`,
// thứ làm `vue-tsc` đỏ). `customBtn` gắn trên `Button` shadcn ⇒ template ref là
// INSTANCE, phần tử thật nằm ở `$el`.
const customBtn = useTemplateRef<{ $el: HTMLElement }>('customBtn')
const popRef = useTemplateRef<HTMLElement>('popRef')
const popStyle = ref<Record<string, string>>({})

const POP_GAP = 6
const POP_WIDTH = 460
const POP_MARGIN = 12

function updatePopPosition(): void {
  const trigger = customBtn.value?.$el
  if (!trigger) return
  const r = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const width = Math.min(POP_WIDTH, vw - POP_MARGIN * 2)
  // Neo mép TRÁI theo nút, nhưng không cho tràn mép phải màn hình.
  const left = Math.max(POP_MARGIN, Math.min(r.left, vw - width - POP_MARGIN))

  const spaceBelow = vh - r.bottom - POP_GAP - POP_MARGIN
  const spaceAbove = r.top - POP_GAP - POP_MARGIN
  const wanted = popRef.value?.scrollHeight ?? 0
  const flipUp = spaceBelow < Math.min(wanted || 520, 520) && spaceAbove > spaceBelow
  const maxH = Math.max(200, Math.min(520, flipUp ? spaceAbove : spaceBelow))

  popStyle.value = {
    left: `${String(Math.round(left))}px`,
    width: `${String(Math.round(width))}px`,
    maxHeight: `${String(Math.round(maxH))}px`,
    ...(flipUp
      ? { bottom: `${String(Math.round(vh - r.top + POP_GAP))}px` }
      : { top: `${String(Math.round(r.bottom + POP_GAP))}px` }),
  }
}

function onReposition(): void {
  if (open.value) updatePopPosition()
}

// `scroll` bắt ở pha CAPTURE: popover neo theo một nút nằm trong cột có thanh
// cuộn riêng, mà sự kiện cuộn của phần tử KHÔNG nổi bọt lên window.
watch(open, async (isOpen) => {
  if (isOpen) {
    updatePopPosition()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    // Lượt thứ hai sau khi popover đã mount: lúc này mới đo được chiều cao thật
    // để quyết định lật lên hay xuống.
    await nextTick()
    updatePopPosition()
  } else {
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
})

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
