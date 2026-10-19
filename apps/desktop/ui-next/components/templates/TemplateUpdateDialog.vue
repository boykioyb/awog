<template>
  <LibraryEntityModal
    :open="open"
    :title="t('templatesUpdate.title')"
    :lock-scrim="applying"
    :width="600"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="flex items-center gap-2.5">
        <div class="text-base font-semibold text-foreground">{{ templateName }}</div>
        <div class="flex items-center gap-1.5">
          <Badge variant="outline" class="rounded-sm text-muted-foreground">
            {{ check.currentVersion || t('templatesUpdate.unversioned') }}
          </Badge>
          <Icon name="chev-right" class="size-3 text-dim" />
          <Badge variant="outline" class="rounded-sm border-selected-border text-primary">
            {{ check.remoteVersion || t('templatesUpdate.unversioned') }}
          </Badge>
        </div>
      </div>
      <div v-if="check.sourceUrl" class="font-mono text-xs break-all text-dim">
        {{ check.sourceUrl }}
      </div>

      <Alert v-if="conflicts.length" class="border-warning/40 bg-warning/10 [&>svg]:text-warning">
        <Icon name="alert" />
        <AlertTitle class="line-clamp-none font-semibold text-foreground">
          {{ t('templatesUpdate.conflicts', { n: conflicts.length }) }}
        </AlertTitle>
        <AlertDescription class="text-xs">
          {{ t('templatesUpdate.conflictHint') }}
        </AlertDescription>
      </Alert>

      <div>
        <div class="mb-2 text-xs font-semibold text-dim">{{ t('templatesUpdate.changes') }}</div>
        <div v-if="!changed.length" class="text-sm text-dim">
          {{ t('templatesUpdate.noChanges') }}
        </div>
        <div
          v-for="row in changed"
          :key="rowKey(row)"
          class="flex items-center gap-2 border-t py-1.5"
        >
          <Badge variant="outline" class="shrink-0 rounded-sm" :class="statusClass(row.status)">
            {{ t('templatesUpdate.status.' + row.status) }}
          </Badge>
          <span class="text-xs text-dim">{{ t('templates.kind.' + row.kind) }}</span>
          <span class="font-mono text-sm text-foreground">{{ row.id }}</span>
          <span v-if="row.localModified" class="text-xs text-warning">
            {{ t('templatesUpdate.localModified') }}
          </span>
          <span class="flex-1" />
          <AppSelect
            v-if="row.conflict"
            :model-value="choiceOf(row)"
            :options="choiceOptions"
            width="170px"
            @update:model-value="setChoice(row, $event)"
          />
        </div>
      </div>

      <div class="text-xs text-dim">{{ t('templatesUpdate.reinstallHint') }}</div>
      <div
        v-if="error"
        class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
      </div>
    </div>

    <template #footer>
      <Button :disabled="applying" variant="outline" @click="emit('close')">
        {{ t('common.cancel') }}
      </Button>
      <Button :disabled="applying || !changed.length" variant="default" @click="onApply">
        {{ applying ? t('templatesUpdate.applying') : t('templatesUpdate.apply') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
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

// Màu badge theo trạng thái diff: thêm = brand, xoá = đỏ, còn lại = viền trung tính.
const statusClass = (status: TemplateEntityDiff['status']): string => {
  if (status === 'added') return 'border-selected-border text-primary'
  if (status === 'removed') return 'border-destructive text-destructive'
  return 'text-muted-foreground'
}

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
