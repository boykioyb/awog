<template>
  <div class="gcbanner" :class="{ ready: !hasConflict }">
    <Icon name="alert" class="gcbicon" />
    <strong v-if="pendingOp" class="gcbop">{{ opLabel }}</strong>
    <span class="gcbtext">
      {{
        hasConflict
          ? t('git.conflict.banner.resolve', { count: conflictedCount })
          : t('git.conflict.banner.ready')
      }}
    </span>
    <span class="gcbsp" />
    <!-- No actions when nothing is in flight: a stash apply/pop conflict has no
         sequencer state, so there is nothing to complete or abort — resolving and
         staging IS the finish. Offering buttons there would only fail. -->
    <template v-if="pendingOp">
      <button class="btn sm" :disabled="hasConflict" @click="emit('complete')">
        {{ completeLabel }}
      </button>
      <!-- git's own third suggestion mid-rebase: drop the commit it is stuck on. -->
      <button v-if="pendingOp === 'rebase'" class="btn sm" @click="emit('skip')">
        {{ t('git.header.skipRebase') }}
      </button>
      <button class="btn sm gdanger" @click="emit('abort')">{{ abortLabel }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
// Full-width strip for "git is mid-something", sitting under the toolbar next to
// the detached-HEAD banner.
//
// It lived INSIDE the toolbar until it was measured: at a 1440px window the row
// already overflowed by 604px (instruction 423 + three buttons 309 + a 222px
// branch chip, every one of them nowrap), and `.gbar{overflow-x:auto}` turned
// that into a sideways scroll that pushed Abort off-screen — the one control
// that gets you out of a mid-merge repo. A state this important does not compete
// with the pickers for width; it gets its own row, and wraps instead of scrolling.
import type { GitPendingOp } from '~/composables/useGitApi'

const props = defineProps<{
  // null + hasConflict = conflicts with no operation in flight (stash apply/pop).
  pendingOp: GitPendingOp | null
  hasConflict: boolean
  conflictedCount: number
}>()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'abort'): void
  (e: 'skip'): void
}>()

const { t } = useI18n()

const OP_KEY: Record<GitPendingOp, string> = {
  merge: 'git.conflict.op.merge',
  rebase: 'git.conflict.op.rebase',
  'cherry-pick': 'git.conflict.op.cherryPick',
  revert: 'git.conflict.op.revert',
}
const COMPLETE_KEY: Record<GitPendingOp, string> = {
  merge: 'git.header.completeMerge',
  rebase: 'git.header.continueRebase',
  'cherry-pick': 'git.header.continueCherryPick',
  revert: 'git.header.continueRevert',
}
const ABORT_KEY: Record<GitPendingOp, string> = {
  merge: 'git.header.abortMerge',
  rebase: 'git.header.abortRebase',
  'cherry-pick': 'git.header.abortCherryPick',
  revert: 'git.header.abortRevert',
}

const opLabel = computed(() => (props.pendingOp ? t(OP_KEY[props.pendingOp]) : ''))
const completeLabel = computed(() => t(COMPLETE_KEY[props.pendingOp ?? 'merge']))
const abortLabel = computed(() => t(ABORT_KEY[props.pendingOp ?? 'merge']))
</script>

<style scoped>
/* Same metrics as .gbanner (detached HEAD) so the two state strips read as one
   family. `flex-wrap` is the whole point: at a narrow window the buttons drop to
   a second line instead of overflowing, so Abort is always reachable. */
.gcbanner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 8px 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--dangerBg);
  box-shadow: inset 0 -1px 0 var(--dangerBorder);
}
.gcbanner.ready {
  color: var(--textMuted);
  background: var(--bgSubtle);
  box-shadow: inset 0 -1px 0 var(--border);
}
.gcbicon {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.gcbop {
  flex: 0 0 auto;
  font-weight: 600;
}
/* The prose is the only thing allowed to give up space — min-width:0 is what lets
   it actually shrink inside a flex row rather than pinning the line open. */
.gcbtext {
  flex: 1 1 180px;
  min-width: 0;
}
/* Keeps the buttons right-aligned on a wide row; collapses to nothing once the
   line wraps, so they sit left under the text instead of stranded far right. */
.gcbsp {
  flex: 1 1 0;
  min-width: 0;
}
.gcbanner .btn {
  flex: 0 0 auto;
  height: 28px;
  border-radius: var(--r-xs);
}
</style>
