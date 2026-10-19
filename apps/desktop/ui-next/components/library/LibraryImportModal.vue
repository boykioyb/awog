<template>
  <LibraryEntityModal
    :open="open"
    :title="t(`library.import.title.${kind}`)"
    :width="620"
    :lock-scrim="importing"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <div class="text-sm text-dim">{{ t('library.import.subtitle') }}</div>

      <div v-if="scanning" class="py-4.5 text-center text-sm text-dim">
        {{ t('library.import.scanning') }}
      </div>
      <div v-else-if="!candidates.length" class="py-4.5 text-center text-sm text-dim">
        {{ t('library.import.empty') }}
      </div>

      <template v-else>
        <Button variant="link" size="xs" class="self-start px-0" @click="toggleAll">
          {{ allSelected ? t('library.import.deselectAll') : t('library.import.selectAll') }}
        </Button>
        <!-- Một bề mặt viền hairline, các hàng chia bằng đường 1px. -->
        <div class="flex max-h-[48vh] flex-col overflow-y-auto rounded-lg border">
          <template v-for="(g, gi) in groups" :key="g.key">
            <div
              class="flex items-center gap-2 bg-muted px-3 py-2 text-xs text-dim"
              :class="{ 'border-t': gi > 0 }"
            >
              <span class="size-2 flex-none rounded-sm" :class="g.key ? 'bg-primary' : 'bg-dim'" />
              <span class="min-w-0 truncate">{{ groupLabel(g.key) }}</span>
              <span class="text-sm tabular-nums">{{ g.items.length }}</span>
            </div>
            <label
              v-for="c in g.items"
              :key="candidateKey(c)"
              class="flex cursor-pointer items-start gap-3 border-t px-3 py-3 transition-colors hover:bg-accent"
            >
              <Checkbox
                class="mt-0.5"
                :model-value="selected.has(candidateKey(c))"
                @update:model-value="toggle(candidateKey(c))"
              />
              <span class="flex min-w-0 flex-col gap-1">
                <span class="text-sm font-semibold break-all text-foreground">
                  {{ c.name || c.id }}
                </span>
                <!-- mono-ok: đường dẫn nguồn + id -->
                <span class="font-mono text-xs break-all text-dim">
                  {{ sourceLabel(c) }} · {{ c.id }}
                </span>
              </span>
            </label>
          </template>
        </div>
      </template>
    </div>

    <template #footer>
      <span class="mr-auto text-sm text-dim">
        {{ t('library.import.selectedCount', { n: selected.size }) }}
      </span>
      <Button :disabled="importing" variant="outline" @click="emit('close')">
        {{ t('common.cancel') }}
      </Button>
      <Button :disabled="!selected.size || importing" variant="default" @click="confirm">
        {{ importing ? t('library.import.importing') : t('library.import.action') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Config-import picker for a library page (ADR 0035 / config-import-assistant).
// Opens from the library toolbar, sweeps every legacy source scope for this
// page's kind (global `~/.claude`+`~/.agents` and each project's `.claude`/
// `.agents`), and copies the ticked items into `.awog`. Non-destructive: sources
// are left untouched and items already present in `.awog` never show up.
import { watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { ImportCandidate } from '~/composables/useConfigImport'
import { candidateKey, useLibraryImport } from '~/composables/useLibraryImport'
import { useProjects } from '~/composables/useProjects'
import type { ConfigKind } from '~/stores/templates'
import Button from '~/components/ui/button/Button.vue'
import Checkbox from '~/components/ui/checkbox/Checkbox.vue'

const props = defineProps<{
  open: boolean
  kind: ConfigKind
}>()

const emit = defineEmits<{
  close: []
  // Number of items actually copied into `.awog` — the page re-hydrates on this.
  imported: [n: number]
}>()

const { t } = useI18n()
const { projectName } = useProjects()

const {
  candidates,
  groups,
  selected,
  allSelected,
  scanning,
  importing,
  scan,
  toggle,
  toggleAll,
  importSelected,
} = useLibraryImport(() => props.kind)

// Re-scan on every open so the list reflects the sources as they are right now.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void scan()
  },
  { immediate: true },
)

// Group header = the `.awog` tier the items land in (mirrors the library list's
// own grouping); '' is the global tier.
const groupLabel = (key: string): string => (key ? projectName(key) : t('library.group.global'))

// Source path shown per row. Global candidates carry a repo-relative label
// (`.claude/agents`), so anchor them at `~` unless they already are.
const sourceLabel = (c: ImportCandidate): string =>
  c.targetScope === 'global' && !c.fromLabel.startsWith('~/') ? `~/${c.fromLabel}` : c.fromLabel

const confirm = async (): Promise<void> => {
  const n = await importSelected()
  emit('imported', n)
}
</script>
