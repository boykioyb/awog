<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Connectors</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
        External context providers that agents can read from
      </div>
    </div>
    <div class="space-y-2">
      <div
        v-for="p in connectorProviders"
        :key="p.id"
        class="rounded p-3 flex items-center gap-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <div
          class="w-8 h-8 rounded flex items-center justify-center"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <component :is="p.icon" :size="14" :style="{ color: t.textMuted }" />
        </div>
        <div class="flex-1">
          <div class="text-[13px] font-medium" :style="{ color: t.text }">
            {{ p.label }}
          </div>
          <div class="text-[10px]" :style="{ color: t.textDim }">
            {{
              settings.contextProviders[p.id as ConnectorId].connected
                ? 'Authenticated · workspace.example.com'
                : 'Not connected'
            }}
          </div>
        </div>
        <button
          class="px-3 py-1 text-[11px] rounded transition"
          :style="{
            background: settings.contextProviders[p.id as ConnectorId].connected
              ? 'transparent'
              : t.accent,
            color: settings.contextProviders[p.id as ConnectorId].connected ? t.text : t.accentText,
            border: settings.contextProviders[p.id as ConnectorId].connected
              ? `1px solid ${t.borderStrong}`
              : 'none',
          }"
          @click="settings.toggleConnector(p.id as ConnectorId)"
        >
          {{ settings.contextProviders[p.id as ConnectorId].connected ? 'Disconnect' : 'Connect' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CONTEXT_PROVIDERS } from '~/utils/initial-data'

type ConnectorId = 'notion' | 'jira' | 'slack'

const { t } = useTheme()
const settings = useSettingsStore()

const connectorProviders = computed(() =>
  CONTEXT_PROVIDERS.filter((p) =>
    (['notion', 'jira', 'slack'] as const).includes(p.id as ConnectorId),
  ),
)
</script>
