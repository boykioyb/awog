<template>
  <div>
    <div v-if="loading" class="px-1 py-4 text-sm text-dim">
      {{ t('projects.drawer.commitsLoading') }}
    </div>
    <div v-else-if="!commits.length" class="px-1 py-4 text-sm text-dim">
      {{ t('projects.drawer.commitsEmpty') }}
    </div>
    <div v-else class="flex flex-col divide-y overflow-hidden rounded-md border">
      <div v-for="c in commits" :key="c.sha" class="flex items-center gap-2.5 px-3 py-2">
        <!-- mono-ok: commit SHA -->
        <span class="flex-none font-mono text-xs text-primary">{{ shortSha(c.sha) }}</span>
        <span class="min-w-0 flex-1 truncate text-foreground">{{ c.message }}</span>
        <span class="flex-none text-xs text-dim">{{ metaLine(c) }}</span>
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
