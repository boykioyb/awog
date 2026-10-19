<template>
  <Dialog :open="open && !!profile" @update:open="(v) => !v && emit('close')">
    <DialogContent v-if="profile" class="max-h-[86vh] max-w-170 gap-3.5 overflow-y-auto p-4.5">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 pr-6 text-lg font-normal">
          <Icon name="globe" class="size-4" />
          {{ t('browser.proxy.modalTitle', { name: profile.name }) }}
        </DialogTitle>
      </DialogHeader>
      <SettingsBrowserProxy :profile="profile" @close="emit('close')" />
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Proxy ("VPN") của hồ sơ đang dùng, mở thẳng từ menu ⋯ của trình duyệt (ADR 0103) —
// cùng editor với Settings → Hồ sơ trình duyệt, để không phải biết đường vào Settings
// mới tìm ra tính năng. Dialog shadcn (`[role="dialog"][data-state="open"]`) nằm trong
// OVERLAYS của useEmbeddedBrowser nên trang web nhường chỗ khi modal mở.
import type { BrowserProfile } from '~/types'
import SettingsBrowserProxy from '~/components/settings/SettingsBrowserProxy.vue'

defineProps<{ open: boolean; profile: BrowserProfile | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
</script>
