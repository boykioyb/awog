<template>
  <div class="flex flex-col items-start gap-3.5">
    <p class="text-muted-foreground">{{ t('onboarding.project.desc') }}</p>

    <Badge v-if="linkedName" variant="outline" class="border-selected-border text-primary">
      <Icon name="check" />
      {{ t('onboarding.project.linked', { name: linkedName }) }}
    </Badge>

    <template v-if="available">
      <Button :disabled="busy" class="self-start" variant="outline" @click="onPick">
        <Icon name="folder" />
        {{ busy ? t('onboarding.project.picking') : t('onboarding.project.pick') }}
      </Button>
      <p v-if="error" class="text-destructive">{{ t('onboarding.project.error') }}</p>
      <p class="text-dim">{{ t('onboarding.project.skipHint') }}</p>
    </template>

    <p v-else class="text-dim">{{ t('onboarding.project.browserOnly') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { useSidecar } from '~/composables/useSidecar'
import { pickFolder } from '~/composables/useFolderPicker'

// First-project step — the real "where do I work" choice in AWOG (the config home
// is fixed). Pick a folder → inspect for sensible prefill → linkProject, reusing
// the exact flow the Projects page uses.
const { t } = useI18n()
const store = useProjectsStore()
const available = useSidecar().available

const busy = ref(false)
const error = ref(false)
const linkedName = ref('')

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const onPick = async () => {
  if (!available || busy.value) return
  busy.value = true
  error.value = false
  try {
    const path = await pickFolder({ title: t('onboarding.project.pick') })
    if (!path) return
    const info = await store.inspectPath(path)
    const project = await store.linkProject({
      name: info?.name || basename(path),
      path,
      description: info?.description ?? '',
      language: info?.language ?? '',
      gitRemote: info?.gitRemote ?? '',
      gitBranch: info?.gitBranch ?? '',
    })
    linkedName.value = project.name
  } catch (err) {
    console.warn('[onboarding] linkProject failed', err)
    error.value = true
  } finally {
    busy.value = false
  }
}
</script>
