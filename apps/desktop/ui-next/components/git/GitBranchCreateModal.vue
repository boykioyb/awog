<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('git.prompt.newBranch') }}</DialogTitle>
      </DialogHeader>

      <div class="grid gap-3">
        <label class="grid grid-cols-[52px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">
            {{ t('git.branchCreate.name') }}
          </span>
          <Input
            ref="nameInput"
            v-model="name"
            class="font-mono"
            placeholder="feature/…"
            @keydown.enter.prevent="submit"
          />
        </label>

        <label class="grid grid-cols-[52px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">
            {{ t('git.branchCreate.from') }}
          </span>
          <AppSelect v-if="baseOptions.length" v-model="base" :options="baseOptions" width="100%" />
          <span v-else class="text-sm italic text-muted-foreground">
            {{ t('git.branchCreate.noBase') }}
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button :disabled="!name.trim()" @click="submit">
          {{ t('git.sidebar.newBranch') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// New-branch modal — branch name + a base picker (which ref to branch off). The
// base defaults to the current branch; the list offers local branches first, then
// remote-tracking refs. Submitting emits { name, from } so the caller can pass
// `from` to `git branch <name> <from>`.
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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
const nameInput = useTemplateRef<{ $el?: HTMLInputElement } | HTMLInputElement>('nameInput')

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
    void nextTick(() => {
      const el =
        nameInput.value instanceof HTMLInputElement ? nameInput.value : nameInput.value?.$el
      el?.focus()
    })
  },
)
</script>
