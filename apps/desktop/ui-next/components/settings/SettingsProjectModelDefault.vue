<template>
  <SettingsField
    block
    :name="t('settingsDefaults.projectModel.name')"
    :desc="t('settingsDefaults.projectModel.desc')"
  >
    <div class="flex flex-wrap items-center justify-end gap-2">
      <SettingsSeg v-model="provider" :options="PROVIDER_OPTIONS" />
      <AppSelect v-model="modelId" :options="modelOptions" />
      <button
        class="btn pri sm"
        type="button"
        :disabled="applying || projectCount === 0"
        @click="applyToAll"
      >
        {{ t('settingsDefaults.projectModel.apply', { n: projectCount }) }}
      </button>
    </div>
  </SettingsField>
</template>

<script setup lang="ts">
// Settings → Defaults: bulk-set the default model on EVERY project's llmDefaults.
// Independent from the app-level default (which only seeds new sessions that have
// no per-project override) — this force-writes the chosen provider+model onto each
// project. Local pickers (seeded from the app default) + a gated Apply button.
import {
  PROVIDER_DISPLAY,
  modelDisplayName,
  modelIdFromDisplay,
  modelsForProvider,
} from '~/composables/useSessionsData'
import type { ProviderName } from '~/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()
const projectsStore = useProjectsStore()
const { confirm } = useConfirm()

const PROVIDER_OPTIONS = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google', value: 'google' },
] as const

// Seeded from the app default; the user picks what to bulk-apply. SettingsSeg's
// model is `string`, so keep these as string refs and cast at the boundary.
const provider = ref<string>(settings.defaults.provider)
const modelId = ref<string>(settings.defaults.modelId)

const firstModelIdOf = (p: string): string =>
  modelIdFromDisplay(modelsForProvider(PROVIDER_DISPLAY[p] ?? 'Anthropic')[0] ?? '')

// Keep the model valid when the provider changes.
watch(provider, (p) => {
  modelId.value = firstModelIdOf(p)
})

const modelOptions = computed(() =>
  modelsForProvider(PROVIDER_DISPLAY[provider.value] ?? 'Anthropic').map((display) => ({
    label: display,
    value: modelIdFromDisplay(display),
  })),
)

const projectCount = computed(() => projectsStore.projects.length)
const applying = ref(false)

onMounted(() => {
  // The projects list may not have hydrated yet when Settings is opened directly.
  if (!projectsStore.loaded) void projectsStore.hydrate()
})

async function applyToAll() {
  if (applying.value || projectCount.value === 0) return
  const model = modelDisplayName(modelId.value)
  const ok = await confirm({
    title: t('settingsDefaults.projectModel.confirmTitle'),
    description: t('settingsDefaults.projectModel.confirmDesc', { model, n: projectCount.value }),
    confirmLabel: t('settingsDefaults.projectModel.applyShort'),
    kind: 'primary',
  })
  if (!ok) return
  applying.value = true
  try {
    const { ok, failed, firstError } = await projectsStore.applyModelToAllProjects({
      provider: provider.value as ProviderName,
      modelId: modelId.value,
    })
    if (ok > 0 && failed === 0) {
      pushActionToast(t('settingsDefaults.projectModel.applied', { model, n: ok }), 'success')
    } else if (ok > 0) {
      // Some projects couldn't be updated (e.g. their folder was moved/deleted,
      // which projects.upsert rejects) — apply what we could, flag the rest.
      pushActionToast(
        t('settingsDefaults.projectModel.appliedPartial', { model, n: ok, failed }),
        'info',
      )
    } else {
      // Nothing applied — surface the real sidecar error (e.g. "Path does not
      // exist: …") so the cause is visible rather than a generic failure.
      pushActionToast(firstError ?? t('settingsDefaults.projectModel.failed'), 'error')
    }
  } catch {
    pushActionToast(t('settingsDefaults.projectModel.failed'), 'error')
  } finally {
    applying.value = false
  }
}
</script>
