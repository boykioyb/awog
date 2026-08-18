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
      <!-- General — Budget caps. Account / Model / Reasoning effort / Style now live
           on the status-bar chips (StatusConfig); Tools + MCP on their own tabs. -->
      <template v-if="cfgTab === 'General'">
        <!-- Budget: soft warning + hard cap (USD). Soft only warns; hard refuses a
             turn / stops tool calls sidecar-side. Empty = no cap. -->
        <div class="pr2">
          <div class="pl plnowrap">
            <span>{{ t('sessions.budget.section') }}</span>
            <span class="budgetcost">
              {{ t('sessions.budget.spent', { cost: fmtUsd(spent) }) }}
            </span>
          </div>
          <div class="budgetfields">
            <label class="budgetfield">
              <span>{{ t('sessions.budget.softLimit') }}</span>
              <input
                v-model="softLimitInput"
                class="budgetinput"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                @change="commitSoft"
              />
            </label>
            <label class="budgetfield">
              <span>{{ t('sessions.budget.hardLimit') }}</span>
              <input
                v-model="hardLimitInput"
                class="budgetinput"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                @change="commitHard"
              />
            </label>
          </div>
          <div class="budgetfields">
            <label class="budgetfield">
              <span>{{ t('sessions.budget.maxToolCalls') }}</span>
              <input
                v-model="maxToolCallsInput"
                class="budgetinput"
                type="number"
                min="0"
                step="1"
                placeholder="—"
                @change="commitMaxToolCalls"
              />
            </label>
            <label class="budgetfield">
              <span>{{ t('sessions.budget.maxMinutes') }}</span>
              <input
                v-model="maxMinutesInput"
                class="budgetinput"
                type="number"
                min="0"
                step="1"
                placeholder="—"
                @change="commitMaxMinutes"
              />
            </label>
          </div>
          <p class="budgethint">{{ t('sessions.budget.hardHint') }}</p>
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
              background: m.status === 'connected' ? 'var(--green)' : 'var(--textFaint)',
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
import { computed, onMounted, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'

// Session config — tabbed popover (General / Tools / MCP). General now keeps just
// Account + Model (real data via useAccounts); style / thinking / no-markdown moved
// to the composer chips. The Tools tab maps to the session tool DENYLIST
// (params.disabledTools); the MCP tab loads real servers (mcp.list) and maintains
// the session MCP whitelist (params.mcpServerIds).
const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()
const sc = useSidecar()
const { fmtUsd } = useSessionCost()

// ── Budget (soft + hard caps) ────────────────────────────────────────────────
// Inputs are local strings (so an empty field clears the cap); committed on blur.
const spent = computed(() => props.session.usage?.cost)
const softLimitInput = ref('')
const hardLimitInput = ref('')
const maxToolCallsInput = ref('')
const maxMinutesInput = ref('')
watch(
  () => [
    props.session.id,
    props.session.budget?.limitUsd,
    props.session.budget?.hardLimitUsd,
    props.session.budget?.maxToolCalls,
    props.session.budget?.maxWallclockMs,
  ],
  () => {
    const b = props.session.budget
    softLimitInput.value = b?.limitUsd?.toString() ?? ''
    hardLimitInput.value = b?.hardLimitUsd?.toString() ?? ''
    maxToolCallsInput.value = b?.maxToolCalls?.toString() ?? ''
    maxMinutesInput.value = b?.maxWallclockMs != null ? String(b.maxWallclockMs / 60000) : ''
  },
  { immediate: true },
)
function parseUsd(v: string): number | undefined {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
function parseCount(v: string): number | undefined {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
function commitSoft() {
  store.setBudget(props.session.id, { limitUsd: parseUsd(softLimitInput.value) })
}
function commitHard() {
  store.setBudget(props.session.id, { hardLimitUsd: parseUsd(hardLimitInput.value) })
}
function commitMaxToolCalls() {
  store.setBudget(props.session.id, { maxToolCalls: parseCount(maxToolCallsInput.value) })
}
function commitMaxMinutes() {
  const mins = parseCount(maxMinutesInput.value)
  store.setBudget(props.session.id, { maxWallclockMs: mins != null ? mins * 60000 : undefined })
}

// Built-in Claude Code tools (the toggleable runtime toolset). MCP tools live in
// their own tab — the denylist here is built-ins only.
const TOOL_GROUPS: [string, string[]][] = [
  ['File', ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit']],
  ['Exec', ['Bash', 'BashOutput', 'KillShell']],
  ['Web', ['WebFetch', 'WebSearch']],
  ['Agent', ['Task', 'TodoWrite', 'ExitPlanMode']],
]
const ALL_TOOLS = TOOL_GROUPS.flatMap(([, tools]) => tools)

const cfgTab = ref<'General' | 'Tools' | 'MCP'>('General')
const toolQ = ref('')

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
// Real sources only (source.list). With no bridge the list is empty — a stand-in
// row would offer to whitelist a server that does not exist.
const mcpServers = computed<McpRow[]>(() => mcpReal.value)
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
      sources: { id: string; name: string; enabled: boolean; connectionStatus?: string }[]
    }>('source.list')
    mcpReal.value = (res.sources ?? [])
      .filter((s) => s.enabled)
      .map((s) => ({ id: s.id, name: s.name, status: s.connectionStatus ?? 'untested' }))
  } catch {
    // Leave empty — the MCP tab shows its empty state.
  }
})
</script>

<style scoped>
.plnowrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.budgetcost {
  font-size: 12px;
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.budgetfields {
  display: flex;
  gap: 8px;
}
.budgetfield {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  font-size: 12px;
  color: var(--textDim);
}
.budgetinput {
  width: 100%;
  background: var(--bgInput, var(--bgActive));
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.budgethint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--textFaint);
}
</style>
