<template>
  <!-- Connections (MCP) whitelist — checkbox list + search (auto when >8
       rows), khung dùng chung AgentPickList / AgentPickRow. undefined model = inherit session MCP (no
       per-agent filter). Any toggle switches the agent into explicit-whitelist
       mode; emptying it returns to inherit (the serializer drops empty arrays
       anyway). -->
  <div>
    <Input v-if="searchable" v-model="q" :placeholder="t('common.search')" class="mb-2" />
    <AgentPickList
      :is-empty="filteredServers.length === 0"
      :empty-text="t('agents.editor.connectionsEmpty')"
    >
      <AgentPickRow
        v-for="s in filteredServers"
        :key="s.id"
        :checked="isOn(s.id)"
        @toggle="toggle(s.id)"
      >
        <!-- mono-ok: id server MCP -->
        <span class="font-mono text-sm font-medium text-foreground">{{ s.name }}</span>
      </AgentPickRow>
    </AgentPickList>
    <div class="text-xs text-dim">{{ t('agents.editor.connectionsHint') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  modelValue: string[] | undefined
  servers: { id: string; name: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[] | undefined] }>()

const { t } = useI18n()
const q = ref('')

const searchable = computed(() => props.servers.length > 8)
const filteredServers = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return props.servers
  return props.servers.filter(
    (s) => s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle),
  )
})

const isOn = (id: string): boolean => props.modelValue?.includes(id) ?? false
function toggle(id: string): void {
  const cur = props.modelValue ?? []
  const next = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]
  emit('update:modelValue', next.length ? next : undefined)
}
</script>
