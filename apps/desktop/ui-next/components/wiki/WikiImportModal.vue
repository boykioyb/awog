<template>
  <div v-if="open" class="wim-back" @click.self="emit('close')">
    <div class="wim" :style="{ background: 'var(--bgPanel)', border: '1px solid var(--border)' }">
      <div class="wim-head">
        <span class="sech">{{ t('wiki.importModal.title') }}</span>
        <button class="wim-x" :title="t('common.close')" @click="emit('close')">
          <Icon name="x" :size="13" />
        </button>
      </div>

      <p class="wim-hint" :style="{ color: 'var(--textDim)' }">
        {{ t('wiki.importModal.hint') }}
      </p>

      <label class="wim-field">
        <span class="sech">{{ t('wiki.importModal.tier') }}</span>
        <AppSelect v-model="tier" :options="tierOptions" />
      </label>

      <label class="wim-field">
        <span class="sech">{{ t('wiki.importModal.space') }}</span>
        <AppSelect v-model="space" :options="spaceOptions" />
      </label>

      <label v-if="space === NEW_SPACE" class="wim-field">
        <span class="sech">{{ t('wiki.importModal.newSpaceName') }}</span>
        <input
          v-model="newSpaceName"
          class="wim-input"
          :placeholder="t('wiki.newSpace.placeholder')"
        />
      </label>

      <p class="wim-dest" :style="{ color: 'var(--textFaint)' }">
        {{ t('wiki.importModal.destination') }}
        <code>{{ destinationLabel }}</code>
      </p>

      <div class="wim-actions">
        <button class="btn sm" :disabled="!canImport" @click="emit('pick-files', target)">
          <Icon name="file" :size="13" />
          {{ t('wiki.import.files') }}
        </button>
        <button class="btn sm" :disabled="!canImport" @click="emit('pick-folder', target)">
          <Icon name="folder" :size="13" />
          {{ t('wiki.import.folder') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Import target picker (ADR 0073). The import used to derive its destination from
// whatever page happened to be selected — so importing a file with nothing selected
// silently dropped it at the wiki root, where it belonged to no space and could not
// even be picked in a session's wiki scope. Asking is one dialog and removes the
// whole class of "I imported it, where did it go".
import AppSelect from '~/components/common/AppSelect.vue'
import type { WikiSource } from '~/stores/wiki'

export interface WikiImportTarget {
  source: WikiSource
  projectId?: string
  // '' = the wiki root.
  space: string
}

// Sentinel for the "+ new space" row. A leading space keeps it distinct from any
// real slug (a slug can never start with one).
const NEW_SPACE = ' new'
const ROOT_SPACE = ''

const props = defineProps<{
  open: boolean
  // Existing space ids, deduped by the caller.
  spaces: string[]
  // Projects that can hold a project-tier wiki.
  projects: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  close: []
  'pick-files': [target: WikiImportTarget]
  'pick-folder': [target: WikiImportTarget]
}>()

const { t } = useI18n()

const tier = ref('global')
const space = ref<string>(ROOT_SPACE)
const newSpaceName = ref('')

const tierOptions = computed(() => [
  { value: 'global', label: t('wiki.importModal.tierGlobal') },
  ...props.projects.map((p) => ({ value: `project:${p.id}`, label: p.name })),
])

const spaceOptions = computed(() => [
  { value: ROOT_SPACE, label: t('wiki.importModal.spaceRoot') },
  ...props.spaces.map((s) => ({ value: s, label: s })),
  { value: NEW_SPACE, label: t('wiki.importModal.spaceNew') },
])

// Slug of the space the files land in ('' = root). Same shape as the sidecar's
// slugifier so the folder the user names is the folder they get.
const resolvedSpace = computed(() => {
  if (space.value !== NEW_SPACE) return space.value
  return newSpaceName.value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
})

const target = computed<WikiImportTarget>(() => {
  const projectId = tier.value.startsWith('project:') ? tier.value.slice('project:'.length) : ''
  return {
    source: projectId ? 'project' : 'global',
    ...(projectId ? { projectId } : {}),
    space: resolvedSpace.value,
  }
})

const canImport = computed(() => space.value !== NEW_SPACE || resolvedSpace.value !== '')

const destinationLabel = computed(() => {
  const tierLabel = target.value.projectId
    ? (props.projects.find((p) => p.id === target.value.projectId)?.name ?? 'project')
    : t('wiki.importModal.tierGlobal')
  return `${tierLabel} / ${target.value.space || t('wiki.importModal.spaceRoot')}`
})

// Reopening should not carry over a half-typed new-space name.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) newSpaceName.value = ''
  },
)
</script>

<style scoped>
.wim-back {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.wim {
  width: 420px;
  max-width: 92vw;
  border-radius: var(--r-sm);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow);
}
.wim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wim-x {
  background: transparent;
  border: 0;
  color: var(--textFaint);
  cursor: pointer;
  padding: 2px;
}
.wim-x:hover {
  color: var(--text);
}
.wim-hint {
  margin: 0;
  font-size: 1em;
  line-height: 1.5;
}
.wim-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wim-input {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  padding: 5px 7px;
  font-size: 1em;
  outline: none;
}
.wim-input:focus {
  border-color: var(--borderFocus);
}
.wim-dest {
  margin: 0;
  font-size: 12px;
}
.wim-dest code {
  /* mono-ok: destination path */
  font-family: var(--code);
}
.wim-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 2px;
}
</style>
