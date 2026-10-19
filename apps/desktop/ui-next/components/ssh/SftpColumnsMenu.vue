<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :class="{ 'bg-accent text-foreground': open }"
        :title="t('ssh.sftp.columns')"
        :aria-label="t('ssh.sftp.columns')"
      >
        <Icon name="settings" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-42">
      <DropdownMenuLabel class="text-xs font-semibold text-muted-foreground">
        {{ t('ssh.sftp.columns') }}
      </DropdownMenuLabel>
      <!-- Bật/tắt nhiều cột liên tiếp: chặn select để menu không tự đóng. -->
      <DropdownMenuCheckboxItem
        v-for="c in ALL_SFTP_COLUMNS"
        :key="c"
        :model-value="columns.includes(c)"
        @select.prevent
        @update:model-value="emit('toggle', c)"
      >
        {{ t(`ssh.sftp.col.${c}`) }}
      </DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
// Column-visibility dropdown for the SFTP table. Multi-toggle (stays open while
// checking boxes — DropdownMenu lo đóng khi bấm ngoài); the parent owns the persisted `columns` list + toggle handler.
import { ref } from 'vue'
import { ALL_SFTP_COLUMNS, type SftpColumn } from '~/composables/useSftpBrowser'

defineProps<{ columns: SftpColumn[] }>()
const emit = defineEmits<{ toggle: [col: SftpColumn] }>()

const { t } = useI18n()
const open = ref(false)
</script>
