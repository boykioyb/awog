<template>
  <div class="fixed inset-0 z-50" @click="emit('cancel')">
    <div
      ref="cardRef"
      class="absolute rounded-2xl overflow-hidden flex flex-col"
      :style="{
        top: `${cardPos.top}px`,
        left: `${cardPos.left}px`,
        width: `${cardPos.width}px`,
        ...(userHeight ? { height: `${userHeight}px` } : {}),
        maxHeight: 'calc(100vh - 24px)',
        background: overlay.background,
        border: `1px solid ${overlay.borderColor}`,
        backdropFilter: overlay.backdropFilter,
        boxShadow: overlay.boxShadow,
      }"
      @click.stop
    >
      <div class="pt-3 pb-1 flex justify-center flex-shrink-0" :style="{ color: t.textFaint }">
        <GripHorizontal :size="14" />
      </div>

      <!-- Header / preview scrolls when content (e.g. a long generated step list)
           or a resized height exceeds the card; the input row stays pinned. -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div v-if="!hasDraft" class="px-8 pt-10 pb-8 flex flex-col items-center text-center">
          <div class="text-base font-medium mb-1.5" :style="{ color: t.text }">
            {{ headline }}
          </div>
          <div class="text-[1em]" :style="{ color: t.textDim }">
            {{ subheadline }}
          </div>
        </div>

        <div v-else class="px-5 pt-3 pb-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
              {{ generatedLabel }}
            </div>
            <button
              class="text-[1em] inline-flex items-center gap-1 transition"
              :style="{ color: t.textDim }"
              @click="emit('regenerate')"
            >
              <RefreshCw :size="11" />
              Regenerate
            </button>
          </div>
          <slot name="preview" />
        </div>
      </div>

      <div class="px-5 pb-5 flex-shrink-0">
        <!-- Pre-generate controls (e.g. workflow scope picker) — shown BEFORE a
             draft exists so the choice can influence generation, not just save. -->
        <div v-if="$slots.controls && !hasDraft" class="mb-2">
          <slot name="controls" />
        </div>
        <div
          class="rounded-2xl p-3 flex flex-col gap-3"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <!-- resize-y: prompt can be dragged taller for long descriptions
               (overrides the default modal-input resize-none — explicit ask). -->
          <textarea
            v-model="promptText"
            :rows="2"
            :disabled="isGenerating || hasDraft"
            :placeholder="placeholder"
            class="w-full bg-transparent text-[1em] leading-relaxed resize-y min-h-[3rem] focus:outline-none"
            :style="{ color: t.text }"
            @keydown.enter.exact.prevent="onSubmit"
          />
          <div class="flex items-center justify-between">
            <button
              class="p-1.5 rounded-full transition"
              :style="{ color: t.textDim }"
              title="Attach context (coming soon)"
              disabled
            >
              <Paperclip :size="14" />
            </button>

            <div v-if="!hasDraft" class="flex items-center gap-2">
              <span
                v-if="isGenerating"
                class="text-[12px] font-mono leading-none"
                :style="{ color: t.textDim }"
              >
                {{ elapsed.toFixed(1) }}s
              </span>
              <span v-if="error" class="text-[1em]" :style="{ color: t.danger }">
                {{ error }}
              </span>
              <button
                class="w-7 h-7 rounded-full inline-flex items-center justify-center transition"
                :disabled="!canSubmit"
                :style="{
                  background: canSubmit ? t.accent : t.bgPanel,
                  color: canSubmit ? t.accentText : t.textFaint,
                }"
                :title="isGenerating ? 'Generating...' : 'Generate'"
                @click="onSubmit"
              >
                <Loader2 v-if="isGenerating" :size="14" class="animate-spin" />
                <ArrowUp v-else :size="14" />
              </button>
            </div>
            <div v-else class="flex items-center gap-2">
              <slot name="actions" />
            </div>
          </div>
        </div>
      </div>

      <!-- Drag-resize handle (bottom-right corner) — adjusts modal width + height. -->
      <div
        class="absolute bottom-1 right-1 cursor-nwse-resize select-none p-0.5"
        :style="{ color: t.textFaint }"
        title="Drag to resize"
        @mousedown="onResizeStart"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        >
          <path d="M9 1 L1 9 M9 5 L5 9" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp, GripHorizontal, Loader2, Paperclip, RefreshCw } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    anchor?: { top: number; left: number } | null
    headline: string
    subheadline: string
    placeholder: string
    hasDraft: boolean
    isGenerating: boolean
    error: string | null
    generatedLabel?: string
  }>(),
  { anchor: null, generatedLabel: 'Generated' },
)

const emit = defineEmits<{
  submit: [prompt: string]
  cancel: []
  regenerate: []
}>()

const { t } = useTheme()
const { overlay } = useGlass()

const promptText = ref('')

// Elapsed timer while the model generates (parity with the session view).
const elapsed = ref(0)
let timerId: ReturnType<typeof setInterval> | null = null
let startedAt = 0
watch(
  () => props.isGenerating,
  (on) => {
    if (on) {
      startedAt = Date.now()
      elapsed.value = 0
      timerId = setInterval(() => {
        elapsed.value = (Date.now() - startedAt) / 1000
      }, 100)
    } else if (timerId) {
      clearInterval(timerId)
      timerId = null
    }
  },
)
onBeforeUnmount(() => {
  if (timerId) clearInterval(timerId)
})

const MAX_CARD_WIDTH = 480
const VIEWPORT_MARGIN = 12
const MIN_W = 320
const MIN_H = 200

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : MAX_CARD_WIDTH)

const onResize = () => {
  viewportWidth.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// User-resized dimensions (null = auto). Reset per modal lifetime.
const cardRef = ref<HTMLElement | null>(null)
const userWidth = ref<number | null>(null)
const userHeight = ref<number | null>(null)

const cardPos = computed(() => {
  const maxWidth = viewportWidth.value - VIEWPORT_MARGIN * 2
  const width =
    userWidth.value == null
      ? Math.min(MAX_CARD_WIDTH, maxWidth)
      : Math.max(MIN_W, Math.min(userWidth.value, maxWidth))
  if (!props.anchor) {
    return { top: 96, left: Math.max(VIEWPORT_MARGIN, (viewportWidth.value - width) / 2), width }
  }
  const maxLeft = viewportWidth.value - width - VIEWPORT_MARGIN
  return {
    top: props.anchor.top,
    left: Math.min(Math.max(VIEWPORT_MARGIN, props.anchor.left), maxLeft),
    width,
  }
})

// Drag-resize the modal from the bottom-right corner (width + height).
let startX = 0
let startY = 0
let startW = 0
let startH = 0
let resizing = false
const onResizeMove = (e: MouseEvent) => {
  userWidth.value = startW + (e.clientX - startX)
  userHeight.value = Math.max(MIN_H, startH + (e.clientY - startY))
}
const onResizeEnd = () => {
  if (!resizing) return
  resizing = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
}
const onResizeStart = (e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  const rect = cardRef.value?.getBoundingClientRect()
  startW = rect?.width ?? cardPos.value.width
  startH = rect?.height ?? MIN_H
  startX = e.clientX
  startY = e.clientY
  resizing = true
  document.body.style.cursor = 'nwse-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})

const canSubmit = computed(
  () => !props.isGenerating && !props.hasDraft && promptText.value.trim().length > 0,
)

const onSubmit = () => {
  if (!canSubmit.value) return
  emit('submit', promptText.value.trim())
}

watch(
  () => props.hasDraft,
  (v) => {
    if (!v) promptText.value = ''
  },
)
</script>
