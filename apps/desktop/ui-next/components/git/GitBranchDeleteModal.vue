<template>
  <Teleport to="body">
    <div v-if="open" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card gbd" role="dialog" aria-modal="true">
        <div class="gpm-title">{{ t('git.deleteBranch.title') }}</div>

        <p class="gbd-desc">{{ t('git.deleteBranch.desc', { name: branchName }) }}</p>

        <!-- Also delete the remote branch — only when one exists for this branch. -->
        <div v-if="remoteName" class="gbd-toggle" @click="deleteRemote = !deleteRemote">
          <span class="gbd-togtext">
            <span :style="deleteRemote ? { color: 'var(--danger)' } : undefined">
              {{ t('git.deleteBranch.alsoRemote') }}
            </span>
            <span class="gbd-ref mono">{{ remoteName }}/{{ branchName }}</span>
          </span>
          <span class="tog2 sm" :class="{ off: !deleteRemote }" />
        </div>

        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn pri gbd-dangerbtn" @click="submit">
            {{ t('git.deleteBranch.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Delete-branch modal — confirms a destructive local branch delete and offers an
// opt-in "also delete the remote branch" toggle (shown only when the branch has a
// matching remote-tracking ref). Emits the chosen options; GitManager runs the
// delete (and handles the UNMERGED → force-delete follow-up).
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

<style scoped>
.gpm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.gpm-card {
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gpm-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gbd-desc {
  font-size: 1em;
  line-height: var(--lh-md);
  color: var(--textMuted);
}
.gbd-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  user-select: none;
}
.gbd-togtext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 1em;
  color: var(--text);
}
.gbd-ref {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gpm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
.gbd-dangerbtn {
  background: var(--danger);
}
</style>
