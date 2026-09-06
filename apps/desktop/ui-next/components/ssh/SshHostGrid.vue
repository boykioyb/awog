<template>
  <div class="sshx-hosts">
    <!-- Top row: wide search + NEW HOST -->
    <div class="sshx-hosts-top">
      <div class="srch sshx-search">
        <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <input
          v-model="q"
          :placeholder="t('ssh.hosts.searchPh')"
          :aria-label="t('ssh.hosts.searchPh')"
          @keydown.enter="connectFirst"
        />
      </div>
      <button class="btn sshx-import" :title="t('ssh.import.title')" @click="emit('import')">
        <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('ssh.import.button') }}
      </button>
      <button class="btn pri sshx-newhost" :title="t('ssh.hosts.newHost')" @click="emit('new')">
        <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('ssh.hosts.newHost') }}
      </button>
    </div>

    <!-- Tag filter chips (only when any host has tags) -->
    <div v-if="allTags.length" class="sshx-tagbar">
      <button
        v-for="tag in allTags"
        :key="tag"
        class="sshx-tagchip"
        :class="{ on: activeTags.has(tag) }"
        :aria-pressed="activeTags.has(tag)"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
      <button v-if="activeTags.size" class="sshx-tagclear" @click="activeTags = new Set()">
        {{ t('ssh.hosts.clearTags') }}
      </button>
    </div>

    <!-- Grouped-by-folder card grid -->
    <div class="sshx-grid-scroll">
      <template v-if="filtered.length">
        <section v-for="g in groups" :key="g.label ?? '__none'" class="sshx-group">
          <div v-if="g.label" class="sshx-grouphdr">
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="sshx-grouphdr-name">{{ g.label }}</span>
            <span class="sshx-grouphdr-count">{{ g.hosts.length }}</span>
          </div>
          <div class="sshx-grid">
            <button
              v-for="h in g.hosts"
              :key="h.id"
              class="sshx-card"
              :title="cardTitle(h)"
              @click="emit('connect', h)"
              @contextmenu.prevent="emit('menu', $event, h)"
            >
              <span class="sshx-card-mono" :style="monoStyle(h)">{{ initial(h) }}</span>
              <span class="sshx-card-main">
                <span class="sshx-card-name">{{ h.name || h.host }}</span>
                <span class="sshx-card-sub">{{ t('ssh.hosts.sub', { user: h.user || '—' }) }}</span>
                <span v-if="h.tags?.length" class="sshx-card-tags">
                  <span v-for="tag in h.tags" :key="tag" class="sshx-card-tag">{{ tag }}</span>
                </span>
              </span>
              <span
                class="sshx-card-menu"
                role="button"
                :title="t('ssh.menu.more')"
                :aria-label="t('ssh.menu.more')"
                @click.stop="emit('menu', $event, h)"
              >
                <Icon name="dots" style="width: var(--icon-md); height: var(--icon-md)" />
              </span>
            </button>
          </div>
        </section>
      </template>

      <SshEmptyState
        v-else
        icon="conn"
        :title="isFiltering ? t('ssh.hosts.noMatch') : t('ssh.hosts.emptyTitle')"
        :body="isFiltering ? t('ssh.hosts.noMatchBody') : t('ssh.hosts.emptyBody')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Hosts section of the SSH workspace — search + tag-filter over a card grid GROUPED
// by folder (Termius-style). Each card: colored monogram (seeded by folder) + name +
// `ssh, <user>` + tag chips. Click connects; ⋯ / right-click opens the action menu.
// Presentational — all mutations bubble to the page via events.
import { computed, ref } from 'vue'
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import { hostAccent, type SshHost } from '~/stores/ssh'

const props = defineProps<{ hosts: SshHost[] }>()

const emit = defineEmits<{
  connect: [host: SshHost]
  menu: [event: MouseEvent, host: SshHost]
  new: []
  import: []
}>()

const { t } = useI18n()

const q = ref('')
const activeTags = ref<Set<string>>(new Set())
const isFiltering = computed(() => !!q.value.trim() || activeTags.value.size > 0)

const searchText = (h: SshHost): string =>
  `${h.name} ${h.host} ${h.user} ${h.tags?.join(' ') ?? ''} ${h.folder ?? ''}`.toLowerCase()

// Union of all tags across hosts → the filter bar.
const allTags = computed(() => {
  const set = new Set<string>()
  for (const h of props.hosts) for (const tag of h.tags ?? []) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})
const toggleTag = (tag: string): void => {
  const next = new Set(activeTags.value)
  if (next.has(tag)) next.delete(tag)
  else next.add(tag)
  activeTags.value = next
}

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase()
  const tags = activeTags.value
  return props.hosts.filter((h) => {
    if (query && !searchText(h).includes(query)) return false
    // Tag filter: OR — a host with ANY active tag matches.
    if (tags.size && !(h.tags ?? []).some((tg) => tags.has(tg))) return false
    return true
  })
})

// Group by folder. Named folders A→Z, ungrouped last. When NO host has a folder,
// labels are null → flat grid (no headers).
const groups = computed<{ label: string | null; hosts: SshHost[] }[]>(() => {
  const map = new Map<string, SshHost[]>()
  for (const h of filtered.value) {
    const key = h.folder?.trim() || ''
    const arr = map.get(key)
    if (arr) arr.push(h)
    else map.set(key, [h])
  }
  const hasFolders = [...map.keys()].some((k) => k !== '')
  const keys = [...map.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  return keys.map((k) => ({
    label: hasFolders ? k || t('ssh.hosts.ungrouped') : null,
    hosts: map.get(k) ?? [],
  }))
})

const initial = (h: SshHost): string => (h.name || h.host || '?').charAt(0).toUpperCase()
const cardTitle = (h: SshHost): string => `${h.name || h.host} · ${h.user}@${h.host}:${h.port}`

const monoStyle = (h: SshHost) => {
  const a = hostAccent(h.folder || h.name || h.host)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
}

// Enter in the search box connects the first filtered host.
const connectFirst = () => {
  const first = filtered.value[0]
  if (first) emit('connect', first)
}
</script>

<style scoped>
.sshx-hosts {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sshx-hosts-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-search {
  flex: 1;
  min-width: 0;
}
.sshx-import {
  flex: 0 0 auto;
}
.sshx-newhost {
  flex: 0 0 auto;
}
/* Tag filter bar */
.sshx-tagbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-tagchip {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition:
    border-color 0.12s,
    color 0.12s,
    background 0.12s;
}
.sshx-tagchip:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.sshx-tagchip.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.sshx-tagclear {
  height: 24px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--textFaint);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.sshx-tagclear:hover {
  color: var(--text);
}
.sshx-grid-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
/* Folder group */
.sshx-group {
  display: flex;
  flex-direction: column;
}
.sshx-grouphdr {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 18px 2px;
  color: var(--textDim);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.sshx-grouphdr-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sshx-grouphdr-count {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
  font-weight: 400;
}
.sshx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding: 12px 18px 6px;
}
.sshx-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    transform 0.12s;
}
.sshx-card:hover {
  border-color: var(--borderStrong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}
.sshx-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.sshx-card-mono {
  width: 40px;
  height: 40px;
  border-radius: var(--r-btn);
  display: grid;
  place-items: center;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  flex: 0 0 auto;
}
.sshx-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sshx-card-name {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sshx-card-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sshx-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.sshx-card-tag {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  white-space: nowrap;
}
.sshx-card-menu {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  opacity: 0;
  flex: 0 0 auto;
  transition:
    opacity 0.12s,
    background 0.12s,
    color 0.12s;
}
.sshx-card:hover .sshx-card-menu,
.sshx-card:focus-within .sshx-card-menu {
  opacity: 1;
}
.sshx-card-menu:hover {
  background: var(--bgActive);
  color: var(--text);
}
</style>
