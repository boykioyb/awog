<template>
  <!-- Band modal gốc (z-170 của Dialog) — nằm dưới hộp xác nhận xoá (z-200) mà nó mở.
       Nút X của DialogContent thay nút đóng tự viết ở head. Escape do listener window
       trong script xử lý nên chặn Escape của Dialog để không emit close hai lần. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && emit('close')">
    <DialogContent
      class="flex max-h-[80vh] max-w-[92vw] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-130"
      @escape-key-down.prevent
    >
      <DialogHeader class="flex-row items-center gap-2 py-3.5 pr-12 pl-4">
        <Icon name="shield" class="size-4 shrink-0 text-primary" />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ t('ssh.identity.title') }}
        </DialogTitle>
        <Button class="ml-auto" variant="default" size="sm" @click="emit('new')">
          <Icon name="plus" />
          {{ t('ssh.identity.new') }}
        </Button>
      </DialogHeader>
      <Separator />

      <div class="overflow-y-auto py-1.5">
        <div v-if="!identities.length" class="px-4 py-6 text-center text-sm text-muted-foreground">
          {{ t('ssh.identity.empty') }}
        </div>
        <div v-else class="flex flex-col divide-y">
          <div
            v-for="idn in identities"
            :key="idn.id"
            class="flex items-center gap-2.5 px-4 py-2.5"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="font-medium text-foreground">{{ idn.name }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <Badge v-if="idn.keyType" variant="secondary">{{ idn.keyType }}</Badge>
                <span class="font-mono text-sm break-all text-muted-foreground">
                  {{ idn.inlineStored ? t('ssh.detail.inlineKey') : idn.keyPath || '—' }}
                </span>
                <Badge
                  v-if="idn.hasPassphrase"
                  variant="outline"
                  class="border-transparent bg-primary/15 text-primary"
                >
                  <Icon name="shield" />
                  {{ t('ssh.detail.passphrase') }}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="iconSm"
              class="text-muted-foreground"
              :title="t('ssh.identity.edit')"
              :aria-label="t('ssh.identity.edit')"
              @click="emit('edit', idn.id)"
            >
              <Icon name="edit" />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              :title="t('ssh.identity.delete')"
              :aria-label="t('ssh.identity.delete')"
              @click="emit('delete', idn.id)"
            >
              <Icon name="trash" />
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Identity manager (ADR 0063 P5) — lists EVERY saved identity so orphans (linked
// to no host) stay editable/deletable, closing the P1 gap where identities were
// only reachable from a host's Identity card. Presentational: the page wires
// new/edit/delete to the same handlers the host card uses.
import { onBeforeUnmount, onMounted } from 'vue'
import type { SshIdentity } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ open: boolean; identities: SshIdentity[] }>()
const emit = defineEmits<{ new: []; edit: [id: string]; delete: [id: string]; close: [] }>()

const { t } = useI18n()

const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
