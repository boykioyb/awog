<template>
  <ToggleGroup
    type="single"
    :spacing="1"
    class="rounded-lg bg-muted p-0.5"
    :model-value="model"
    @update:model-value="pick"
  >
    <ToggleGroupItem
      v-for="(opt, i) in options"
      :key="optionValue(opt, i)"
      :value="optionValue(opt, i)"
      class="h-(--ctrl-h-xs) px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
    >
      {{ optionLabel(opt) }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>

<script setup lang="ts">
// Segmented control (chọn 1) — ToggleGroup của shadcn, điều khiển qua v-model.
// Option là chuỗi (label === value) hoặc { label, value } khi giá trị lưu khác
// chữ hiển thị (vd id model vs tên hiển thị).
type SegOption = string | { label: string; value: string }

defineProps<{
  options: readonly SegOption[]
}>()

const model = defineModel<string>({ required: true })

const optionValue = (opt: SegOption, i: number): string =>
  typeof opt === 'string' ? opt : (opt.value ?? String(i))
const optionLabel = (opt: SegOption): string => (typeof opt === 'string' ? opt : opt.label)

// ToggleGroup single cho phép bấm lại mục đang bật để bỏ chọn (emit rỗng) — segmented
// luôn phải có một giá trị nên bỏ qua lần bỏ chọn đó.
function pick(v: unknown): void {
  if (typeof v === 'string' && v) model.value = v
}
</script>
