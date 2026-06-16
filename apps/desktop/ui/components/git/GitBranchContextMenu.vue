<template>
  <ContextMenu v-if="open" :x="position.x" :y="position.y" :items="items" @close="emit('close')" />
</template>

<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Download,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  Pencil,
  Replace,
  Tag,
  Trash2,
} from 'lucide-vue-next'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

type Props = {
  open: boolean
  position: { x: number; y: number }
  branchName: string
  isRemote: boolean
  isCurrent: boolean
  // Name of the currently checked-out branch — drives Merge/Rebase labels.
  // Optional so legacy callers without git context still compile (the
  // context-dependent items then render disabled).
  currentBranch?: string
  // The context branch's own upstream (gates Create PR / Pull / Push).
  hasUpstream?: boolean
  // Whether the repo has any remote configured (gates Create PR).
  hasRemote?: boolean
  ahead?: number
  behind?: number
}

const props = withDefaults(defineProps<Props>(), {
  currentBranch: '',
  hasUpstream: false,
  hasRemote: false,
  ahead: 0,
  behind: 0,
})

const emit = defineEmits<{
  close: []
  checkout: [name: string, isCurrent: boolean]
  'checkout-as-local': [remoteName: string]
  'create-from': [ref: string]
  rename: [name: string]
  copy: [name: string]
  fetch: []
  delete: [name: string]
  merge: [name: string]
  rebase: [name: string]
  'create-tag': [name: string]
  'create-pr': [name: string]
  pull: []
  push: []
}>()

const { t: tr } = useI18n()

// Create PR is disabled until the branch is pushed (no upstream → nothing to
// compare on the remote) or when the repo has no remote at all. Per ADR 0040.
const prItem = (): ContextMenuItem => {
  const disabled = !props.hasRemote || !props.hasUpstream
  const tooltip = !props.hasRemote
    ? tr('git.branches.menu.create_pr_no_remote')
    : !props.hasUpstream
      ? tr('git.branches.menu.create_pr_no_push')
      : undefined
  return {
    label: tr('git.branches.menu.create_pr'),
    icon: GitPullRequest,
    disabled,
    ...(tooltip ? { tooltip } : {}),
    action: () => emit('create-pr', props.branchName),
  }
}

const items = computed<ContextMenuItem[]>(() => {
  if (props.isRemote) {
    return [
      {
        label: tr('git.branches.menu.checkout_as_local'),
        icon: GitBranchPlus,
        action: () => emit('checkout-as-local', props.branchName),
      },
      {
        label: tr('git.branches.menu.fetch'),
        icon: Download,
        action: () => emit('fetch'),
      },
      { separator: true },
      {
        label: tr('git.branches.menu.merge_into', { target: props.currentBranch }),
        icon: GitMerge,
        disabled: !props.currentBranch,
        action: () => emit('merge', props.branchName),
      },
      prItem(),
      { separator: true },
      {
        label: tr('git.branches.menu.copy_name'),
        icon: Copy,
        action: () => emit('copy', props.branchName),
      },
    ]
  }

  const out: ContextMenuItem[] = [
    {
      label: props.isCurrent
        ? tr('git.branches.menu.already_checked_out')
        : tr('git.branches.menu.checkout'),
      icon: Check,
      disabled: props.isCurrent,
      action: () => emit('checkout', props.branchName, props.isCurrent),
    },
    {
      label: tr('git.branches.menu.new_from_here'),
      icon: GitBranchPlus,
      action: () => emit('create-from', props.branchName),
    },
    { separator: true },
  ]

  if (props.isCurrent) {
    out.push(
      {
        label: tr('git.branches.menu.pull'),
        icon: ArrowDownToLine,
        shortcut: props.behind > 0 ? `↓${props.behind}` : undefined,
        disabled: !props.hasUpstream || props.behind === 0,
        action: () => emit('pull'),
      },
      {
        label: tr('git.branches.menu.push'),
        icon: ArrowUpFromLine,
        shortcut: props.ahead > 0 ? `↑${props.ahead}` : undefined,
        disabled: props.hasUpstream && props.ahead === 0,
        action: () => emit('push'),
      },
    )
  } else {
    out.push(
      {
        label: tr('git.branches.menu.merge_into', { target: props.currentBranch }),
        icon: GitMerge,
        disabled: !props.currentBranch,
        action: () => emit('merge', props.branchName),
      },
      {
        label: tr('git.branches.menu.rebase_onto', {
          current: props.currentBranch,
          target: props.branchName,
        }),
        icon: Replace,
        disabled: !props.currentBranch,
        action: () => emit('rebase', props.branchName),
      },
    )
  }

  out.push(
    { separator: true },
    {
      label: tr('git.branches.menu.rename'),
      icon: Pencil,
      action: () => emit('rename', props.branchName),
    },
    {
      label: tr('git.branches.menu.create_tag'),
      icon: Tag,
      action: () => emit('create-tag', props.branchName),
    },
    prItem(),
    { separator: true },
    {
      label: tr('git.branches.menu.copy_name'),
      icon: Copy,
      action: () => emit('copy', props.branchName),
    },
  )

  if (!props.isCurrent) {
    out.push({
      label: tr('git.branches.menu.delete'),
      icon: Trash2,
      danger: true,
      action: () => emit('delete', props.branchName),
    })
  }

  return out
})
</script>
