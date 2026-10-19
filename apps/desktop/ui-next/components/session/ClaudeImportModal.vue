<template>
  <!-- Dialog (reka) tự teleport ra body nên modal thoát mọi stacking context của panel.
       Một instance (AppGlobalHosts), lái bởi useClaudeImportModal().
       Esc do listener `onKey` của script xử lý (chặn khi đang import) — vì thế chặn
       đường Esc riêng của reka bằng `@escape-key-down.prevent`. -->
  <Dialog :open="isOpen" @update:open="(v) => !v && close()">
    <DialogContent
      class="flex h-[min(640px,84vh)] w-[94vw] max-w-190 flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 text-base text-card-foreground sm:max-w-190"
      @escape-key-down.prevent
    >
      <div class="flex shrink-0 items-start gap-2.5 px-4 pt-3.5 pb-3 pr-12">
        <Icon name="download" class="mt-0.5 size-4" />
        <DialogHeader class="min-w-0 flex-1 gap-0">
          <DialogTitle class="text-lg font-semibold">
            {{ t('sessions.claudeImport.title') }}
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            {{ t('sessions.claudeImport.subtitle') }}
          </DialogDescription>
        </DialogHeader>
      </div>
      <Separator />

      <div class="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
        <div class="relative min-w-0 flex-1">
          <Icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            v-model="filter"
            type="search"
            class="h-ctrl-sm border-transparent bg-muted pl-8 text-base shadow-none focus-visible:border-ring"
            :placeholder="t('sessions.claudeImport.filter')"
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          :spacing="1"
          class="shrink-0"
          :model-value="days"
          @update:model-value="(v) => v && (days = Number(v))"
        >
          <ToggleGroupItem
            v-for="d in DAY_OPTIONS"
            :key="d"
            :value="d"
            class="h-auto rounded-sm px-2.5 py-1 text-sm font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-primary"
          >
            {{ t('sessions.claudeImport.days', { n: d }) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Separator />

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2.5">
        <div v-if="loading" class="px-3 py-7 text-center text-muted-foreground">
          {{ t('sessions.claudeImport.loading') }}
        </div>
        <div v-else-if="loadError" class="px-3 py-7 text-center text-destructive">
          {{ t('sessions.claudeImport.loadFailed') }} {{ loadError }}
        </div>
        <div v-else-if="!items.length" class="px-3 py-7 text-center text-muted-foreground">
          {{ t('sessions.claudeImport.empty') }}
        </div>
        <div v-else-if="!groups.length" class="px-3 py-7 text-center text-muted-foreground">
          {{ t('sessions.claudeImport.noMatch') }}
        </div>
        <template v-else>
          <section v-for="g in groups" :key="g.projectId" class="mt-1.5">
            <label
              class="sticky top-0 z-1 flex cursor-pointer items-center gap-2 bg-card px-2 py-1.5 text-sm font-semibold text-muted-foreground"
              :title="t('sessions.claudeImport.selectProject', { name: g.name })"
            >
              <AppCheckbox
                :checked="g.state === 'all'"
                :indeterminate="g.state === 'some'"
                :disabled="g.selectable.length === 0 || importing"
                @update:checked="toggleGroup(g)"
              />
              <Icon name="folder" class="size-3.5" />
              <span class="min-w-0 truncate">{{ g.name }}</span>
              <span class="font-medium tabular-nums">{{ g.items.length }}</span>
            </label>
            <label
              v-for="it in g.items"
              :key="it.id"
              class="flex items-center gap-2.5 rounded-sm py-1.5 pr-2 pl-3"
              :class="
                it.importedSessionId
                  ? 'cursor-default opacity-55'
                  : 'cursor-pointer hover:bg-accent'
              "
              :title="it.cwd"
            >
              <AppCheckbox
                :checked="selected.has(it.id)"
                :disabled="!!it.importedSessionId || importing"
                @update:checked="toggleOne(it.id)"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate">{{ it.title }}</span>
                <span class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    class="shrink-0 px-1.5 py-0 font-semibold"
                    :class="
                      it.entrypoint === 'cli' ? 'text-muted-foreground' : 'border-ring text-primary'
                    "
                  >
                    {{
                      it.entrypoint === 'cli'
                        ? t('sessions.claudeImport.srcCli')
                        : t('sessions.claudeImport.srcDesktop')
                    }}
                  </Badge>
                  <span v-if="it.gitBranch" class="inline-flex min-w-0 items-center gap-1">
                    <Icon name="branch" class="size-3" />
                    <span class="truncate">{{ it.gitBranch }}</span>
                  </span>
                </span>
              </span>
              <span
                class="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground tabular-nums"
              >
                <span v-if="it.importedSessionId" class="font-semibold text-primary">
                  {{ t('sessions.claudeImport.imported') }}
                </span>
                <span>
                  {{ t('sessions.claudeImport.turns', { n: it.userTurns }) }}
                </span>
                <span class="min-w-14 text-right">{{ formatRelativeAgo(it.lastAt, t, now) }}</span>
              </span>
            </label>
          </section>
        </template>
      </div>

      <Separator />
      <div class="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
        <span class="flex min-w-0 flex-1 flex-col text-xs text-muted-foreground">
          <span v-if="skipped.noProject">
            {{ t('sessions.claudeImport.skippedNoProject', { n: skipped.noProject }) }}
          </span>
          <span v-if="skipped.unreadable">
            {{ t('sessions.claudeImport.skippedUnreadable', { n: skipped.unreadable }) }}
          </span>
        </span>
        <span class="text-sm text-muted-foreground">
          {{ t('sessions.claudeImport.selected', { n: selected.size }) }}
        </span>
        <Button variant="outline" size="sm" @click="close">{{ t('common.cancel') }}</Button>
        <Button size="sm" :disabled="!selected.size || importing" @click="runImport">
          {{
            importing
              ? t('sessions.claudeImport.importing')
              : t('sessions.claudeImport.import', { n: selected.size })
          }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Manual import of Claude Desktop / CLI sessions (docs/features/claude-session-import.md).
// The sidecar already restricts the list to sessions inside an AWOG project and flags
// the ones imported before (`importedSessionId`), so this component only selects + sends.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useClaudeImportModal } from '~/composables/useClaudeImportModal'
import { useI18n } from '~/composables/useI18n'
import { useNow } from '~/composables/useNow'
import { useToast } from '~/composables/useToast'
import { useSessionsStore } from '~/stores/sessions'
import type { ClaudeSessionItem } from '~/types'
import { formatRelativeAgo } from '~/utils/relative-time'

type Group = {
  projectId: string
  name: string
  items: ClaudeSessionItem[]
  // Rows that can still be ticked (not imported yet).
  selectable: ClaudeSessionItem[]
  state: 'none' | 'some' | 'all'
}

const DAY_OPTIONS = [7, 30, 90] as const

const { t } = useI18n()
const { isOpen, close } = useClaudeImportModal()
const store = useSessionsStore()
const toast = useToast()
const now = useNow()

const days = ref<number>(30)
const filter = ref('')
const loading = ref(false)
const loadError = ref('')
const importing = ref(false)
const items = ref<ClaudeSessionItem[]>([])
const skipped = ref({ noProject: 0, unreadable: 0 })
const selected = ref<Set<string>>(new Set())

// A stale response (days toggled quickly) must not overwrite the newer one.
let loadSeq = 0
async function load(): Promise<void> {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const res = await store.listClaudeSessions(days.value)
    if (seq !== loadSeq) return
    items.value = res.items
    skipped.value = res.skipped
    // Keep only ticks that still exist and are still importable.
    const ok = new Set(res.items.filter((i) => !i.importedSessionId).map((i) => i.id))
    selected.value = new Set([...selected.value].filter((id) => ok.has(id)))
  } catch (err) {
    if (seq !== loadSeq) return
    loadError.value = err instanceof Error ? err.message : String(err)
    items.value = []
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(isOpen, (open) => {
  if (!open) return
  filter.value = ''
  selected.value = new Set()
  void load()
})
watch(days, () => {
  if (isOpen.value) void load()
})

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const groups = computed<Group[]>(() => {
  const q = norm(filter.value.trim())
  const byProject = new Map<string, Group>()
  for (const it of items.value) {
    if (q && !norm(`${it.title} ${it.gitBranch ?? ''} ${it.projectName}`).includes(q)) continue
    let g = byProject.get(it.projectId)
    if (!g) {
      g = {
        projectId: it.projectId,
        name: it.projectName,
        items: [],
        selectable: [],
        state: 'none',
      }
      byProject.set(it.projectId, g)
    }
    g.items.push(it)
    if (!it.importedSessionId) g.selectable.push(it)
  }
  const out = [...byProject.values()]
  for (const g of out) {
    const n = g.selectable.filter((i) => selected.value.has(i.id)).length
    g.state = n === 0 ? 'none' : n === g.selectable.length ? 'all' : 'some'
  }
  // Items arrive newest-first, so Map insertion order already puts the project with the
  // most recent activity first.
  return out
})

function toggleOne(id: string): void {
  const next = new Set(selected.value)
  if (!next.delete(id)) next.add(id)
  selected.value = next
}

function toggleGroup(g: Group): void {
  const next = new Set(selected.value)
  if (g.state === 'all') for (const i of g.selectable) next.delete(i.id)
  else for (const i of g.selectable) next.add(i.id)
  selected.value = next
}

async function runImport(): Promise<void> {
  if (!selected.value.size || importing.value) return
  importing.value = true
  try {
    const res = await store.importClaudeSessions([...selected.value])
    if (res.imported.length) {
      toast.add({
        title: t('sessions.claudeImport.toast.done', { n: res.imported.length }),
        description: res.skipped.length
          ? t('sessions.claudeImport.toast.skipped', { n: res.skipped.length })
          : undefined,
        color: 'success',
      })
    } else {
      toast.add({
        title: t('sessions.claudeImport.toast.skipped', { n: res.skipped.length }),
        color: 'warning',
      })
    }
    selected.value = new Set()
    await load()
  } catch (err) {
    toast.add({
      title: t('sessions.claudeImport.toast.failed'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    })
  } finally {
    importing.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value && !importing.value) close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
