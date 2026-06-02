<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[120] flex flex-col"
      :style="{ background: t.overlay }"
      @click.self="emit('close')"
    >
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-4 py-2.5"
        :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
      >
        <Code :size="14" :style="{ color: t.accent }" />
        <span class="text-[1em] font-medium font-mono" :style="{ color: t.text }">{{ title }}</span>
        <span class="flex-1" />

        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: copied ? t.accent : t.textDim }"
          :title="copied ? tr('session.code.copied') : tr('common.copy')"
          @click="copy"
        >
          <Check v-if="copied" :size="15" />
          <Copy v-else :size="15" />
        </button>
        <div :style="{ width: '1px', height: '18px', background: t.border }" />
        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('common.close')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </div>

      <!-- Code surface -->
      <div class="flex-1 overflow-auto awog-md" :style="{ background: t.bg }">
        <!-- eslint-disable vue/no-v-html -- hljs output: source is HTML-escaped, only hljs spans are injected -->
        <pre class="code-zoom-pre"><code class="hljs" v-html="highlightedHtml" /></pre>
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Check, Code, Copy, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { highlightCode } from '~/utils/markdown'

const props = defineProps<{
  // Raw (decoded) code source and its language hint.
  source: string
  language?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const highlightedHtml = computed(() => highlightCode(props.source, props.language).html)
const title = computed(() =>
  props.language ? props.language.toUpperCase() : tr('session.code.title'),
)

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
const copy = () => {
  navigator.clipboard
    .writeText(props.source)
    .then(() => {
      copied.value = true
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied.value = false
      }, 1500)
    })
    .catch(() => {})
}

const onKeydown = (ev: KeyboardEvent) => {
  if (ev.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
/* Override the boxed .awog-md pre so the viewer fills the surface and reads big. */
.code-zoom-pre {
  margin: 0;
  padding: 1.5rem;
  min-height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.code-zoom-pre :deep(code) {
  font-size: 0.95em;
  line-height: 1.6;
}
</style>
