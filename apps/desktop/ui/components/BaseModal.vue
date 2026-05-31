<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
        :style="{ background: t.overlay }"
      >
        <div
          ref="cardRef"
          class="w-full rounded-lg overflow-hidden flex flex-col max-h-[85vh]"
          :class="sizeClass"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.borderStrong}`,
            boxShadow: `0 20px 60px ${t.shadow}`,
          }"
        >
          <div
            v-if="$slots.header || title"
            class="px-4 py-3 flex items-center gap-2"
            :style="{ borderBottom: `1px solid ${t.border}` }"
          >
            <slot name="header">
              <div class="text-[1em] font-medium" :style="{ color: t.text }">{{ title }}</div>
            </slot>
            <button
              class="ml-auto"
              :style="{ color: t.textDim }"
              :aria-label="'Close'"
              @click="emit('close')"
            >
              <X :size="15" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="px-4 py-3 flex justify-end gap-2"
            :style="{ borderTop: `1px solid ${t.border}` }"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { ref, computed, watch, onBeforeUnmount } from 'vue'

type Props = {
  open: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  size: 'md',
  closeOnBackdrop: true,
  closeOnEscape: true,
})
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const cardRef = ref<HTMLElement | null>(null)

const SIZE_MAP = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[960px]',
} as const
const sizeClass = computed(() => SIZE_MAP[props.size])

// Body scroll lock — restore previous value khi đóng / unmount để không kẹt overflow
let previousOverflow: string | null = null
const lockScroll = () => {
  if (typeof document === 'undefined') return
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}
const unlockScroll = () => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = previousOverflow ?? ''
  previousOverflow = null
}

watch(
  () => props.open,
  (next) => (next ? lockScroll() : unlockScroll()),
  { immediate: true },
)
onBeforeUnmount(unlockScroll)

const escapeEnabled = computed(() => props.open && props.closeOnEscape)
useEscape(() => emit('close'), { enabled: escapeEnabled })
useClickOutside(cardRef, () => {
  if (props.open && props.closeOnBackdrop) emit('close')
})
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 150ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
