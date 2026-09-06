<template>
  <LibraryEntityModal
    :open="open"
    :title="t('ssh.import.title')"
    :width="600"
    @close="emit('close')"
  >
    <div class="ssp">
      <div class="ssp-sub">{{ t('ssh.import.subtitle') }}</div>

      <div v-if="loading" class="ssp-state">{{ t('ssh.import.loading') }}</div>
      <div v-else-if="!candidates.length" class="ssp-state">{{ t('ssh.import.empty') }}</div>

      <template v-else>
        <button type="button" class="ssp-selectall" @click="toggleAll">
          {{ allSelected ? t('ssh.import.deselectAll') : t('ssh.import.selectAll') }}
        </button>
        <div class="ssp-list">
          <label v-for="c in candidates" :key="c.alias" class="ssp-item">
            <input
              type="checkbox"
              class="ssp-check"
              :checked="selected.has(c.alias)"
              @change="toggle(c.alias)"
            />
            <span class="ssp-item-tx">
              <span class="ssp-item-nm">{{ c.alias }}</span>
              <span class="ssp-item-sub mono">{{ endpoint(c) }}</span>
              <span v-if="c.proxyJump" class="ssp-item-sub mono">
                {{ t('ssh.import.viaJump', { jump: c.proxyJump }) }}
              </span>
            </span>
          </label>
        </div>
      </template>
    </div>

    <template #footer>
      <span class="ssp-count">{{ t('ssh.import.selectedCount', { n: selected.size }) }}</span>
      <span style="flex: 1" />
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!selected.size" @click="confirm">
        {{ t('ssh.import.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// SSH import picker (ADR 0063 P1) — lists the dry-run candidates parsed from
// ~/.ssh/config (ssh.importConfig) with checkboxes. Confirm emits the selected
// aliases; the page applies them (ssh.importConfigApply). Re-opening resets the
// selection to all candidates so the common "import everything" path is one click.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { SshConfigCandidate } from '~/stores/ssh'

const props = withDefaults(
  defineProps<{
    open: boolean
    candidates: SshConfigCandidate[]
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  close: []
  confirm: [aliases: string[]]
}>()

const { t } = useI18n()

const selected = ref<Set<string>>(new Set())

// Default to all candidates selected whenever the list (re)loads while open.
watch(
  () => [props.open, props.candidates] as const,
  ([isOpen]) => {
    if (!isOpen) return
    selected.value = new Set(props.candidates.map((c) => c.alias))
  },
  { immediate: true },
)

const allSelected = computed(
  () => props.candidates.length > 0 && selected.value.size === props.candidates.length,
)

const toggle = (alias: string) => {
  const next = new Set(selected.value)
  if (next.has(alias)) next.delete(alias)
  else next.add(alias)
  selected.value = next
}
const toggleAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(props.candidates.map((c) => c.alias))
}
const endpoint = (c: SshConfigCandidate): string =>
  `${c.user ? `${c.user}@` : ''}${c.host}:${c.port}`
const confirm = () => {
  if (selected.value.size) emit('confirm', [...selected.value])
}
</script>

<style scoped>
.ssp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ssp-sub {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.5;
}
.ssp-state {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  text-align: center;
  padding: 18px 0;
}
.ssp-selectall {
  align-self: flex-start;
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  padding: 2px 0;
}
/* Flat hairline list — one bordered surface, rows split by a 1px divider (not a
   stack of filled cards), matching the reference's dense list idiom. */
.ssp-list {
  display: flex;
  flex-direction: column;
  max-height: 48vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.ssp-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.ssp-item + .ssp-item {
  border-top: 1px solid var(--border);
}
.ssp-item:hover {
  background: var(--bgHover);
}
.ssp-check {
  margin-top: 2px;
  flex: 0 0 auto;
  accent-color: var(--accent);
}
.ssp-item-tx {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ssp-item-nm {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}
.ssp-item-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  word-break: break-all;
}
.ssp-count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
</style>
