<template>
  <div>
    <SettingsPaneHeader :title="t('settings.storage.heading')" />

    <div v-if="loading && !scan" class="stoload">{{ t('settings.storage.scanning') }}</div>

    <template v-else-if="scan">
      <!-- Total + what makes it up. The bar is the answer to "how heavy is it";
           the legend is the answer to "what is it made of", which is what decides
           whether there is anything worth deleting. -->
      <div class="stototal">
        <span class="stobig">{{ fmt(scan.totalBytes) }}</span>
        <span class="stosub">
          {{ t('settings.storage.summary', { s: scan.sessions.length, p: scan.projects.length }) }}
        </span>
        <span style="flex: 1" />
        <button class="btn sm" :disabled="loading" @click="refresh">
          <Icon name="refresh" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('settings.storage.refresh') }}
        </button>
      </div>

      <div class="stobar">
        <span
          v-for="p in parts"
          :key="p.key"
          class="stoseg"
          :style="{ width: pct(p.bytes), background: p.color }"
          :title="`${p.label} — ${fmt(p.bytes)}`"
        />
      </div>
      <div class="stolegend">
        <span v-for="p in parts" :key="p.key" class="stolg">
          <span class="stodot" :style="{ background: p.color }" />
          {{ p.label }}
          <b class="tnum">{{ fmt(p.bytes) }}</b>
        </span>
      </div>

      <!-- Cleanup. Both actions state the exact reclaim before asking. -->
      <div class="sech">{{ t('settings.storage.cleanup.heading') }}</div>

      <SettingsField
        :name="t('settings.storage.cleanup.snapshots.name')"
        :desc="t('settings.storage.cleanup.snapshots.desc')"
      >
        <div class="storow">
          <AppSelect v-model="olderThanDays" :options="dayOptions" style="width: 132px" />
          <button class="btn sm danger" :disabled="busy || !scan.snapshotBytes" @click="onPrune">
            {{ t('settings.storage.cleanup.snapshots.action') }}
          </button>
        </div>
      </SettingsField>

      <SettingsField
        :name="t('settings.storage.cleanup.orphans.name')"
        :desc="t('settings.storage.cleanup.orphans.desc')"
      >
        <div class="storow">
          <span class="chip">
            {{ t('settings.storage.cleanup.orphans.count', { n: scan.orphanCount }) }}
            · {{ fmt(scan.orphanBytes) }}
          </span>
          <button class="btn sm danger" :disabled="busy || !scan.orphanCount" @click="onOrphans">
            {{ t('settings.storage.cleanup.orphans.action') }}
          </button>
        </div>
      </SettingsField>

      <!-- Per project: the breakdown the question was actually about. -->
      <div class="sech">{{ t('settings.storage.byProject') }}</div>
      <div class="stolist">
        <div v-for="p in scan.projects" :key="p.projectId ?? '-'" class="storowi">
          <span class="stonm">{{ projectName(p.projectId) }}</span>
          <span class="stominibar">
            <span
              class="stominiseg"
              :style="{ width: rel(p.totalBytes), background: 'var(--accent)' }"
            />
          </span>
          <span class="stoct tnum">
            {{ t('settings.storage.nSessions', { n: p.sessionCount }) }}
          </span>
          <span class="stosz tnum">{{ fmt(p.totalBytes) }}</span>
        </div>
      </div>

      <!-- The handful of sessions that dominate. Deleting one of these is often
           the whole fix, and it is not discoverable from the session list. -->
      <div class="sech">{{ t('settings.storage.biggest') }}</div>
      <div class="stolist">
        <div v-for="s in biggest" :key="s.id" class="storowi">
          <span class="stonm" :title="s.title">{{ s.title }}</span>
          <span class="stoct">{{ projectName(s.projectId) }}</span>
          <span class="stosz tnum">{{ fmt(s.totalBytes) }}</span>
          <button
            class="btn sm danger"
            :disabled="busy"
            :title="t('settings.storage.deleteSession')"
            @click="onDeleteSession(s)"
          >
            <Icon name="trash" style="width: var(--icon-xs); height: var(--icon-xs)" />
          </button>
        </div>
      </div>
    </template>

    <div v-else class="stoload">{{ t('settings.storage.unavailable') }}</div>
  </div>
</template>

<script setup lang="ts">
// Settings → Storage. Answers "how heavy are my sessions, per project, and what
// can I safely delete".
//
// Why this screen exists at all: measured on a real install, ~/.awog/sessions had
// grown to 11 GB across 820 entries with nothing in the app reporting it. The two
// cleanups offered here follow that measurement rather than guesswork —
// snapshots were 70% of it and stray *.bak debris another 26%, while the
// conversations themselves were 6%.
import type { SessionUsage, StorageScan } from '~/composables/useStorageApi'

const { t } = useI18n()
const { confirm } = useConfirm()
const projects = useProjectsStore()
const api = useStorageApi()

const scan = ref<StorageScan | null>(null)
const loading = ref(false)
const busy = ref(false)
const olderThanDays = ref('30')

const dayOptions = computed(() => [
  { value: '7', label: t('settings.storage.days', { n: 7 }) },
  { value: '30', label: t('settings.storage.days', { n: 30 }) },
  { value: '90', label: t('settings.storage.days', { n: 90 }) },
  { value: '180', label: t('settings.storage.days', { n: 180 }) },
])

const parts = computed(() => {
  const s = scan.value
  if (!s) return []
  return [
    {
      key: 'snap',
      label: t('settings.storage.kind.snapshots'),
      bytes: s.snapshotBytes,
      color: 'var(--accent)',
    },
    {
      key: 'orph',
      label: t('settings.storage.kind.orphans'),
      bytes: s.orphanBytes,
      color: 'var(--danger)',
    },
    {
      key: 'tx',
      label: t('settings.storage.kind.transcripts'),
      bytes: s.transcriptBytes,
      color: 'var(--blue)',
    },
    {
      key: 'att',
      label: t('settings.storage.kind.attachments'),
      bytes: s.attachmentBytes,
      color: 'var(--amber)',
    },
  ].filter((p) => p.bytes > 0)
})

const biggest = computed(() => scan.value?.sessions.slice(0, 12) ?? [])
const maxProject = computed(() => scan.value?.projects[0]?.totalBytes ?? 1)

const pct = (b: number) => `${((b / Math.max(1, scan.value?.totalBytes ?? 1)) * 100).toFixed(2)}%`
const rel = (b: number) => `${((b / Math.max(1, maxProject.value)) * 100).toFixed(1)}%`

// Binary units — this is disk, and the OS reports the same way.
function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const projectName = (id: string | null) =>
  id ? (projects.projects.find((p) => p.id === id)?.name ?? id) : t('settings.storage.noProject')

async function refresh() {
  loading.value = true
  try {
    scan.value = await api.scan()
  } catch {
    scan.value = null
  } finally {
    loading.value = false
  }
}

// Reclaim is stated BEFORE the confirm, from the scan that is already on screen —
// "free 6.3 GB" is a decision the user can make; "delete snapshots" is not.
const reclaimable = computed(() => {
  const s = scan.value
  if (!s) return 0
  const cutoff = Date.now() - Number(olderThanDays.value) * 86_400_000
  return s.sessions
    .filter((x) => (x.updatedAt ? Date.parse(x.updatedAt) : 0) <= cutoff)
    .reduce((a, x) => a + x.snapshotBytes, 0)
})

// "Đã giải phóng 0 B từ 0 phiên" is a non-answer: the user clicked to reclaim
// space and nothing was reclaimed, which deserves saying plainly. `count ?? 0`
// is defensive on purpose — an older engine (the bundled sidecar only picks up a
// rebuild on app restart) still returns the pre-rename `sessionCount`, and a
// missing field must not turn into a broken-looking sentence.
function reportCleanup(res: { freedBytes?: number; count?: number }, key: 'freed' | 'freedFiles') {
  const bytes = res.freedBytes ?? 0
  if (bytes <= 0) {
    useToast().add({ title: t('settings.storage.nothingToClean'), color: 'info' })
    return
  }
  useToast().add({
    title: t(`settings.storage.${key}`, { size: fmt(bytes), n: res.count ?? 0 }),
    color: 'success',
  })
}

async function onPrune() {
  const ok = await confirm({
    title: t('settings.storage.cleanup.snapshots.confirmTitle'),
    description: t('settings.storage.cleanup.snapshots.confirmBody', {
      days: olderThanDays.value,
      size: fmt(reclaimable.value),
    }),
  })
  if (!ok) return
  busy.value = true
  try {
    reportCleanup(await api.pruneSnapshots(Number(olderThanDays.value)), 'freed')
    await refresh()
  } catch {
    useToast().add({ title: t('settings.storage.failed'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function onOrphans() {
  const s = scan.value
  if (!s) return
  const ok = await confirm({
    title: t('settings.storage.cleanup.orphans.confirmTitle'),
    description: t('settings.storage.cleanup.orphans.confirmBody', {
      n: s.orphanCount,
      size: fmt(s.orphanBytes),
    }),
  })
  if (!ok) return
  busy.value = true
  try {
    // `freedFiles`, not `freed`: this path counts FILES, and reusing the session
    // wording produced "freed 2.8 GB from 199 sessions" for 199 loose files.
    reportCleanup(await api.deleteOrphans(), 'freedFiles')
    await refresh()
  } catch {
    useToast().add({ title: t('settings.storage.failed'), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function onDeleteSession(s: SessionUsage) {
  const ok = await confirm({
    title: t('settings.storage.deleteSessionTitle'),
    description: t('settings.storage.deleteSessionBody', {
      title: s.title,
      size: fmt(s.totalBytes),
    }),
  })
  if (!ok) return
  busy.value = true
  try {
    await api.deleteSession(s.id)
    useToast().add({
      title: t('settings.storage.freed', { size: fmt(s.totalBytes), n: 1 }),
      color: 'success',
    })
    await refresh()
  } catch {
    useToast().add({ title: t('settings.storage.failed'), color: 'error' })
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  projects.hydrate().catch(() => undefined)
  refresh()
})
</script>

<style scoped>
.stoload {
  padding: 24px 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.stototal {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 0 12px;
}
.stobig {
  font-size: var(--fs-2xl);
  line-height: var(--lh-2xl);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.stosub {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.stobar {
  display: flex;
  height: 10px;
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--bgSubtle);
}
.stoseg {
  height: 100%;
}
.stolegend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 10px 0 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.stolg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.stolg b {
  color: var(--text);
  font-weight: 600;
}
.stodot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.storow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stolist {
  display: flex;
  flex-direction: column;
}
.storowi {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 4px;
  border-radius: var(--r-xs);
}
.storowi:hover {
  background: var(--bgHover);
}
.stonm {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.stominibar {
  flex: 0 0 120px;
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--bgSubtle);
  overflow: hidden;
}
.stominiseg {
  display: block;
  height: 100%;
}
.stoct {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.stosz {
  flex: 0 0 72px;
  text-align: right;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
</style>
