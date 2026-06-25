<template>
  <div class="wpanel" :style="{ flex: `0 0 ${width}px`, width: `${width}px` }">
    <div class="wphead">
      <div class="wptabs2">
        <div
          v-for="tab in openTabs"
          :key="tab"
          class="wptab2"
          :class="{ on: tab === activeTab }"
          @click="activeTab = tab"
        >
          <Icon :name="wpIcon(tab)" style="width: 12px; height: 12px" />
          <span>{{ tab }}</span>
          <span class="x" @click.stop="closeTab(tab)">×</span>
        </div>
      </div>
      <span style="position: relative">
        <button class="wpaddb" :title="t('sessions.workspace.openView')" @click.stop="toggleAdd">
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <div
          v-if="addOpen"
          class="smenu"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div v-for="v in addableViews" :key="v" class="mi" @click="addView(v)">
            <Icon :name="wpIcon(v)" style="width: 13px; height: 13px" />
            {{ v }}
          </div>
        </div>
      </span>
      <button class="wpib on" :title="t('sessions.workspace.closePanel')" @click="emit('close')">
        <Icon name="panel" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="wpbody" :class="{ flush: isFlushTab }">
      <!-- Diff -->
      <WorkspaceDiff v-if="activeTab === 'Diff'" :session="session" />

      <!-- Files -->
      <WorkspaceFiles v-else-if="activeTab === 'Files'" :session="session" />

      <!-- Plan -->
      <WorkspacePlan v-else-if="activeTab === 'Plan'" :session="session" />

      <!-- Tasks -->
      <WorkspaceTasks v-else-if="activeTab === 'Tasks'" :session="session" />

      <!-- Terminal — kept mounted once opened so the PTY persists across tab
           switches; only shown while it's the active tab. -->
      <WorkspaceTerminal
        v-if="terminalMounted"
        v-show="activeTab === 'Terminal'"
        :session="session"
        :visible="activeTab === 'Terminal'"
      />

      <!-- Info -->
      <div v-if="activeTab === 'Info'" style="display: flex; flex-direction: column">
        <div
          v-for="row in infoRows"
          :key="row.k"
          style="
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 6px 0;
            border-bottom: 1px solid var(--border);
          "
        >
          <span style="color: var(--textDim); flex: 0 0 96px">{{ row.k }}</span>
          <span class="mono" style="min-width: 0; overflow-wrap: anywhere">{{ row.v }}</span>
        </div>
      </div>

      <!-- fallback (Preview / any unhandled view) -->
      <div v-if="isFallbackTab" class="empty" style="padding: 30px">
        <div class="et">{{ t('sessions.workspace.noPreview') }}</div>
      </div>
    </div>

    <div v-if="addOpen" style="position: fixed; inset: 0; z-index: 40" @click="addOpen = false" />
  </div>
</template>

<script setup lang="ts">
// Workspace panel (wpHtml ~1406 + wpBody ~1425): tab strip (Diff/Files/Terminal/…),
// + panel chrome. Tab bodies are wired to real engine data via dedicated tab
// components (Diff/Files/Terminal/Plan/Tasks) which degrade gracefully to an empty
// state outside the Electron shell. Local tab state, closable tabs, "+" view menu.
import type { Session } from '~/composables/useSessionsMock'

const props = withDefaults(
  defineProps<{
    session: Session
    tabs?: string[]
    active?: string
    width?: number
  }>(),
  { tabs: () => ['Diff', 'Files', 'Terminal'], active: 'Diff', width: 352 },
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { wpIcon } = useSessionsMock()
const { projectName } = useProjects()

// Full set of selectable views for the "+" menu (prototype WPVIEWS order).
const ALL_VIEWS = ['Diff', 'Files', 'Terminal', 'Plan', 'Tasks', 'Preview', 'Info'] as const

// Props are read-only seeds; tab open/active live in local state.
const openTabs = ref<string[]>([...props.tabs])
const activeTab = ref(props.active ?? props.tabs[0] ?? 'Diff')
if (!openTabs.value.includes(activeTab.value)) openTabs.value.push(activeTab.value)

// Lazy-mount the Terminal on first activation, then keep it mounted so its PTY
// survives tab switches (an unmount would kill + respawn the shell).
const terminalMounted = ref(activeTab.value === 'Terminal')
watch(activeTab, (tab) => {
  if (tab === 'Terminal') terminalMounted.value = true
})

// Diff/Files/Terminal own their own full-bleed chrome; the others use the padded
// wpbody. `isFallbackTab` = any view without a dedicated body (Preview).
const FLUSH_TABS = new Set(['Diff', 'Files', 'Terminal'])
const HANDLED_TABS = new Set(['Diff', 'Files', 'Terminal', 'Plan', 'Tasks', 'Info'])
const isFlushTab = computed(() => FLUSH_TABS.has(activeTab.value))
const isFallbackTab = computed(() => !HANDLED_TABS.has(activeTab.value))

const addOpen = ref(false)
const addableViews = computed(() => ALL_VIEWS.filter((v) => !openTabs.value.includes(v)))

function closeTab(tab: string) {
  openTabs.value = openTabs.value.filter((t2) => t2 !== tab)
  if (activeTab.value === tab) activeTab.value = openTabs.value[0] ?? 'Diff'
}

function toggleAdd() {
  addOpen.value = !addOpen.value
}

function addView(view: string) {
  if (!openTabs.value.includes(view)) openTabs.value.push(view)
  activeTab.value = view
  addOpen.value = false
}

// Header Info button drives the `active` prop → open + activate that view.
watch(
  () => props.active,
  (v) => {
    if (v) addView(v)
  },
)

const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))
const totalTok = computed(() => {
  const chars = props.session.msgs.reduce((a, m) => {
    if (m.role === 'assistant') {
      return (
        a +
        m.blocks.reduce(
          (b, k) =>
            b +
            ('text' in k ? k.text.length : 0) +
            ('detail' in k ? (k.detail || '').length : 0) +
            60,
          0,
        )
      )
    }
    return a + m.text.length
  }, 0)
  return Math.floor(chars / 3)
})

const infoRows = computed(() => {
  const s = props.session
  return [
    { k: t('sessions.info.id'), v: `s_${s.id}` },
    { k: t('sessions.info.project'), v: projectName(s.project) },
    { k: t('sessions.info.account'), v: s.account },
    { k: t('sessions.info.model'), v: s.model },
    { k: t('sessions.info.style'), v: s.style || 'Normal' },
    { k: t('sessions.info.mode'), v: s.mode || 'Ask' },
    { k: t('sessions.info.messages'), v: String(s.msgs.length) },
    { k: t('sessions.info.tokens'), v: `${kfmt(totalTok.value)} / 200k` },
    { k: t('sessions.info.updated'), v: s.when },
  ]
})
</script>

<style scoped>
/* Diff/Files/Terminal own their full chrome (file lists, viewers, the PTY canvas)
   so they take over the whole body without the default 13px padding + scroll. */
.wpbody.flush {
  padding: 0;
  overflow: hidden;
}
</style>
