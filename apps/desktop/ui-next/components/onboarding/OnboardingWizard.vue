<template>
  <Teleport to="body">
    <Transition name="ob">
      <div v-if="wizardOpen" class="ob-ovl">
        <div
          class="ob-card"
          role="dialog"
          aria-modal="true"
          :aria-label="t('onboarding.welcome.title')"
        >
          <header class="ob-head">
            <span class="ob-title">{{ t(titleKey) }}</span>
            <span class="ob-count">
              {{ t('onboarding.stepOf', { n: stepIndex + 1, total: STEPS.length }) }}
            </span>
            <button class="ob-x" :title="t('onboarding.skipAll')" @click="complete">
              <Icon name="x" />
            </button>
          </header>

          <div class="ob-body">
            <component :is="stepComponent" />
          </div>

          <footer class="ob-foot">
            <div class="ob-dots">
              <button
                v-for="(s, i) in STEPS"
                :key="s"
                class="ob-dot"
                :class="{ on: i === stepIndex, done: i < stepIndex }"
                :aria-label="t('onboarding.stepOf', { n: i + 1, total: STEPS.length })"
                @click="goTo(i)"
              />
            </div>
            <div class="ob-nav">
              <button v-if="stepIndex > 0" class="btn" @click="back">
                {{ t('onboarding.back') }}
              </button>
              <button v-if="!isLast" class="btn pri" @click="advance">{{ nextLabel }}</button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import StepWelcome from '~/components/onboarding/steps/StepWelcome.vue'
import StepAccount from '~/components/onboarding/steps/StepAccount.vue'
import StepAppearance from '~/components/onboarding/steps/StepAppearance.vue'
import StepProject from '~/components/onboarding/steps/StepProject.vue'
import StepFinish from '~/components/onboarding/steps/StepFinish.vue'

// First-run setup wizard host (§9 global, mounted once in the layout). Owns the
// chrome (header / progress dots / back-next); each step renders its own content
// and drives the existing flows (account connect / project link / appearance) via
// the stores directly, so this stays a thin shell. Finish renders its own CTAs.

const { t } = useI18n()
const { wizardOpen, stepIndex, complete } = useOnboarding()

// Ordered step ids. The map below resolves each to its view + header title.
const STEPS = ['welcome', 'account', 'appearance', 'project', 'finish'] as const
type StepId = (typeof STEPS)[number]

const STEP_VIEW = {
  welcome: StepWelcome,
  account: StepAccount,
  appearance: StepAppearance,
  project: StepProject,
  finish: StepFinish,
} as const

const TITLE_KEY: Record<StepId, string> = {
  welcome: 'onboarding.welcome.title',
  account: 'onboarding.account.title',
  appearance: 'onboarding.appearance.title',
  project: 'onboarding.project.title',
  finish: 'onboarding.finish.title',
}

const currentId = computed<StepId>(() => STEPS[stepIndex.value] ?? 'welcome')
const stepComponent = computed(() => STEP_VIEW[currentId.value])
const titleKey = computed(() => TITLE_KEY[currentId.value])
const isLast = computed(() => stepIndex.value >= STEPS.length - 1)
// First step's Next button reads as the welcome CTA ("Get started").
const nextLabel = computed(() =>
  stepIndex.value === 0 ? t('onboarding.welcome.cta') : t('onboarding.next'),
)

const advance = () => {
  if (stepIndex.value < STEPS.length - 1) stepIndex.value += 1
}
const back = () => {
  if (stepIndex.value > 0) stepIndex.value -= 1
}
const goTo = (i: number) => {
  if (i >= 0 && i < STEPS.length) stepIndex.value = i
}
</script>

<style scoped>
/* Onboarding overlay — top of the modal band (above the ⌘K palette at 200, below
   the mermaid tooltip at 300). Backdrop matches the app's other overlays. */
.ob-ovl {
  position: fixed;
  inset: 0;
  z-index: 250;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}
.ob-card {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  max-height: 88vh;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.ob-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ob-title {
  font-size: 1.08em;
  font-weight: 600;
  color: var(--text);
}
.ob-count {
  margin-left: auto;
  font-size: 12px;
  font-family: var(--code);
  color: var(--textFaint);
}
.ob-x {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.ob-x:hover {
  color: var(--text);
  background: var(--bgHover);
}
.ob-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22px;
}
.ob-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.ob-dots {
  display: flex;
  gap: 7px;
}
.ob-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  cursor: pointer;
  background: var(--border);
  transition: background 140ms ease;
}
.ob-dot.done {
  background: var(--accentBorder);
}
.ob-dot.on {
  background: var(--accent);
}
.ob-nav {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.ob-enter-active,
.ob-leave-active {
  transition: opacity 140ms ease;
}
.ob-enter-from,
.ob-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ob-enter-active,
  .ob-leave-active,
  .ob-dot {
    transition: none;
  }
}
</style>
