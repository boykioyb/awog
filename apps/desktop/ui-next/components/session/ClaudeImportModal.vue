<template>
  <!-- Teleport to body so the modal escapes any panel stacking context. Single
       instance (AppGlobalHosts), driven by useClaudeImportModal(). -->
  <Teleport to="body">
    <div v-if="isOpen" class="ovl on cimpovl" @click.self="close">
      <div
        class="cimp"
        role="dialog"
        aria-modal="true"
        :aria-label="t('sessions.claudeImport.title')"
      >
        <div class="cimp-head">
          <Icon name="download" style="width: var(--icon-md); height: var(--icon-md)" />
          <div class="cimp-titles">
            <div class="cimp-title">{{ t('sessions.claudeImport.title') }}</div>
            <div class="cimp-sub">{{ t('sessions.claudeImport.subtitle') }}</div>
          </div>
          <button class="cimp-x" type="button" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="cimp-bar">
          <div class="cimp-search">
            <Icon
              name="search"
              class="cimp-search-ic"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            <input
              v-model="filter"
              class="cimp-input"
              type="search"
              :placeholder="t('sessions.claudeImport.filter')"
            />
          </div>
          <div class="cimp-seg" role="tablist">
            <button
              v-for="d in DAY_OPTIONS"
              :key="d"
              type="button"
              role="tab"
              class="cimp-seg-btn"
              :class="{ on: days === d }"
              :aria-selected="days === d"
              @click="days = d"
            >
              {{ t('sessions.claudeImport.days', { n: d }) }}
            </button>
          </div>
        </div>

        <div class="cimp-body">
          <div v-if="loading" class="cimp-note">{{ t('sessions.claudeImport.loading') }}</div>
          <div v-else-if="loadError" class="cimp-note err">
            {{ t('sessions.claudeImport.loadFailed') }} {{ loadError }}
          </div>
          <div v-else-if="!items.length" class="cimp-note">
            {{ t('sessions.claudeImport.empty') }}
          </div>
          <div v-else-if="!groups.length" class="cimp-note">
            {{ t('sessions.claudeImport.noMatch') }}
          </div>
          <template v-else>
            <section v-for="g in groups" :key="g.projectId" class="cimp-group">
              <label
                class="cimp-ghead"
                :title="t('sessions.claudeImport.selectProject', { name: g.name })"
              >
                <input
                  type="checkbox"
                  class="cimp-check"
                  :checked="g.state === 'all'"
                  :indeterminate="g.state === 'some'"
                  :disabled="g.selectable.length === 0 || importing"
                  @change="toggleGroup(g)"
                />
                <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
                <span class="cimp-gname">{{ g.name }}</span>
                <span class="cimp-gcount">{{ g.items.length }}</span>
              </label>
              <label
                v-for="it in g.items"
                :key="it.id"
                class="cimp-row"
                :class="{ done: !!it.importedSessionId }"
                :title="it.cwd"
              >
                <input
                  type="checkbox"
                  class="cimp-check"
                  :checked="selected.has(it.id)"
                  :disabled="!!it.importedSessionId || importing"
                  @change="toggleOne(it.id)"
                />
                <span class="cimp-main">
                  <span class="cimp-rtitle">{{ it.title }}</span>
                  <span class="cimp-meta">
                    <span class="cimp-badge" :class="it.entrypoint === 'cli' ? 'cli' : 'desk'">
                      {{
                        it.entrypoint === 'cli'
                          ? t('sessions.claudeImport.srcCli')
                          : t('sessions.claudeImport.srcDesktop')
                      }}
                    </span>
                    <span v-if="it.gitBranch" class="cimp-branch">
                      <Icon name="branch" style="width: var(--icon-xs); height: var(--icon-xs)" />
                      <span class="cimp-branch-n">{{ it.gitBranch }}</span>
                    </span>
                  </span>
                </span>
                <span class="cimp-side">
                  <span v-if="it.importedSessionId" class="cimp-done">
                    {{ t('sessions.claudeImport.imported') }}
                  </span>
                  <span class="cimp-turns">
                    {{ t('sessions.claudeImport.turns', { n: it.userTurns }) }}
                  </span>
                  <span class="cimp-when">{{ formatRelativeAgo(it.lastAt, t, now) }}</span>
                </span>
              </label>
            </section>
          </template>
        </div>

        <div class="cimp-foot">
          <span class="cimp-skip">
            <span v-if="skipped.noProject">
              {{ t('sessions.claudeImport.skippedNoProject', { n: skipped.noProject }) }}
            </span>
            <span v-if="skipped.unreadable">
              {{ t('sessions.claudeImport.skippedUnreadable', { n: skipped.unreadable }) }}
            </span>
          </span>
          <span class="cimp-count">
            {{ t('sessions.claudeImport.selected', { n: selected.size }) }}
          </span>
          <button class="cimp-btn" type="button" @click="close">{{ t('common.cancel') }}</button>
          <button
            class="cimp-btn pri"
            type="button"
            :disabled="!selected.size || importing"
            @click="runImport"
          >
            {{
              importing
                ? t('sessions.claudeImport.importing')
                : t('sessions.claudeImport.import', { n: selected.size })
            }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
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

<style scoped>
.cimpovl {
  align-items: center;
  padding: 24px;
  z-index: 130;
}
.cimp {
  width: min(760px, 94vw);
  height: min(640px, 84vh);
  display: flex;
  flex-direction: column;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--r-panel);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.cimp-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px 12px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cimp-titles {
  flex: 1;
  min-width: 0;
}
.cimp-title {
  font-weight: 600;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
}
.cimp-sub {
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.cimp-x {
  background: transparent;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--r-xs);
  display: inline-flex;
}
.cimp-x:hover {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.cimp-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cimp-search {
  position: relative;
  flex: 1;
  min-width: 0;
}
.cimp-search-ic {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: var(--muted-foreground);
}
.cimp-input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: var(--muted);
  color: var(--foreground);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  outline: none;
}
.cimp-input:focus {
  border-color: var(--ring);
}
.cimp-seg {
  display: inline-flex;
  gap: 4px;
  flex: none;
}
.cimp-seg-btn {
  padding: 5px 10px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  font-weight: 500;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.cimp-seg-btn:hover {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
.cimp-seg-btn.on {
  color: var(--primary);
  border-color: var(--ring);
  background: var(--accent-wash);
}
.cimp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px 10px;
}
.cimp-note {
  padding: 28px 12px;
  text-align: center;
  color: var(--muted-foreground);
}
.cimp-note.err {
  color: var(--destructive);
}
.cimp-group {
  margin-top: 6px;
}
.cimp-ghead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: var(--muted-foreground);
  font-weight: 600;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  position: sticky;
  top: 0;
  background: var(--card);
  z-index: 1;
}
.cimp-gname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cimp-gcount {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.cimp-check {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.cimp-check:disabled {
  cursor: not-allowed;
}
.cimp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 12px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.cimp-row:hover {
  background: var(--accent-wash);
}
.cimp-row.done {
  opacity: 0.55;
  cursor: default;
}
.cimp-row.done:hover {
  background: transparent;
}
.cimp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cimp-rtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cimp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.cimp-badge {
  flex: none;
  padding: 0 6px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  font-weight: 600;
}
.cimp-badge.desk {
  color: var(--primary);
  border-color: var(--ring);
}
.cimp-branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.cimp-branch-n {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cimp-side {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.cimp-done {
  color: var(--primary);
  font-weight: 600;
}
.cimp-when {
  min-width: 56px;
  text-align: right;
}
.cimp-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  box-shadow: inset 0 1px 0 var(--border);
}
.cimp-skip {
  flex: 1;
  min-width: 0;
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  display: flex;
  flex-direction: column;
}
.cimp-count {
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.cimp-btn {
  font-weight: 500;
  padding: 6px 12px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--foreground);
  cursor: pointer;
}
.cimp-btn:hover {
  background: var(--accent-wash);
}
.cimp-btn.pri {
  border-color: transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}
.cimp-btn.pri:hover {
  background: var(--primary);
  filter: brightness(1.08);
}
.cimp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
