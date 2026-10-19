<template>
  <div>
    <SettingsPaneHeader :title="t('settings.storage.heading')" />

    <div v-if="loading && !scan" class="py-6 text-sm text-dim">
      {{ t('settings.storage.scanning') }}
    </div>

    <template v-else-if="scan">
      <!-- Total + what makes it up. The bar is the answer to "how heavy is it";
           the legend is the answer to "what is it made of", which is what decides
           whether there is anything worth deleting. -->
      <div class="flex items-baseline gap-2.5 pt-1 pb-3">
        <span class="text-2xl font-semibold text-foreground tabular-nums">
          {{ fmt(scan.totalBytes) }}
        </span>
        <span class="text-sm text-dim">
          {{ t('settings.storage.summary', { s: scan.sessions.length, p: scan.projects.length }) }}
        </span>
        <span class="flex-1" />
        <Button :disabled="loading" variant="outline" size="sm" @click="refresh">
          <Icon name="refresh" class="size-3" />
          {{ t('settings.storage.refresh') }}
        </Button>
      </div>

      <!-- Thanh xếp chồng: bề rộng mỗi đoạn là tỉ lệ dữ liệu (inline width). -->
      <div class="flex h-2.5 overflow-hidden rounded-full bg-muted">
        <span
          v-for="p in parts"
          :key="p.key"
          class="h-full"
          :class="p.colorClass"
          :style="{ width: pct(p.bytes) }"
          :title="`${p.label} — ${fmt(p.bytes)}`"
        />
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1.5 pt-2.5 pb-1 text-xs text-dim">
        <span v-for="p in parts" :key="p.key" class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full" :class="p.colorClass" />
          {{ p.label }}
          <b class="font-semibold text-foreground tabular-nums">{{ fmt(p.bytes) }}</b>
        </span>
      </div>

      <!-- Cleanup. Both actions state the exact reclaim before asking. -->
      <SettingsGroupLabel>{{ t('settings.storage.cleanup.heading') }}</SettingsGroupLabel>

      <SettingsField
        :name="t('settings.storage.cleanup.snapshots.name')"
        :desc="t('settings.storage.cleanup.snapshots.desc')"
      >
        <div class="flex items-center gap-2">
          <AppSelect v-model="olderThanDays" :options="dayOptions" width="132px" />
          <Button
            :disabled="busy || !scan.snapshotBytes"
            variant="danger"
            size="sm"
            @click="onPrune"
          >
            {{ t('settings.storage.cleanup.snapshots.action') }}
          </Button>
        </div>
      </SettingsField>

      <SettingsField
        :name="t('settings.storage.cleanup.orphans.name')"
        :desc="t('settings.storage.cleanup.orphans.desc')"
      >
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="text-muted-foreground">
            {{ t('settings.storage.cleanup.orphans.count', { n: scan.orphanCount }) }}
            · {{ fmt(scan.orphanBytes) }}
          </Badge>
          <Button
            :disabled="busy || !scan.orphanCount"
            variant="danger"
            size="sm"
            @click="onOrphans"
          >
            {{ t('settings.storage.cleanup.orphans.action') }}
          </Button>
        </div>
      </SettingsField>

      <!-- Per project: the breakdown the question was actually about. -->
      <SettingsGroupLabel>{{ t('settings.storage.byProject') }}</SettingsGroupLabel>
      <div class="flex flex-col">
        <div
          v-for="p in scan.projects"
          :key="p.projectId ?? '-'"
          class="flex h-ctrl-sm items-center gap-2.5 rounded-sm px-1 hover:bg-accent"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-foreground">
            {{ projectName(p.projectId) }}
          </span>
          <span class="h-1.5 w-30 shrink-0 overflow-hidden rounded-full bg-muted">
            <span class="block h-full bg-primary" :style="{ width: rel(p.totalBytes) }" />
          </span>
          <span class="shrink-0 text-xs text-faint tabular-nums">
            {{ t('settings.storage.nSessions', { n: p.sessionCount }) }}
          </span>
          <span class="w-18 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
            {{ fmt(p.totalBytes) }}
          </span>
        </div>
      </div>

      <!-- The handful of sessions that dominate. Deleting one of these is often
           the whole fix, and it is not discoverable from the session list. -->
      <SettingsGroupLabel>{{ t('settings.storage.biggest') }}</SettingsGroupLabel>
      <div class="flex flex-col">
        <div
          v-for="s in biggest"
          :key="s.id"
          class="flex h-ctrl-sm items-center gap-2.5 rounded-sm px-1 hover:bg-accent"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-foreground" :title="s.title">
            {{ s.title }}
          </span>
          <span class="shrink-0 text-xs text-faint">{{ projectName(s.projectId) }}</span>
          <span class="w-18 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
            {{ fmt(s.totalBytes) }}
          </span>
          <Button
            :disabled="busy"
            :title="t('settings.storage.deleteSession')"
            :aria-label="t('settings.storage.deleteSession')"
            variant="danger"
            size="sm"
            @click="onDeleteSession(s)"
          >
            <Icon name="trash" class="size-3" />
          </Button>
        </div>
      </div>
    </template>

    <div v-else class="py-6 text-sm text-dim">{{ t('settings.storage.unavailable') }}</div>
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
import type { StorageScan, StorageSessionUsage } from '~/composables/useStorageApi'

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
      colorClass: 'bg-primary',
    },
    {
      key: 'orph',
      label: t('settings.storage.kind.orphans'),
      bytes: s.orphanBytes,
      colorClass: 'bg-destructive',
    },
    {
      key: 'tx',
      label: t('settings.storage.kind.transcripts'),
      bytes: s.transcriptBytes,
      colorClass: 'bg-info',
    },
    {
      key: 'att',
      label: t('settings.storage.kind.attachments'),
      bytes: s.attachmentBytes,
      colorClass: 'bg-warning',
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

async function onDeleteSession(s: StorageSessionUsage) {
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
