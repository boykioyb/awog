<template>
  <!-- z-200: band hộp thoại trên cùng — mở từ SFTP browser có thể đang nằm trong modal. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && emit('cancel')">
    <DialogContent class="z-200 flex max-w-[92vw] flex-col gap-3.5 rounded-xl p-4.5 sm:max-w-85">
      <DialogHeader class="flex-row items-center gap-2">
        <Icon name="shield" class="size-4 shrink-0 text-primary" />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ t('ssh.sftp.chmod.title') }}
        </DialogTitle>
      </DialogHeader>
      <DialogDescription class="text-sm break-all text-muted-foreground">
        {{ subtitle }}
      </DialogDescription>

      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead />
            <TableHead class="h-auto p-1 text-center text-xs font-medium text-muted-foreground">
              {{ t('ssh.sftp.chmod.read') }}
            </TableHead>
            <TableHead class="h-auto p-1 text-center text-xs font-medium text-muted-foreground">
              {{ t('ssh.sftp.chmod.write') }}
            </TableHead>
            <TableHead class="h-auto p-1 text-center text-xs font-medium text-muted-foreground">
              {{ t('ssh.sftp.chmod.exec') }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="grp in GROUPS" :key="grp.key" class="border-0 hover:bg-transparent">
            <TableCell class="px-1 py-1.5 text-left text-sm text-foreground">
              {{ t(`ssh.sftp.chmod.${grp.key}`) }}
            </TableCell>
            <TableCell v-for="bit in grp.bits" :key="bit" class="px-1 py-1.5 text-center">
              <Checkbox :model-value="!!(mode & bit)" @update:model-value="toggle(bit)" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <label class="flex items-center gap-2.5 text-sm text-muted-foreground">
        <span>{{ t('ssh.sftp.chmod.octal') }}</span>
        <Input
          v-model="octal"
          maxlength="3"
          inputmode="numeric"
          class="h-ctrl-xs w-18 text-center font-mono"
        />
      </label>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button variant="default" @click="emit('confirm', mode)">
          {{ t('ssh.sftp.chmod.apply') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// chmod editor — a 3×3 rwx grid (owner/group/other) mirrored by an octal input.
// Emits the resulting mode number (standard 0o777 bits). Seeds from the first
// target's current mode on open.
import { computed, ref, watch } from 'vue'
import type { SftpEntry } from '~/composables/useSshApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ open: boolean; targets: SftpEntry[] }>()
const emit = defineEmits<{ confirm: [mode: number]; cancel: [] }>()

const { t } = useI18n()

const GROUPS = [
  { key: 'owner', bits: [0o400, 0o200, 0o100] },
  { key: 'group', bits: [0o040, 0o020, 0o010] },
  { key: 'other', bits: [0o004, 0o002, 0o001] },
] as const

const mode = ref(0o644)

watch(
  () => [props.open, props.targets] as const,
  ([isOpen]) => {
    if (isOpen && props.targets[0]) mode.value = props.targets[0].mode & 0o777
  },
  { immediate: true },
)

function toggle(bit: number): void {
  mode.value = mode.value & bit ? mode.value & ~bit : mode.value | bit
}

const octal = computed<string>({
  get: () => (mode.value & 0o777).toString(8).padStart(3, '0'),
  set: (v) => {
    if (/^[0-7]{1,3}$/.test(v)) mode.value = Number.parseInt(v.padStart(3, '0'), 8)
  },
})

const subtitle = computed(() =>
  props.targets.length === 1
    ? props.targets[0]?.name
    : t('ssh.sftp.chmod.many', { count: props.targets.length }),
)
</script>
