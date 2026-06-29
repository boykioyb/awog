<template>
  <div class="obp">
    <p class="ob-lead">{{ t('onboarding.project.desc') }}</p>

    <div v-if="linkedName" class="chip obp-ok">
      <Icon name="check" />
      {{ t('onboarding.project.linked', { name: linkedName }) }}
    </div>

    <template v-if="available">
      <button class="btn obp-pick" :disabled="busy" @click="onPick">
        <Icon name="folder" />
        {{ busy ? t('onboarding.project.picking') : t('onboarding.project.pick') }}
      </button>
      <p v-if="error" class="obp-err">{{ t('onboarding.project.error') }}</p>
      <p class="obp-hint">{{ t('onboarding.project.skipHint') }}</p>
    </template>

    <p v-else class="obp-hint">{{ t('onboarding.project.browserOnly') }}</p>
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

<style scoped>
.obp {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}
.ob-lead {
  color: var(--textMuted);
  line-height: 1.5;
}
.obp-ok {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.obp-pick {
  align-self: flex-start;
}
.obp-err {
  color: var(--danger);
}
.obp-hint {
  color: var(--textDim);
  line-height: 1.5;
}
</style>
