<template>
  <!-- Status bar riêng của Workbench (26px) — xếp DƯỚI `.wb`,
       còn AppStatusBar toàn app vẫn nằm dưới nó trong layout. Chip dùng
       `WbChip` (auto-import). Menu mở phía TRÊN qua WorkbenchContextMenu. -->
  <footer
    class="flex h-6.5 min-w-0 flex-none items-center gap-2 overflow-hidden border-t bg-sidebar px-2.5 text-xs text-dim"
  >
    <!-- Quota theo account (donut 5h + tooltip breakdown) — component toàn app. -->
    <StatusUsage />
    <Separator orientation="vertical" class="h-3" />

    <!-- CPU/RAM của cây tiến trình AWOG — click mở doc monitor. -->
    <WbChip title="Giám sát — mở trang Monitor" @click="openMonitorDoc">
      <Icon class="size-3" name="act" />
      <span class="tnum">
        <b>CPU {{ cpuLabel }}</b>
        · RAM {{ ramLabel }}
      </span>
    </WbChip>

    <span class="flex-1" />

    <!-- Context meter: chỉ khi có phiên đang mở. -->
    <template v-if="active">
      <WbChip
        title="Context — click: compact / xoá history"
        :aria-expanded="menuFor === 'ctx'"
        data-wbi="ctx"
        @click="openCtxMenu"
      >
        <!-- Mini bar context: fill theo % cửa sổ. -->
        <Progress :model-value="ctxPct" class="h-1 w-9.5 flex-none bg-muted" />
        <span class="tnum">{{ ctxLabel }}</span>
      </WbChip>
    </template>

    <!-- Project chip: đổi workspace (tab project của sessions store). -->
    <WbChip
      title="Project — đổi workspace"
      :aria-expanded="menuFor === 'project'"
      data-wbi="project"
      @click="openProjectMenu"
    >
      <Icon class="size-3" name="folder" />
      <span class="max-w-40 truncate">{{ currentProjectLabel }}</span>
    </WbChip>
    <Separator orientation="vertical" class="h-3" />

    <!-- Phong cách trả lời của phiên đang mở (+ bỏ markdown) — WbStyleChip. -->
    <template v-if="active">
      <WbStyleChip :session="active" />
      <Separator orientation="vertical" class="h-3" />
    </template>

    <!-- Account chip — menu account + model + settings (phong cách có chip riêng). -->
    <WbChip
      title="Account — đổi account/model"
      :aria-expanded="menuFor === 'account'"
      data-wbi="account"
      @click="openAccountMenu"
    >
      {{ accountLabel }}
    </WbChip>
    <Separator orientation="vertical" class="h-3" />

    <!-- Toggles: explorer / agent browser tab / dock / settings. -->
    <WbChip :active="!wb.sideClosed" title="Explorer ⌘B" @click="wb.toggleSide()">
      <Icon class="size-3" name="folder" />
    </WbChip>
    <WbChip title="Mở tab browser của agent" @click="openBrowserDoc">
      <Icon class="size-3" name="globe" />
    </WbChip>
    <WbChip :active="!wb.dockHidden" title="Dock panel ⌘J" @click="wb.toggleDock()">
      <Icon class="size-3" name="dock-bottom" />
    </WbChip>
    <WbChip title="Settings" @click="openSettingsDoc('appearance')">
      <Icon class="size-3" name="settings" />
    </WbChip>

    <WorkbenchContextMenu />
  </footer>
</template>

<script setup lang="ts">
import { useProjects } from '~/composables/useProjects'
import { useAccounts } from '~/composables/useAccounts'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useWorkbenchMenu, type WbMenuItem } from '~/composables/useWorkbenchMenu'
import { useWorkbenchMonitor } from '~/composables/useWorkbenchMonitor'
import { useSessionsData } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkbenchStore } from '~/stores/workbench'

const wb = useWorkbenchStore()
const sessions = useSessionsStore()
const toast = useToast()
const { confirm } = useConfirm()
const { menu, openMenu } = useWorkbenchMenu()
const { cpuLabel, ramLabel } = useWorkbenchMonitor()
const { projects, projectName, projectPath } = useProjects()
const { accounts, modelsForAccount } = useAccounts()
const { t } = useI18n()
const { providerOf } = useSessionsData()

const active = computed<Session | null>(() => sessions.active)

// ── Monitor chip ────────────────────────────────────────────────────────────
function openMonitorDoc() {
  wb.openDoc({ kind: 'monitor', id: 'monitor', title: 'Giám sát' })
}
function openBrowserDoc() {
  // Doc web đầu tiên nếu đã có (tab agent đang mở), không thì mở doc web mới —
  // slice C quyết định surface render; status bar chỉ đặt doc.
  const existing = wb.docs.find((d) => d.kind === 'web')
  if (existing) wb.openDoc(existing)
  else wb.openDoc({ kind: 'web', id: `web-${Date.now().toString(36)}`, title: 'Browser' })
}
function openSettingsDoc(nav: string) {
  wb.openDoc({ kind: 'settings', id: 'settings', title: 'Settings', nav })
}

// ── Context chip ────────────────────────────────────────────────────────────
// useSessionContextUsage nhận getter phiên; chip chỉ render khi `active` có
// thật, getter fallback vẫn phải trả một Session để computed không ném — lấy
// phiên đầu danh sách làm vật thế, nó không bao giờ hiện ra UI.
const ctxSession = computed<Session>(() => active.value ?? sessions.sessions[0]!)
const { tokLabel, limitLabel, pct } = useSessionContextUsage(() => ctxSession.value)
const ctxLabel = computed(() => `${tokLabel.value}/${limitLabel.value}`)
const ctxPct = computed(() => Math.min(100, Math.max(0, pct.value)))

function openCtxMenu(e: MouseEvent) {
  const s = active.value
  if (!s) return
  const compacting = s.compacting === true
  const items: WbMenuItem[] = [
    {
      id: 'compact',
      label: compacting ? 'Đang compact…' : 'Compact context',
      icon: 'foldv',
      disabled: compacting || !s.engineId,
    },
    { id: 'summarize', label: 'Tóm tắt transcript', icon: 'listul', disabled: !s.engineId },
    { separator: true },
    { id: 'clear', label: 'Xoá toàn bộ history phiên', icon: 'trash', danger: true },
  ]
  openMenu(e.currentTarget as HTMLElement, items, (id) => {
    if (id === 'compact') void doCompact(s, 0)
    else if (id === 'summarize') void doCompact(s, undefined)
    else if (id === 'clear') void clearHistory(s)
  })
}

// `sessions.compact` — giữ nguyên thông báo của StatusContext (compact vs
// nothing vs failed). `keepRecentTokens=0` = compact mặc định; `undefined` =
// tóm tắt theo mặc định engine.
async function doCompact(s: Session, keepRecentTokens: number | undefined) {
  const r = await sessions.compactSession(s.id, keepRecentTokens)
  if (r === 'compacted')
    toast.add({ title: t('sessions.command.notice.compacted'), color: 'success' })
  else if (r === 'nothing')
    toast.add({ title: t('sessions.command.notice.nothingToCompact'), color: 'info' })
  else toast.add({ title: t('sessions.command.notice.compactFailed'), color: 'error' })
}

// "Xoá history" của phiên = xoá luôn phiên (transcript là định danh của nó) —
// hành vi phá huỷ nên phải qua confirm, khớp hàng rào destructive của app.
async function clearHistory(s: Session) {
  const ok = await confirm({
    title: 'Xoá toàn bộ history phiên?',
    description: `Phiên “${s.title}” và transcript của nó sẽ bị xoá vĩnh viễn.`,
    confirmLabel: 'Xoá phiên',
    kind: 'danger',
  })
  if (ok) sessions.remove(s.id)
}

// ── Project chip ────────────────────────────────────────────────────────────
const currentProjectLabel = computed(() => projectName(sessions.activeTab || '') || '—')
// "Thêm project" dẫn ra trang Projects — nơi có luồng add thật (modal
// quick-view của useProjectModal chỉ xem thông tin, không thêm được).

// Đường dẫn hiển thị gọn: thư mục home → "~". Chỉ là nhãn phụ (hint) — tên project
// mới là thứ người dùng tìm; ô lọc khớp cả hai.
const shortPath = (p: string): string => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~')

function openProjectMenu(e: MouseEvent) {
  const cur = sessions.activeTab
  const items: WbMenuItem[] = [
    { header: 'Đổi project' },
    ...projects.value.map<WbMenuItem>((p) => {
      const path = projectPath(p.id)
      return {
        id: `proj:${p.id}`,
        label: p.name,
        ...(path ? { hint: shortPath(path) } : {}),
        icon: 'folder',
        active: p.id === cur,
      }
    }),
    { separator: true },
    { id: 'add', label: 'Thêm project…', icon: 'plus' },
  ]
  openMenu(
    e.currentTarget as HTMLElement,
    items,
    (id) => {
      if (id === 'add') void navigateTo('/projects')
      else if (id.startsWith('proj:')) sessions.setActiveTab(id.slice('proj:'.length))
    },
    { filterPlaceholder: 'Tìm project…' },
  )
}

// ── Account chip ────────────────────────────────────────────────────────────
// Nhãn account của phiên đang mở. Phong cách trả lời đã tách ra chip riêng
// (WbStyleChip) — nhãn cũ `account · style` chỉ hiện chứ không đổi được style.
// Không có phiên → chỉ tên provider mặc định, không bịa account.
const accountLabel = computed(() => {
  const s = active.value
  if (!s) return 'Account'
  const disp = s.account || ''
  const idx = disp.lastIndexOf(' · ')
  return (idx > 0 ? disp.slice(0, idx) : disp) || providerOf(disp)
})

function openAccountMenu(e: MouseEvent) {
  const s = active.value
  const accountItems: WbMenuItem[] = accounts.value.map((a) => ({
    id: `acc:${a.id}`,
    label: a.display + (a.isActive ? ' ✓' : ''),
    active: !!s && (s.accountId === a.id || s.account === a.display),
  }))
  // Model chỉ có nghĩa trên phiên đang mở; danh sách theo account của phiên.
  const modelItems: WbMenuItem[] = s
    ? modelsForAccount(
        accounts.value.find((a) => a.id === s.accountId) ??
          ({
            id: '',
            label: '',
            provider: providerOf(s.account),
            providerDisplay: providerOf(s.account),
            display: s.account,
          } as const),
      ).map<WbMenuItem>((m) => ({
        id: `model:${m}`,
        label: m + (m === s.model ? ' (hiện)' : ''),
        active: m === s.model,
      }))
    : []
  const items: WbMenuItem[] = [
    { header: 'TÀI KHOẢN' },
    ...(accountItems.length ? accountItems : [{ label: 'Chưa có account', disabled: true }]),
    ...(modelItems.length ? [{ separator: true }, { header: 'MODEL' }, ...modelItems] : []),
    { separator: true },
    { id: 'settings', label: 'Cài đặt accounts…', icon: 'settings' },
  ]
  openMenu(e.currentTarget as HTMLElement, items, (id) => {
    if (id === 'settings') openSettingsDoc('models')
    else if (id.startsWith('acc:') && s) {
      const a = accounts.value.find((x) => x.id === id.slice('acc:'.length))
      if (a) sessions.selectAccount(s.id, { id: a.id, display: a.display })
    } else if (id.startsWith('model:') && s) {
      sessions.setModel(s.id, id.slice('model:'.length))
    }
  })
}

// ── aria-expanded cho chip ──────────────────────────────────────────────────
// Menu là singleton; chip đang mở được nhận diện qua `data-wbi` trên anchor.
// `?.` cả hai tầng: điểm neo nào không phải Element (lỗi gọi sai) cũng không được làm
// hỏng render cả status bar.
const menuFor = computed(() => menu.value?.anchor?.dataset?.wbi ?? '')
</script>
