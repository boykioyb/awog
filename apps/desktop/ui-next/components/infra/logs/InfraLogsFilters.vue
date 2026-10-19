<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-2">
      <div class="relative min-w-0 flex-auto">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
        />
        <Input
          :model-value="quick"
          type="search"
          spellcheck="false"
          class="h-ctrl-sm pl-8"
          :placeholder="t('infra.logs.filters.quickPh')"
          @update:model-value="onQuick"
        />
      </div>
      <!-- Chọn MỘT mức — ToggleGroup. Bấm lại ô đang bật KHÔNG bỏ chọn (reka gửi giá
           trị rỗng, `onLevel` bỏ qua) nên luôn có đúng một mức, "Tất cả" là `ALL`. -->
      <ToggleGroup
        type="single"
        variant="outline"
        :spacing="1"
        class="shrink-0"
        :model-value="level || ALL"
        :aria-label="t('infra.logs.filters.level')"
        @update:model-value="onLevel"
      >
        <ToggleGroupItem
          v-for="lv in LEVELS"
          :key="lv || 'all'"
          :value="lv || ALL"
          class="h-ctrl-xs min-w-0 rounded-sm px-2 text-xs font-normal text-dim shadow-none"
          :class="LEVEL_ON[lv]"
        >
          {{ lv || t('infra.logs.filters.all') }}
        </ToggleGroupItem>
      </ToggleGroup>
      <span class="shrink-0 text-xs text-dim tabular-nums">
        {{ t('infra.logs.filters.showing', { shown: shown, total: total }) }}
      </span>
    </div>

    <!-- Facet: bấm một giá trị ⇒ chèn `filter <trường> = "giá trị"` vào câu lệnh.
         Đây là đường NGẮN NHẤT từ "tôi thấy một giá trị lạ" tới "cho tôi mọi dòng
         có giá trị đó" — không phải tự gõ lại tên trường. -->
    <div v-if="facets.length > 0" class="flex flex-col gap-1">
      <div v-for="f in facets" :key="f.field" class="flex flex-wrap items-center gap-1">
        <!-- mono-ok: tên trường của bản ghi log, không phải câu văn -->
        <span class="min-w-24 font-mono text-xs text-dim">{{ f.field }}</span>
        <Button
          v-for="v in f.values"
          :key="v.value"
          variant="outline"
          size="xs"
          class="block h-auto max-w-65 truncate rounded-sm px-2 py-0.5 font-normal shadow-none"
          :class="
            active?.field === f.field && active.value === v.value
              ? 'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
              : 'text-muted-foreground'
          "
          :title="t('infra.logs.filters.insertHint')"
          @click="emit('insert', f.field, v.value)"
        >
          {{ v.value }}
          <span class="ml-1 text-faint tabular-nums">{{ v.count }}</span>
        </Button>
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
import Input from '~/components/ui/input/Input.vue'

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

function onQuick(v: string): void {
  emit('update:quick', v)
}

type Level = (typeof LEVELS)[number]

/** Giá trị đại diện "Tất cả" trong ToggleGroup — reka coi chuỗi rỗng là bỏ chọn. */
const ALL = 'ALL'

/** Màu trạng thái của ô đang bật: lỗi đỏ, cảnh báo vàng, còn lại accent-tint. */
const LEVEL_ON: Record<Level, string> = {
  '': 'data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary',
  ERROR:
    'data-[state=on]:border-destructive data-[state=on]:bg-selected data-[state=on]:text-destructive',
  WARN: 'data-[state=on]:border-warning data-[state=on]:bg-selected data-[state=on]:text-warning',
  INFO: 'data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary',
  DEBUG:
    'data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary',
}

/** Bấm lại ô đang bật thì reka gửi giá trị rỗng — bỏ qua để luôn có một mức. */
function onLevel(v: unknown): void {
  if (typeof v !== 'string' || v === '') return
  emit('update:level', v === ALL ? '' : (v as Level))
}
</script>
