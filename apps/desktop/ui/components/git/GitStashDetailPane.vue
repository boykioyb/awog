<template>
  <div class="flex-1 overflow-auto p-6">
    <div v-if="!stash" :style="{ color: t.textDim }" class="text-[1em]">
      {{ tr('git.sidebar.empty') }}
    </div>
    <div v-else class="max-w-xl">
      <div class="flex items-center gap-2 mb-3">
        <Archive :size="18" :style="{ color: t.accent }" />
        <span class="text-[1em] font-mono" :style="{ color: t.accent }">{{ stash.ref }}</span>
        <span class="text-[1em]" :style="{ color: t.textDim }">
          {{ tr('git.stash.on_branch', { branch: stash.branch }) }}
        </span>
      </div>

      <div class="rounded p-4" :style="{ background: t.bgPanel, border: `1px solid ${t.border}` }">
        <div class="text-[1em] whitespace-pre-wrap" :style="{ color: t.text }">
          {{ stash.message }}
        </div>
        <div class="text-[1em] mt-2" :style="{ color: t.textFaint }">
          {{ stash.date }}
        </div>
        <div class="flex items-center gap-2 mt-4">
          <button
            class="text-[1em] px-3 py-1.5 rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="store.stashPop(stash.index)"
          >
            {{ tr('git.stash.pop') }}
          </button>
          <button
            class="text-[1em] px-3 py-1.5 rounded transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            @click="store.stashApply(stash.index)"
          >
            {{ tr('git.stash.apply') }}
          </button>
          <button
            class="ml-auto text-[1em] px-3 py-1.5 rounded transition"
            :style="{
              background: t.dangerBg,
              color: t.danger,
              border: `1px solid ${t.dangerBorder}`,
            }"
            @click="pendingDrop = true"
          >
            {{ tr('git.stash.drop') }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDeleteModal
      v-if="pendingDrop && stash"
      :title="tr('git.stash.drop_title')"
      :description="tr('git.stash.drop_description')"
      @confirm="onConfirmDrop"
      @cancel="pendingDrop = false"
    />
  </div>
</template>

<script setup lang="ts">
import { Archive } from 'lucide-vue-next'
import type { GitStashEntry } from '~/types'

type Props = {
  index: number
}

const props = defineProps<Props>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const pendingDrop = ref(false)

const stash = computed<GitStashEntry | undefined>(() =>
  store.stashes.find((s: GitStashEntry) => s.index === props.index),
)

const onConfirmDrop = async () => {
  if (stash.value) await store.stashDrop(stash.value.index)
  pendingDrop.value = false
}
</script>
