<template>
  <!-- One app-lifetime host (mounted in the layout) bound to the useConfirm()
       singleton. Plain confirms reuse the shared LibraryConfirmDelete visual so
       every confirm — library deletes AND imperative confirm() callers — looks
       identical; `kind: 'infra'` payloads render the infrastructure card below. -->
  <LibraryConfirmDelete
    :open="state.open && !infra"
    :title="state.title"
    :description="state.description"
    :kind="state.kind"
    :confirm-label="state.confirmLabel"
    :cancel-label="state.cancelLabel"
    @confirm="settle(true)"
    @cancel="settle(false)"
  />

  <Teleport to="body">
    <div v-if="isOpen" class="ovl on icd-ovl" @click.self="settle(false)">
      <div
        class="icd-card"
        :class="{ prod: isProduction }"
        role="dialog"
        aria-modal="true"
        :aria-label="titleText"
      >
        <!-- 1 — action + target -->
        <div class="icd-head">
          <Icon :name="isBlocked ? 'shield' : 'alert'" class="icd-icn" :class="{ dgr: isDanger }" />
          <span class="icd-title">{{ titleText }}</span>
        </div>

        <!-- 2 — the consequence, in plain language. Never a command line. -->
        <p class="icd-conseq">{{ consequence }}</p>

        <!-- 3 — pinned context + the always-on "this gets logged" chip -->
        <div class="icd-chips">
          <span v-if="isProduction" class="icd-chip dgr">
            <Icon name="alert" class="icd-chip-icn" />
            {{ t('infra.confirm.production') }}
          </span>
          <span v-for="chip in contextChips" :key="chip.key" class="icd-chip">
            <span class="icd-chip-k">{{ chip.label }}</span>
            {{ chip.value }}
          </span>
          <span class="icd-chip">
            <Icon name="book" class="icd-chip-icn" />
            {{ t('infra.confirm.logged') }}
          </span>
        </div>

        <p v-if="isBlocked" class="icd-blocked">{{ t('infra.confirm.blocked') }}</p>

        <!-- 4 — the command itself, collapsed -->
        <details class="icd-tech">
          <summary class="icd-tech-sum">
            <Icon name="chev-right" class="icd-tech-chev" />
            {{ t('infra.confirm.tech') }}
          </summary>
          <pre class="icd-cmd">{{ command }}</pre>
        </details>

        <div v-if="needsTyping" class="icd-type">
          <label class="icd-type-lbl" for="icd-type-input">
            {{ t('infra.confirm.typeToConfirm', { name: typeWord }) }}
          </label>
          <input
            id="icd-type-input"
            ref="typeInput"
            v-model="typed"
            class="icd-input"
            autocomplete="off"
            spellcheck="false"
            :placeholder="typeWord"
            @keydown.enter.prevent="onPrimary"
          />
        </div>

        <!-- 5 — footer per variant -->
        <div class="icd-foot">
          <template v-if="isBlocked">
            <button class="btn" @click="copyCommand">
              <Icon name="copy" />
              {{ copied ? t('common.copied') : t('infra.confirm.copyCommand') }}
            </button>
            <button ref="primaryBtn" class="btn pri" @click="settle(false)">
              {{ t('common.close') }}
            </button>
          </template>
          <template v-else-if="isRead">
            <button ref="primaryBtn" class="btn pri" @click="settle(true)">
              {{ t('infra.confirm.run') }}
            </button>
          </template>
          <template v-else>
            <button class="btn" @click="settle(false)">{{ t('common.cancel') }}</button>
            <button
              ref="primaryBtn"
              class="btn"
              :class="isDanger ? 'icd-dgr-btn' : 'pri'"
              :disabled="!canConfirm"
              @click="onPrimary"
            >
              {{ t('common.confirm') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Host for both confirm shapes (see useConfirm.ts). The infra card is built here
// rather than by each caller so every infrastructure surface — Explorer buttons,
// the agent's `infra_action` gate, playbooks — asks the same question the same way
// (ADR 0088 §5, infra-explorer "Hành động ghi: luật chung"):
//   consequence in plain language → context chips → collapsed command → footer.
// The footer is the only thing the command class changes:
//   read        → one Run button        write       → Confirm + Cancel
//   destructive → retype the name first  blocked     → copy the command, no run
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'

const { state, settle } = useConfirm()
const { t } = useI18n()

const infra = computed(() => state.infra)
const isOpen = computed(() => state.open && !!infra.value)

const titleText = computed(() =>
  infra.value
    ? t('infra.confirm.title', { action: infra.value.action, target: infra.value.target })
    : '',
)
const consequence = computed(() => infra.value?.consequence ?? '')
const command = computed(() => infra.value?.command ?? '')
const isProduction = computed(() => infra.value?.accountKind === 'production')
const isBlocked = computed(() => infra.value?.blocked === true)
const isRead = computed(() => infra.value?.class === 'read')
// Red chrome for the two cases worth stopping at: a destructive class, or anything
// at all on a production account.
const isDanger = computed(() => infra.value?.class === 'destructive' || isProduction.value)

// Context chips, account first (the question people actually ask is "which
// account?"). Order is fixed so two dialogs never read differently.
const CONTEXT_KEYS = ['accountId', 'profile', 'region', 'cluster', 'namespace'] as const

const contextChips = computed(() => {
  const ctx = infra.value?.context
  if (!ctx) return []
  return CONTEXT_KEYS.filter((key) => !!ctx[key]).map((key) => ({
    key,
    label: t(`infra.confirm.ctx.${key}`),
    value: ctx[key] as string,
  }))
})

// A destructive action is never ungated: with no explicit `typeToConfirm` the
// target's own name becomes the word to retype.
const typeWord = computed(() => infra.value?.typeToConfirm || infra.value?.target || '')
const needsTyping = computed(
  () => !isBlocked.value && infra.value?.class === 'destructive' && !!typeWord.value,
)

const typed = ref('')
// Exact match (GitHub's "type the repo name" rule): a case-insensitive compare on
// resource names that differ only by case would wave through the wrong resource.
const canConfirm = computed(
  () => !isBlocked.value && (!needsTyping.value || typed.value.trim() === typeWord.value),
)

function onPrimary() {
  if (!canConfirm.value) return
  settle(true)
}

const copied = ref(false)
let copyTimer: number | undefined

async function copyCommand() {
  await navigator.clipboard.writeText(command.value)
  copied.value = true
  window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

const typeInput = useTemplateRef<HTMLInputElement>('typeInput')
const primaryBtn = useTemplateRef<HTMLButtonElement>('primaryBtn')

// Reset the per-open state, then park focus where the next keystroke belongs: the
// retype field when there is one, the safe default button otherwise. Keyed on the
// PAYLOAD, not on `isOpen`: opening a second infra confirm over a pending one keeps
// `isOpen` true the whole time, and that dialog must not inherit the first one's
// half-typed resource name.
watch(infra, (payload) => {
  if (!payload) return
  typed.value = ''
  copied.value = false
  nextTick(() => (needsTyping.value ? typeInput.value?.focus() : primaryBtn.value?.focus()))
})

// Esc closes. LibraryConfirmDelete owns its own listener but only while ITS `open`
// prop is true, so the two never both fire.
function onKey(e: KeyboardEvent) {
  if (isOpen.value && e.key === 'Escape') settle(false)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.clearTimeout(copyTimer)
})
</script>

<style scoped>
/* Center the card (the shared .ovl aligns to top for the command palette), and match
   LibraryConfirmDelete's z-index so an infra confirm raised from inside another modal
   stacks above it. */
.icd-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 200;
}
.icd-card {
  width: 480px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
/* Production: the whole box is outlined red, not just a word inside it. */
.icd-card.prod {
  border-color: var(--dangerBorder);
  box-shadow:
    0 0 0 1px var(--dangerBorder),
    0 30px 80px rgba(0, 0, 0, 0.6);
}
.icd-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.icd-icn {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  color: var(--accent);
}
.icd-icn.dgr {
  color: var(--danger);
}
.icd-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.icd-conseq {
  margin: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  color: var(--text);
}
.icd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.icd-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgSubtle);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.icd-chip.dgr {
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  color: var(--danger);
  font-weight: 650;
}
.icd-chip-k {
  color: var(--textDim);
}
.icd-chip-icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
.icd-blocked {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--dangerBorder);
  border-radius: var(--r-sm);
  background: var(--dangerDim);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.icd-tech {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
}
.icd-tech-sum {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  list-style: none;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.icd-tech-sum::-webkit-details-marker {
  display: none;
}
.icd-tech-chev {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  transition: transform var(--dur-fast) var(--ease);
}
.icd-tech[open] .icd-tech-chev {
  transform: rotate(90deg);
}
.icd-cmd {
  margin: 0;
  padding: 0 10px 10px;
  /* mono-ok: dòng lệnh CLI thật — người dùng copy thẳng vào terminal khi bị chặn */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
.icd-type {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.icd-type-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.icd-input {
  width: 100%;
  padding: 8px 11px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-family: var(--sans);
}
.icd-input:focus {
  border-color: var(--danger);
}
.icd-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.icd-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.icd-dgr-btn {
  background: var(--danger);
  color: var(--bg);
  border-color: transparent;
  font-weight: 650;
}
</style>
