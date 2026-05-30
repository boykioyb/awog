<template>
  <BaseModal :open="open" title="Create tag" size="sm" @close="emit('close')">
    <div class="p-4 flex flex-col gap-3">
      <div class="text-[0.71em]" :style="{ color: t.textDim }">
        Target:
        <span class="font-mono" :style="{ color: t.accent }">{{ targetShortHash }}</span>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-[0.71em] uppercase tracking-wider" :style="{ color: t.textFaint }">
          Tag name
        </label>
        <input
          v-model="name"
          placeholder="v1.2.0"
          class="w-full rounded text-xs px-2 py-1.5"
          :style="{
            background: t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
            outline: 'none',
          }"
          @keydown.enter="onSubmit"
        />
      </div>
      <label
        class="flex items-center gap-2 text-[0.79em] cursor-pointer select-none"
        :style="{ color: t.text }"
      >
        <input
          v-model="annotated"
          type="checkbox"
          class="cursor-pointer"
          :style="{ accentColor: t.accent }"
        />
        <span>Annotated tag (with message)</span>
      </label>
      <div v-if="annotated" class="flex flex-col gap-1">
        <label class="text-[0.71em] uppercase tracking-wider" :style="{ color: t.textFaint }">
          Message
        </label>
        <!-- Resize-y per coding-guide for content-style textareas. -->
        <textarea
          v-model="message"
          rows="3"
          placeholder="Release notes…"
          class="w-full rounded text-xs px-2 py-1.5 resize-y min-h-[5rem]"
          :style="{
            background: t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
            outline: 'none',
          }"
        />
      </div>
    </div>
    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{
          background: t.accent,
          color: t.accentText,
          opacity: canSubmit ? 1 : 0.6,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        Create tag
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
type Props = {
  open: boolean
  targetSha: string
  targetShortHash: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  submit: [payload: { name: string; message: string; annotated: boolean }]
}>()

const { t } = useTheme()

const name = ref('')
const message = ref('')
const annotated = ref(false)

// Reset fields whenever the modal opens for a new commit. Keeping stale input
// across sessions surprises the user — Sublime Merge clears on open.
watch(
  () => props.open,
  (next) => {
    if (next) {
      name.value = ''
      message.value = ''
      annotated.value = false
    }
  },
)

const canSubmit = computed(() => name.value.trim().length > 0)

const onSubmit = () => {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    message: message.value.trim(),
    annotated: annotated.value,
  })
}
</script>
