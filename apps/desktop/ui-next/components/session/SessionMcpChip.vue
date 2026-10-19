<template>
  <!-- Biến thể `inline` (session-ui-refactor §3.7): chỉ danh sách nguồn, không chip
       không popover — dùng khi nó nằm SẴN trong menu `⋯` của composer, nơi một
       popover lồng trong popover sẽ che mất chính menu chứa nó. -->
  <template v-if="variant === 'inline' && servers.length">
    <div class="mb-2 text-xs font-medium text-muted-foreground">
      {{ t('sessions.config.mcpHint') }}
    </div>
    <div
      v-for="m in servers"
      :key="m.id"
      class="flex cursor-pointer items-center gap-2 border-t py-2 text-base first-of-type:border-t-0"
      @click.stop="toggleMcp(m.id)"
    >
      <span
        class="size-2 flex-none rounded-full"
        :class="m.status === 'connected' ? 'bg-success' : 'bg-faint'"
      />
      <span class="min-w-0 truncate text-foreground">{{ m.name }}</span>
      <span class="ml-auto text-sm text-faint">{{ m.status }}</span>
      <!-- Công tắc chỉ để hiển thị — cả hàng là vùng bấm, nên tắt pointer của Switch
           cho khỏi lật hai lần. -->
      <Switch
        :checked="onSet.has(m.id)"
        class="pointer-events-none"
        tabindex="-1"
        aria-hidden="true"
      />
    </div>
  </template>

  <!-- No enabled source = no chip: an "MCP 0/0" control would only offer to
       whitelist servers that do not exist. -->
  <span v-else-if="servers.length" class="relative inline-flex">
    <Button
      type="button"
      variant="outline"
      size="xs"
      class="gap-1.5 font-normal text-dim shadow-none hover:text-foreground [&_svg]:size-3"
      :class="{ 'border-ring text-primary': open || customized }"
      :title="t('sessions.config.mcpHint')"
      @click.stop="emit('toggle')"
    >
      <Icon name="conn" />
      {{ t('sessions.composer.mcp') }}
      <!-- Đếm cỡ cố định, số thẳng cột như các chip đếm khác. -->
      <span class="text-faint tabular-nums">{{ onCount }}/{{ servers.length }}</span>
      <Icon name="chev" />
    </Button>

    <!-- Popover mở lên trên từ thanh composer. -->
    <!-- role=dialog + data-state=open: khớp selector `[role="dialog"][data-state="open"]`
           trong OVERLAYS (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
    <div
      v-if="open"
      role="dialog"
      data-state="open"
      class="absolute bottom-[130%] left-0 z-50 w-64 overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-3 font-sans whitespace-normal text-popover-foreground shadow-md"
      @click.stop
    >
      <div class="mb-2 text-xs font-medium text-muted-foreground">
        {{ t('sessions.config.mcpHint') }}
      </div>
      <div
        v-for="m in servers"
        :key="m.id"
        class="flex cursor-pointer items-center gap-2 border-t py-2 text-base first-of-type:border-t-0"
        @click="toggleMcp(m.id)"
      >
        <span
          class="size-2 flex-none rounded-full"
          :class="m.status === 'connected' ? 'bg-success' : 'bg-faint'"
        />
        <span class="min-w-0 truncate text-foreground">{{ m.name }}</span>
        <span class="ml-auto text-sm text-faint">{{ m.status }}</span>
        <!-- Công tắc chỉ để hiển thị — cả hàng là vùng bấm, nên tắt pointer của Switch
             cho khỏi lật hai lần. -->
        <Switch
          :checked="onSet.has(m.id)"
          class="pointer-events-none"
          tabindex="-1"
          aria-hidden="true"
        />
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
// Per-session MCP whitelist as a composer chip (moved off the config popover's MCP
// tab): the allowed connections are a per-turn decision, so they belong next to the
// Mode chip rather than behind the header gear. Open state is owned by the composer
// (one popover at a time + its click-away overlay).
const props = withDefaults(defineProps<{ open?: boolean; variant?: 'chip' | 'inline' }>(), {
  open: false,
  variant: 'chip',
})
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
    if (props.variant === 'chip' && props.open) emit('toggle')
  },
)
</script>
