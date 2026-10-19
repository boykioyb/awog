<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="w-105 max-w-[92vw] gap-2.5 bg-sidebar p-3.5">
      <DialogHeader class="pr-8">
        <DialogTitle class="text-xs font-semibold text-dim">
          {{ t('wiki.importModal.title') }}
        </DialogTitle>
      </DialogHeader>

      <DialogDescription class="text-base text-dim">
        {{ t('wiki.importModal.hint') }}
      </DialogDescription>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-dim">{{ t('wiki.importModal.tier') }}</span>
        <AppSelect v-model="tier" :options="tierOptions" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-dim">{{ t('wiki.importModal.space') }}</span>
        <AppSelect v-model="space" :options="spaceOptions" />
      </label>

      <label v-if="space === NEW_SPACE" class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-dim">
          {{ t('wiki.importModal.newSpaceName') }}
        </span>
        <Input v-model="newSpaceName" :placeholder="t('wiki.newSpace.placeholder')" />
      </label>

      <p class="m-0 text-sm text-faint">
        {{ t('wiki.importModal.destination') }}
        <!-- mono-ok: đường dẫn đích -->
        <code class="font-mono">{{ destinationLabel }}</code>
      </p>

      <DialogFooter class="mt-0.5 gap-1.5">
        <Button
          :disabled="!canImport"
          variant="outline"
          size="sm"
          @click="emit('pick-files', target)"
        >
          <Icon name="file" class="size-3.5" />
          {{ t('wiki.import.files') }}
        </Button>
        <Button
          :disabled="!canImport"
          variant="outline"
          size="sm"
          @click="emit('pick-folder', target)"
        >
          <Icon name="folder" class="size-3.5" />
          {{ t('wiki.import.folder') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Import target picker (ADR 0073). The import used to derive its destination from
// whatever page happened to be selected — so importing a file with nothing selected
// silently dropped it at the wiki root, where it belonged to no space and could not
// even be picked in a session's wiki scope. Asking is one dialog and removes the
// whole class of "I imported it, where did it go".
import AppSelect from '~/components/common/AppSelect.vue'
import type { WikiSource } from '~/stores/wiki'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

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
