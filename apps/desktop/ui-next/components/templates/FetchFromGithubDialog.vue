<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templates.fetchDialog.title')"
    :lock-scrim="fetching"
    :width="520"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label>{{ t('templates.fetchDialog.url') }}</Label>
        <Input
          v-model="url"
          :placeholder="t('templates.fetchDialog.urlPh')"
          spellcheck="false"
          class="font-mono"
          @keydown.enter="onFetch"
        />
        <div class="text-xs text-dim">{{ t('templates.fetchDialog.hint') }}</div>
      </div>

      <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox :model-value="overwrite" @update:model-value="overwrite = $event === true" />
        <span>{{ t('templates.fetchDialog.overwrite') }}</span>
      </label>

      <div
        v-if="error"
        class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canFetch || fetching" variant="default" @click="onFetch">
        {{ fetching ? t('templates.fetchDialog.fetching') : t('templates.fetchDialog.confirm') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Fetch-from-GitHub dialog — import template bundle(s) from a public GitHub
// folder (ADR 0037), rendered inside LibraryEntityModal. Errors surface inline; requires the
// desktop app (no browser-dev network path — the store throws).
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useTemplatesStore, type TemplateFetchResult } from '~/stores/templates'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
