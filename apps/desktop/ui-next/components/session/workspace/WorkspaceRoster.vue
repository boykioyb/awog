<template>
  <section ref="rootEl" class="mt-3">
    <Button
      variant="ghost"
      class="h-auto w-full justify-start gap-1.5 px-0 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
      @click="open = !open"
    >
      <ChevronDown class="size-3 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
      <span>{{ t('sessions.workspace.group.roster') }}</span>
      <span class="font-normal text-faint">{{ members.length }}</span>
    </Button>

    <div v-if="open" class="mt-2 flex flex-col gap-1.5">
      <!-- Hàng LEAD: phiên gốc của nhóm (giữ cây chính, không worktree). -->
      <WorkspaceRosterMember
        :m="lead"
        lead
        :project-id="projectId"
        @open="openSession"
        @pick-agent="toggleAgentMenu"
      />
      <!-- Nhóm chưa có member — dùng lại câu placeholder của bảng Nhóm cũ. -->
      <div v-if="!members.length" class="px-0.5 py-1 text-xs text-faint">
        {{ t('sessions.workspace.group.placeholder') }}
      </div>
      <WorkspaceRosterMember
        v-for="m in members"
        :key="m.id"
        :m="m"
        :flash="flashId === m.engineId"
        :project-id="projectId"
        @open="openSession"
        @pick-agent="toggleAgentMenu"
      />
    </div>

    <!-- Menu chọn agent — teleported + fixed để thoát khỏi panel cuộn, neo theo
         usePopoverAnchor. Không dùng DropdownMenu vì anchor là nút trong hàng con. -->
    <Teleport to="body">
      <template v-if="agentMenuFor">
        <div class="fixed inset-0 z-120" @click="agentMenuFor = null" />
        <!-- hook-ok: `.smenu` do OVERLAYS của useEmbeddedBrowser.ts đọc -->
        <div ref="agentMenuEl" class="smenu" :class="MENU" :style="agentMenuStyle">
          <div
            role="menuitem"
            :class="[MENU_ITEM, !agentMenuFor.agent && 'bg-selected text-foreground']"
            @click="pickAgent(null)"
          >
            {{ t('sessions.workspace.group.agentNone') }}
          </div>
          <div v-if="!agentOptions.length" :class="[MENU_ITEM, 'pointer-events-none opacity-45']">
            {{ t('sessions.workspace.group.agentEmpty') }}
          </div>
          <div
            v-for="a in agentOptions"
            :key="agents.agentKey(a)"
            role="menuitem"
            :class="[MENU_ITEM, sameAgent(agentMenuFor.agent, a) && 'bg-selected text-foreground']"
            @click="pickAgent(a)"
          >
            {{ a.name || a.id }}
            <span v-if="a.source === 'project'" class="text-faint">
              · {{ t('sessions.workspace.group.agentProject') }}
            </span>
          </div>
        </div>
      </template>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
// Roster của cockpit (session-teams §8): hàng LEAD + mỗi member (component con
// WorkspaceRosterMember giữ diff/merge/inbox của từng hàng), cộng menu gắn/đổi
// agent qua sessions.setAgent. expose scrollToMember để thanh "Cần bạn
// quyết" nhảy tới đúng hàng.
import { computed, nextTick, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'
import { useSessionsStore } from '~/stores/sessions'
import { useAgentsStore, type Agent } from '~/stores/agents'
import { useBoardStore } from '~/stores/board'
import type { Session } from '~/composables/useSessionsData'
import WorkspaceRosterMember from './WorkspaceRosterMember.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  // Phiên GỐC của nhóm (lead) + các member trực tiếp.
  lead: Session
  members: Session[]
  // projectId cho board-item lookup của từng hàng member ('' = chưa gắn).
  projectId: string
}>()

const { t } = useI18n()
const store = useSessionsStore()
const agents = useAgentsStore()
const board = useBoardStore()

const open = ref(true)
const flashId = ref('')
const rootEl = ref<HTMLElement | null>(null)

// Mở phiên con trong cột chi tiết (giữ hành vi cũ của bảng Nhóm).
function openSession(id: number) {
  store.setActive(id)
}

// Được "Cần bạn quyết" gọi: bung section + cuộn tới hàng + flash ngắn.
async function scrollToMember(engineId: string): Promise<void> {
  open.value = true
  await nextTick()
  const el = rootEl.value?.querySelector(`[data-member="${engineId}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashId.value = engineId
  setTimeout(() => {
    if (flashId.value === engineId) flashId.value = ''
  }, 1600)
}
defineExpose({ scrollToMember })

// ── Agent picker ──
const agentMenuFor = ref<Session | null>(null)
const agentAnchorEl = ref<HTMLElement | null>(null)
const agentMenuEl = ref<HTMLElement | null>(null)
const agentMenuOpen = computed(() => agentMenuFor.value !== null)
const { style: agentMenuStyle } = usePopoverAnchor(agentAnchorEl, agentMenuEl, agentMenuOpen, {
  align: 'right',
  width: 220,
})

const agentOptions = computed<Agent[]>(() => agents.agents)

// Hộp menu chọn agent (vị trí do usePopoverAnchor ghi inline).
const MENU =
  'fixed z-130 max-h-[calc(100vh-1.5rem)] min-w-42 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md'
// Một hàng của menu chọn agent (hover wash; hàng đang chọn thêm accent-tint).
const MENU_ITEM =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground'

const sameAgent = (ref0: Session['agent'], a: Agent): boolean =>
  !!ref0 &&
  ref0.id === a.id &&
  (ref0.source ?? 'global') === a.source &&
  (ref0.projectId ?? '') === (a.projectId ?? '')

function toggleAgentMenu(s: Session, e: MouseEvent) {
  if (agentMenuFor.value === s) {
    agentMenuFor.value = null
    return
  }
  agentAnchorEl.value = e.currentTarget as HTMLElement
  agentMenuFor.value = s
  if (!agents.loaded && agents.available) {
    void agents.loadAgents(props.projectId ? [props.projectId] : [])
  }
}

async function pickAgent(a: Agent | null) {
  const s = agentMenuFor.value
  agentMenuFor.value = null
  if (!s?.engineId) return
  await board.setAgent(
    s.engineId,
    a ? { id: a.id, source: a.source, ...(a.projectId ? { projectId: a.projectId } : {}) } : null,
  )
}
</script>
