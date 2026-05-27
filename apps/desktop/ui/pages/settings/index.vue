<template>
  <MasterDetailShell v-model:mobile-pane="mobilePane" :selected-id="section" list-width="14rem">
    <template #list>
      <div class="py-4">
        <div
          class="px-3 mb-3 text-[11px] uppercase tracking-wider font-medium"
          :style="{ color: t.textDim }"
        >
          Settings
        </div>
        <div class="px-2 space-y-0.5">
          <button
            v-for="s in sections"
            :key="s.id"
            class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-[12px] transition"
            :style="{
              background: section === s.id ? t.bgActive : 'transparent',
              color: section === s.id ? t.text : t.textDim,
            }"
            @click="onSelectSection(s.id)"
          >
            <component :is="s.icon" :size="13" />
            {{ s.label }}
          </button>
        </div>
      </div>
    </template>

    <template #detail>
      <div class="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl">
        <SettingsWorkspaceSection v-if="section === 'workspace'" />
        <SettingsDefaultsSection v-else-if="section === 'defaults'" />
        <SettingsModelsSection v-else-if="section === 'models'" />
        <SettingsConnectorsSection v-else-if="section === 'connectors'" />
        <SettingsAppearanceSection v-else-if="section === 'appearance'" />
      </div>
    </template>
  </MasterDetailShell>
</template>

<script setup lang="ts">
import { FolderGit2, Key, Palette, Plug, Sliders } from 'lucide-vue-next'
import type { Component } from 'vue'

type SectionId = 'workspace' | 'defaults' | 'models' | 'connectors' | 'appearance'

const { t } = useTheme()
const settings = useSettingsStore()

const section = ref<SectionId>('appearance')
const mobilePane = ref<'list' | 'detail'>('list')

onMounted(async () => {
  // Pull accounts truth from sidecar; safe to call even when sidecar is unavailable.
  await settings.hydrateFromSidecar()
})

const onSelectSection = (id: SectionId) => {
  section.value = id
  mobilePane.value = 'detail'
}

const sections: { id: SectionId; label: string; icon: Component }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: FolderGit2 },
  { id: 'defaults', label: 'Defaults', icon: Sliders },
  { id: 'models', label: 'Models & API Keys', icon: Key },
  { id: 'connectors', label: 'Connectors', icon: Plug },
]
</script>
