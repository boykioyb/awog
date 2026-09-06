<template>
  <Teleport to="body">
    <Transition name="cmdk">
      <div v-if="isOpen" class="cmdk-ovl" @click.self="close">
        <div class="cmdk-card" role="dialog" aria-modal="true">
          <div class="cmdk-search">
            <Search :size="15" class="cmdk-search-ic" />
            <input
              ref="inputRef"
              v-model="query"
              class="cmdk-input"
              :placeholder="t('palette.placeholder')"
              :aria-label="t('palette.placeholder')"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
              @keydown.enter.prevent="runActive"
              @keydown.esc.prevent="close"
            />
          </div>

          <div class="cmdk-list">
            <p v-if="entries.length === 0" class="cmdk-empty">{{ t('palette.empty') }}</p>

            <template v-for="group in grouped" :key="group.section">
              <div v-if="group.entries.length" class="cmdk-group">
                {{ group.label }}
              </div>
              <button
                v-for="entry in group.entries"
                :key="entry.id"
                ref="rowEls"
                type="button"
                class="cmdk-row"
                :class="{ on: entry.flatIndex === activeIndex }"
                @mouseenter="activeIndex = entry.flatIndex"
                @click="run(entry)"
              >
                <component :is="entry.icon ?? defaultIcon" :size="14" class="cmdk-row-ic" />
                <span class="cmdk-row-label">
                  <span
                    v-for="(seg, si) in highlightSegments(entry.label, entry.positions)"
                    :key="si"
                    :class="{ hl: seg.match }"
                  >
                    {{ seg.text }}
                  </span>
                </span>
                <span v-if="entry.hint" class="cmdk-row-hint">{{ entry.hint }}</span>
              </button>
            </template>
          </div>

          <div class="cmdk-foot">
            <span>{{ t('palette.hint.navUp') }}</span>
            <span>{{ t('palette.hint.enter') }}</span>
            <span>{{ t('palette.hint.esc') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ArrowRight, MessageSquarePlus, Search, Sparkles, Terminal, Wand2 } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import {
  highlightSegments,
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
const { start: startTour } = useTour()
const { reset: rerunSetup } = useOnboarding()

const defaultIcon = Terminal

const query = ref('')
const activeIndex = ref(0)
const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const rowEls = useTemplateRef<HTMLElement[]>('rowEls')

// ── Navigate commands (file-based routes) ────────────────────────────────────
const NAV_ROUTES: { to: string; key: string }[] = [
  { to: '/sessions', key: 'palette.cmd.goSessions' },
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
      void navigateTo('/sessions')
    },
  })
  for (const s of store.sessions.slice(0, RECENT_LIMIT)) {
    out.push({
      id: `session-${s.id}`,
      label: s.title,
      hint: t('palette.session.jump'),
      icon: ArrowRight,
      section: 'session',
      run: () => {
        store.setActive(s.id)
        void navigateTo('/sessions')
      },
    })
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

const entries = computed<PaletteEntry[]>(() => rankCommands(query.value, commands.value))

// Group filtered entries by section, preserving rank order within each group,
// and stamp a flat index for keyboard navigation across all visible rows.
type RenderEntry = PaletteEntry & { flatIndex: number }
type RenderGroup = { section: PaletteCommand['section']; label: string; entries: RenderEntry[] }

const grouped = computed<RenderGroup[]>(() => {
  const sections: { section: PaletteCommand['section']; label: string }[] = [
    { section: 'session', label: t('palette.section.session') },
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
// this so the cursor lines up with what the eye sees (sessions then navigate).
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

// On open: reset query + cursor, focus the input.
watch(isOpen, (open) => {
  if (!open) return
  query.value = ''
  activeIndex.value = 0
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

<style scoped>
.cmdk-ovl {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: rgba(0, 0, 0, 0.55);
}
.cmdk-card {
  width: 100%;
  max-width: 600px;
  margin: 0 16px;
  display: flex;
  flex-direction: column;
  max-height: 64vh;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.cmdk-search {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cmdk-search-ic {
  color: var(--textDim);
  flex-shrink: 0;
}
.cmdk-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.cmdk-input::placeholder {
  color: var(--textFaint);
}
.cmdk-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 5px 5px 7px;
}
.cmdk-empty {
  padding: 14px 12px;
  color: var(--textFaint);
  font-size: 1em;
}
.cmdk-group {
  padding: 8px 10px 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.cmdk-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  text-align: left;
  color: var(--text);
  cursor: pointer;
  background: transparent;
}
.cmdk-row.on {
  background: var(--bgActive);
}
.cmdk-row-ic {
  flex-shrink: 0;
  color: var(--textDim);
}
.cmdk-row.on .cmdk-row-ic {
  color: var(--accent);
}
.cmdk-row-label {
  flex: 1;
  min-width: 0;
  font-size: 1em;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmdk-row-label .hl {
  color: var(--accent);
  font-weight: 600;
}
.cmdk-row-hint {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.cmdk-foot {
  display: flex;
  gap: 14px;
  padding: 7px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}

.cmdk-enter-active,
.cmdk-leave-active {
  transition: opacity 120ms ease;
}
.cmdk-enter-from,
.cmdk-leave-to {
  opacity: 0;
}
</style>
