<template>
  <div class="mx-4 mb-3 flex flex-col gap-2 rounded-lg border border-selected-border bg-card p-3">
    <div class="flex items-center gap-2">
      <Icon name="shield" class="size-3.5 text-primary" />
      <span class="text-sm font-semibold text-foreground">{{ t('connections.secret.title') }}</span>
    </div>
    <div class="text-xs text-muted-foreground">{{ t('connections.secret.subtitle') }}</div>

    <div class="flex flex-col gap-2">
      <div v-for="s in secrets" :key="s.key" class="flex flex-col gap-1">
        <!-- Tên KEY keychain là chuỗi kỹ thuật ⇒ mono. -->
        <Label :for="`csp-${s.key}`" class="font-mono text-xs text-muted-foreground">
          {{ s.field || s.key }}
        </Label>
        <Input
          :id="`csp-${s.key}`"
          v-model="values[s.key]"
          type="password"
          :placeholder="t('connections.secret.placeholder', { key: s.key })"
          spellcheck="false"
          autocomplete="off"
          :disabled="saving"
          class="font-mono"
          @keydown.enter.prevent="onSave"
        />
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <Button :disabled="saving" variant="outline" size="sm" @click="emit('skip')">
        {{ t('connections.secret.later') }}
      </Button>
      <Button
        :disabled="saving || !hasAny"
        variant="default"
        size="sm"
        class="[&_svg]:size-3"
        @click="onSave"
      >
        <Icon :name="saving ? 'refresh' : 'check'" :class="saving && 'animate-spin'" />
        {{ saving ? t('connections.secret.saving') : t('connections.secret.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
