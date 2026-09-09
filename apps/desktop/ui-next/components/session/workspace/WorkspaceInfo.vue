<template>
  <div class="wsinfo">
    <div v-for="row in infoRows" :key="row.k" class="wsinfo-row">
      <span class="wsinfo-k">{{ row.k }}</span>
      <a
        v-if="row.href"
        class="mono wsinfo-v wsinfo-link"
        :href="row.href"
        target="_blank"
        rel="noopener"
      >
        {{ row.v }}
      </a>
      <span v-else class="mono wsinfo-v">{{ row.v }}</span>
    </div>

    <!-- Context files: attachments + pinned working-set fed into the model. -->
    <div class="infoctx">
      <div class="infoctx-h">
        {{ t('sessions.info.contextFiles') }}
        <span v-if="contextFiles.length" class="infoctx-n">{{ contextFiles.length }}</span>
      </div>
      <button
        v-for="f in contextFiles"
        :key="f.key"
        type="button"
        class="infoctx-row"
        :title="'path' in f ? f.path : f.name"
        @click="openContextFile(f)"
      >
        <Icon
          :name="ctxIcon(f.kind)"
          style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto"
          :style="{ color: ctxIconColor(f.kind) }"
        />
        <span class="infoctx-name mono">{{ f.name }}</span>
        <span v-if="f.kind === 'attachment' && f.size != null" class="infoctx-size">
          {{ formatBytes(f.size) }}
        </span>
        <span class="infoctx-kind">{{ t(`sessions.info.ctxKind.${f.kind}`) }}</span>
      </button>
      <p v-if="!contextFiles.length" class="infoctx-empty">
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
import type { Session } from '~/composables/useSessionsData'
import type { SessionContextFile } from '~/composables/useSessionContextFiles'
import { formatTokenCount } from '~/utils/context-window'
import { formatBytes } from '~/utils/format-bytes'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const { projectName } = useProjects()

// Context files (working folder + attachments + pinned working-set).
const { contextFiles, openContextFile } = useSessionContextFiles(() => props.session)
// Row icon + accent per context kind (folder/pinned = standing context → accent).
function ctxIcon(kind: SessionContextFile['kind']): string {
  if (kind === 'folder') return 'folder'
  if (kind === 'pinned') return 'pin'
  return 'rules'
}
function ctxIconColor(kind: SessionContextFile['kind']): string {
  return kind === 'attachment' ? 'var(--textDim)' : 'var(--accent)'
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

<style scoped>
.wsinfo {
  display: flex;
  flex-direction: column;
}
.wsinfo-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.wsinfo-k {
  color: var(--textDim);
  flex: 0 0 96px;
}
.wsinfo-v {
  min-width: 0;
  overflow-wrap: anywhere;
}
.wsinfo-link {
  color: var(--blue);
  text-decoration: none;
}
/* Context files section (attachments + pinned working-set). */
.infoctx {
  margin-top: 14px;
}
.infoctx-h {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin-bottom: 6px;
}
.infoctx-n {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.infoctx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 4px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.infoctx-row:hover {
  background: var(--bgHover);
}
.infoctx-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.infoctx-size {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}
.infoctx-kind {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  flex: 0 0 auto;
}
.infoctx-empty {
  color: var(--textFaint);
  padding: 4px 0;
}
</style>
