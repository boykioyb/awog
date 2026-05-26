<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="flex items-center justify-between px-3 py-2"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[11px] uppercase tracking-wider" :style="{ color: t.textDim }">
        Working tree
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="store.unstagedFiles.length > 0 || store.untrackedFiles.length > 0"
          class="text-[10px] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
          @click="stageAll"
        >
          Stage all
        </button>
        <button
          v-if="store.stagedFiles.length > 0"
          class="text-[10px] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
          @click="unstageAll"
        >
          Unstage all
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      <div
        v-if="store.statusFiles.length === 0"
        class="px-3 py-12 text-center text-xs"
        :style="{ color: t.textDim }"
      >
        Working tree clean
      </div>

      <GitStatusSection
        v-if="store.conflictedFiles.length > 0"
        label="Conflicted"
        :files="store.conflictedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="false"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
      />

      <GitStatusSection
        v-if="store.stagedFiles.length > 0"
        label="Staged"
        :files="store.stagedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        :is-staged-section="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
      />

      <GitStatusSection
        v-if="store.unstagedFiles.length > 0"
        label="Changes"
        :files="store.unstagedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
      />

      <GitStatusSection
        v-if="store.untrackedFiles.length > 0"
        label="Untracked"
        :files="store.untrackedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
      />
    </div>

    <ConfirmDeleteModal
      v-if="pendingDiscard"
      title="Discard changes?"
      :description="`Sẽ xóa vĩnh viễn change uncommitted của '${pendingDiscard}'. Tiếp tục?`"
      @confirm="confirmDiscard"
      @cancel="pendingDiscard = null"
    />
  </div>
</template>

<script setup lang="ts">
const { t } = useTheme()
const store = useGitStore()

const pendingDiscard = ref<string | null>(null)

const askDiscard = (p: string) => {
  pendingDiscard.value = p
}

const confirmDiscard = () => {
  if (pendingDiscard.value) {
    store.discardFile(pendingDiscard.value)
  }
  pendingDiscard.value = null
}

const stageAll = () => {
  ;[...store.unstagedFiles, ...store.untrackedFiles].forEach((f) => store.stageFile(f.path))
}

const unstageAll = () => {
  store.stagedFiles.forEach((f) => store.unstageFile(f.path))
}
</script>
