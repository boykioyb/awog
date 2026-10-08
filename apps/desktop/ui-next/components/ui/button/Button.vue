<template>
  <Primitive
    v-bind="rest"
    :as="as"
    :as-child="asChild"
    data-slot="button"
    :data-variant="variant ?? 'default'"
    :data-size="size ?? 'default'"
    :class="cn(buttonVariants({ variant, size }), $attrs.class)"
  >
    <slot />
  </Primitive>
</template>

<script setup lang="ts">
// `PrimitiveProps` has the same unresolvable-extends problem — declare the
// three fields we actually read locally and forward the rest as attrs.
import { computed } from 'vue'
import { Primitive } from 'reka-ui'
import { cn } from '~/lib/utils'
import { buttonVariants, type ButtonVariants } from './index'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const [rest, attrs] = useForwardAttrs('class', 'variant', 'size', 'as', 'asChild')
const variant = computed(() => attrs.variant as ButtonVariants['variant'] | undefined)
const size = computed(() => attrs.size as ButtonVariants['size'] | undefined)
const as = computed(() => (attrs.as as string | undefined) ?? 'button')
const asChild = computed(() => attrs.asChild === true || attrs.asChild === '')
</script>
