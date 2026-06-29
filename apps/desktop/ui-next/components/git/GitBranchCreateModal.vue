<template>
  <Teleport to="body">
    <div v-if="open" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card" role="dialog" aria-modal="true">
        <div class="gpm-title">{{ t('git.prompt.newBranch') }}</div>

        <label class="gbc-field">
          <span class="gbc-label">{{ t('git.branchCreate.name') }}</span>
          <input
            ref="nameInput"
            v-model="name"
            class="gpm-input mono"
            placeholder="feature/…"
            @keydown.enter.prevent="submit"
            @keydown.esc.prevent="emit('close')"
          />
        </label>

        <label class="gbc-field">
          <span class="gbc-label">{{ t('git.branchCreate.from') }}</span>
          <AppSelect v-if="baseOptions.length" v-model="base" :options="baseOptions" width="100%" />
          <span v-else class="gbc-nobase">{{ t('git.branchCreate.noBase') }}</span>
        </label>

        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn pri" :disabled="!name.trim()" @click="submit">
            {{ t('git.sidebar.newBranch') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// New-branch modal — branch name + a base picker (which ref to branch off). The
// base defaults to the current branch; the list offers local branches first, then
// remote-tracking refs. Submitting emits { name, from } so the caller can pass
// `from` to `git branch <name> <from>`.
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { BranchInfo } from './git-types'

const props = defineProps<{
  open: boolean
  branches: BranchInfo[]
  currentBranch: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; from: string }): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const name = ref('')
const base = ref('')
const nameInput = useTemplateRef<HTMLInputElement>('nameInput')

// Local branches first, then remote-tracking refs — all valid `git branch` bases.
const baseOptions = computed<AppSelectOption[]>(() => {
  const locals = props.branches
    .filter((b) => !b.remote)
    .map((b) => ({ label: b.name, value: b.name }))
  const remotes = props.branches
    .filter((b) => b.remote)
    .map((b) => ({ label: b.name, value: b.name }))
  return [...locals, ...remotes]
})

function submit() {
  const n = name.value.trim()
  if (!n) return
  emit('submit', { name: n, from: base.value })
}

// Reset + default the base to the current branch on each open.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = ''
    const opts = baseOptions.value
    base.value = opts.some((o) => o.value === props.currentBranch)
      ? props.currentBranch
      : (opts[0]?.value ?? '')
    void nextTick(() => nameInput.value?.focus())
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
.gbc-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gbc-label {
  flex: none;
  width: 52px;
  font-size: 1em;
  color: var(--textDim);
}
.gbc-nobase {
  flex: 1;
  font-size: 1em;
  color: var(--textDim);
  font-style: italic;
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
