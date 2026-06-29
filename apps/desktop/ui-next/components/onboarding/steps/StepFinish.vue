<template>
  <div class="obf">
    <p class="ob-lead">{{ t('onboarding.finish.desc') }}</p>

    <ul class="obf-summary">
      <li :class="{ ok: hasAccount }">
        <Icon :name="hasAccount ? 'check' : 'minus'" />
        <span>
          {{ hasAccount ? t('onboarding.finish.accountOk') : t('onboarding.finish.accountNo') }}
        </span>
      </li>
      <li :class="{ ok: !!projectName }">
        <Icon :name="projectName ? 'check' : 'minus'" />
        <span>
          {{
            projectName
              ? t('onboarding.finish.projectOk', { name: projectName })
              : t('onboarding.finish.projectNo')
          }}
        </span>
      </li>
    </ul>

    <div class="obf-cta">
      <button class="btn pri" @click="onTour">
        <Icon name="sparkles" />
        {{ t('onboarding.finish.tour') }}
      </button>
      <button class="btn" @click="onSession">
        <Icon name="message" />
        {{ t('onboarding.finish.session') }}
      </button>
      <button class="btn obf-close" @click="onClose">{{ t('onboarding.finish.close') }}</button>
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
  void navigateTo('/sessions')
}
const onClose = () => {
  complete()
}
</script>

<style scoped>
.obf {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ob-lead {
  color: var(--textMuted);
}
.obf-summary {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.obf-summary li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--textDim);
}
.obf-summary li.ok {
  color: var(--text);
}
.obf-summary li :deep(svg) {
  flex-shrink: 0;
  color: var(--textFaint);
}
.obf-summary li.ok :deep(svg) {
  color: var(--accent);
}
.obf-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.obf-close {
  margin-left: auto;
}
</style>
