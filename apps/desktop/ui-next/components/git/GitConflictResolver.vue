<template>
  <div class="cres">
    <!-- Toolbar: filename + progress chip + take-all + Mark resolved -->
    <div class="dh">
      <span class="dt mono" style="font-size: var(--fs-sm)">
        <span class="dtname" :title="path">{{ baseName }}</span>
      </span>
      <span v-if="mode === 'text'" class="chip cchip">
        {{ t('git.conflict.chosenCount', { chosen, total }) }}
      </span>
      <span style="flex: 1" />
      <template v-if="mode === 'text'">
        <button class="btn sm" type="button" @click="pickAll('ours')">
          {{ t('git.conflict.takeAllOurs') }}
        </button>
        <button class="btn sm" type="button" @click="pickAll('theirs')">
          {{ t('git.conflict.takeAllTheirs') }}
        </button>
        <button
          class="btn sm pri"
          type="button"
          :disabled="!allChosen || isResolving"
          @click="markResolved"
        >
          <Icon name="check" style="width: 14px; height: 14px" />
          {{ t('git.conflict.markResolved') }}
        </button>
      </template>
    </div>

    <div class="dscroll cscroll">
      <!-- Inline error (desync / gone) — keep resolver open, offer reload (CR-13) -->
      <div v-if="errorKey" class="cerr">
        <span>{{ t(errorKey) }}</span>
        <button class="btn sm" type="button" @click="load">{{ t('git.conflict.reload') }}</button>
      </div>

      <!-- Text mode: per-block 2-way pick -->
      <template v-if="mode === 'text'">
        <GitConflictBlock
          v-for="b in blocks"
          :key="b.index"
          :index="b.index"
          :total="total"
          :line="b.startLine"
          :ours="b.ours"
          :theirs="b.theirs"
          :ours-label="b.oursLabel"
          :theirs-label="b.theirsLabel"
          :choice="choices.get(b.index)"
          @pick="(c) => pick(b.index, c)"
        />
      </template>

      <!-- Binary mode: whole-side pick (CR-09) -->
      <div v-else-if="mode === 'binary'" class="cfb">
        <p class="cfbmsg">{{ t('git.conflict.binary.title') }}</p>
        <div class="cfbactions">
          <button class="btn" type="button" :disabled="isResolving" @click="resolveBinary('ours')">
            {{ t('git.conflict.binary.takeOurs') }}
          </button>
          <button
            class="btn"
            type="button"
            :disabled="isResolving"
            @click="resolveBinary('theirs')"
          >
            {{ t('git.conflict.binary.takeTheirs') }}
          </button>
        </div>
      </div>

      <!-- Encoding fallback: external editor + mark staged (CR-10) -->
      <div v-else-if="mode === 'encoding'" class="cfb">
        <p class="cfbmsg">{{ t('git.conflict.encoding.title') }}</p>
        <div class="cfbactions">
          <button class="btn" type="button" @click="openExternal">
            {{ t('git.conflict.encoding.openExternal') }}
          </button>
          <button class="btn pri" type="button" @click="markStaged">
            {{ t('git.conflict.encoding.markStaged') }}
          </button>
          <button class="btn" type="button" @click="copyPath">
            {{ t('git.conflict.encoding.copyPath') }}
          </button>
        </div>
      </div>

      <!-- File no longer in conflict / changed (ENOENT etc.) -->
      <div v-else-if="mode === 'gone'" class="cfb">
        <p class="cfbmsg">{{ t('git.conflict.error.gone') }}</p>
        <div class="cfbactions">
          <button class="btn sm" type="button" @click="load">{{ t('git.conflict.reload') }}</button>
        </div>
      </div>

      <!-- Loading -->
      <div v-else class="cfb">
        <p class="cfbmsg">…</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Right-pane conflict resolver (replaces the diff viewer for a conflicted file).
// v1 is 2-way pick only — NO Monaco, NO inline edit (QĐ-1). Reads the file via
// store.loadConflictFile, then renders one of four modes: text (per-block ours/
// theirs), binary (whole-side pick), encoding fallback (external editor), or gone.
// All state + handlers live in useConflictResolver(); this SFC is template + bind.
import { baseNameOf } from './git-types'
import { useConflictResolver } from '~/composables/useConflictResolver'

const props = defineProps<{ path: string }>()

// Abort lives in the page header (global merge/rebase abort), not the resolver —
// so there is no `abort-request`. The resolver only reports a completed resolve.
const emit = defineEmits<{
  (e: 'resolved'): void
}>()

const { t } = useI18n()

const {
  mode,
  blocks,
  choices,
  errorKey,
  isResolving,
  total,
  chosen,
  allChosen,
  load,
  pick,
  pickAll,
  markResolved,
  resolveBinary,
  openExternal,
  markStaged,
  copyPath,
} = useConflictResolver(
  () => props.path,
  () => emit('resolved'),
)

const baseName = computed(() => baseNameOf(props.path))
</script>

<style scoped>
.cres {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.cchip {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--textDim);
}
.cscroll {
  padding: 12px;
  overflow-y: auto;
}
.cerr {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  color: var(--danger);
  background: var(--dangerBg, var(--bgSubtle));
  border: 1px solid var(--danger);
}
.cerr span {
  flex: 1;
}
.cfb {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.cfbmsg {
  color: var(--textDim);
  margin-bottom: 12px;
}
.cfbactions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
