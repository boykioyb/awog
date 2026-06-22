<!--
  App-level GitHub account picker (ADR 0049). Lists accounts from gh.accounts,
  marks the active one, and is bound to the settings store's `githubAccount`.
  Selecting a different account re-fetches the list (the container watches the
  store value). Empty value = follow gh's active account.
-->
<template>
  <div class="flex items-center gap-2">
    <Github :size="13" :style="{ color: t.textDim }" />
    <span class="text-[1em]" :style="{ color: t.textDim }">
      {{ tr('project.github.account') }}
    </span>
    <div class="min-w-[12rem]">
      <AppSelect :model-value="modelValue" @update:model-value="onChange">
        <option v-for="acc in accounts" :key="acc.login" :value="acc.login">
          {{ acc.login }}{{ acc.active ? ` · ${tr('project.github.account_active')}` : '' }}
        </option>
      </AppSelect>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Github } from 'lucide-vue-next'
import type { GhAccount } from '~/types'

defineProps<{
  accounts: GhAccount[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [login: string]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const onChange = (login: string) => emit('update:modelValue', login)
</script>
