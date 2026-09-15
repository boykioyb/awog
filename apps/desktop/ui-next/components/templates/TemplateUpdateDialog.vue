<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templatesUpdate.title')"
    :lock-scrim="applying"
    :width="600"
    @close="emit('close')"
  >
    <div class="tud">
      <div class="tud-meta">
        <div class="tud-name">{{ templateName }}</div>
        <div class="tud-versions">
          <span class="chip">{{ check.currentVersion || t('templatesUpdate.unversioned') }}</span>
          <Icon name="chev-right" class="tud-arrow" />
          <span class="chip tud-next">
            {{ check.remoteVersion || t('templatesUpdate.unversioned') }}
          </span>
        </div>
      </div>
      <div v-if="check.sourceUrl" class="tud-src mono">{{ check.sourceUrl }}</div>

      <div v-if="conflicts.length" class="tud-warn">
        <Icon name="alert" class="tud-warn-icn" />
        <div>
          <div class="tud-warn-hd">
            {{ t('templatesUpdate.conflicts', { n: conflicts.length }) }}
          </div>
          <div class="tud-warn-txt">{{ t('templatesUpdate.conflictHint') }}</div>
        </div>
      </div>

      <div class="tud-section">
        <div class="tud-section-hd">{{ t('templatesUpdate.changes') }}</div>
        <div v-if="!changed.length" class="tud-empty">{{ t('templatesUpdate.noChanges') }}</div>
        <div v-for="row in changed" :key="rowKey(row)" class="tud-row">
          <span class="tud-badge" :data-status="row.status">
            {{ t('templatesUpdate.status.' + row.status) }}
          </span>
          <span class="tud-kind">{{ t('templates.kind.' + row.kind) }}</span>
          <span class="tud-id mono">{{ row.id }}</span>
          <span v-if="row.localModified" class="tud-local">
            {{ t('templatesUpdate.localModified') }}
          </span>
          <span style="flex: 1" />
          <AppSelect
            v-if="row.conflict"
            :model-value="choiceOf(row)"
            :options="choiceOptions"
            width="170px"
            @update:model-value="setChoice(row, $event)"
          />
        </div>
      </div>

      <div class="tud-hint">{{ t('templatesUpdate.reinstallHint') }}</div>
      <div v-if="error" class="tud-error">{{ error }}</div>
    </div>

    <template #footer>
      <button class="btn" :disabled="applying" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
      <button class="btn pri" :disabled="applying || !changed.length" @click="onApply">
        {{ applying ? t('templatesUpdate.applying') : t('templatesUpdate.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Update-template dialog (WP10) — shows what the source changed BEFORE anything
// is written, and forces an explicit decision on every entity the user edited
// locally that the source also touched.
//
// The engine is the authority on conflicts: it re-diffs on `templates.update`
// and answers `status: 'conflicts'` if the source moved while the dialog was
// open. That answer replaces the rendered list instead of being swallowed.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import {
  useTemplatesStore,
  type ConflictChoice,
  type TemplateEntityDiff,
  type TemplateUpdateCheck,
  type TemplateUpdateResult,
} from '~/stores/templates'

const props = defineProps<{
  open: boolean
  templateName: string
  check: TemplateUpdateCheck
}>()

const emit = defineEmits<{
  close: []
  updated: [TemplateUpdateResult]
}>()

const { t } = useI18n()
const store = useTemplatesStore()

// Local copy of the verdict: the engine may hand back a fresher conflict list.
const check = ref<TemplateUpdateCheck>(props.check)
const applying = ref(false)
const error = ref('')
// Conflict decisions, keyed `kind/id`. Default is the safe one: keep what the
// user wrote — an update must never be the thing that loses their edits.
const choices = ref<Record<string, ConflictChoice>>({})

const rowKey = (row: TemplateEntityDiff): string => `${row.kind}/${row.id}`

const reset = (next: TemplateUpdateCheck) => {
  check.value = next
  error.value = ''
  applying.value = false
  const seed: Record<string, ConflictChoice> = {}
  for (const e of next.entities) if (e.conflict) seed[rowKey(e)] = 'keepLocal'
  choices.value = seed
}

watch(
  () => [props.open, props.check] as const,
  ([isOpen]) => {
    if (isOpen) reset(props.check)
  },
  { immediate: true },
)

// Unchanged entities are noise here — the dialog answers "what will change?".
const changed = computed(() => check.value.entities.filter((e) => e.status !== 'unchanged'))
const conflicts = computed(() => check.value.entities.filter((e) => e.conflict))

const choiceOptions = computed<AppSelectOption[]>(() => [
  { value: 'keepLocal', label: t('templatesUpdate.choice.keepLocal') },
  { value: 'takeRemote', label: t('templatesUpdate.choice.takeRemote') },
])

const choiceOf = (row: TemplateEntityDiff): string => choices.value[rowKey(row)] ?? 'keepLocal'

const setChoice = (row: TemplateEntityDiff, value: string) => {
  choices.value[rowKey(row)] = value === 'takeRemote' ? 'takeRemote' : 'keepLocal'
}

const onApply = async () => {
  if (applying.value) return
  applying.value = true
  error.value = ''
  try {
    const result = await store.update(
      check.value.id,
      conflicts.value.map((row) => ({
        kind: row.kind,
        id: row.id,
        choice: choiceOf(row) === 'takeRemote' ? ('takeRemote' as const) : ('keepLocal' as const),
      })),
    )
    if (result.status === 'conflicts') {
      // Source moved mid-decision: re-render with the fresh list, write nothing.
      reset({ ...check.value, entities: result.conflicts, conflicts: result.conflicts.length })
      error.value = t('templatesUpdate.staleConflicts')
      return
    }
    emit('updated', result)
    emit('close')
  } catch (err) {
    error.value = t('templatesUpdate.failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  } finally {
    applying.value = false
  }
}
</script>

<style scoped>
.tud {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tud-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tud-name {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.tud-versions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tud-arrow {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--textDim);
}
.tud-next {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.tud-src {
  /* mono-ok: URL người dùng copy-paste được */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  word-break: break-all;
}
.tud-warn {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
}
.tud-warn-icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--amber);
  flex: 0 0 auto;
  margin-top: 2px;
}
.tud-warn-hd {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.tud-warn-txt {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.tud-section-hd {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
  margin-bottom: 8px;
}
.tud-empty {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.tud-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}
.tud-badge {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  padding: 2px 7px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  color: var(--textMuted);
  flex: 0 0 auto;
}
.tud-badge[data-status='added'] {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.tud-badge[data-status='removed'] {
  color: var(--danger);
  border-color: var(--danger);
}
.tud-kind {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.tud-id {
  /* mono-ok: id entity trùng tên file trên đĩa */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.tud-local {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}
.tud-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.tud-error {
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
