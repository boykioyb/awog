<template>
  <div>
    <div v-if="label" class="mb-2 text-sm font-medium text-dim">{{ label }}</div>
    <div class="flex flex-col gap-2">
      <div v-for="(entry, i) in modelValue" :key="i" class="flex items-center gap-2">
        <Input
          :model-value="entry.key"
          :placeholder="t('library.kv.key')"
          spellcheck="false"
          class="w-[38%] font-mono"
          @update:model-value="updateKey(i, $event)"
        />
        <Input
          :type="isSecretRow(entry.value) ? 'password' : 'text'"
          :model-value="isSecretRow(entry.value) ? secretMaskFor(entry.value) : entry.value"
          :disabled="isSecretRow(entry.value)"
          :placeholder="t('library.kv.value')"
          spellcheck="false"
          class="min-w-0 flex-1 font-mono"
          @update:model-value="updateVal(i, $event)"
        />
        <Button
          v-if="secretMode"
          :class="{ 'border-selected-border text-primary': isSecretRow(entry.value) }"
          :disabled="secretBusy === i || !entry.key.trim() || !entry.value.trim()"
          :title="
            isSecretRow(entry.value) ? t('library.kv.secretStored') : t('library.kv.secretMove')
          "
          class="flex-none"
          variant="outline"
          size="iconSm"
          @click="toggleSecret(i)"
        >
          <Icon
            :name="secretBusy === i ? 'refresh' : isSecretRow(entry.value) ? 'shield' : 'globe'"
            :class="{ 'animate-spin': secretBusy === i }"
          />
        </Button>
        <Button
          :title="t('library.kv.remove')"
          class="flex-none"
          variant="outline"
          size="iconSm"
          @click="remove(i)"
        >
          <Icon name="x" />
        </Button>
      </div>
      <Button variant="outline" size="sm" @click="add">
        <Icon name="plus" />
        {{ t('library.kv.add') }}
      </Button>
      <div v-if="secretError" class="pt-0.5 text-sm text-destructive">{{ secretError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Shared key/value editor with optional OS-keychain secret mode. Port of the old
// UI KvEditor — connections (Source env/headers, ADR 0018/0060) consume it. When
// `secretMode` is set, each row shows a lock toggle: click → persist the value to
// the OS keychain via `source.setSecret` (keyed by the source's stable id), swap
// the field to a `secret:KEY` placeholder (rendered masked + disabled). Rendered
// in prototype CSS.
import { ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

export type KvEntry = { key: string; value: string }
// `sourceId` is the source's STABLE id (keychain account prefix), NOT the slug —
// matches the id env/headers are expanded against at connect time.
export type KvSecretMode = { sourceId: string }

const props = defineProps<{
  modelValue: KvEntry[]
  label?: string
  secretMode?: KvSecretMode
}>()

const emit = defineEmits<{ 'update:modelValue': [value: KvEntry[]] }>()

const { t } = useI18n()
const sc = useSidecar()

const secretBusy = ref<number | null>(null)
const secretError = ref<string | null>(null)

const isSecretRow = (value: string): boolean =>
  typeof value === 'string' && value.startsWith('secret:')

const secretMaskFor = (value: string): string => {
  const key = value.slice('secret:'.length)
  return key ? `••••••  (keychain · ${key})` : '••••••'
}

const add = () => emit('update:modelValue', [...props.modelValue, { key: '', value: '' }])
const remove = (i: number) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, idx) => idx !== i),
  )
const updateKey = (i: number, k: string) => {
  const next = props.modelValue.map((e, idx) => (idx === i ? { ...e, key: k } : e))
  emit('update:modelValue', next)
}
const updateVal = (i: number, v: string) => {
  const next = props.modelValue.map((e, idx) => (idx === i ? { ...e, value: v } : e))
  emit('update:modelValue', next)
}

const toggleSecret = async (i: number) => {
  if (!props.secretMode) return
  const entry = props.modelValue[i]
  if (!entry) return
  if (isSecretRow(entry.value)) {
    // Convert back to plaintext: clear so the user re-enters. The keychain entry
    // becomes orphan (acceptable per ADR 0018 — no sweep in this phase).
    updateVal(i, '')
    return
  }
  if (!entry.key.trim() || !entry.value.trim()) {
    secretError.value = t('library.kv.secretNeedsBoth')
    return
  }
  secretBusy.value = i
  secretError.value = null
  try {
    if (!sc.available) {
      secretError.value = t('library.kv.secretOffline')
      return
    }
    const res = await sc.request<{ placeholder: string }>('source.setSecret', {
      sourceId: props.secretMode.sourceId,
      key: entry.key.trim(),
      value: entry.value,
    })
    updateVal(i, res.placeholder)
  } catch (err) {
    secretError.value = err instanceof Error ? err.message : String(err)
  } finally {
    secretBusy.value = null
  }
}
</script>
