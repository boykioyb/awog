<template>
  <div class="pop cfgpop">
    <div class="poptabs">
      <span :class="{ on: cfgTab === 'General' }" @click="cfgTab = 'General'">
        {{ t('sessions.config.tab.general') }}
      </span>
      <span :class="{ on: cfgTab === 'Tools' }" @click="cfgTab = 'Tools'">
        {{ t('sessions.config.tab.tools') }}
      </span>
    </div>

    <div class="popbody">
      <!-- General — Budget caps. Account / Model / Reasoning effort / Style now live
           on the status-bar chips (StatusConfig); Tools on its own tab. -->
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
      <template v-else>
        <div class="toolsrch">
          <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <input v-model="toolQ" :placeholder="t('sessions.config.toolSearch')" />
          <span class="tc tnum" style="font-size: var(--fs-xs); color: var(--textFaint)">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'

// Session config — tabbed popover (General / Tools). General keeps the budget caps
// (account / model / thinking / style live on the status-bar chips); the Tools tab
// maps to the session tool DENYLIST (params.disabledTools). The per-session MCP
// whitelist moved to the composer's MCP chip (SessionMcpChip).
const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()
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

// Built-in Claude Code tools (the toggleable runtime toolset). MCP servers are
// whitelisted from the composer chip — the denylist here is built-ins only.
const TOOL_GROUPS: [string, string[]][] = [
  ['File', ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit']],
  ['Exec', ['Bash', 'BashOutput', 'KillShell']],
  ['Web', ['WebFetch', 'WebSearch']],
  ['Agent', ['Task', 'TodoWrite', 'ExitPlanMode']],
]
const ALL_TOOLS = TOOL_GROUPS.flatMap(([, tools]) => tools)

const cfgTab = ref<'General' | 'Tools'>('General')
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
  line-height: 18px;
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
  line-height: 18px;
  color: var(--textDim);
}
.budgetinput {
  width: 100%;
  background: var(--bgInput, var(--bgActive));
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 5px 8px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.budgethint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
</style>
