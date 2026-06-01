<template>
  <Teleport to="body">
    <!-- Transparent catcher: click outside cancels. The card stops propagation
         so clicks inside it don't dismiss. -->
    <div class="fixed inset-0 z-[110]" @mousedown.self="emit('cancel')">
      <div
        class="absolute rounded-xl flex flex-col overflow-hidden"
        :style="{
          top: `${top}px`,
          left: `${left}px`,
          width: '340px',
          background: t.bgElevated,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 12px 32px ${t.shadow}`,
        }"
        @mousedown.stop
      >
        <div class="px-3.5 pt-3 pb-1.5 flex items-center gap-1.5">
          <Quote :size="12" :style="{ color: t.accent }" />
          <span class="text-[1em] font-semibold" :style="{ color: t.text }">
            {{ tr('session.followup.title') }}
          </span>
        </div>

        <div class="px-3.5">
          <div
            class="rounded-md px-2.5 py-1.5 text-[1em] italic max-h-16 overflow-y-auto whitespace-pre-wrap"
            :style="{
              background: t.bgSubtle,
              color: t.textDim,
              borderLeft: `2px solid ${t.accent}`,
            }"
          >
            {{ selectedText }}
          </div>
        </div>

        <div class="px-3.5 py-2.5">
          <textarea
            ref="taRef"
            v-model="note"
            rows="3"
            :placeholder="tr('session.followup.placeholder')"
            class="w-full rounded-md px-2.5 py-2 text-[1em] resize-y min-h-[4.5rem] max-h-[40vh] outline-none"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            @keydown="onKeydown"
          />
        </div>

        <div class="px-3.5 pb-3 flex items-center justify-end gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[1em] transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            @click="emit('cancel')"
          >
            {{ tr('common.cancel') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[1em] font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="onSave"
          >
            {{ tr('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Quote } from 'lucide-vue-next'

defineProps<{
  selectedText: string
  // Viewport coords (already clamped by the opener) — the card is teleported.
  top: number
  left: number
}>()

const emit = defineEmits<{
  save: [note: string]
  cancel: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const note = ref('')
const taRef = ref<HTMLTextAreaElement | null>(null)

const onSave = () => emit('save', note.value)

// ⌘/Ctrl+Enter saves; Esc cancels. Plain Enter inserts a newline (multi-line
// instructions are common), so we don't hijack it.
const onKeydown = (ev: KeyboardEvent) => {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault()
    onSave()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('cancel')
  }
}

onMounted(() => {
  nextTick(() => taRef.value?.focus())
})
</script>
