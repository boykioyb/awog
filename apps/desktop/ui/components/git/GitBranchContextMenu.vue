<template>
  <ContextMenu v-if="open" :x="position.x" :y="position.y" :items="items" @close="emit('close')" />
</template>

<script setup lang="ts">
import { Check, Copy, Download, GitBranchPlus, Pencil, Trash2 } from 'lucide-vue-next'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

type Props = {
  open: boolean
  position: { x: number; y: number }
  branchName: string
  isRemote: boolean
  isCurrent: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  checkout: [name: string, isCurrent: boolean]
  'checkout-as-local': [remoteName: string]
  'create-from': [ref: string]
  rename: [name: string]
  copy: [name: string]
  fetch: []
  delete: [name: string]
}>()

const items = computed<ContextMenuItem[]>(() => {
  if (props.isRemote) {
    return [
      {
        label: 'Checkout as new local branch',
        icon: GitBranchPlus,
        action: () => emit('checkout-as-local', props.branchName),
      },
      {
        label: 'Fetch',
        icon: Download,
        action: () => emit('fetch'),
      },
      {
        label: 'Copy name',
        icon: Copy,
        action: () => emit('copy', props.branchName),
      },
    ]
  }
  return [
    {
      label: props.isCurrent ? 'Already checked out' : 'Checkout',
      icon: Check,
      disabled: props.isCurrent,
      action: () => emit('checkout', props.branchName, props.isCurrent),
    },
    {
      label: 'New branch from here…',
      icon: GitBranchPlus,
      action: () => emit('create-from', props.branchName),
    },
    {
      label: 'Rename…',
      icon: Pencil,
      action: () => emit('rename', props.branchName),
    },
    {
      label: 'Copy name',
      icon: Copy,
      action: () => emit('copy', props.branchName),
    },
    {
      label: 'Delete branch',
      icon: Trash2,
      danger: true,
      disabled: props.isCurrent,
      action: () => emit('delete', props.branchName),
    },
  ]
})
</script>
