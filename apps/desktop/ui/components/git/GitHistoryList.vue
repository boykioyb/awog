<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="px-3 py-2 flex items-center justify-between flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[0.79em] uppercase tracking-wider" :style="{ color: t.textDim }">
        History
      </div>
      <div class="text-[0.71em]" :style="{ color: t.textFaint }">
        {{ store.commits.length }} commits
      </div>
    </div>

    <div
      v-if="store.commits.length === 0"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      No commits yet
    </div>
    <div v-else class="flex-1 overflow-y-auto">
      <div
        v-for="c in store.commits"
        :key="c.hash"
        class="group flex flex-col gap-1 px-3 py-2 cursor-pointer transition"
        :style="{
          background:
            store.selectedCommitHash === c.hash
              ? t.bgActive
              : hovered === c.hash
                ? t.bgHover
                : 'transparent',
          borderLeft:
            store.selectedCommitHash === c.hash ? `2px solid ${t.accent}` : '2px solid transparent',
        }"
        @mouseenter="hovered = c.hash"
        @mouseleave="hovered = null"
        @click="store.selectCommit(c.hash)"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono" :style="{ color: t.accent }">{{ c.shortHash }}</span>
          <span class="text-xs flex-1 truncate" :style="{ color: t.text }">{{ c.subject }}</span>
          <span
            v-if="c.phaseId"
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.infoBg,
              color: t.info,
              border: `1px solid ${t.infoBorder}`,
            }"
            :title="`Linked phase ${c.phaseId}`"
          >
            <Link :size="9" class="inline-block mr-0.5" />
            {{ c.phaseId }}
          </span>
        </div>
        <div class="flex items-center gap-2 text-[0.71em]" :style="{ color: t.textDim }">
          <span>{{ c.authorName }}</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span>{{ formatDate(c.date) }}</span>
          <span
            v-for="r in c.refs"
            :key="`${r.kind}:${r.name}`"
            class="ml-1 px-1.5 py-0.5 rounded text-[0.64em]"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ r.name }}
          </span>
        </div>
      </div>
      <div
        v-if="store.historyHasMore"
        class="px-3 py-2 flex justify-center"
        :style="{ borderTop: `1px solid ${t.border}` }"
      >
        <button
          type="button"
          class="px-3 py-1 text-[0.71em] rounded transition"
          :style="{
            background: t.bgInput,
            color: t.textMuted,
            border: `1px solid ${t.border}`,
            opacity: store.isLoadingHistoryMore ? 0.6 : 1,
          }"
          :disabled="store.isLoadingHistoryMore"
          @click="store.loadMoreHistory()"
        >
          {{ store.isLoadingHistoryMore ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Link } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()

const hovered = ref<string | null>(null)

const formatDate = (iso: string) => {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return 'just now'
  if (diff < hour) return `${Math.floor(diff / min)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < day * 30) return `${Math.floor(diff / day)}d ago`
  return d.toLocaleDateString()
}
</script>
