<template>
  <div class="flex flex-col gap-4.5">
    <p class="text-muted-foreground">{{ t('onboarding.finish.desc') }}</p>

    <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
      <li class="flex items-center gap-2.5" :class="hasAccount ? 'text-foreground' : 'text-dim'">
        <Icon
          :name="hasAccount ? 'check' : 'minus'"
          class="shrink-0"
          :class="hasAccount ? 'text-primary' : 'text-faint'"
        />
        <span>
          {{ hasAccount ? t('onboarding.finish.accountOk') : t('onboarding.finish.accountNo') }}
        </span>
      </li>
      <li class="flex items-center gap-2.5" :class="projectName ? 'text-foreground' : 'text-dim'">
        <Icon
          :name="projectName ? 'check' : 'minus'"
          class="shrink-0"
          :class="projectName ? 'text-primary' : 'text-faint'"
        />
        <span>
          {{
            projectName
              ? t('onboarding.finish.projectOk', { name: projectName })
              : t('onboarding.finish.projectNo')
          }}
        </span>
      </li>
    </ul>

    <div class="flex flex-wrap gap-2">
      <Button variant="default" @click="onTour">
        <Icon name="sparkles" />
        {{ t('onboarding.finish.tour') }}
      </Button>
      <Button variant="outline" @click="onSession">
        <Icon name="message" />
        {{ t('onboarding.finish.session') }}
      </Button>
      <Button class="ml-auto" variant="outline" @click="onClose">
        {{ t('onboarding.finish.close') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore, type ProviderName } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'

// Finish step — recaps what got set up and offers the three exits. Each exit marks
// onboarding complete first; "Show me around" then kicks off the spotlight tour.
const { t } = useI18n()
const settings = useSettingsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const { complete } = useOnboarding()
const { start } = useTour()

const hasAccount = computed(() =>
  (['anthropic', 'openai', 'google'] as ProviderName[]).some(
    (p) => settings.providers[p].accounts.length > 0,
  ),
)
const projectName = computed(() => projects.projects[0]?.name ?? '')

const onTour = () => {
  complete()
  start('intro')
}
const onSession = () => {
  complete()
  sessions.create()
  void navigateTo('/workbench')
}
const onClose = () => {
  complete()
}
</script>
