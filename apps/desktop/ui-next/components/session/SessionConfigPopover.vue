<template>
  <div class="pop cfgpop">
    <div class="poptabs">
      <span :class="{ on: cfgTab === 'General' }" @click="cfgTab = 'General'">
        {{ t('sessions.config.tab.general') }}
      </span>
      <span :class="{ on: cfgTab === 'Tools' }" @click="cfgTab = 'Tools'">
        {{ t('sessions.config.tab.tools') }}
      </span>
      <span :class="{ on: cfgTab === 'MCP' }" @click="cfgTab = 'MCP'">
        {{ t('sessions.config.tab.mcp') }}
      </span>
    </div>

    <div class="popbody">
      <!-- General — Account + Model (real data). Style / no-markdown / thinking
           now live on the composer chips, not here. -->
      <template v-if="cfgTab === 'General'">
        <div class="pr2">
          <div class="pl">{{ t('sessions.config.account') }}</div>
          <div class="opts">
            <span
              v-for="a in accounts"
              :key="a.id"
              class="o"
              :class="{ on: a.id === session.accountId }"
              @click="store.selectAccount(session.id, { id: a.id, display: a.display })"
            >
              {{ a.display }}
            </span>
          </div>
        </div>

        <div class="pr2">
          <div class="pl">
            {{ t('sessions.config.model', { provider: accountProvider }) }}
          </div>
          <div class="opts">
            <span
              v-for="m in models"
              :key="m"
              class="o"
              :class="{ on: m === session.model }"
              @click="store.setModel(session.id, m)"
            >
              {{ m }}
            </span>
          </div>
        </div>
      </template>

      <!-- Tools -->
      <template v-else-if="cfgTab === 'Tools'">
        <div class="toolsrch">
          <Icon name="search" style="width: 13px; height: 13px" />
          <input v-model="toolQ" :placeholder="t('sessions.config.toolSearch')" />
          <span
            class="tc"
            style="font-family: var(--code); font-size: 0.7692rem; color: var(--textFaint)"
          >
            {{ onCount }}/{{ total }}
          </span>
        </div>
        <div v-for="[group, tools] in filteredGroups" :key="group" class="tgrp">
          <div class="tgrph">
            {{ group }}
            <span class="tc">
              {{ tools.filter((tl) => toolsOn.has(tl)).length }}/{{ tools.length }}
            </span>
          </div>
          <div class="opts">
            <span
              v-for="tl in tools"
              :key="tl"
              class="o"
              :class="{ on: toolsOn.has(tl) }"
              @click="toggleTool(tl)"
            >
              {{ tl }}
            </span>
          </div>
        </div>
        <div v-if="!filteredGroups.length" class="listempty">
          {{ t('sessions.config.noToolMatch') }}
        </div>
      </template>

      <!-- MCP -->
      <template v-else>
        <div class="pl" style="margin-bottom: 9px">{{ t('sessions.config.mcpHint') }}</div>
        <div v-if="!mcpServers.length" class="listempty">
          {{ t('sessions.config.noMcp') }}
        </div>
        <div v-for="m in mcpServers" :key="m.id" class="mcprow" @click="toggleMcp(m.id)">
          <span
            class="cdot"
            :style="{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: m.status === 'running' ? 'var(--green)' : 'var(--textFaint)',
            }"
          />
          <span class="mcpn">{{ m.name }}</span>
          <span class="mcpst">{{ m.status }}</span>
          <span class="tog2" :class="{ off: !mcpOnSet.has(m.id) }" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Session } from '~/composables/useSessionsMock'

// Session config — tabbed popover (General / Tools / MCP). General now keeps just
// Account + Model (real data via useAccounts); style / thinking / no-markdown moved
// to the composer chips. The Tools tab maps to the session tool DENYLIST
// (params.disabledTools); the MCP tab loads real servers (mcp.list) and maintains
// the session MCP whitelist (params.mcpServerIds).
const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { providerOf } = useSessionsMock()
const { accounts, accountById, modelsForAccount } = useAccounts()
const store = useSessionsStore()
const sc = useSidecar()

// Built-in Claude Code tools (the toggleable runtime toolset). MCP tools live in
// their own tab — the denylist here is built-ins only.
const TOOL_GROUPS: [string, string[]][] = [
  ['File', ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit']],
  ['Exec', ['Bash', 'BashOutput', 'KillShell']],
  ['Web', ['WebFetch', 'WebSearch']],
  ['Agent', ['Task', 'TodoWrite', 'ExitPlanMode']],
]
const ALL_TOOLS = TOOL_GROUPS.flatMap(([, tools]) => tools)

// Mock MCP list for browser-dev (no bridge). Real servers come from mcp.list.
const MCP_FALLBACK: [string, string][] = [
  ['github', 'running'],
  ['filesystem', 'running'],
  ['linear', 'idle'],
]

const cfgTab = ref<'General' | 'Tools' | 'MCP'>('General')
const toolQ = ref('')

// ── General (Account + Model) ───────────────────────────────────────────────────
// Resolve the selected account (by real id) to drive its model catalog + provider
// label; fall back to the display-string provider when unresolved (mock / deleted).
const selectedAccount = computed(() =>
  props.session.accountId ? accountById(props.session.accountId) : undefined,
)
const accountProvider = computed(
  () => selectedAccount.value?.provider ?? providerOf(props.session.account),
)
const models = computed(() => {
  const opt = selectedAccount.value
  if (opt) return modelsForAccount(opt)
  return modelsForAccount({
    id: '',
    label: '',
    provider: accountProvider.value,
    providerDisplay: accountProvider.value,
    display: props.session.account,
  })
})

// ── Tools (denylist) ───────────────────────────────────────────────────────────
// A tool is ON when it is NOT in the session denylist. Default (no denylist) = all on.
const toolsOn = computed(() => {
  const disabled = new Set(props.session.disabledTools ?? [])
  return new Set(ALL_TOOLS.filter((tl) => !disabled.has(tl)))
})
function toggleTool(tl: string) {
  const disabled = new Set(props.session.disabledTools ?? [])
  if (disabled.has(tl)) disabled.delete(tl)
  else disabled.add(tl)
  store.setDisabledTools(props.session.id, [...disabled])
}
const total = computed(() => ALL_TOOLS.length)
const onCount = computed(() => ALL_TOOLS.filter((tl) => toolsOn.value.has(tl)).length)
const filteredGroups = computed<[string, string[]][]>(() => {
  const q = toolQ.value.toLowerCase()
  return TOOL_GROUPS.map(
    ([g, tools]) => [g, tools.filter((tl) => tl.toLowerCase().includes(q))] as [string, string[]],
  ).filter(([, tools]) => tools.length)
})

// ── MCP (per-session whitelist) ────────────────────────────────────────────────
type McpRow = { id: string; name: string; status: string }
const mcpReal = ref<McpRow[]>([])
const mcpServers = computed<McpRow[]>(() =>
  sc.available ? mcpReal.value : MCP_FALLBACK.map(([name, status]) => ({ id: name, name, status })),
)
// undefined session whitelist = "all enabled servers on" (legacy); otherwise the
// explicit set. The dot/toggle reflect membership.
const mcpOnSet = computed<Set<string>>(() => {
  const ids = props.session.mcpServerIds
  if (ids === undefined) return new Set(mcpServers.value.map((m) => m.id))
  return new Set(ids)
})
function toggleMcp(id: string) {
  const cur = new Set(mcpOnSet.value)
  if (cur.has(id)) cur.delete(id)
  else cur.add(id)
  store.setMcpServerIds(props.session.id, [...cur])
}

onMounted(async () => {
  if (!sc.available) return
  try {
    const res = await sc.request<{
      servers: { id: string; name: string; enabled: boolean; status: string }[]
    }>('mcp.list')
    mcpReal.value = (res.servers ?? [])
      .filter((s) => s.enabled)
      .map((s) => ({ id: s.id, name: s.name, status: s.status }))
  } catch {
    // Leave empty — the MCP tab shows its empty state.
  }
})
</script>
