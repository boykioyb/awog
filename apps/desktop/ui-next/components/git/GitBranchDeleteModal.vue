<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('git.deleteBranch.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('git.deleteBranch.desc', { name: branchName }) }}
        </DialogDescription>
      </DialogHeader>

      <!-- Also delete the remote branch — only when one exists for this branch. -->
      <div
        v-if="remoteName"
        class="flex cursor-pointer select-none items-center justify-between gap-3"
        @click="deleteRemote = !deleteRemote"
      >
        <span class="flex min-w-0 flex-col gap-0.5 text-sm">
          <span :class="deleteRemote ? 'text-destructive' : undefined">
            {{ t('git.deleteBranch.alsoRemote') }}
          </span>
          <span class="truncate font-mono text-xs text-muted-foreground">
            {{ remoteName }}/{{ branchName }}
          </span>
        </span>
        <Switch
          :checked="deleteRemote"
          class="data-[state=checked]:bg-destructive"
          @click.stop
          @update:checked="deleteRemote = $event"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button variant="destructive" @click="submit">
          {{ t('git.deleteBranch.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Delete-branch modal — confirms a destructive local branch delete and offers an
// opt-in "also delete the remote branch" toggle (shown only when the branch has a
// matching remote-tracking ref). Emits the chosen options; GitManager runs the
// delete (and handles the UNMERGED → force-delete follow-up).
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Switch from '~/components/ui/switch/Switch.vue'

const props = defineProps<{
  open: boolean
  branchName: string
  // Remote that has this branch (e.g. 'origin'); null → no remote branch, hide the toggle.
  remoteName: string | null
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { deleteRemote: boolean }): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const deleteRemote = ref(false)

// Reset the opt-in each time the dialog opens (default OFF — deleting the remote
// branch is the more destructive choice).
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) deleteRemote.value = false
  },
)

function submit() {
  emit('submit', { deleteRemote: props.remoteName ? deleteRemote.value : false })
}
</script>
