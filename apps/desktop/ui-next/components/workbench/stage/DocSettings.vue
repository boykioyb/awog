<template>
  <!-- Doc 'settings' — Settings NHÚNG (không modal): nav 2 cột trái theo nhóm
       + SettingsPane của section đang chọn. Section sống trong `doc.nav` nên
       KeepAlive khôi phục đúng chỗ đã mở và DocTabs/store giữ được trạng thái. -->
  <!-- `.setpane` (SettingsPane) chiếm trọn stage thay vì giữ max-width của modal. -->
  <div class="flex min-h-0 flex-1 [&_.setpane]:h-full [&_.setpane]:max-w-none">
    <aside class="w-47.5 flex-none overflow-y-auto border-r border-border bg-sidebar px-2 py-2.5">
      <SettingsNav :groups="SETTINGS_GROUPS" :active="active" @select="onSelect" />
    </aside>
    <div class="min-w-0 flex-1 overflow-y-auto">
      <SettingsPane :active="active" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import SettingsNav from '~/components/settings/SettingsNav.vue'
import SettingsPane from '~/components/settings/SettingsPane.vue'
import { SETTINGS_GROUPS } from '~/components/settings/sections'
import type { SettingsSectionId } from '~/components/settings/sections'

const props = defineProps<{ doc: WorkbenchDoc }>()
const wbDocs = useWorkbenchDocs()

// `doc.nav` chưa gán → mặc định 'appearance'; gán rồi thì ghi qua action của
// composable (doc sống trong Pinia `wb.docs` — không mutate prop trực tiếp).
const active = computed<SettingsSectionId>({
  get: () => (props.doc.nav as SettingsSectionId | undefined) ?? 'appearance',
  set: (v) => {
    wbDocs.updateDocMeta(props.doc, { nav: v })
  },
})

function onSelect(id: SettingsSectionId) {
  active.value = id
}
</script>
