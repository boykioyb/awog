<template>
  <!-- Khung popover: bề mặt popover + viền mảnh + bo lg + shadow vừa. Cùng trần chiều
       cao với các popup khác của composer — dài hơn thì cuộn. Vị trí do cha đặt qua
       `style` (absolute). `role="dialog"` + `data-state="open"` khớp OVERLAYS
       (composables/useEmbeddedBrowser.ts) thay cho class `.pop` cũ. -->
  <div
    role="dialog"
    data-state="open"
    class="fixed z-130 flex max-h-[min(420px,60vh)] w-71 flex-col overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-md"
  >
    <Tabs v-model="cfgTab" class="flex min-h-0 flex-col">
      <TabsList
        class="h-auto w-full shrink-0 justify-start gap-0.5 rounded-none bg-transparent p-2"
      >
        <TabsTrigger
          value="General"
          class="rounded-sm px-3 py-1.5 font-normal text-muted-foreground hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
        >
          {{ t('sessions.config.tab.general') }}
        </TabsTrigger>
        <TabsTrigger
          value="Tools"
          class="rounded-sm px-3 py-1.5 font-normal text-muted-foreground hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
        >
          {{ t('sessions.config.tab.tools') }}
        </TabsTrigger>
      </TabsList>
      <Separator />

      <!-- General — Budget caps. Account / Model / Reasoning effort / Style now live
           on the status-bar chips (StatusConfig); Tools on its own tab. -->
      <TabsContent value="General" class="max-h-[60vh] overflow-y-auto p-3">
        <!-- Budget: soft warning + hard cap (USD). Soft only warns; hard refuses a
             turn / stops tool calls sidecar-side. Empty = no cap. -->
        <div>
          <div class="mb-2 flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{{ t('sessions.budget.section') }}</span>
            <span class="text-sm text-muted-foreground tabular-nums">
              {{ t('sessions.budget.spent', { cost: fmtUsd(spent) }) }}
            </span>
          </div>
          <div class="flex gap-2">
            <Label
              class="flex flex-1 flex-col items-stretch gap-0.5 text-sm font-normal text-muted-foreground"
            >
              <span>{{ t('sessions.budget.softLimit') }}</span>
              <Input
                v-model="softLimitInput"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                class="tabular-nums"
                @change="commitSoft"
              />
            </Label>
            <Label
              class="flex flex-1 flex-col items-stretch gap-0.5 text-sm font-normal text-muted-foreground"
            >
              <span>{{ t('sessions.budget.hardLimit') }}</span>
              <Input
                v-model="hardLimitInput"
                type="number"
                min="0"
                step="0.5"
                placeholder="—"
                class="tabular-nums"
                @change="commitHard"
              />
            </Label>
          </div>
          <div class="flex gap-2">
            <Label
              class="flex flex-1 flex-col items-stretch gap-0.5 text-sm font-normal text-muted-foreground"
            >
              <span>{{ t('sessions.budget.maxToolCalls') }}</span>
              <Input
                v-model="maxToolCallsInput"
                type="number"
                min="0"
                step="1"
                placeholder="—"
                class="tabular-nums"
                @change="commitMaxToolCalls"
              />
            </Label>
            <Label
              class="flex flex-1 flex-col items-stretch gap-0.5 text-sm font-normal text-muted-foreground"
            >
              <span>{{ t('sessions.budget.maxMinutes') }}</span>
              <Input
                v-model="maxMinutesInput"
                type="number"
                min="0"
                step="1"
                placeholder="—"
                class="tabular-nums"
                @change="commitMaxMinutes"
              />
            </Label>
          </div>
          <p class="mt-1.5 mb-0 text-sm text-faint">{{ t('sessions.budget.hardHint') }}</p>
        </div>
      </TabsContent>

      <!-- Tools — map vào DENYLIST tool của phiên (params.disabledTools). -->
      <TabsContent value="Tools" class="max-h-[60vh] overflow-y-auto p-3">
        <!-- Ô tìm tool — cùng khung với ô nhập budget (viền input, nền trong suốt). -->
        <div
          class="mb-3 flex items-center gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-muted-foreground"
        >
          <Icon name="search" class="size-3.5 shrink-0" />
          <Input
            v-model="toolQ"
            unstyled
            class="text-sm text-foreground placeholder:text-muted-foreground"
            :placeholder="t('sessions.config.toolSearch')"
          />
          <span class="shrink-0 text-xs text-faint tabular-nums">{{ onCount }}/{{ total }}</span>
        </div>
        <div v-for="[group, tools] in filteredGroups" :key="group" class="mb-3 last:mb-0">
          <div class="mb-2 flex items-center text-xs font-semibold text-muted-foreground">
            {{ group }}
            <span class="ml-auto text-faint tabular-nums">
              {{ tools.filter((tl) => toolsOn.has(tl)).length }}/{{ tools.length }}
            </span>
          </div>
          <!-- Công tắc tool — chip viền, hover wash trung tính, tint primary khi BẬT. -->
          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="tl in tools"
              :key="tl"
              variant="outline"
              size="xs"
              class="h-auto rounded-sm px-2.5 py-1 text-sm font-normal shadow-none"
              :class="
                toolsOn.has(tl)
                  ? 'border-primary/45 bg-primary/12 text-primary hover:bg-primary/12 hover:text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              "
              :aria-pressed="toolsOn.has(tl)"
              @click="toggleTool(tl)"
            >
              {{ tl }}
            </Button>
          </div>
        </div>
        <div v-if="!filteredGroups.length" class="px-3.5 py-8.5 text-center text-sm text-dim">
          {{ t('sessions.config.noToolMatch') }}
        </div>
      </TabsContent>
    </Tabs>
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
