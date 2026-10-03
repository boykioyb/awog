<template>
  <!-- Avatar tròn 2 ký tự — palette deterministic theo seed (khuôn
       ActorAvatar của Multica: agent = initials từ tên, squad = icon users
       để phân biệt ngay trên list). -->
  <span class="eav" :class="[`s-${size}`]" :style="style">
    <Icon v-if="variant === 'squad'" name="users" class="eav-ic" />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '~/components/Icon.vue'

const PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(167,139,250,.15)', fg: '#c4b5fd' },
  { bg: 'rgba(16,185,129,.15)', fg: '#6ee7b7' },
  { bg: 'rgba(239,68,68,.13)', fg: '#fca5a5' },
  { bg: 'rgba(96,165,250,.15)', fg: '#93c5fd' },
  { bg: 'rgba(245,158,11,.15)', fg: '#fcd34d' },
  { bg: 'rgba(236,72,153,.15)', fg: '#f9a8d4' },
  { bg: 'rgba(45,212,191,.15)', fg: '#5eead4' },
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

<style scoped>
.eav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: 600;
  flex: 0 0 auto;
  user-select: none;
}
.s-sm {
  width: 20px;
  height: 20px;
  font-size: 9px;
}
.s-md {
  width: 28px;
  height: 28px;
  font-size: 11px;
}
.s-lg {
  width: 40px;
  height: 40px;
  font-size: 15px;
  border-radius: var(--r-btn);
}
.eav-ic {
  width: 55%;
  height: 55%;
}
</style>
