<template>
  <div
    v-if="questions.length"
    class="rounded-md text-[1em]"
    :style="{
      background: t.bgSubtle,
      border: `1px solid ${accent.border}`,
      borderLeft: `3px solid ${accent.accent}`,
    }"
  >
    <!-- Header. Once answered the card collapses to just this bar (the form is
         hidden); click to re-open the read-only record. -->
    <div
      class="px-3 py-2 flex items-center gap-2"
      :class="answered ? 'cursor-pointer select-none' : ''"
      :style="{ borderBottom: showBody ? `1px solid ${t.border}` : 'none' }"
      @click="answered && (collapsed = !collapsed)"
    >
      <MessageCircleQuestion :size="13" :style="{ color: accent.accent }" />
      <div class="font-semibold flex items-center gap-1.5" :style="{ color: t.text }">
        {{
          questions.length > 1 ? tr('session.question.title_plural') : tr('session.question.title')
        }}
        <span
          class="px-1 py-0.5 rounded uppercase tracking-wide font-medium text-[12px] leading-none"
          :style="{
            background: accent.bg,
            color: accent.accent,
            border: `1px solid ${accent.border}`,
          }"
        >
          {{ answered ? tr('session.question.answered') : tr('session.question.pending') }}
        </span>
      </div>
      <ChevronDown
        v-if="answered"
        :size="12"
        class="ml-auto flex-shrink-0"
        :style="{
          color: t.textDim,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
        }"
      />
    </div>

    <!-- Answered → read-only record (hidden until the header is expanded) -->
    <div v-if="answered && !collapsed" class="px-3 py-2 space-y-2.5">
      <div v-for="(q, qi) in questions" :key="qi">
        <div class="leading-relaxed" :style="{ color: t.textMuted }">{{ q.question }}</div>
        <div class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="(sel, si) in answerFor(q.header)"
            :key="si"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px]"
            :style="{ background: accent.bg, color: t.text, border: `1px solid ${accent.border}` }"
          >
            <Check :size="10" :style="{ color: accent.accent }" />
            {{ sel }}
          </span>
          <span
            v-if="!answerFor(q.header).length"
            class="text-[12px]"
            :style="{ color: t.textFaint }"
          >
            {{ tr('session.question.no_answer') }}
          </span>
        </div>
      </div>
    </div>

    <!-- Pending → interactive form (only while unanswered; collapsed-answered
         renders neither this nor the record, just the header bar) -->
    <template v-else-if="!answered">
      <!-- Question tabs (multi-question only) -->
      <div v-if="questions.length > 1" class="px-3 pt-2 flex items-center gap-1 flex-wrap">
        <button
          v-for="(q, qi) in questions"
          :key="qi"
          type="button"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium transition"
          :style="tabStyle(qi)"
          @click="activeTab = qi"
        >
          {{ q.header || `#${qi + 1}` }}
          <Check v-if="selectedFor(qi).length" :size="10" />
        </button>
      </div>

      <!-- Active question -->
      <div class="px-3 py-2 space-y-1.5">
        <div class="font-medium leading-relaxed" :style="{ color: t.text }">
          {{ active.question }}
        </div>
        <div class="space-y-1">
          <button
            v-for="(opt, oi) in active.options"
            :key="oi"
            type="button"
            :disabled="!canAnswer"
            class="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded transition"
            :style="optionStyle(isPicked(activeTab, opt.label))"
            @click="toggleOption(activeTab, opt.label)"
          >
            <component
              :is="markIcon(active.multiSelect, isPicked(activeTab, opt.label))"
              :size="14"
              class="flex-shrink-0 mt-0.5"
              :style="{ color: isPicked(activeTab, opt.label) ? accent.accent : t.textDim }"
            />
            <span class="min-w-0">
              <span :style="{ color: t.text }">{{ opt.label }}</span>
              <span
                v-if="opt.description"
                class="block text-[12px] leading-snug"
                :style="{ color: t.textMuted }"
              >
                {{ opt.description }}
              </span>
            </span>
          </button>

          <!-- Other (free text) -->
          <div
            class="rounded"
            :style="{ border: `1px solid ${otherOn[activeTab] ? accent.border : t.border}` }"
          >
            <button
              type="button"
              :disabled="!canAnswer"
              class="w-full text-left flex items-center gap-2 px-2 py-1.5 transition"
              @click="toggleOther(activeTab)"
            >
              <component
                :is="markIcon(active.multiSelect, otherOn[activeTab])"
                :size="14"
                class="flex-shrink-0"
                :style="{ color: otherOn[activeTab] ? accent.accent : t.textDim }"
              />
              <span :style="{ color: t.text }">{{ tr('session.question.other') }}</span>
            </button>
            <input
              v-if="otherOn[activeTab]"
              v-model="otherText[activeTab]"
              type="text"
              :disabled="!canAnswer"
              class="w-full px-2 py-1.5 bg-transparent outline-none text-[1em]"
              :style="{ color: t.text, borderTop: `1px solid ${t.border}` }"
              :placeholder="tr('session.question.other_placeholder')"
              @keydown.enter.prevent="confirmStep"
            />
          </div>
        </div>
      </div>

      <!-- Footer — single-select auto-advances on pick, so the action button
           only surfaces for multi-select, the "Other" path, or the last
           question (where it becomes Submit). -->
      <div
        v-if="showFooter"
        class="px-3 py-2 flex items-center gap-2"
        :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <button
          type="button"
          :disabled="!stepEnabled"
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition"
          :style="{
            background: accent.accent,
            color: t.accentText,
            opacity: stepEnabled ? 1 : 0.5,
          }"
          @click="confirmStep"
        >
          <component :is="isLast ? Check : ArrowRight" :size="11" />
          {{ isLast ? tr('session.question.submit') : tr('session.question.continue') }}
        </button>
        <span
          v-if="questions.length > 1"
          class="ml-auto text-[12px]"
          :style="{ color: t.textFaint }"
        >
          {{ answeredCount }}/{{ questions.length }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  MessageCircleQuestion,
  Square,
  SquareCheck,
} from 'lucide-vue-next'
import { computed, reactive, ref, type Component } from 'vue'
import type { SessionQuestion, SessionQuestionAnswer, SessionStep } from '~/types'
import { ANSWER_QUESTION_KEY } from '~/utils/step-context'

const props = defineProps<{
  step: SessionStep
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

// Inject the store-backed answer callback. Null outside a session context → the
// card renders read-only (no submit).
const answer = inject(ANSWER_QUESTION_KEY, null)

const questions = computed<SessionQuestion[]>(() => props.step.questions ?? [])
const answered = computed(() => Array.isArray(props.step.answers) && props.step.answers.length > 0)
const canAnswer = computed(() => !!answer && !answered.value)

// Once answered, collapse to just the header bar (hide the read-only record);
// the user can click the header to re-open it. Pending cards always show their
// form, so this only gates the answered state.
const collapsed = ref(true)
const showBody = computed(() => !answered.value || !collapsed.value)

// Fallback keeps `active` a concrete SessionQuestion (the template guards on
// questions.length, but TS can't see that through the indexed access).
const FALLBACK_QUESTION: SessionQuestion = {
  header: '',
  question: '',
  options: [],
  multiSelect: false,
}
const activeTab = ref(0)
const active = computed<SessionQuestion>(
  () => questions.value[activeTab.value] ?? questions.value[0] ?? FALLBACK_QUESTION,
)

// Per-question selection state. picks = chosen option labels (radio = ≤1);
// otherOn/otherText = the free-text "Other" choice. Keyed by question index;
// questions never change after the step is created so a sparse record is fine.
const picks = reactive<Record<number, Set<string>>>({})
const otherOn = reactive<Record<number, boolean>>({})
const otherText = reactive<Record<number, string>>({})
const picksFor = (qi: number): Set<string> => {
  if (!picks[qi]) picks[qi] = new Set<string>()
  return picks[qi]
}

const isPicked = (qi: number, label: string): boolean => picksFor(qi).has(label)

const toggleOption = (qi: number, label: string): void => {
  if (!canAnswer.value) return
  const set = picksFor(qi)
  if (questions.value[qi]?.multiSelect) {
    if (set.has(label)) set.delete(label)
    else set.add(label)
  } else {
    // Radio: exactly one option, and clear the Other choice.
    set.clear()
    set.add(label)
    otherOn[qi] = false
    // Single-select auto-advances to the next question; the last/only question
    // still waits for an explicit Submit.
    if (qi === activeTab.value && !isLast.value) advance()
  }
}

const toggleOther = (qi: number): void => {
  if (!canAnswer.value) return
  if (questions.value[qi]?.multiSelect) {
    otherOn[qi] = !otherOn[qi]
  } else {
    picksFor(qi).clear()
    otherOn[qi] = true
  }
}

const selectedFor = (qi: number): string[] => {
  const out = [...picksFor(qi)]
  if (otherOn[qi] && otherText[qi]?.trim()) out.push(otherText[qi].trim())
  return out
}

const answeredCount = computed(
  () => questions.value.filter((_, qi) => selectedFor(qi).length > 0).length,
)
const canSubmit = computed(() => questions.value.every((_, qi) => selectedFor(qi).length > 0))

const isLast = computed(() => activeTab.value >= questions.value.length - 1)
const currentSelected = computed(() => selectedFor(activeTab.value).length > 0)

// Footer action button: "Continue" (advance) on every question but the last,
// where it becomes the final "Submit". Single-select questions auto-advance on
// pick, so the button only surfaces for multi-select, the free-text "Other"
// path, or the last question (always Submit).
const showFooter = computed(
  () => canAnswer.value && (active.value.multiSelect || !!otherOn[activeTab.value] || isLast.value),
)
const stepEnabled = computed(() => (isLast.value ? canSubmit.value : currentSelected.value))

const advance = (): void => {
  if (activeTab.value < questions.value.length - 1) activeTab.value += 1
}

const confirmStep = (): void => {
  if (!stepEnabled.value) return
  if (isLast.value) submit()
  else advance()
}

const submit = (): void => {
  if (!answer || !canSubmit.value) return
  const out: SessionQuestionAnswer[] = questions.value.map((q, qi) => ({
    header: q.header,
    selected: selectedFor(qi),
  }))
  answer(props.step.id, out)
}

// Read-only record lookup (answered state).
const answerFor = (header: string): string[] =>
  props.step.answers?.find((a) => a.header === header)?.selected ?? []

const markIcon = (multi: boolean, on: boolean | undefined): Component => {
  if (multi) return on ? SquareCheck : Square
  return on ? CircleDot : Circle
}

const accent = computed(() =>
  answered.value
    ? { accent: '#22c55e', bg: 'rgba(34, 197, 94, 0.10)', border: 'rgba(34, 197, 94, 0.35)' }
    : { accent: t.value.accent, bg: t.value.bgInput, border: t.value.border },
)

const tabStyle = (qi: number) =>
  qi === activeTab.value
    ? {
        background: t.value.accent,
        color: t.value.accentText,
        border: `1px solid ${t.value.accent}`,
      }
    : { background: t.value.bgInput, color: t.value.textDim, border: `1px solid ${t.value.border}` }

const optionStyle = (on: boolean) => ({
  background: on ? accent.value.bg : 'transparent',
  border: `1px solid ${on ? accent.value.border : t.value.border}`,
})
</script>
