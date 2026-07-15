<template>
  <div class="csp">
    <div class="csp-head">
      <Icon name="shield" style="width: 13px; height: 13px; color: var(--accent)" />
      <span class="csp-title">{{ t('connections.secret.title') }}</span>
    </div>
    <div class="csp-sub">{{ t('connections.secret.subtitle') }}</div>

    <div class="csp-rows">
      <div v-for="s in secrets" :key="s.key" class="csp-row">
        <label class="csp-label mono" :for="`csp-${s.key}`">{{ s.field || s.key }}</label>
        <input
          :id="`csp-${s.key}`"
          v-model="values[s.key]"
          type="password"
          class="csp-input mono"
          :placeholder="t('connections.secret.placeholder', { key: s.key })"
          spellcheck="false"
          autocomplete="off"
          :disabled="saving"
          @keydown.enter.prevent="onSave"
        />
      </div>
    </div>

    <div class="csp-actions">
      <button class="btn sm" :disabled="saving" @click="emit('skip')">
        {{ t('connections.secret.later') }}
      </button>
      <button class="btn sm pri" :disabled="saving || !hasAny" @click="onSave">
        <Icon
          :name="saving ? 'refresh' : 'check'"
          :class="{ spin: saving }"
          style="width: 12px; height: 12px"
        />
        {{ saving ? t('connections.secret.saving') : t('connections.secret.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Secure secret-entry step for the chat creator (ADR 0060). After the LLM writes a
// config that references credentials as `secret:<KEY>`, this panel collects each
// value in a masked field and hands them back to the creator to persist in the OS
// keychain (source.setSecret) — so a token is NEVER pasted into the chat transcript
// or written to config.json. The value is write-only: fields start blank and are
// never read back.
import { computed, ref, watch } from 'vue'
import type { SourcePendingSecret } from '~/stores/connections'

const props = withDefaults(
  defineProps<{
    secrets: SourcePendingSecret[]
    saving?: boolean
  }>(),
  { saving: false },
)

const emit = defineEmits<{
  // Only the non-empty values, keyed by keychain KEY.
  save: [values: Record<string, string>]
  skip: []
}>()

const { t } = useI18n()

// Local draft keyed by KEY; reset whenever the set of pending secrets changes.
const values = ref<Record<string, string>>({})
watch(
  () => props.secrets.map((s) => s.key).join('|'),
  () => {
    values.value = Object.fromEntries(props.secrets.map((s) => [s.key, '']))
  },
  { immediate: true },
)

const hasAny = computed(() => Object.values(values.value).some((v) => v.trim().length > 0))

const onSave = () => {
  if (props.saving || !hasAny.value) return
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values.value)) {
    if (v.trim().length > 0) out[k] = v
  }
  emit('save', out)
}
</script>

<style scoped>
.csp {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 0 16px 12px;
  padding: 12px 13px;
  border-radius: 12px;
  background: var(--bgInput);
  border: 1px solid var(--accentBorder);
}
.csp-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.csp-title {
  font-size: 0.9615rem;
  font-weight: 600;
  color: var(--text);
}
.csp-sub {
  font-size: 0.8462rem;
  color: var(--textDim);
  line-height: 1.5;
}
.csp-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.csp-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.csp-label {
  font-size: 0.8462rem;
  color: var(--textMuted);
}
.csp-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9231rem;
  outline: none;
}
.csp-input:focus {
  border-color: var(--accent);
}
.csp-input:disabled {
  opacity: 0.6;
}
.csp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.spin {
  animation: csp-spin 0.9s linear infinite;
}
@keyframes csp-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
