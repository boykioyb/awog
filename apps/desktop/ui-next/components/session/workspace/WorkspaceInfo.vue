<template>
  <div class="flex flex-col">
    <div
      v-for="row in infoRows"
      :key="row.k"
      class="flex items-baseline gap-2.5 border-b border-border py-1.5"
    >
      <span class="w-24 shrink-0 text-dim">{{ row.k }}</span>
      <a
        v-if="row.href"
        class="min-w-0 font-mono text-info no-underline [overflow-wrap:anywhere]"
        :href="row.href"
        target="_blank"
        rel="noopener"
      >
        {{ row.v }}
      </a>
      <span v-else class="min-w-0 font-mono [overflow-wrap:anywhere]">{{ row.v }}</span>
    </div>

    <!-- Context files: attachments + pinned working-set fed into the model. -->
    <div class="mt-3.5">
      <div class="mb-1.5 flex items-center gap-1.5 text-sm text-dim">
        {{ t('sessions.info.contextFiles') }}
        <span v-if="contextFiles.length" class="text-sm tabular-nums text-faint">
          {{ contextFiles.length }}
        </span>
      </div>
      <Button
        v-for="f in contextFiles"
        :key="f.key"
        variant="outline"
        type="button"
        class="h-auto p-0 flex w-full items-center gap-2 border-b border-border px-1 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
        :title="'path' in f ? f.path : f.name"
        @click="openContextFile(f)"
      >
        <component
          :is="ctxIcon(f.kind)"
          class="size-3 shrink-0"
          :class="f.kind === 'attachment' ? 'text-dim' : 'text-primary'"
        />
        <span class="min-w-0 flex-1 truncate font-mono">{{ f.name }}</span>
        <span v-if="f.kind === 'attachment' && f.size != null" class="shrink-0 text-sm text-faint">
          {{ formatBytes(f.size) }}
        </span>
        <span class="shrink-0 text-sm text-muted-foreground">
          {{ t(`sessions.info.ctxKind.${f.kind}`) }}
        </span>
      </Button>
      <p v-if="!contextFiles.length" class="py-1 text-faint">
        {{ t('sessions.info.contextFilesEmpty') }}
      </p>
    </div>

    <!-- Media · links · docs: everything that flowed through the transcript. -->
    <WorkspaceInfoMedia :session="session" />
  </div>
</template>

<script setup lang="ts">
// Info tab body — session metadata rows, the context files fed into the model, and
// the media/links/docs index of the transcript. Split out of SessionWorkspacePanel
// (which owns the panel chrome only) once the tab grew past a couple of rows, so it
// matches the other tabs: one component per view.
import type { Component } from 'vue'
import { Folder, Pin, ScrollText } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import type { SessionContextFile } from '~/composables/useSessionContextFiles'
import { formatTokenCount } from '~/utils/context-window'
import { formatBytes } from '~/utils/format-bytes'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const { projectName } = useProjects()

// Context files (working folder + attachments + pinned working-set).
const { contextFiles, openContextFile } = useSessionContextFiles(() => props.session)
// Row icon per context kind; folder/pinned = standing context → primary tint.
function ctxIcon(kind: SessionContextFile['kind']): Component {
  if (kind === 'folder') return Folder
  if (kind === 'pinned') return Pin
  return ScrollText
}

const totalTok = computed(() => {
  const chars = props.session.msgs.reduce((a, m) => {
    if (m.role === 'assistant') {
      return (
        a +
        m.blocks.reduce(
          (b, k) =>
            b +
            ('text' in k ? k.text.length : 0) +
            ('detail' in k ? (k.detail || '').length : 0) +
            60,
          0,
        )
      )
    }
    return a + m.text.length
  }, 0)
  return Math.floor(chars / 3)
})

// Derive a compact label for a GitHub issue/PR URL, e.g. "PR owner/repo#5".
function ghLabel(url: string): string {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(url)
  if (!m) return url
  const kind = m[3] === 'pull' ? 'PR' : 'Issue'
  return `${kind} ${m[1]}/${m[2]}#${m[4]}`
}

const infoRows = computed<{ k: string; v: string; href?: string }[]>(() => {
  const s = props.session
  const rows: { k: string; v: string; href?: string }[] = [
    { k: t('sessions.info.id'), v: `s_${s.id}` },
    { k: t('sessions.info.project'), v: projectName(s.project) },
    { k: t('sessions.info.account'), v: s.account },
    { k: t('sessions.info.model'), v: s.model },
    { k: t('sessions.info.style'), v: s.style || 'Normal' },
    { k: t('sessions.info.mode'), v: s.mode || 'Ask' },
    { k: t('sessions.info.messages'), v: String(s.msgs.length) },
    { k: t('sessions.info.tokens'), v: `${formatTokenCount(totalTok.value)} / 200k` },
    { k: t('sessions.info.updated'), v: s.when },
  ]
  // Cost has its own dedicated Cost tab (per-day + 1d/7d/30d/custom-range roll-up);
  // not duplicated here.
  if (s.aboutGhUrl) {
    rows.push({ k: t('sessions.info.gh'), v: ghLabel(s.aboutGhUrl), href: s.aboutGhUrl })
  }
  return rows
})
</script>
