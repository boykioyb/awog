<template>
  <!-- Tools whitelist — checkbox list over the canonical tool catalogue
       (utils/tool-catalog, same list the session Tools denylist shows) +
       `mcp__<server>` rows per connection + free-form chips for anything else.
       Khung dùng chung AgentPickList / AgentPickRow. Empty/undefined = full toolset. -->
  <div>
    <Input v-model="q" :placeholder="t('common.search')" class="mb-2" />
    <AgentPickList
      :is-empty="filteredRows.length === 0"
      :empty-text="t('agents.editor.toolsEmpty')"
    >
      <AgentPickRow
        v-for="row in filteredRows"
        :key="row.id"
        :checked="isOn(row.id)"
        @toggle="toggle(row.id)"
      >
        <!-- mono-ok: tên tool -->
        <span class="font-mono text-sm font-medium text-foreground">{{ row.id }}</span>
        <span class="truncate text-xs text-faint">{{ row.group }}</span>
      </AgentPickRow>
    </AgentPickList>
    <div v-if="extraTools.length" class="flex flex-wrap gap-1">
      <!-- mono-ok: tên tool mcp__… -->
      <Badge
        v-for="tool in extraTools"
        :key="tool"
        variant="outline"
        :class="{ 'font-mono': tool.startsWith('mcp__') }"
      >
        {{ tool }}
        <Button
          variant="ghost"
          size="iconSm"
          class="size-4 text-dim hover:bg-transparent hover:text-destructive"
          :title="t('agents.editor.removeTool')"
          @click="remove(tool)"
        >
          <Icon name="x" class="size-2.5!" />
        </Button>
      </Badge>
    </div>
    <!-- mono-ok: tên tool -->
    <Input
      v-model="input"
      :placeholder="t('agents.editor.toolsPh')"
      class="font-mono"
      @keydown.enter.prevent="add"
    />
    <div class="text-xs text-dim">{{ t('agents.editor.toolsHint') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import { TOOL_GROUPS } from '~/utils/tool-catalog'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  modelValue: string[] | undefined
  servers?: { id: string; name: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[] | undefined] }>()

const { t } = useI18n()
const q = ref('')
const input = ref('')

// Catalog rows: every built-in tool (with its group as the tier label) + one
// `mcp__<id>` row per connection — whitelisting that name grants the whole
// server's tools (Claude Code subagent `tools` semantics).
const rows = computed(() => [
  ...TOOL_GROUPS.flatMap(([group, tools]) => tools.map((id) => ({ id, group }))),
  ...(props.servers ?? []).map((s) => ({ id: `mcp__${s.id}`, group: s.name })),
])
const catalogIds = computed(() => new Set(rows.value.map((r) => r.id)))
// Whitelisted names outside the catalogue — shown as removable chips.
const extraTools = computed(() =>
  (props.modelValue ?? []).filter((tool) => !catalogIds.value.has(tool)),
)

const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(
    (r) => r.id.toLowerCase().includes(needle) || r.group.toLowerCase().includes(needle),
  )
})

const isOn = (id: string): boolean => props.modelValue?.includes(id) ?? false
function toggle(id: string): void {
  const cur = props.modelValue ?? []
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  emit('update:modelValue', next.length ? next : undefined)
}
function add(): void {
  const v = input.value.trim()
  if (!v) return
  if (!(props.modelValue ?? []).includes(v))
    emit('update:modelValue', [...(props.modelValue ?? []), v])
  input.value = ''
}
function remove(tool: string): void {
  const next = (props.modelValue ?? []).filter((x) => x !== tool)
  emit('update:modelValue', next.length ? next : undefined)
}
</script>
