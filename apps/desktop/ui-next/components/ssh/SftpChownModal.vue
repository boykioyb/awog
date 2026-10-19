<template>
  <!-- z-200: band hộp thoại trên cùng — mở từ SFTP browser có thể đang nằm trong modal. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && emit('cancel')">
    <DialogContent class="z-200 flex max-w-[92vw] flex-col gap-3 rounded-xl p-4.5 sm:max-w-90">
      <DialogHeader class="flex-row items-center gap-2">
        <Icon name="settings" class="size-4 shrink-0 text-primary" />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ t('ssh.sftp.chown.title') }}
        </DialogTitle>
      </DialogHeader>
      <DialogDescription class="text-sm break-all text-muted-foreground">
        {{ subtitle }}
      </DialogDescription>

      <label class="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>{{ t('ssh.sftp.chown.owner') }}</span>
        <Input
          ref="ownerInput"
          v-model="owner"
          spellcheck="false"
          placeholder="root"
          class="font-mono"
          @keydown.enter="submit"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>{{ t('ssh.sftp.chown.group') }}</span>
        <Input
          v-model="group"
          spellcheck="false"
          :placeholder="t('ssh.sftp.chown.groupPh')"
          class="font-mono"
          @keydown.enter="submit"
        />
      </label>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox :model-value="recursive" @update:model-value="recursive = $event === true" />
        <span>{{ t('ssh.sftp.chown.recursive') }}</span>
      </label>
      <div class="text-xs text-muted-foreground">{{ t('ssh.sftp.chown.hint') }}</div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button :disabled="!valid" variant="default" @click="submit">
          {{ t('ssh.sftp.chown.apply') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// chown editor — owner + optional group + recursive flag. Owner/group are
// charset-validated (mirrors the sidecar's own guard) before the button enables.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { SftpEntry } from '~/composables/useSshApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ open: boolean; targets: SftpEntry[] }>()
const emit = defineEmits<{
  confirm: [owner: string, group: string, recursive: boolean]
  cancel: []
}>()

const { t } = useI18n()
const NAME_RE = /^[A-Za-z0-9._-]+$/

const owner = ref('')
const group = ref('')
const recursive = ref(false)
const ownerInput = useTemplateRef<HTMLInputElement>('ownerInput')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    owner.value = ''
    group.value = ''
    recursive.value = props.targets.some((e) => e.type === 'dir')
    void nextTick(() => ownerInput.value?.focus())
  },
)

const valid = computed(
  () => NAME_RE.test(owner.value) && (group.value === '' || NAME_RE.test(group.value)),
)
function submit(): void {
  if (valid.value) emit('confirm', owner.value, group.value, recursive.value)
}

const subtitle = computed(() =>
  props.targets.length === 1
    ? props.targets[0]?.name
    : t('ssh.sftp.chmod.many', { count: props.targets.length }),
)
</script>
