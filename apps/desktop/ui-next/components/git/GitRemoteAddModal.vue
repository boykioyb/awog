<template>
  <Teleport to="body">
    <div v-if="open" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card" role="dialog" aria-modal="true">
        <div class="gpm-title">{{ t('git.remote.addTitle') }}</div>
        <label class="gra-field">
          <span class="gra-label">{{ t('git.remote.name') }}</span>
          <input
            ref="nameInput"
            v-model="name"
            class="gpm-input"
            :placeholder="t('git.remote.namePlaceholder')"
            @keydown.enter.prevent="focusUrl"
            @keydown.esc.prevent="emit('close')"
          />
        </label>
        <label class="gra-field">
          <span class="gra-label">{{ t('git.remote.url') }}</span>
          <input
            ref="urlInput"
            v-model="url"
            class="gpm-input mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="submit"
            @keydown.esc.prevent="emit('close')"
          />
        </label>
        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn pri" :disabled="!canSubmit" @click="submit">
            {{ t('git.remote.add') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Add-remote modal — collects a remote name + URL (`git remote add`). Two fields,
// so it can't reuse the single-line GitPromptModal. Reuses GitPromptModal's overlay
// styling (.gpm-*) for visual consistency.
const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; url: string }): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const name = ref('')
const url = ref('')
const nameInput = useTemplateRef<HTMLInputElement>('nameInput')
const urlInput = useTemplateRef<HTMLInputElement>('urlInput')

const canSubmit = computed(() => !!name.value.trim() && !!url.value.trim())

function focusUrl() {
  urlInput.value?.focus()
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', { name: name.value.trim(), url: url.value.trim() })
}

// Reset + focus the first field on each open.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = 'origin'
    url.value = ''
    void nextTick(() => {
      nameInput.value?.focus()
      nameInput.value?.select()
    })
  },
)
</script>

<style scoped>
.gpm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.gpm-card {
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gpm-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gra-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gra-label {
  flex: none;
  width: 48px;
  font-size: 1em;
  color: var(--textDim);
}
.gpm-input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.gpm-input.mono {
  font-family: var(--mono);
}
.gpm-input:focus {
  border-color: var(--accent);
}
.gpm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.gpm-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
