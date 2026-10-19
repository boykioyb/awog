<template>
  <!-- Repo access whitelist — registered-project checkboxes (search auto when
       >8 rows) + free-form paths (sub-repo of a container, unregistered
       checkout…), khung dùng chung AgentPickList / AgentPickRow. Empty/undefined = unrestricted. -->
  <div>
    <Input v-if="searchable" v-model="q" :placeholder="t('common.search')" class="mb-2" />
    <AgentPickList
      :is-empty="filteredRows.length === 0"
      :empty-text="t('agents.editor.reposEmpty')"
    >
      <AgentPickRow
        v-for="p in filteredRows"
        :key="p.id"
        :checked="isOn(p.path)"
        @toggle="toggle(p.path)"
      >
        <span class="text-sm font-medium text-foreground">{{ p.name }}</span>
        <!-- mono-ok: đường dẫn repo -->
        <span class="truncate font-mono text-xs text-faint">{{ p.path }}</span>
      </AgentPickRow>
    </AgentPickList>
    <div v-if="extraRepos.length" class="flex flex-wrap gap-1">
      <!-- mono-ok: đường dẫn repo -->
      <Badge v-for="r in extraRepos" :key="r" variant="outline" class="font-mono">
        {{ r }}
        <Button
          variant="ghost"
          size="iconSm"
          class="size-4 text-dim hover:bg-transparent hover:text-destructive"
          :title="t('agents.editor.removeTool')"
          @click="remove(r)"
        >
          <Icon name="x" class="size-2.5!" />
        </Button>
      </Badge>
    </div>
    <!-- mono-ok: đường dẫn repo -->
    <Input
      v-model="input"
      :placeholder="t('agents.editor.reposPh')"
      class="font-mono"
      @keydown.enter.prevent="add"
    />
    <div class="text-xs text-dim">{{ t('agents.editor.reposHint') }}</div>
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
