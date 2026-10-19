<template>
  <!-- Avatar tròn 2 ký tự — palette deterministic theo seed (khuôn
       ActorAvatar của Multica: agent = initials từ tên, squad = icon users
       để phân biệt ngay trên list). -->
  <span
    class="inline-flex flex-none items-center justify-center rounded-full font-semibold select-none"
    :class="SIZE_CLASS[size]"
    :style="style"
  >
    <Icon v-if="variant === 'squad'" name="users" class="size-[55%]" />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '~/components/Icon.vue'

// Màu DỮ LIỆU (mỗi entity một màu cố định theo seed), không phải màu theme. Chưa
// chuyển sang token: bảng token ngữ nghĩa chưa có hồng + xanh ngọc (xem báo cáo đợt
// chuyển shadcn) — đổi số màu thì mọi avatar đổi màu theo.
const PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(167,139,250,.15)', fg: '#c4b5fd' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(16,185,129,.15)', fg: '#6ee7b7' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(239,68,68,.13)', fg: '#fca5a5' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(96,165,250,.15)', fg: '#93c5fd' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(245,158,11,.15)', fg: '#fcd34d' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(236,72,153,.15)', fg: '#f9a8d4' }, // hex-ok: màu nhận diện entity (dữ liệu)
  { bg: 'rgba(45,212,191,.15)', fg: '#5eead4' }, // hex-ok: màu nhận diện entity (dữ liệu)
]

const props = withDefaults(
  defineProps<{
    name: string
    // seed ổn định cho màu (mặc định = name) — agent truyền agentKey để màu
    // không đổi khi đổi tên.
    seed?: string
    variant?: 'entity' | 'squad'
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { seed: '', variant: 'entity', size: 'md' },
)

const SIZE_CLASS = {
  // px-ok: chữ viết tắt trong avatar 20px — cỡ chữ đi theo đường kính, không theo thang chữ
  sm: 'size-5 text-[9px]',
  md: 'size-7 text-xs',
  lg: 'size-10 rounded-lg text-lg',
} as const

const initials = computed(() => {
  const words = props.name
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  const base = (props.name || '?').replace(/[^a-z0-9]/gi, '')
  return (base.slice(0, 2) || '?').toUpperCase()
})

const style = computed(() => {
  const key = props.seed || props.name
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h << 5) - h + key.charCodeAt(i)
  const c = PALETTE[Math.abs(h) % PALETTE.length]!
  return { background: c.bg, color: c.fg }
})
</script>
