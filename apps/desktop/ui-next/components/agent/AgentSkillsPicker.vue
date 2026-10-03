<template>
  <!-- Skills whitelist — checkbox list + search (auto when >8 rows), styles
       global (.awp-*, agent-whitelist.css). Empty/undefined = every in-scope
       skill. Agents are global roles → caller passes the global tier only. -->
  <div>
    <Input v-if="searchable" v-model="q" :placeholder="t('common.search')" class="awp-search" />
    <div class="awp-list">
      <label
        v-for="s in filteredRows"
        :key="s.key"
        class="awp-row"
        :class="{ on: isOn(s.id) }"
        :title="s.description"
      >
        <input type="checkbox" :checked="isOn(s.id)" class="awp-cbx" @change="toggle(s.id)" />
        <span class="awp-name mono">{{ s.id }}</span>
        <span v-if="s.tier" class="awp-tier">{{ s.tier }}</span>
      </label>
      <div v-if="filteredRows.length === 0" class="awp-empty">
        {{ t('agents.editor.skillsEmpty') }}
      </div>
    </div>
    <div class="awp-hint">{{ t('agents.editor.skillsHint') }}</div>
  </div>
</template>

<script setup lang="ts">
// v-model: string[] | undefined — undefined/[] = unrestricted. Rows keyed by
// composite identity (same skill id may exist on several tiers — the whitelist
// stores bare ids, so ticking one row grants every tier's copy).
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  modelValue: string[] | undefined
  skills: { id: string; name: string; description?: string; source?: string; projectId?: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[] | undefined] }>()

const { t } = useI18n()
const q = ref('')

const rows = computed(() =>
  props.skills.map((s) => ({
    key: `${s.source ?? 'global'}|${s.projectId ?? ''}|${s.id}`,
    id: s.id,
    description: s.description ?? s.name,
    tier: s.source === 'project' ? (s.projectId ?? 'project') : '',
  })),
)

const searchable = computed(() => rows.value.length > 8)
const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(
    (s) => s.id.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle),
  )
})

const isOn = (id: string): boolean => props.modelValue?.includes(id) ?? false
function toggle(id: string): void {
  const cur = props.modelValue ?? []
  const next = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]
  emit('update:modelValue', next.length ? next : undefined)
}
</script>
