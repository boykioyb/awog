<template>
  <!-- Cùng nhịp với banner detached-HEAD để hai dải trạng thái đọc như một họ.
       `flex-wrap` là mấu chốt: cửa sổ hẹp thì nút rớt xuống dòng hai thay vì tràn,
       nên Abort luôn bấm được. -->
  <div
    class="flex flex-none flex-wrap items-center gap-2 border-b px-3.5 py-2 text-sm"
    :class="
      hasConflict
        ? 'border-destructive/40 bg-destructive/15 text-destructive'
        : 'border-border bg-muted text-muted-foreground'
    "
  >
    <Icon name="alert" class="size-3.5 flex-none" />
    <strong v-if="pendingOp" class="flex-none font-semibold">{{ opLabel }}</strong>
    <!-- Chỉ phần chữ được nhường chỗ — min-w-0 cho nó co lại trong hàng flex. -->
    <span class="min-w-0 flex-1 basis-45">
      {{
        hasConflict
          ? t('git.conflict.banner.resolve', { count: conflictedCount })
          : t('git.conflict.banner.ready')
      }}
    </span>
    <!-- Đẩy nút sang phải khi hàng rộng; co về 0 khi đã xuống dòng. -->
    <span class="min-w-0 flex-1" />
    <!-- No actions when nothing is in flight: a stash apply/pop conflict has no
         sequencer state, so there is nothing to complete or abort — resolving and
         staging IS the finish. Offering buttons there would only fail. -->
    <template v-if="pendingOp">
      <Button variant="outline" size="sm" :disabled="hasConflict" @click="emit('complete')">
        {{ completeLabel }}
      </Button>
      <!-- git's own third suggestion mid-rebase: drop the commit it is stuck on. -->
      <Button v-if="pendingOp === 'rebase'" variant="outline" size="sm" @click="emit('skip')">
        {{ t('git.header.skipRebase') }}
      </Button>
      <Button variant="destructive" size="sm" @click="emit('abort')">{{ abortLabel }}</Button>
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
import Button from '~/components/ui/button/Button.vue'
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
