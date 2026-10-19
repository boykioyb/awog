<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- Top row: wide search + NEW HOST -->
    <div class="flex shrink-0 items-center gap-2.5 px-4 py-3.5">
      <div class="relative min-w-0 flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="q"
          class="pl-8"
          :placeholder="t('ssh.hosts.searchPh')"
          :aria-label="t('ssh.hosts.searchPh')"
          @keydown.enter="connectFirst"
        />
      </div>
      <Button
        :title="t('ssh.import.title')"
        class="shrink-0"
        variant="outline"
        @click="emit('import')"
      >
        <Icon name="download" />
        {{ t('ssh.import.button') }}
      </Button>
      <Button
        :title="t('ssh.hosts.newHost')"
        class="shrink-0"
        variant="default"
        @click="emit('new')"
      >
        <Icon name="plus" />
        {{ t('ssh.hosts.newHost') }}
      </Button>
    </div>
    <Separator />

    <!-- Tag filter chips (only when any host has tags) -->
    <template v-if="allTags.length">
      <div class="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2.5">
        <Button
          v-for="tag in allTags"
          :key="tag"
          variant="outline"
          size="xs"
          class="font-normal"
          :class="
            activeTags.has(tag)
              ? 'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
              : 'text-muted-foreground'
          "
          :aria-pressed="activeTags.has(tag)"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </Button>
        <Button
          v-if="activeTags.size"
          variant="ghost"
          size="xs"
          class="font-normal text-faint hover:bg-transparent hover:text-foreground"
          @click="activeTags = new Set()"
        >
          {{ t('ssh.hosts.clearTags') }}
        </Button>
      </div>
      <Separator />
    </template>

    <!-- Grouped-by-folder card grid -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <template v-if="filtered.length">
        <section v-for="g in groups" :key="g.label ?? '__none'" class="flex flex-col">
          <div
            v-if="g.label"
            class="flex items-center gap-2 px-4 pt-3.5 pb-0.5 text-sm font-semibold text-muted-foreground"
          >
            <Icon name="folder" class="size-3.5" />
            <span class="truncate font-medium">{{ g.label }}</span>
            <span class="font-normal text-faint tabular-nums">{{ g.hosts.length }}</span>
          </div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 px-4 pt-3 pb-1.5">
            <!-- raw-ok: cả thẻ host là một vùng bấm (connect), nút ⋯ lồng bên trong là span. -->
            <button
              v-for="h in g.hosts"
              :key="h.id"
              type="button"
              class="group flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition hover:-translate-y-px hover:border-input hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              :title="cardTitle(h)"
              @click="emit('connect', h)"
              @contextmenu.prevent="emit('menu', $event, h)"
            >
              <!-- Màu monogram sinh theo folder/host (HSL dữ liệu, không phải token theme). -->
              <span
                class="grid size-10 shrink-0 place-items-center rounded-lg text-lg font-semibold"
                :style="monoStyle(h)"
              >
                {{ initial(h) }}
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-base font-medium text-foreground">
                  {{ h.name || h.host }}
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ t('ssh.hosts.sub', { user: h.user || '—' }) }}
                </span>
                <span v-if="h.tags?.length" class="mt-0.5 flex flex-wrap gap-1">
                  <Badge
                    v-for="tag in h.tags"
                    :key="tag"
                    variant="outline"
                    class="font-normal text-muted-foreground"
                  >
                    {{ tag }}
                  </Badge>
                </span>
              </span>
              <!-- span role=button: không được lồng nút trong nút (thẻ host đã là nút). -->
              <span
                class="grid size-ctrl-xs shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                role="button"
                :title="t('ssh.menu.more')"
                :aria-label="t('ssh.menu.more')"
                @click.stop="emit('menu', $event, h)"
              >
                <Icon name="dots" class="size-4" />
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
