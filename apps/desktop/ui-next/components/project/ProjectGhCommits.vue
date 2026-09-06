<template>
  <div class="ghcommits">
    <div v-if="loading" class="fd" style="padding: 16px 4px">
      {{ t('projects.drawer.commitsLoading') }}
    </div>
    <div v-else-if="!commits.length" class="fd" style="padding: 16px 4px">
      {{ t('projects.drawer.commitsEmpty') }}
    </div>
    <div v-else class="ghcommit-list">
      <div v-for="c in commits" :key="c.sha" class="ghcommit-row">
        <span class="ghcommit-sha mono">{{ shortSha(c.sha) }}</span>
        <span class="ghcommit-msg">{{ c.message }}</span>
        <span class="ghcommit-meta">{{ metaLine(c) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// PR commits list for the GitHub drawer (Commits tab). Presentational — the parent
// (ProjectGhDrawer) lazy-loads the commits via the useProjectGh controller and
// forwards them + the loading flag. Each row: short sha (mono) + truncated message
// + author · relative date.
import type { GhCommit } from '~/composables/useProjectGh'

defineProps<{
  commits: GhCommit[]
  loading: boolean
}>()

const { t } = useI18n()

// First 7 chars of the full oid (git's conventional short sha).
function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

// `author · relative date` (each half optional; the dot only joins both present).
function metaLine(c: GhCommit): string {
  const when = c.date ? relativeWhen(c.date) : ''
  return [c.author, when].filter(Boolean).join(' · ')
}

function relativeWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ms).toLocaleDateString()
}
</script>

<style scoped>
.ghcommit-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.ghcommit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-top: 1px solid var(--border);
}
.ghcommit-list > .ghcommit-row:first-child {
  border-top: none;
}
.ghcommit-sha {
  flex: 0 0 auto;
  /* mono-ok: commit SHA */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
}
.ghcommit-msg {
  flex: 1;
  min-width: 0;
  font-size: 1em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghcommit-meta {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
