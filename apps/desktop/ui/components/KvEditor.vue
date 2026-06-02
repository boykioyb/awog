<template>
  <Field :label="label">
    <div class="space-y-1.5">
      <div v-for="(entry, i) in modelValue" :key="i" class="flex items-center gap-1.5">
        <input
          :value="entry.key"
          placeholder="key"
          class="rounded px-2 py-1 text-[1em] font-mono"
          :style="{ ...inputStyle, width: '38%' }"
          @input="(e: Event) => updateKey(i, (e.target as HTMLInputElement).value)"
        />
        <input
          :type="isSecretRow(entry.value) ? 'password' : 'text'"
          :value="isSecretRow(entry.value) ? secretMaskFor(entry.value) : entry.value"
          :disabled="isSecretRow(entry.value)"
          placeholder="value"
          class="flex-1 rounded px-2 py-1 text-[1em] font-mono disabled:cursor-not-allowed"
          :style="{
            ...inputStyle,
            opacity: isSecretRow(entry.value) ? 0.7 : 1,
          }"
          @input="(e: Event) => updateVal(i, (e.target as HTMLInputElement).value)"
        />
        <button
          v-if="secretMode"
          :style="{ color: isSecretRow(entry.value) ? t.success : t.textDim }"
          :title="
            isSecretRow(entry.value)
              ? `Stored in OS keychain. Click to clear (re-enter value to update).`
              : 'Move this value into the OS keychain (recommended for tokens/passwords).'
          "
          :disabled="secretBusy === i || !entry.key.trim() || !entry.value.trim()"
          @click="toggleSecret(i)"
        >
          <Loader2 v-if="secretBusy === i" :size="11" class="animate-spin" />
          <Lock v-else-if="isSecretRow(entry.value)" :size="11" />
          <LockOpen v-else :size="11" />
        </button>
        <button :style="{ color: t.textDim }" @click="remove(i)">
          <X :size="11" />
        </button>
      </div>
      <button class="text-[1em] flex items-center gap-1" :style="{ color: t.textDim }" @click="add">
        <Plus :size="11" />
        Add entry
      </button>
      <div v-if="secretError" class="text-[1em] pt-1" :style="{ color: t.danger }">
        {{ secretError }}
      </div>
    </div>
  </Field>
</template>

<script setup lang="ts">
import { Loader2, Lock, LockOpen, Plus, X } from 'lucide-vue-next'

interface KvEntry {
  key: string
  value: string
}

interface SecretMode {
  serverId: string
}

const props = defineProps<{
  modelValue: KvEntry[]
  label: string
  // Optional MCP-secret integration (ADR 0018). When set, each row shows a
  // lock toggle: click → persist value to OS keychain, swap to `secret:KEY`
  // placeholder. Already-stored rows render masked + disabled.
  secretMode?: SecretMode
}>()
const emit = defineEmits<{ 'update:modelValue': [value: KvEntry[]] }>()
const { t } = useTheme()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none' as const,
}))

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
    // Convert back to plaintext: clear field so user re-enters. Keychain entry
    // becomes orphan (acceptable per ADR 0018 — pha 2 doesn't sweep).
    updateVal(i, '')
    return
  }
  if (!entry.key.trim() || !entry.value.trim()) {
    secretError.value = 'Both key and value must be filled before saving as secret.'
    return
  }
  secretBusy.value = i
  secretError.value = null
  try {
    const sidecar = useSidecar()
    if (!sidecar.available) {
      secretError.value = 'Sidecar offline — cannot store secret.'
      return
    }
    const res = await sidecar.request<{ placeholder: string }>('mcp.setSecret', {
      serverId: props.secretMode.serverId,
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
