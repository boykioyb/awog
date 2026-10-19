<template>
  <!-- Dải tab tài liệu của stage (ADR 0098): Trao đổi ghim đầu (không đóng được),
       mỗi tab có icon theo kind + ● dirty + × hiện khi hover; click giữa hoặc ×
       đóng (dirty → hỏi), chuột phải mở menu tab; `＋` mở tab web trống.
       Dùng reka `Tabs` thật (data-state). Tab đang mở = accent-tint giống dải tab
       phiên trên title bar (SessionTabBar → tabState). Ngoại lệ có chủ đích của
       .claude/rules/workbench-ui.md: tab có close/pin/wheel-scroll custom. -->
  <Tabs :model-value="wb.activeDoc" @update:model-value="(v) => (wb.activeDoc = String(v))">
    <TabsList
      ref="stripEl"
      class="flex h-10 flex-none items-center justify-start gap-0.5 overflow-x-auto rounded-none bg-sidebar p-0 px-2 text-sm shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:thin]"
      @wheel="onWheel"
    >
      <!-- TabsTrigger gộp class qua cn() nên trạng thái đặt bằng data-[state] an toàn. -->
      <TabsTrigger
        v-for="d in wb.docs"
        :key="d.id"
        :value="d.id"
        :data-doc="d.id"
        class="group h-7 select-none gap-1.5 rounded-sm border border-transparent px-2.5 py-0 text-sm font-normal text-muted-foreground shadow-none hover:text-foreground data-[state=active]:border-selected-border data-[state=active]:bg-selected data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:hover:bg-accent/55"
        :title="titleOf(d)"
        @auxclick="(e: MouseEvent) => onAux(d, e)"
        @contextmenu="(e: MouseEvent) => ctx.open(e, d)"
      >
        <!-- eslint-disable vue/no-v-html -- icon kind + pin là SVG constant trong file, không phải input -->
        <!-- `!` để thắng `[&_svg]:size-3.5` gốc của TabsTrigger (cùng specificity). -->
        <span
          class="flex flex-none [&_svg]:size-(--icon-xs)!"
          :class="iconClass(d)"
          v-html="ICON[d.kind] ?? ICON.file"
        />
        <span class="max-w-55 truncate">{{ d.title }}</span>
        <!-- px-ok: chấm dirty 8px là ký hiệu trạng thái dưới thang chữ, giữ như prototype -->
        <span v-if="d.dirty" class="text-[8px] leading-[16px] text-warning">●</span>
        <!-- px-ok: icon ghim 10px như prototype; `!` để thắng [&_svg] gốc của TabsTrigger -->
        <span
          v-if="d.pin"
          class="grid place-items-center text-primary [&_svg]:size-[10px]!"
          :title="t('workbench.tab.pin')"
          v-html="PIN_SVG"
        />
        <!-- eslint-enable vue/no-v-html -->
        <span
          v-else
          class="rounded-sm p-px text-xs text-faint opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
          @click.stop="void wbDocs.requestCloseDoc(d)"
        >
          ✕
        </span>
      </TabsTrigger>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-7 flex-none rounded-sm p-0 text-faint hover:text-foreground"
        :title="t('workbench.tab.newWeb')"
        @click="void wbDocs.openNewWebDoc()"
      >
        ＋
      </Button>
    </TabsList>
  </Tabs>

  <Teleport to="body">
    <AppContextMenu
      :open="ctx.pos.value !== null"
      :position="ctx.pos.value ?? { x: 0, y: 0 }"
      :items="menuItems"
      @close="ctx.close()"
      @select="onMenuSelect"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { WorkbenchDoc, WorkbenchDocKind } from '~/types/workbench'
import { useWorkbenchStore } from '~/stores/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useContextMenu, type MenuItem } from '~/composables/useContextMenu'
import { copyText } from '~/utils/clipboard'

const wb = useWorkbenchStore()
const wbDocs = useWorkbenchDocs()
const { t } = useI18n()
const ctx = useContextMenu<WorkbenchDoc>()

// Icon theo kind — cùng bộ stroke SVG của prototype (v-html giống view rail của
// WorkbenchView: markup tĩnh trong file này, không phải dữ liệu ngoài).
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'
const ICON: Record<WorkbenchDocKind, string> = {
  chat: `${SVG_OPEN}<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  file: `${SVG_OPEN}<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  md: `${SVG_OPEN}<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15V9l2.5 3L12 9v6M17 9v6m-2-2 2 2 2-2"/></svg>`,
  web: `${SVG_OPEN}<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>`,
  img: `${SVG_OPEN}<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
  vid: `${SVG_OPEN}<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>`,
  office: `${SVG_OPEN}<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M12 11v8"/></svg>`,
  mmd: `${SVG_OPEN}<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v3a3 3 0 0 0 3 3h8"/></svg>`,
  settings: `${SVG_OPEN}<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  monitor: `${SVG_OPEN}<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>`,
  task: `${SVG_OPEN}<path d="M9 11l3 3 8-8"/><path d="M21 12a9 9 0 1 1-9-9"/></svg>`,
  diff: `${SVG_OPEN}<path d="M8 6h13M8 12h9M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  gitlog: `${SVG_OPEN}<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6h4a4 4 0 0 1 4 4"/></svg>`,
  cdiff: `${SVG_OPEN}<path d="M8 6h13M8 12h9M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
}
const PIN_SVG = `${SVG_OPEN}<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a3 3 0 0 0-3-3 3 3 0 0 0-3 3Z"/></svg>`

const isFileDoc = (d: WorkbenchDoc) =>
  ['file', 'md', 'img', 'vid', 'office', 'mmd'].includes(d.kind)
const titleOf = (d: WorkbenchDoc) => (isFileDoc(d) ? wbDocs.relPathOf(d) : d.title)

// Màu icon theo kind giống prototype — chỉ khi tab đang mở; tab khác chữ mờ.
// Kind 'vid' từng tô hồng (pink-400 của prototype) nhưng theme chưa có token hồng ⇒ tạm dùng màu
// accent chung của tab đang mở.
const ACTIVE_ICON: Partial<Record<WorkbenchDocKind, string>> = {
  file: 'text-info',
  md: 'text-muted-foreground',
  img: 'text-lavender',
  mmd: 'text-warning',
}
function iconClass(d: WorkbenchDoc): string {
  if (d.id !== wb.activeDoc) return 'text-faint'
  return ACTIVE_ICON[d.kind] ?? 'text-primary'
}

// Giữ tab đang mở trong khung nhìn khi strip tràn.
const stripEl = useTemplateRef<{ $el: HTMLElement } | null>('stripEl')
watch(
  () => wb.activeDoc,
  (id) => {
    stripEl.value?.$el
      ?.querySelector(`[data-doc="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
)

// Cuộn dọc → cuộn ngang như VS Code (chuột dọc trên dải tab).
function onWheel(e: WheelEvent) {
  const el = stripEl.value?.$el
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (e.deltaY === 0 && e.deltaX === 0) return
  e.preventDefault()
  el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
}

function onAux(d: WorkbenchDoc, e: MouseEvent) {
  if (e.button === 1) void wbDocs.requestCloseDoc(d)
}

// ── Menu chuột phải ──────────────────────────────────────────────────────────
const menuItems = computed<MenuItem[]>(() => {
  const d = ctx.target.value
  if (!d) return []
  const sep: MenuItem = { separator: true }
  const rows: MenuItem[] = [{ id: 'open', label: t('workbench.tab.open') }]
  if (d.id !== 'chat') {
    rows.push({ id: 'pin', label: d.pin ? t('workbench.tab.unpin') : t('workbench.tab.pin') })
  }
  if (d.kind === 'web') {
    rows.push({ id: 'reload', label: t('workbench.web.reload') })
    rows.push({ id: 'copy-url', label: t('workbench.web.copyUrl') })
  } else if (isFileDoc(d)) {
    rows.push({ id: 'copy-path', label: t('files.ctx.copyPath') })
    rows.push({ id: 'copy-rel', label: t('files.ctx.copyRelPath') })
  }
  rows.push(sep)
  rows.push({ id: 'close', label: t('workbench.tab.close'), disabled: !!d.pin })
  rows.push({ id: 'close-others', label: t('workbench.tab.closeOthers') })
  rows.push({ id: 'close-right', label: t('workbench.tab.closeRight') })
  return rows
})

async function onMenuSelect(id: string): Promise<void> {
  const d = ctx.target.value
  ctx.close()
  if (!d) return
  switch (id) {
    case 'open':
      wb.activeDoc = d.id
      break
    case 'pin':
      wbDocs.togglePinDoc(d)
      break
    case 'reload': {
      const api = window.awog?.browser
      if (api && d.browId) void api.reload(d.browId).catch(() => {})
      break
    }
    case 'copy-url': {
      const api = window.awog?.browser
      if (!api || !d.browId) break
      const list = await api.tabs().catch(() => null)
      const url = list?.tabs.find((x) => x.tabId === d.browId)?.url
      if (url) await copyText(url)
      break
    }
    case 'copy-path': {
      const abs = wbDocs.absPathOf(d)
      if (abs) await copyText(abs)
      break
    }
    case 'copy-rel':
      await copyText(wbDocs.relPathOf(d))
      break
    case 'close':
      void wbDocs.requestCloseDoc(d)
      break
    case 'close-others':
      void wbDocs.requestCloseMany(wb.docs.filter((x) => x.id !== d.id && !x.pin).map((x) => x.id))
      break
    case 'close-right': {
      const i = wb.docs.findIndex((x) => x.id === d.id)
      void wbDocs.requestCloseMany(
        wb.docs
          .slice(i + 1)
          .filter((x) => !x.pin)
          .map((x) => x.id),
      )
      break
    }
    default:
      break
  }
}
</script>
