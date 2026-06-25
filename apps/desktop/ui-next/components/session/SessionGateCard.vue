<template>
  <!-- plan -->
  <div v-if="block.kind === 'plan'" class="gcard" :class="{ gate: planStatus === 'pending' }">
    <div class="gh">
      <Icon name="rules" />
      {{ t('sessions.gate.plan') }}
    </div>
    <ul class="planlist">
      <li v-for="(x, i) in block.items" :key="i">{{ x }}</li>
    </ul>
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

  <!-- question -->
  <template v-else-if="block.kind === 'question'">
    <div v-if="!block.multi && answer" class="gcard">
      <div class="gh">
        <Icon name="alert" />
        {{ t('sessions.gate.question') }}
      </div>
      <div class="qp">{{ block.prompt }}</div>
      <div class="resolved">
        <Icon name="check" />
        {{ t('sessions.gate.chose', { answer }) }}
      </div>
    </div>
    <div v-else-if="block.multi && answer" class="gcard">
      <div class="gh">
        <Icon name="alert" />
        {{ t('sessions.gate.questionMulti') }}
      </div>
      <div class="qp">{{ block.prompt }}</div>
      <div class="resolved">
        <Icon name="check" />
        {{ t('sessions.gate.chose', { answer }) }}
      </div>
    </div>
    <div v-else-if="block.multi" class="gcard gate">
      <div class="gh">
        <Icon name="alert" />
        {{ t('sessions.gate.questionMulti') }}
      </div>
      <div class="qp">{{ block.prompt }}</div>
      <div class="qopts">
        <label
          v-for="(o, i) in block.options"
          :key="i"
          class="qchk"
          :class="{ on: sel.includes(o.label) }"
          @click="toggleSel(o.label)"
        >
          <span class="qcbox">
            <Icon v-if="sel.includes(o.label)" name="check" style="width: 11px; height: 11px" />
          </span>
          {{ o.label }}
        </label>
        <input v-model="other" class="qother" :placeholder="t('sessions.gate.otherPlaceholder')" />
      </div>
      <div class="cact">
        <button class="btn pri sm" @click="onContinue">
          <Icon name="check" />
          {{ t('sessions.gate.continue') }}
        </button>
      </div>
    </div>
    <div v-else class="gcard gate">
      <div class="gh">
        <Icon name="alert" />
        {{ t('sessions.gate.question') }}
      </div>
      <div class="qp">{{ block.prompt }}</div>
      <div class="qopts">
        <button v-for="(o, i) in block.options" :key="i" class="qopt" @click="onChoose(o.label)">
          {{ o.label }}
          <b v-if="o.desc">{{ o.desc }}</b>
        </button>
        <!-- "Other": free-text answer (always available, like Claude Code's
             AskUserQuestion). Enter or the Submit button sends the typed answer. -->
        <input
          v-model="other"
          class="qother"
          :placeholder="t('sessions.gate.otherPlaceholder')"
          @keydown.enter="onOtherSubmit"
        />
      </div>
      <div class="cact">
        <button class="btn pri sm" :disabled="!other.trim()" @click="onOtherSubmit">
          <Icon name="check" />
          {{ t('sessions.gate.submit') }}
        </button>
      </div>
    </div>
  </template>

  <!-- perm -->
  <div v-else-if="block.kind === 'perm'" class="gcard" :class="{ gate: permStatus === 'pending' }">
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
    <div v-if="permStatus === 'pending'" class="cact">
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
// can diverge from the store. Only the multi-select in-progress selection
// (sel/other) stays local UI working-state until "Continue" commits it.
// Accepts the full block union; only the gate kinds match a branch (others render
// nothing) so the parent's v-else can pass an un-narrowed AssistantBlock cleanly.
import type { AssistantBlock } from '~/composables/useSessionsMock'

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
const onPlanRun = (): void => {
  if (!located.value || sessionId.value == null) return
  store.approvePlan(sessionId.value, msgIndex.value)
}
const onPlanEdit = (): void => {
  // Seed the composer with the plan text so the user can refine it before re-asking.
  if (props.block.kind === 'plan') store.seedComposer(props.block.items.join('\n'))
}

// ── Question (single) ───────────────────────────────────────────────────────────
// Answered label comes from the block; choosing commits via the store.
const answer = computed<string | null>(() =>
  props.block.kind === 'question' ? (props.block.answer ?? null) : null,
)
const onChoose = (label: string): void => {
  if (!located.value || sessionId.value == null) return
  store.answerQuestion(sessionId.value, msgIndex.value, label)
}
// "Other" free-text answer for a single-select question (Enter to submit).
const onOtherSubmit = (): void => {
  if (!located.value || sessionId.value == null) return
  const extra = other.value.trim()
  if (!extra) return
  store.answerQuestion(sessionId.value, msgIndex.value, extra)
}

// ── Question (multi) ──────────────────────────────────────────────────────────
// Local working-state for the in-progress selection (UI-only) until "Continue".
const sel = ref<string[]>(
  props.block.kind === 'question' && props.block.sel ? [...props.block.sel] : [],
)
const other = ref(props.block.kind === 'question' ? (props.block.other ?? '') : '')
const toggleSel = (label: string): void => {
  const i = sel.value.indexOf(label)
  if (i === -1) sel.value.push(label)
  else sel.value.splice(i, 1)
}
const onContinue = (): void => {
  if (!located.value || sessionId.value == null) return
  const parts = [...sel.value]
  const extra = other.value.trim()
  if (extra) parts.push(extra)
  store.answerQuestion(sessionId.value, msgIndex.value, parts.join(', '))
}

// ── Permission ────────────────────────────────────────────────────────────────
// allowed/denied/pending derived from the block (store flips it on resolve).
const permStatus = computed<'pending' | 'allowed' | 'denied'>(() =>
  props.block.kind === 'perm' ? (props.block.status ?? 'pending') : 'pending',
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
/* Submit button is disabled until the "Other" free-text has content. */
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
