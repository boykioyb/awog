<template>
  <!-- Chip của hàng ngữ cảnh phiên (SessionContextStrip): SSH · ba chip hạ tầng ·
       đánh dấu · task. Viền `border-input` (borderStrong) chứ không `border`: ở light
       theme --border chỉ đủ làm đường phân cách, không đủ vẽ đường bao một vật thể nhỏ.
       Nền trong suốt + viền + accent-tint là quy ước control của app, KHÔNG fill xám. -->
  <Button variant="outline" size="xs" type="button" :class="chipClass">
    <Icon :name="icon" />
    <!-- Nhãn tự cắt để chip nhường chỗ khi hàng chật — chip khác không bị đẩy khỏi hàng. -->
    <slot>
      <span class="min-w-0 truncate" :class="!tinted && 'text-foreground'">{{ label }}</span>
    </slot>
    <span v-if="sub" class="shrink-0" :class="!tinted && 'text-faint'">{{ sub }}</span>
    <Icon v-if="chev" name="chev" />
  </Button>
</template>

<script setup lang="ts">
// Một khuôn chip cho mọi chip của hàng ngữ cảnh — trước đây là class `.ctxchip`
// global trong app-shell.css. Cờ trạng thái giữ đúng thứ tự cascade cũ:
// on/acc (accent) < warn (amber) < danger (đỏ, chỉ chip AWS production).
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<{
    icon: string
    // Bỏ trống khi bên gọi tự vẽ nhãn qua slot mặc định (vd. huy hiệu số của chip đánh dấu).
    label?: string | number
    sub?: string
    chev?: boolean
    on?: boolean
    acc?: boolean
    warn?: boolean
    danger?: boolean
  }>(),
  { label: '', sub: '', chev: false, on: false, acc: false, warn: false, danger: false },
)

const chipClass = computed(() =>
  cn(
    'h-5.5 min-w-0 shrink gap-1.5 rounded-md border-input bg-transparent px-2.5 text-xs font-normal text-dim shadow-none hover:bg-accent hover:text-foreground [&_svg]:size-3',
    (props.on || props.acc) && 'border-selected-border text-primary hover:text-primary',
    props.on && 'bg-selected hover:bg-selected',
    props.warn &&
      'border-warning/45 bg-warning/10 text-warning hover:bg-warning/10 hover:text-warning',
    props.danger &&
      'border-destructive/45 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive',
  ),
)

// Chip đã nhuộm cảnh báo thì nhãn + phụ đề ăn theo màu chip (như `.ctxchip.warn`).
const tinted = computed(() => props.warn || props.danger)
</script>
