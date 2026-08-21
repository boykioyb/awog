<template>
  <!-- No enabled source = no chip: an "MCP 0/0" control would only offer to
       whitelist servers that do not exist. -->
  <span
    v-if="servers.length"
    class="chip sm chipbtn"
    :title="t('sessions.config.mcpHint')"
    style="position: relative"
    :style="
      open || customized ? { borderColor: 'var(--accentBorder)', color: 'var(--accent)' } : {}
    "
    @click.stop="emit('toggle')"
  >
    <Icon name="conn" style="width: 12px; height: 12px" />
    {{ t('sessions.composer.mcp') }}
    <span class="mcpc">{{ onCount }}/{{ servers.length }}</span>
    <Icon name="chev" style="width: 11px; height: 11px" />

    <div
      v-if="open"
      class="pop mcppop"
      style="position: absolute; bottom: 130%; left: 0; z-index: 50"
      @click.stop
    >
      <div class="pl">{{ t('sessions.config.mcpHint') }}</div>
      <div v-for="m in servers" :key="m.id" class="mcprow" @click="toggleMcp(m.id)">
        <span
          class="mcpdot"
          :style="{ background: m.status === 'connected' ? 'var(--green)' : 'var(--textFaint)' }"
        />
        <span class="mcpn">{{ m.name }}</span>
        <span class="mcpst">{{ m.status }}</span>
        <span class="tog2 sm" :class="{ off: !onSet.has(m.id) }" />
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
// Per-session MCP whitelist as a composer chip (moved off the config popover's MCP
// tab): the allowed connections are a per-turn decision, so they belong next to the
// Mode chip rather than behind the header gear. Open state is owned by the composer
// (one popover at a time + its click-away overlay).
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const store = useSessionsStore()
const connections = useConnectionsStore()

// Only enabled sources can serve tools, so only they are whitelistable.
const servers = computed(() =>
  connections.mcpServers
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name || s.slug,
      status: s.connectionStatus ?? 'untested',
    })),
)

// undefined whitelist = "all enabled servers on" (legacy default); an explicit array
// is the whitelist. The first toggle materialises the full set so a tick reads as
// include and an untick as exclude.
const onSet = computed<Set<string>>(() => {
  const ids = store.active?.mcpServerIds
  if (ids === undefined) return new Set(servers.value.map((m) => m.id))
  return new Set(ids)
})
const onCount = computed(() => servers.value.filter((m) => onSet.value.has(m.id)).length)
// Chip reads accented while the session deviates from "everything on".
const customized = computed(() => onCount.value < servers.value.length)

function toggleMcp(id: string) {
  if (store.activeId == null) return
  const next = new Set(onSet.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  store.setMcpServerIds(store.activeId, [...next])
}

onMounted(() => {
  if (!connections.loaded) void connections.loadSources()
})

// Close the popover if the session switches under it (the whitelist it edits changed).
watch(
  () => store.activeId,
  () => {
    if (props.open) emit('toggle')
  },
)
</script>

<style scoped>
/* Fixed-size count badge (not em-scaled) — same rule as the other count chips. */
.mcpc {
  font-size: 12px;
  font-family: var(--code);
  line-height: 1;
  color: var(--textFaint);
}
/* Popover opens upward from the composer bar; narrower than the header config pop.
   `white-space: normal` resets the value inherited from the chip: the chip is nowrap,
   which made the hint line one long row and gave the popover a horizontal scrollbar
   (`.pop` sets overflow-y, so the x axis computes to auto). */
.mcppop {
  width: 258px;
  white-space: normal;
  overflow-x: hidden;
  /* Chip text is the code font; popover content reads as UI text. */
  font-family: var(--sans);
}
.mcpdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
/* One long connection name truncates instead of widening the row. */
.mcppop .mcpn {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
