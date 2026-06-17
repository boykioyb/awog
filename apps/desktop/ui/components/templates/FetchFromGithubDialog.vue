<template>
  <BaseModal
    :open="open"
    :title="tr('templates.fetch_dialog.title')"
    size="md"
    @close="emit('close')"
  >
    <div class="p-4 space-y-4">
      <Field :label="tr('templates.fetch_dialog.url')">
        <input
          v-model="url"
          :placeholder="tr('templates.fetch_dialog.url_placeholder')"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          @keydown.enter="onFetch"
        />
        <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">
          {{ tr('templates.fetch_dialog.hint') }}
        </div>
      </Field>

      <label class="flex items-center gap-2 px-1 cursor-pointer">
        <input v-model="overwrite" type="checkbox" :style="{ accentColor: t.accent }" />
        <span class="text-[1em]" :style="{ color: t.text }">
          {{ tr('templates.fetch_dialog.overwrite') }}
        </span>
      </label>

      <div
        v-if="error"
        class="rounded px-3 py-2 text-[1em]"
        :style="{ background: t.dangerBg, color: t.danger, border: `1px solid ${t.danger}` }"
      >
        {{ error }}
      </div>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton :disabled="!canFetch || fetching" @click="onFetch">
        {{
          fetching ? tr('templates.fetch_dialog.fetching') : tr('templates.fetch_dialog.confirm')
        }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { TemplateFetchResult } from '~/types'
import { useTemplatesStore } from '~/stores/templates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; fetched: [TemplateFetchResult] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const templatesStore = useTemplatesStore()

const url = ref('')
const overwrite = ref(false)
const fetching = ref(false)
const error = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      url.value = ''
      overwrite.value = false
      error.value = ''
      fetching.value = false
    }
  },
  { immediate: true },
)

const inputStyle = computed<CSSProperties>(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const canFetch = computed(() => url.value.trim().length > 0)

const onFetch = async () => {
  if (!canFetch.value || fetching.value) return
  fetching.value = true
  error.value = ''
  try {
    const result = await templatesStore.fetchRemote(url.value.trim(), overwrite.value)
    emit('fetched', result)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : tr('templates.fetch_dialog.error')
  } finally {
    fetching.value = false
  }
}
</script>
