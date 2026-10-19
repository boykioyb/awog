<template>
  <!-- Dialog không tự đóng: không Esc, không bấm nền — chỉ thoát bằng nút X (= bỏ qua
       toàn bộ) hoặc các lối ra của bước Finish, như overlay cũ. Nút đóng mặc định của
       DialogContent bị ẩn; X riêng trong header giữ tooltip "bỏ qua". -->
  <Dialog :open="wizardOpen">
    <DialogContent
      class="flex max-h-[88vh] w-full max-w-140 flex-col gap-0 overflow-hidden bg-card p-0 sm:rounded-xl [&>button:last-child]:hidden"
      @escape-key-down.prevent
      @pointer-down-outside.prevent
      @interact-outside.prevent
    >
      <DialogHeader class="flex shrink-0 flex-row items-center gap-2.5 px-4 py-3.5">
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t(titleKey) }}</DialogTitle>
        <span class="ml-auto text-sm text-faint tabular-nums">
          {{ t('onboarding.stepOf', { n: stepIndex + 1, total: STEPS.length }) }}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :title="t('onboarding.skipAll')"
          :aria-label="t('onboarding.skipAll')"
          @click="complete"
        >
          <Icon name="x" />
        </Button>
      </DialogHeader>
      <Separator />

      <div class="min-h-0 flex-1 overflow-y-auto px-5.5 py-5">
        <component :is="stepComponent" />
      </div>

      <Separator />
      <DialogFooter class="flex shrink-0 flex-row items-center gap-3 px-4 py-3 sm:justify-start">
        <div class="flex gap-2">
          <!-- raw-ok: chấm tiến độ 8px — Button nhỏ nhất vẫn quá to cho chấm tròn -->
          <button
            v-for="(s, i) in STEPS"
            :key="s"
            type="button"
            class="size-2 cursor-pointer rounded-full border-0 p-0 transition-colors motion-reduce:transition-none"
            :class="dotClass(i)"
            :aria-label="t('onboarding.stepOf', { n: i + 1, total: STEPS.length })"
            @click="goTo(i)"
          />
        </div>
        <div class="ml-auto flex gap-2">
          <Button v-if="stepIndex > 0" variant="outline" @click="back">
            {{ t('onboarding.back') }}
          </Button>
          <Button v-if="!isLast" variant="default" @click="advance">{{ nextLabel }}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
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
// Chấm tiến độ: bước hiện tại = primary, bước đã qua = viền accent nhạt, còn lại = viền.
const dotClass = (i: number): string => {
  if (i === stepIndex.value) return 'bg-primary'
  return i < stepIndex.value ? 'bg-selected-border' : 'bg-border'
}
const goTo = (i: number) => {
  if (i >= 0 && i < STEPS.length) stepIndex.value = i
}
</script>
