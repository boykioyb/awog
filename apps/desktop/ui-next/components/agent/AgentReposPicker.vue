<template>
  <!-- Repo access whitelist — registered-project checkboxes (search auto when
       >8 rows) + free-form paths (sub-repo of a container, unregistered
       checkout…), styles global (.awp-*). Empty/undefined = unrestricted. -->
  <div>
    <Input v-if="searchable" v-model="q" :placeholder="t('common.search')" class="awp-search" />
    <div class="awp-list">
      <label v-for="p in filteredRows" :key="p.id" class="awp-row" :class="{ on: isOn(p.path) }">
        <input type="checkbox" :checked="isOn(p.path)" class="awp-cbx" @change="toggle(p.path)" />
        <span class="awp-name">{{ p.name }}</span>
        <span class="awp-tier mono">{{ p.path }}</span>
      </label>
      <div v-if="filteredRows.length === 0" class="awp-empty">
        {{ t('agents.editor.reposEmpty') }}
      </div>
    </div>
    <div v-if="extraRepos.length" class="awp-chips">
      <span v-for="r in extraRepos" :key="r" class="chip mono">
        {{ r }}
        <button class="awp-chipx" :title="t('agents.editor.removeTool')" @click="remove(r)">
          <Icon name="x" style="width: 10px; height: 10px" />
        </button>
      </span>
    </div>
    <Input
      v-model="input"
      :placeholder="t('agents.editor.reposPh')"
      class="mono"
      @keydown.enter.prevent="add"
    />
    <div class="awp-hint">{{ t('agents.editor.reposHint') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  modelValue: string[] | undefined
  projects: { id: string; name: string; path?: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[] | undefined] }>()

const { t } = useI18n()
const q = ref('')
const input = ref('')

const projectRows = computed(() =>
  props.projects.filter((p): p is { id: string; name: string; path: string } => !!p.path),
)
const projectPaths = computed(() => new Set(projectRows.value.map((p) => p.path)))
// Whitelisted paths that aren't a registered project — shown as chips.
const extraRepos = computed(() =>
  (props.modelValue ?? []).filter((r) => !projectPaths.value.has(r)),
)

const searchable = computed(() => projectRows.value.length > 8)
const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return projectRows.value
  return projectRows.value.filter(
    (p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle),
  )
})

const isOn = (path: string): boolean => props.modelValue?.includes(path) ?? false
function toggle(path: string): void {
  const cur = props.modelValue ?? []
  const next = cur.includes(path) ? cur.filter((r) => r !== path) : [...cur, path]
  emit('update:modelValue', next.length ? next : undefined)
}
function add(): void {
  const v = input.value.trim()
  if (!v) return
  if (!(props.modelValue ?? []).includes(v))
    emit('update:modelValue', [...(props.modelValue ?? []), v])
  input.value = ''
}
function remove(r: string): void {
  const next = (props.modelValue ?? []).filter((x) => x !== r)
  emit('update:modelValue', next.length ? next : undefined)
}
</script>
