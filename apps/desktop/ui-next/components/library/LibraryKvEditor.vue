<template>
  <div class="lkv">
    <div v-if="label" class="lkv-label">{{ label }}</div>
    <div class="lkv-rows">
      <div v-for="(entry, i) in modelValue" :key="i" class="lkv-row">
        <input
          class="lkv-input lkv-key"
          :value="entry.key"
          :placeholder="t('library.kv.key')"
          spellcheck="false"
          @input="updateKey(i, ($event.target as HTMLInputElement).value)"
        />
        <input
          class="lkv-input lkv-val"
          :type="isSecretRow(entry.value) ? 'password' : 'text'"
          :value="isSecretRow(entry.value) ? secretMaskFor(entry.value) : entry.value"
          :disabled="isSecretRow(entry.value)"
          :placeholder="t('library.kv.value')"
          spellcheck="false"
          @input="updateVal(i, ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="secretMode"
          class="iconbtn lkv-btn"
          :class="{ on: isSecretRow(entry.value) }"
          :disabled="secretBusy === i || !entry.key.trim() || !entry.value.trim()"
          :title="
            isSecretRow(entry.value) ? t('library.kv.secretStored') : t('library.kv.secretMove')
          "
          @click="toggleSecret(i)"
        >
          <Icon
            :name="secretBusy === i ? 'refresh' : isSecretRow(entry.value) ? 'shield' : 'globe'"
            :class="{ spin: secretBusy === i }"
            style="width: 13px; height: 13px"
          />
        </button>
        <button class="iconbtn lkv-btn" :title="t('library.kv.remove')" @click="remove(i)">
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </div>
      <button class="btn sm" @click="add">
        <Icon name="plus" />
        {{ t('library.kv.add') }}
      </button>
      <div v-if="secretError" class="lkv-err">{{ secretError }}</div>
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

<style scoped>
.lkv-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--textDim);
  margin-bottom: 8px;
}
.lkv-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lkv-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.lkv-input {
  padding: 6px 9px;
  border-radius: var(--r-xs);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  /* mono-ok: frontmatter key/value — identifiers */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.lkv-input:focus {
  border-color: var(--accent);
}
.lkv-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.lkv-key {
  width: 38%;
}
.lkv-val {
  flex: 1;
  min-width: 0;
}
.lkv-btn {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
.lkv-btn.on {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.lkv-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.lkv-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  padding-top: 2px;
}
.spin {
  animation: lkv-spin 0.9s linear infinite;
}
@keyframes lkv-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
