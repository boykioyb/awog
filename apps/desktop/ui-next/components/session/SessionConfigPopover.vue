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
              <Input
                v-model="softLimitInput"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                @change="commitSoft"
              />
            </label>
            <label class="budgetfield">
              <span>{{ t('sessions.budget.hardLimit') }}</span>
              <Input
                v-model="hardLimitInput"
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
              <Input
                v-model="maxToolCallsInput"
                type="number"
                min="0"
                step="1"
                placeholder="—"
                @change="commitMaxToolCalls"
              />
            </label>
            <label class="budgetfield">
              <span>{{ t('sessions.budget.maxMinutes') }}</span>
              <Input
                v-model="maxMinutesInput"
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
          <Input v-model="toolQ" unstyled :placeholder="t('sessions.config.toolSearch')" />
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
import { ALL_TOOLS, TOOL_GROUPS, toolNamesFor } from '~/utils/tool-catalog'
import type { Session } from '~/composables/useSessionsData'
import Input from '~/components/ui/input/Input.vue'

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

// Built-in tools of the runtime toolset (the toggleable ones). MCP servers are
// whitelisted from the composer chip — the denylist here is built-ins only.
// Catalog sống ở ~/utils/tool-catalog (dùng chung với picker Whitelist tool của
// agent). Not every name exists on both runtimes: `WebSearch` is real only on
// the Claude SDK path (the Pi path has no search backend and deliberately does
// not advertise one), and turning off a tool the current runtime doesn't have
// is simply a no-op. `disabledTools` được truyền THẲNG thành `disallowedTools`;
// tắt bằng tên trần chỉ tắt nhánh Pi nên toolNamesFor ghi cả alias bắc cầu.

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
  const names = toolNamesFor(tl)
  if (disabled.has(tl)) for (const n of names) disabled.delete(n)
  else for (const n of names) disabled.add(n)
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
/* Popover chrome — popover surface + hairline border + --radius + mid shadow. */
.cfgpop {
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
/* Tab strip — muted labels, neutral accent-wash on the active tab. */
.poptabs {
  gap: 2px;
}
.poptabs span {
  border-radius: var(--r-xs);
  color: var(--muted-foreground);
}
.poptabs span:hover {
  color: var(--foreground);
}
.poptabs span.on {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.plnowrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pl {
  color: var(--muted-foreground);
}
.budgetcost {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted-foreground);
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
  color: var(--muted-foreground);
}
/* Inputs — the shadcn field look: transparent fill, --input border, rounded-md,
   1px --ring halo on focus. */
.budgetinput {
  width: 100%;
  background: transparent;
  border: 1px solid var(--input);
  border-radius: var(--r-sm);
  padding: 5px 8px;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.budgetinput:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--ring);
}
.budgethint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
/* Tools tab — search field matches the budget inputs. */
.toolsrch {
  background: transparent;
  border-color: var(--input);
  border-radius: var(--r-sm);
  color: var(--muted-foreground);
}
.toolsrch input::placeholder {
  color: var(--muted-foreground);
}
.tgrph {
  color: var(--muted-foreground);
  font-weight: 600;
}
.tgrph .tc {
  color: var(--textFaint);
}
/* Tool toggles — outlined chips, neutral wash hover, primary tint when ON.
   Nested under .opts so scoped rules beat the global `.pop .o` (equal
   specificity otherwise). */
.opts .o {
  border-radius: var(--r-xs);
  color: var(--muted-foreground);
}
.opts .o:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.opts .o.on {
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
</style>
