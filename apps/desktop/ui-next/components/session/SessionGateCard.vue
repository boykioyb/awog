<template>
  <!-- plan -->
  <div v-if="block.kind === 'plan'" class="gcard" :class="{ gate: planStatus === 'pending' }">
    <div class="gh">
      <Icon name="rules" />
      {{ t('sessions.gate.plan') }}
    </div>
    <SessionTextBlock class="planbody" :text="planMarkdown" />
    <div v-if="planStatus === 'pending'" class="cact">
      <button class="btn sm" @click="onPlanEdit">{{ t('sessions.gate.planEdit') }}</button>
      <button class="btn pri sm" @click="onPlanRun">
        <Icon name="check" />
        {{ t('sessions.gate.planRun') }}
      </button>
    </div>
    <div v-else class="resolved">
      <Icon name="check" />
      {{ t('sessions.gate.planApproved') }}
    </div>
  </div>

  <!-- question — one AskUserQuestion call carries 1–4 questions answered together
       (the sidecar parks once and resumes with the whole set). Multiple questions
       render as tabs: choosing an answer auto-advances; only the last tab submits. -->
  <div
    v-else-if="block.kind === 'question'"
    class="gcard"
    :class="{ gate: !answered && !cancelled }"
  >
    <div class="gh">
      <Icon name="alert" />
      {{ qItems.length > 1 ? t('sessions.gate.questionMulti') : t('sessions.gate.question') }}
    </div>

    <!-- answered → read-only record -->
    <template v-if="answered">
      <div v-for="(it, qi) in qItems" :key="qi" class="qitem">
        <div class="qp">{{ it.prompt }}</div>
        <div class="resolved">
          <Icon name="check" />
          {{ t('sessions.gate.chose', { answer: it.answer ?? '' }) }}
        </div>
      </div>
    </template>

    <!-- cancelled by a turn abort while still parked -->
    <template v-else-if="cancelled">
      <div v-for="(it, qi) in qItems" :key="qi" class="qp">{{ it.prompt }}</div>
      <div class="resolved den">{{ t('sessions.gate.cancelled') }}</div>
    </template>

    <!-- interactive: one tab per question; pick → auto-advance; submit on last -->
    <template v-else>
      <div v-if="forms.length > 1" class="qtabs">
        <button
          v-for="(f, qi) in forms"
          :key="qi"
          class="qtab"
          :class="{ on: qi === active, done: isAnswered(f) }"
          @click="active = qi"
        >
          <Icon v-if="isAnswered(f)" name="check" style="width: 11px; height: 11px" />
          {{ f.item.header || t('sessions.gate.qtab', { n: qi + 1 }) }}
        </button>
      </div>

      <!-- active question body -->
      <template v-for="(f, qi) in forms" :key="qi">
        <div v-if="qi === active" class="qitem">
          <div class="qp">{{ f.item.prompt }}</div>
          <div class="qopts">
            <!-- multi-select → checkboxes (no auto-advance: pick several, then Next) -->
            <template v-if="f.item.multi">
              <label
                v-for="(o, oi) in f.item.options"
                :key="oi"
                class="qchk"
                :class="{ on: f.sel.includes(o.label) }"
                @click="toggle(f, o.label)"
              >
                <span class="qcbox">
                  <Icon
                    v-if="f.sel.includes(o.label)"
                    name="check"
                    style="width: 11px; height: 11px"
                  />
                </span>
                {{ o.label }}
              </label>
            </template>
            <!-- single-select → radio-style buttons; choosing advances to next -->
            <template v-else>
              <button
                v-for="(o, oi) in f.item.options"
                :key="oi"
                class="qopt"
                :class="{ on: f.sel.includes(o.label) }"
                @click="choose(f, qi, o.label)"
              >
                {{ o.label }}
                <b v-if="o.desc">{{ o.desc }}</b>
              </button>
            </template>
            <!-- "Other": free-text answer (always available, like Claude Code's
                 AskUserQuestion). Enter advances / submits. -->
            <input
              v-model="f.other"
              class="qother"
              :placeholder="t('sessions.gate.otherPlaceholder')"
              @keydown.enter="onEnter"
            />
          </div>
        </div>
      </template>

      <div class="cact">
        <button v-if="!isLast" class="btn pri sm" :disabled="!activeAnswered" @click="active++">
          {{ t('sessions.gate.next') }}
        </button>
        <button v-else class="btn pri sm" :disabled="!canSubmit" @click="onSubmit">
          <Icon name="check" />
          {{ t('sessions.gate.submit') }}
        </button>
      </div>
    </template>
  </div>

  <!-- perm -->
  <div
    v-else-if="block.kind === 'perm'"
    class="gcard"
    :class="{ gate: permStatus === 'pending' && !cancelled }"
  >
    <div class="gh">
      <Icon name="shield" />
      {{ t('sessions.gate.permission') }}
    </div>
    <div>
      {{ t('sessions.gate.allowQuestion') }}
      <b>{{ block.tool }}</b>
      {{ t('sessions.gate.on') }}
      <span class="permcode">{{ block.target }}</span>
      ?
    </div>
    <div v-if="cancelled" class="resolved den">{{ t('sessions.gate.cancelled') }}</div>
    <div v-else-if="permStatus === 'pending'" class="cact">
      <button class="btn sm" @click="onDeny">{{ t('sessions.gate.deny') }}</button>
      <button class="btn sm" @click="onAllowAlways">{{ t('sessions.gate.allowAlways') }}</button>
      <button class="btn pri sm" @click="onAllow">
        <Icon name="check" />
        {{ t('sessions.gate.allow') }}
      </button>
    </div>
    <div v-else-if="permStatus === 'allowed'" class="resolved">
      <Icon name="check" />
      {{ t('sessions.gate.allowed') }}
    </div>
    <div v-else class="resolved den">{{ t('sessions.gate.denied') }}</div>
  </div>

  <!-- steer -->
  <div v-else-if="block.kind === 'steer'" class="steernote">
    <Icon name="send" style="width: 12px; height: 12px" />
    {{ t('sessions.gate.steered', { text: block.text || '' }) }}
  </div>

  <!-- error -->
  <div v-else-if="block.kind === 'error'" class="gcard err">
    <div class="gh">
      <Icon name="alert" />
      {{ t('sessions.gate.error') }}
    </div>
    <div style="font-size: 1rem; line-height: 1.5">{{ block.text }}</div>
    <div class="cact">
      <button class="btn pri sm" @click="onRetry">
        <Icon name="refresh" />
        {{ t('sessions.gate.retry') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Gate / status cards (blockHtml ~1466): plan, question (single/multi/answered),
// permission, steer note, error. Wired to the sessions store: each action drives
// the real store (which in turn talks to the sidecar in IPC mode, or mutates the
// mock session locally). The DISPLAY is derived from `props.block` — the store's
// own reactive object — via computeds, so the card never holds shadow status that
// can diverge from the store. Only the per-question in-progress selection
// (`forms` + the active tab) stays local UI working-state until "Submit" commits it.
// Accepts the full block union; only the gate kinds match a branch (others render
// nothing) so the parent's v-else can pass an un-narrowed AssistantBlock cleanly.
import { questionAnswered } from '~/composables/useSessionsData'
import type { AssistantBlock, QuestionItem } from '~/composables/useSessionsData'

const props = defineProps<{ block: AssistantBlock }>()
const { t } = useI18n()
const store = useSessionsStore()

// Locate this card's (sessionId, msgIndex) from the store without new props: the
// block instance lives inside the active session's assistant message. Reactive so
// it tracks the active session. msgIndex = -1 when not found (guard before action).
const sessionId = computed<number | null>(() => store.activeId)
const msgIndex = computed<number>(
  () =>
    store.active?.msgs.findIndex(
      (m) => m.role === 'assistant' && (m.blocks as AssistantBlock[]).includes(props.block),
    ) ?? -1,
)
const located = computed<boolean>(() => sessionId.value != null && msgIndex.value >= 0)

// ── Plan ──────────────────────────────────────────────────────────────────────
// Display approved/pending straight from the block (store flips it on approve).
const planStatus = computed<'pending' | 'approved'>(() =>
  props.block.kind === 'plan' ? (props.block.status ?? 'pending') : 'pending',
)
// Render the model's own markdown when present (headers/lists/bold survive);
// fall back to the flattened items as a bullet list (mock data / legacy steps).
const planMarkdown = computed<string>(() => {
  if (props.block.kind !== 'plan') return ''
  if (props.block.markdown) return props.block.markdown
  return props.block.items.map((x) => `- ${x}`).join('\n')
})
const onPlanRun = (): void => {
  if (!located.value || sessionId.value == null) return
  store.approvePlan(sessionId.value, msgIndex.value)
}
const onPlanEdit = (): void => {
  // Seed the composer with the plan text so the user can refine it before re-asking.
  if (props.block.kind === 'plan') store.seedComposer(planMarkdown.value)
}

// ── Question (AskUserQuestion: 1–4 questions answered together) ───────────────
const qItems = computed<QuestionItem[]>(() =>
  props.block.kind === 'question' ? props.block.items : [],
)
const answered = computed<boolean>(
  () => props.block.kind === 'question' && questionAnswered(props.block),
)
// Per-question working state (chosen labels + free-text "Other"), UI-only until
// Submit. Each question owns one `QForm` so the template iterates defined objects
// (no array-index access). Built once — the card instance is per-block, so the
// question set is fixed for its lifetime.
type QForm = { item: QuestionItem; sel: string[]; other: string }
const forms = ref<QForm[]>(qItems.value.map((item) => ({ item, sel: [], other: '' })))
// Active tab (one per question). Choosing a single-select answer advances to the
// next; the user can also click any tab to jump back.
const active = ref(0)
const isAnswered = (f: QForm): boolean => f.sel.length > 0 || f.other.trim().length > 0
const isLast = computed<boolean>(() => active.value >= forms.value.length - 1)
const activeAnswered = computed<boolean>(() => {
  const f = forms.value[active.value]
  return !!f && isAnswered(f)
})
const choose = (f: QForm, qi: number, label: string): void => {
  f.sel = [label] // single-select: replace
  if (qi < forms.value.length - 1) active.value = qi + 1 // auto-advance
}
const toggle = (f: QForm, label: string): void => {
  const i = f.sel.indexOf(label)
  if (i === -1) f.sel.push(label)
  else f.sel.splice(i, 1)
}
// Enter in the "Other" field advances when valid (or submits on the last tab).
const onEnter = (): void => {
  if (isLast.value) onSubmit()
  else if (activeAnswered.value) active.value += 1
}
// Submit needs every question to have at least one option or free-text answer.
const canSubmit = computed<boolean>(() =>
  forms.value.every((f) => f.sel.length > 0 || f.other.trim().length > 0),
)
const onSubmit = (): void => {
  if (!located.value || sessionId.value == null || !canSubmit.value) return
  const answers = forms.value.map((f) => {
    const selected = [...f.sel]
    const extra = f.other.trim()
    if (extra) selected.push(extra)
    return { header: f.item.header ?? '', selected }
  })
  store.answerQuestion(sessionId.value, msgIndex.value, answers)
}

// ── Permission ────────────────────────────────────────────────────────────────
// allowed/denied/pending derived from the block (store flips it on resolve).
const permStatus = computed<'pending' | 'allowed' | 'denied'>(() =>
  props.block.kind === 'perm' ? (props.block.status ?? 'pending') : 'pending',
)
// A parked gate (question/perm) abandoned by a turn cancel → render as cancelled,
// not interactive (the store sets `cancelled` and stops counting it as awaiting).
const cancelled = computed(
  () =>
    (props.block.kind === 'question' || props.block.kind === 'perm') &&
    props.block.cancelled === true,
)
const onAllow = (): void => {
  if (!located.value || sessionId.value == null) return
  store.setPermission(sessionId.value, msgIndex.value, 'allow')
}
// Allow + remember: the engine applies the request's permission suggestions to a
// session-scoped allowlist so this tool stops prompting for the rest of the session.
const onAllowAlways = (): void => {
  if (!located.value || sessionId.value == null) return
  store.setPermission(sessionId.value, msgIndex.value, 'allow', true)
}
const onDeny = (): void => {
  if (!located.value || sessionId.value == null) return
  store.setPermission(sessionId.value, msgIndex.value, 'deny')
}

// ── Error ─────────────────────────────────────────────────────────────────────
const onRetry = (): void => {
  if (!located.value || sessionId.value == null) return
  store.regenerate(sessionId.value, msgIndex.value)
}
</script>

<style scoped>
/* Plan body = the model's markdown rendered as a document (SessionTextBlock).
   Replaces the old flat <ul> so headers/nested lists/bold/code survive. Breathing
   room from the approve/edit row (.cact mt:12) and the approved confirmation. */
.planbody {
  margin-bottom: 6px;
}
/* Submit stays disabled until every question has an answer. */
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* Selected single-select option mirrors the multi-select .qchk.on accent. */
.qopt.on {
  border-color: var(--accent);
}
/* Separate stacked questions (answered / cancelled read-only views). */
.qitem + .qitem {
  margin-top: 14px;
}
/* Tab strip — one tab per question. Active/answered use an accent tint (not a
   gray surface fill), per the segmented-control convention. */
.qtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 11px;
}
.qtab {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 1rem;
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.qtab:hover {
  border-color: var(--accent);
  color: var(--text);
}
.qtab.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.qtab.done :deep(.icn) {
  color: var(--accent);
}
</style>
