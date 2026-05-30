<template>
  <div class="fixed inset-0 z-50" @click="emit('cancel')">
    <div
      class="absolute rounded-2xl overflow-hidden flex flex-col"
      :style="{
        top: `${cardPos.top}px`,
        left: `${cardPos.left}px`,
        width: `${cardPos.width}px`,
        background: t.bgPanel,
        border: `1px solid ${t.border}`,
        boxShadow: `0 24px 60px ${t.shadow}`,
      }"
      @click.stop
    >
      <div class="pt-3 pb-1 flex justify-center" :style="{ color: t.textFaint }">
        <GripHorizontal :size="14" />
      </div>

      <div v-if="!hasDraft" class="px-8 pt-10 pb-8 flex flex-col items-center text-center">
        <div class="text-base font-medium mb-1.5" :style="{ color: t.text }">
          {{ headline }}
        </div>
        <div class="text-[0.86em]" :style="{ color: t.textDim }">
          {{ subheadline }}
        </div>
      </div>

      <div v-else class="px-5 pt-3 pb-3 space-y-3">
        <div class="flex items-center justify-between">
          <div class="text-[0.71em] uppercase tracking-wider" :style="{ color: t.textDim }">
            {{ generatedLabel }}
          </div>
          <button
            class="text-[0.79em] inline-flex items-center gap-1 transition"
            :style="{ color: t.textDim }"
            @click="emit('regenerate')"
          >
            <RefreshCw :size="11" />
            Regenerate
          </button>
        </div>
        <slot name="preview" />
      </div>

      <div class="px-5 pb-5">
        <div
          class="rounded-2xl p-3 flex flex-col gap-3"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <textarea
            v-model="promptText"
            :rows="2"
            :disabled="isGenerating || hasDraft"
            :placeholder="placeholder"
            class="w-full bg-transparent text-[0.86em] leading-relaxed resize-none focus:outline-none"
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
              <span v-if="error" class="text-[0.79em]" :style="{ color: t.danger }">
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

const promptText = ref('')

const MAX_CARD_WIDTH = 480
const VIEWPORT_MARGIN = 12

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : MAX_CARD_WIDTH)

const onResize = () => {
  viewportWidth.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const cardPos = computed(() => {
  const width = Math.min(MAX_CARD_WIDTH, viewportWidth.value - VIEWPORT_MARGIN * 2)
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
