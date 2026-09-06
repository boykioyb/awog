<template>
  <span class="sb-wrap">
    <button
      class="sb-item"
      :title="t('statusbar.branch.title')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="branch" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="sb-branch">{{ branch ?? t('statusbar.branch.none') }}</span>
      <span v-if="dirtyCount" class="sb-badge">{{ dirtyCount }}</span>
    </button>

    <template v-if="open">
      <div class="sb-backdrop" @click="open = false" />
      <div class="smenu sb-menu" @click.stop>
        <div class="sb-menu-hd">{{ t('statusbar.branch.switch') }}</div>
        <!-- Only the branch list scrolls; the "Open Git Manager" action below is
             frozen so it stays reachable no matter how many branches there are. -->
        <div class="sb-menu-scroll">
          <div v-if="loading" class="sb-menu-hint">{{ t('statusbar.branch.loading') }}</div>
          <div v-else-if="!localBranches.length" class="sb-menu-hint">
            {{ t('statusbar.branch.empty') }}
          </div>
          <button
            v-for="b in localBranches"
            :key="b"
            class="mi"
            :disabled="switching"
            @click="pick(b)"
          >
            <span class="sb-mi-name">{{ b }}</span>
            <Icon
              v-if="b === branch"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </div>
        <div class="sb-menu-foot">
          <div class="sb-menu-sep" />
          <button class="mi" @click="openGit">
            <Icon name="git" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('statusbar.branch.openGit') }}
          </button>
        </div>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Branch chip + quick-switch popover for the status bar (VSCode-style): shows the
// active session's current branch, click pops a local-branch list (click → checkout)
// plus an "Open Git Manager…" escape hatch to the full modal. Dirty-file count
// badges the chip. Branch state comes from useSessionBranch (decoupled from the
// global git store); the modal is the shared useGitModal.
import { ref } from 'vue'
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()

const { branch, localBranches, loading, switching, checkout } = useSessionBranch(
  () => props.session.project,
)
const { dirtyCount } = useGitDirtyCount(() => props.session.project)
const gitModal = useGitModal()

const open = ref(false)

function pick(name: string) {
  void checkout(name)
  open.value = false
}
function openGit() {
  gitModal.open(props.session.project)
  open.value = false
}
</script>

<style scoped>
.sb-wrap {
  position: relative;
  display: inline-flex;
}
.sb-branch {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Quick-switch list opens UPWARD (the bar is pinned to the window bottom). Override
   the global `.smenu` fixed/z so it anchors above the chip. A flex column with a
   capped height: header + frozen footer stay put while only the branch list scrolls
   (override the global `.smenu { overflow-y: auto }` so the whole menu doesn't scroll). */
.sb-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 95;
  max-height: min(50vh, 360px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Only the branch list scrolls. */
.sb-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* Frozen footer: the separator + "Open Git Manager" action pinned at the bottom. */
.sb-menu-foot {
  flex: 0 0 auto;
}
.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
}
.sb-menu-hd {
  flex: 0 0 auto;
  padding: 4px 10px 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.sb-menu-hint {
  padding: 6px 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.sb-menu-sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
.mi {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
.mi:disabled {
  opacity: 0.6;
  cursor: default;
}
.sb-mi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
