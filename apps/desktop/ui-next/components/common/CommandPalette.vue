<template>
  <!-- shadcn Dialog (role=dialog ⇒ OVERLAYS đã phủ; thay cho `.cmdk-ovl` cũ). Esc / bấm
       ngoài = đóng qua `update:open`. Neo cao 14vh thay vì căn giữa: danh sách lọc co
       giãn theo chữ gõ, căn giữa thì ô tìm nhảy lên xuống mỗi phím. z-200: trên mọi
       modal thường, cùng bậc confirm. -->
  <Dialog :open="isOpen" @update:open="(v: boolean) => !v && close()">
    <DialogContent
      class="top-[14vh] z-200 flex max-h-[64vh] w-[calc(100%-2rem)] max-w-150 translate-y-0 flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground data-[state=closed]:[--tw-exit-translate-y:0]! data-[state=open]:[--tw-enter-translate-y:0]!"
      :aria-label="t('palette.placeholder')"
      :aria-describedby="undefined"
    >
      <DialogTitle class="sr-only">{{ t('palette.placeholder') }}</DialogTitle>
      <!-- pr-10: chừa chỗ nút X (DialogContent tự vẽ ở góc phải trên). -->
      <div class="flex shrink-0 items-center gap-2 border-b py-2.5 pr-10 pl-3.5">
        <Search class="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref="inputRef"
          v-model="query"
          unstyled
          class="min-h-0 min-w-0 flex-1 text-base placeholder:text-faint"
          :placeholder="t('palette.placeholder')"
          :aria-label="t('palette.placeholder')"
          @keydown.down.prevent="moveDown"
          @keydown.up.prevent="moveUp"
          @keydown.enter.prevent="runActive"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-2">
        <p v-if="entries.length === 0" class="px-3 py-3.5 text-base text-muted-foreground">
          {{ t('palette.empty') }}
        </p>

        <template v-for="group in grouped" :key="group.section">
          <div
            v-if="group.entries.length"
            class="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
          >
            {{ group.label }}
          </div>
          <!-- raw-ok: hàng kết quả cả dòng là một vùng bấm; ref mảng để cuộn theo phím -->
          <button
            v-for="entry in group.entries"
            :key="entry.id"
            ref="rowEls"
            type="button"
            class="group/row flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left"
            :class="
              entry.flatIndex === activeIndex
                ? 'on bg-accent text-accent-foreground'
                : 'text-popover-foreground'
            "
            @mouseenter="activeIndex = entry.flatIndex"
            @click="run(entry)"
          >
            <component
              :is="entry.icon ?? defaultIcon"
              class="size-3.5 shrink-0 text-muted-foreground group-[.on]/row:text-primary"
            />
            <span class="min-w-0 flex-1 truncate text-base font-medium">
              <span
                v-for="(seg, si) in highlightSegments(entry.label, entry.positions)"
                :key="si"
                :class="{ 'font-semibold text-primary': seg.match }"
              >
                {{ seg.text }}
              </span>
            </span>
            <Badge
              v-if="entry.meta"
              variant="secondary"
              class="block max-w-[40%] shrink-0 truncate bg-muted font-normal text-muted-foreground"
            >
              {{ entry.meta }}
            </Badge>
            <span v-if="entry.hint" class="shrink-0 text-sm text-muted-foreground">
              {{ entry.hint }}
            </span>
          </button>
        </template>
      </div>

      <div class="flex shrink-0 gap-3.5 border-t px-3.5 py-2 text-sm text-muted-foreground">
        <span>{{ t('palette.hint.navUp') }}</span>
        <span>{{ t('palette.hint.enter') }}</span>
        <span>{{ t('palette.hint.esc') }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  Boxes,
  Cloud,
  FolderGit2,
  MessageSquarePlus,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useProjects } from '~/composables/useProjects'
import { useInfraExplorerCatalog } from '~/composables/useInfraExplorerCatalog'
import { useInfraServiceOpen } from '~/composables/useInfraServiceOpen'
import { useLinkOpen } from '~/composables/useLinkOpen'
import { highlightSegments } from '~/utils/fuzzy'
import { SETTINGS_SECTIONS } from '~/components/settings/sections'
import {
  rankCommands,
  useCommandPalette,
  type PaletteCommand,
  type PaletteEntry,
} from '~/composables/useCommandPalette'

// Global ⌘K palette. Mounted once in the layout; the open/close key handler lives
// there too. Builds a static navigate set + a live session set (jump to recent),
// fuzzy-filters, and runs the chosen command's closure.

const { t } = useI18n()
const { isOpen, close } = useCommandPalette()
const store = useSessionsStore()
const { projects, projectName } = useProjects()
const { services: awsServices, pinnedServices, ensureCatalog } = useInfraExplorerCatalog()
const { request: requestServiceOpen } = useInfraServiceOpen()
const { openExternally } = useLinkOpen()
const { start: startTour } = useTour()
const { reset: rerunSetup } = useOnboarding()
const { index: settingsIndex, ensureIndex: ensureSettingsIndex } = useSettingsSearch()
const { openSettings } = useSettingsModal()

const defaultIcon = Terminal

const query = ref('')
const activeIndex = ref(0)
// Input shadcn expose focus() (template ref là instance, không phải phần tử input).
const inputRef = useTemplateRef<{ focus: () => void }>('inputRef')
const rowEls = useTemplateRef<HTMLElement[]>('rowEls')

// ── Navigate commands (file-based routes) ────────────────────────────────────
const NAV_ROUTES: { to: string; key: string }[] = [
  { to: '/workbench', key: 'palette.cmd.goSessions' },
  { to: '/agents', key: 'palette.cmd.goAgents' },
  { to: '/projects', key: 'palette.cmd.goProjects' },
  { to: '/git', key: 'palette.cmd.goGit' },
  { to: '/tasks', key: 'palette.cmd.goTasks' },
  { to: '/workflows', key: 'palette.cmd.goWorkflows' },
  { to: '/skills', key: 'palette.cmd.goSkills' },
  { to: '/commands', key: 'palette.cmd.goCommands' },
  { to: '/rules', key: 'palette.cmd.goRules' },
  { to: '/hooks', key: 'palette.cmd.goHooks' },
  { to: '/connections', key: 'palette.cmd.goConnections' },
  { to: '/settings', key: 'palette.cmd.goSettings' },
  { to: '/templates', key: 'palette.cmd.goTemplates' },
]

// labelKey của một mục Settings (id → nhãn nav).
const sectionLabelKey = (id: string): string =>
  SETTINGS_SECTIONS.find((s) => s.id === id)?.labelKey ?? id

// Cap recent sessions surfaced so the list stays scannable.
const RECENT_LIMIT = 8

const commands = computed<PaletteCommand[]>(() => {
  const out: PaletteCommand[] = []

  // Session actions first (most common quick action).
  out.push({
    id: 'session-new',
    label: t('palette.cmd.newSession'),
    hint: t('palette.cmd.newSession.hint'),
    icon: MessageSquarePlus,
    section: 'session',
    run: () => {
      // Generic "New session" command → a global DEFAULT (no-project) session, like
      // the header "New" button. Project scoping is intentionally only on ⌘T + the
      // page "+", not on this generic affordance. Do NOT pass activeTab here.
      store.create()
      void navigateTo('/workbench')
    },
  })
  for (const s of store.sessions.slice(0, RECENT_LIMIT)) {
    out.push({
      id: `session-${s.id}`,
      label: s.title,
      // Show which project this session belongs to. Skip no-project sessions —
      // a "Default" tag on every loose chat is noise, not information.
      ...(s.project ? { meta: projectName(s.project) } : {}),
      hint: t('palette.session.jump'),
      icon: ArrowRight,
      section: 'session',
      run: () => {
        store.setActive(s.id)
        void navigateTo('/workbench')
      },
    })
  }

  // ── Projects (searchable) ──────────────────────────────────────────────────
  // Selecting a project opens its most recent session (the "first" one the
  // sessions list would show); if it has none yet, start a fresh session scoped
  // to that project.
  for (const p of projects.value) {
    out.push({
      id: `project-${p.id}`,
      label: p.name,
      hint: t('palette.project.open'),
      icon: FolderGit2,
      section: 'project',
      run: () => {
        const first = store.sessions.find((s) => s.project === p.id)
        if (first) store.setActive(first.id)
        else store.create(p.id)
        void navigateTo('/workbench')
      },
    })
  }

  // ── AWS services ───────────────────────────────────────────────────────────
  // Pinned services show even on an empty query; the rest surface only when the
  // user types (the catalog is ~110 entries — flooding the empty palette buries
  // everything else). Opening follows the /infra catalog's own semantics: a
  // service with an in-app table opens /infra on that table; a console-only
  // service opens the AWS Console in the browser.
  const typing = query.value.trim().length > 0
  const pinnedSet = new Set(pinnedServices.value)
  const svcSource = typing
    ? awsServices.value
    : awsServices.value.filter((s) => pinnedSet.has(s.id))
  for (const svc of svcSource) {
    out.push({
      id: `aws-${svc.id}`,
      label: t(svc.label),
      meta: t(`infra.explorer.group.${svc.group}`),
      hint: t('palette.service.open'),
      icon: svc.target.kind === 'console' ? Cloud : Boxes,
      section: 'service',
      run: () => {
        if (svc.target.kind === 'console' && svc.consoleUrl) {
          void openExternally(svc.consoleUrl)
          return
        }
        requestServiceOpen(svc.id)
        void navigateTo('/infra')
      },
    })
  }

  // ── Cài đặt (tìm tới TỪNG dòng) ─────────────────────────────────────────────
  // Chỉ khi có chữ gõ: chỉ mục có hàng trăm dòng, đổ hết vào palette trống là chôn mọi
  // thứ khác. Chọn ⇒ mở Settings đúng mục, cuộn tới + nháy sáng đúng dòng.
  if (typing) {
    for (const h of settingsIndex.value) {
      const secLabel = t(sectionLabelKey(h.section))
      const label =
        h.kind === 'section' ? `${t('palette.setting.prefix')} ${secLabel}` : t(h.nameKey)
      out.push({
        id: `setting-${h.section}-${h.nameKey}`,
        label,
        ...(h.kind === 'section' ? {} : { meta: secLabel }),
        keywords: h.keywords,
        hint: t('palette.setting.open'),
        icon: Settings2,
        section: 'setting',
        run: () => openSettings(h.section, h.kind === 'section' ? undefined : label),
      })
    }
  }

  // Navigate-to-page commands.
  for (const r of NAV_ROUTES) {
    out.push({
      id: `nav-${r.to}`,
      label: t(r.key),
      section: 'navigate',
      run: () => void navigateTo(r.to),
    })
  }

  // Onboarding replay — re-run the setup wizard or take the interface tour.
  out.push({
    id: 'onboarding-tour',
    label: t('onboarding.cmd.startTour'),
    icon: Sparkles,
    section: 'navigate',
    run: () => startTour('intro'),
  })
  out.push({
    id: 'onboarding-setup',
    label: t('onboarding.cmd.startSetup'),
    icon: Wand2,
    section: 'navigate',
    run: () => rerunSetup(),
  })

  return out
})

// Cài đặt khớp có thể rất nhiều (khớp qua mô tả) — giữ 12 dòng tốt nhất cho nhóm đó.
const SETTING_LIMIT = 12
const entries = computed<PaletteEntry[]>(() => {
  let settings = 0
  return rankCommands(query.value, commands.value).filter(
    (e) => e.section !== 'setting' || ++settings <= SETTING_LIMIT,
  )
})

// Group filtered entries by section, preserving rank order within each group,
// and stamp a flat index for keyboard navigation across all visible rows.
type RenderEntry = PaletteEntry & { flatIndex: number }
type RenderGroup = { section: PaletteCommand['section']; label: string; entries: RenderEntry[] }

const grouped = computed<RenderGroup[]>(() => {
  const sections: { section: PaletteCommand['section']; label: string }[] = [
    { section: 'session', label: t('palette.section.session') },
    { section: 'project', label: t('palette.section.project') },
    { section: 'service', label: t('palette.section.service') },
    { section: 'setting', label: t('palette.section.setting') },
    { section: 'navigate', label: t('palette.section.navigate') },
  ]
  let flat = 0
  return sections.map(({ section, label }) => ({
    section,
    label,
    entries: entries.value
      .filter((e) => e.section === section)
      .map((e) => ({ ...e, flatIndex: flat++ })),
  }))
})

// Flat, ordered list matching the rendered rows — Enter runs activeIndex against
// this so the cursor lines up with what the eye sees (sessions, projects,
// services, then navigate).
const flatEntries = computed<RenderEntry[]>(() => grouped.value.flatMap((g) => g.entries))

function moveDown() {
  const n = flatEntries.value.length
  if (n) activeIndex.value = (activeIndex.value + 1) % n
}
function moveUp() {
  const n = flatEntries.value.length
  if (n) activeIndex.value = (activeIndex.value - 1 + n) % n
}

function run(entry: PaletteEntry) {
  entry.run()
  close()
}
function runActive() {
  const entry = flatEntries.value[activeIndex.value]
  if (entry) run(entry)
}

// On open: reset query + cursor, focus the input, and load the AWS service
// catalog (lazily — only once ⌘K is actually used, not at app boot). It just
// serializes a constant on the sidecar; no CLI, no credentials.
watch(isOpen, (open) => {
  if (!open) return
  query.value = ''
  activeIndex.value = 0
  void ensureCatalog()
  void ensureSettingsIndex()
  nextTick(() => inputRef.value?.focus())
})

// Keep the cursor valid when the filtered set shrinks.
watch(flatEntries, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = 0
})

// Keep the active row in view during keyboard navigation.
watch(activeIndex, (i) => {
  nextTick(() => rowEls.value?.[i]?.scrollIntoView({ block: 'nearest' }))
})
</script>
