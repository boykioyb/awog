<template>
  <Teleport to="body">
    <div v-if="open && profile" class="ovl on" @click.self="emit('close')">
      <div class="bpm-card" role="dialog" aria-modal="true">
        <div class="bpm-head">
          <Icon name="globe" class="icn" />
          <span class="bpm-title">{{ t('browser.proxy.modalTitle', { name: profile.name }) }}</span>
          <button class="bpm-x" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" class="icn" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
        <SettingsBrowserProxy :profile="profile" @close="emit('close')" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Proxy ("VPN") của hồ sơ đang dùng, mở thẳng từ menu ⋯ của trình duyệt (ADR 0103) —
// cùng editor với Settings → Hồ sơ trình duyệt, để không phải biết đường vào Settings
// mới tìm ra tính năng. `.ovl.on` nằm trong danh sách OVERLAYS của useEmbeddedBrowser
// nên trang web nhường chỗ khi modal mở.
import type { BrowserProfile } from '~/types'
import SettingsBrowserProxy from '~/components/settings/SettingsBrowserProxy.vue'

defineProps<{ open: boolean; profile: BrowserProfile | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
</script>

<style scoped>
.bpm-card {
  width: min(680px, 94vw);
  max-height: 86vh;
  overflow-y: auto;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bpm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bpm-title {
  flex: 1;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}
.bpm-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
}
.bpm-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
</style>
