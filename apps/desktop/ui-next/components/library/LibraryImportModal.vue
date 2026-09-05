<template>
  <LibraryEntityModal
    :open="open"
    :title="t(`library.import.title.${kind}`)"
    :width="620"
    :lock-scrim="importing"
    @close="emit('close')"
  >
    <div class="lim">
      <div class="lim-sub">{{ t('library.import.subtitle') }}</div>

      <div v-if="scanning" class="lim-state">{{ t('library.import.scanning') }}</div>
      <div v-else-if="!candidates.length" class="lim-state">
        {{ t('library.import.empty') }}
      </div>

      <template v-else>
        <button type="button" class="lim-selectall" @click="toggleAll">
          {{ allSelected ? t('library.import.deselectAll') : t('library.import.selectAll') }}
        </button>
        <div class="lim-list">
          <template v-for="g in groups" :key="g.key">
            <div class="lim-grp">
              <span
                class="pdot"
                :style="{ background: g.key ? 'var(--accent)' : 'var(--textDim)' }"
              />
              <span class="lim-grp-nm">{{ groupLabel(g.key) }}</span>
              <span class="lim-grp-ct">{{ g.items.length }}</span>
            </div>
            <label v-for="c in g.items" :key="candidateKey(c)" class="lim-item">
              <input
                type="checkbox"
                class="lim-check"
                :checked="selected.has(candidateKey(c))"
                @change="toggle(candidateKey(c))"
              />
              <span class="lim-item-tx">
                <span class="lim-item-nm">{{ c.name || c.id }}</span>
                <span class="lim-item-sub mono">{{ sourceLabel(c) }} · {{ c.id }}</span>
              </span>
            </label>
          </template>
        </div>
      </template>
    </div>

    <template #footer>
      <span class="lim-count">{{ t('library.import.selectedCount', { n: selected.size }) }}</span>
      <span style="flex: 1" />
      <button class="btn" :disabled="importing" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
      <button class="btn pri" :disabled="!selected.size || importing" @click="confirm">
        {{ importing ? t('library.import.importing') : t('library.import.action') }}
      </button>
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

<style scoped>
.lim {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lim-sub {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.5;
}
.lim-state {
  font-size: 0.9231rem;
  color: var(--textDim);
  text-align: center;
  padding: 18px 0;
}
.lim-selectall {
  align-self: flex-start;
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: 0.8846rem;
  cursor: pointer;
  padding: 2px 0;
}
/* Flat hairline list — one bordered surface, rows split by a 1px divider. */
.lim-list {
  display: flex;
  flex-direction: column;
  max-height: 48vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.lim-grp {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  background: var(--bgHover);
  color: var(--textDim);
  font-size: 0.8462rem;
}
.lim-grp:not(:first-child) {
  border-top: 1px solid var(--border);
}
.lim-grp-nm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lim-grp-ct {
  font-family: var(--mono, monospace);
  font-size: 12px;
  line-height: 1;
}
.lim-item {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 12px;
  cursor: pointer;
  transition: background 0.12s;
  border-top: 1px solid var(--border);
}
.lim-item:hover {
  background: var(--bgHover);
}
.lim-check {
  margin-top: 3px;
  flex: 0 0 auto;
  accent-color: var(--accent);
}
.lim-item-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.lim-item-nm {
  font-size: 0.9231rem;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}
.lim-item-sub {
  font-size: 0.8462rem;
  color: var(--textDim);
  word-break: break-all;
}
.lim-count {
  font-size: 0.8846rem;
  color: var(--textDim);
}
</style>
