<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templates.fetchDialog.title')"
    :lock-scrim="fetching"
    :width="520"
    @close="emit('close')"
  >
    <div class="tpd">
      <div class="tpd-field">
        <label class="tpd-label">{{ t('templates.fetchDialog.url') }}</label>
        <input
          v-model="url"
          class="tpd-input mono"
          :placeholder="t('templates.fetchDialog.urlPh')"
          spellcheck="false"
          @keydown.enter="onFetch"
        />
        <div class="tpd-hint">{{ t('templates.fetchDialog.hint') }}</div>
      </div>

      <label class="tpd-check">
        <input v-model="overwrite" type="checkbox" />
        <span>{{ t('templates.fetchDialog.overwrite') }}</span>
      </label>

      <div v-if="error" class="tpd-error">{{ error }}</div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canFetch || fetching" @click="onFetch">
        {{ fetching ? t('templates.fetchDialog.fetching') : t('templates.fetchDialog.confirm') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Fetch-from-GitHub dialog — import template bundle(s) from a public GitHub
// folder (ADR 0037). Port of the old UI FetchFromGithubDialog, rendered in
// prototype CSS inside LibraryEntityModal. Errors surface inline; requires the
// desktop app (no browser-dev network path — the store throws).
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useTemplatesStore, type TemplateFetchResult } from '~/stores/templates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; fetched: [TemplateFetchResult] }>()

const { t } = useI18n()
const store = useTemplatesStore()

const url = ref('')
const overwrite = ref(false)
const fetching = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    url.value = ''
    overwrite.value = false
    error.value = ''
    fetching.value = false
  },
  { immediate: true },
)

const canFetch = computed(() => url.value.trim().length > 0)

const onFetch = async () => {
  if (!canFetch.value || fetching.value) return
  fetching.value = true
  error.value = ''
  try {
    const result = await store.fetchRemote(url.value.trim(), overwrite.value)
    emit('fetched', result)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('templates.fetchDialog.error')
  } finally {
    fetching.value = false
  }
}
</script>

<style scoped>
.tpd {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tpd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tpd-label {
  font-size: var(--fs-sm);
  font-weight: 550;
  color: var(--text);
}
.tpd-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  outline: none;
}
.tpd-input.mono {
  font-family: var(--code);
}
.tpd-input:focus {
  border-color: var(--accent);
}
.tpd-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.5;
}
.tpd-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text);
}
.tpd-check input {
  accent-color: var(--accent);
}
.tpd-error {
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
  font-size: var(--fs-sm);
}
</style>
