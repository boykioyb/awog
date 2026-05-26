<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="!detail"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      Select a commit
    </div>
    <template v-else>
      <div
        class="px-4 py-3 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-mono" :style="{ color: t.accent }">
            {{ detail.commit.shortHash }}
          </span>
          <span
            v-if="detail.commit.phaseId"
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.infoBg,
              color: t.info,
              border: `1px solid ${t.infoBorder}`,
            }"
          >
            <Link :size="9" class="inline-block mr-0.5" />
            phase {{ detail.commit.phaseId }}
          </span>
        </div>
        <div class="text-sm" :style="{ color: t.text }">{{ detail.commit.subject }}</div>
        <div
          v-if="detail.commit.body"
          class="text-xs mt-2 whitespace-pre-wrap"
          :style="{ color: t.textMuted }"
        >
          {{ detail.commit.body }}
        </div>
        <div class="flex items-center gap-2 text-[10px] mt-2" :style="{ color: t.textDim }">
          <span>{{ detail.commit.authorName }}</span>
          <span>&lt;{{ detail.commit.authorEmail }}&gt;</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span>{{ new Date(detail.commit.date).toLocaleString() }}</span>
        </div>
      </div>

      <div
        class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="text-[10px] uppercase tracking-wider" :style="{ color: t.textDim }">
          Files ({{ detail.files.length }})
        </div>
      </div>
      <div class="flex flex-col flex-1 overflow-hidden">
        <div
          class="flex flex-wrap gap-1 px-3 py-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <button
            v-for="(f, i) in detail.files"
            :key="f.path"
            class="text-[10px] font-mono px-2 py-1 rounded transition truncate max-w-full"
            :style="{
              background: activeFileIndex === i ? t.bgActive : t.bgInput,
              color: activeFileIndex === i ? t.text : t.textMuted,
              border: `1px solid ${t.border}`,
            }"
            @click="activeFileIndex = i"
          >
            {{ f.path }}
          </button>
        </div>
        <div class="flex-1 overflow-hidden">
          <GitDiffViewer :diff="detail.files[activeFileIndex] ?? null" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Link } from 'lucide-vue-next'
import type { GitCommit, GitFileDiff } from '~/types'

defineProps<{
  detail: { commit: GitCommit; files: GitFileDiff[] } | null
}>()

const { t } = useTheme()
const activeFileIndex = ref(0)
</script>
