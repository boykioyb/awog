<template>
  <Button
    :variant="shadVariant"
    :size="shadSize"
    :type="type"
    :disabled="disabled || loading"
    :class="extraClass"
    @click="emit('click', $event)"
  >
    <Loader2 v-if="loading" class="animate-spin" :size="14" />
    <slot />
  </Button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'

// AWOG facade over the shadcn-vue Button (ADR 0044). Real reka-ui + cva underneath;
// this keeps the AWOG-flavored prop API used across ~114 call sites:
//   - AWOG variant names (danger → shadcn `destructive`)
//   - AWOG sizes (md → shadcn `default`, plus xs/icon)
//   - extra props not in stock shadcn: active (toolbar toggle), loading, block
type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'ghostDanger' | 'danger' | 'link'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    block?: boolean
    disabled?: boolean
    loading?: boolean
    // Toolbar toggle on-state → brighten fg to the brand accent (non-solid variants).
    active?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'default',
    size: 'md',
    block: false,
    disabled: false,
    loading: false,
    active: false,
    type: 'button',
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

// AWOG → shadcn-vue variant/size aliasing.
const shadVariant = computed(() => (props.variant === 'danger' ? 'destructive' : props.variant))
const shadSize = computed(() => (props.size === 'md' ? 'default' : props.size))

// active: non-solid variants brighten to the brand accent (text-primary wins via
// tailwind-merge over the variant's resting fg). block → full width.
const extraClass = computed(() => [
  props.block ? 'w-full' : '',
  props.active && props.variant !== 'default' && props.variant !== 'danger' ? 'text-primary' : '',
])
</script>
