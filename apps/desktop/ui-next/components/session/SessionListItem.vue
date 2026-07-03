<template>
  <div
    class="li"
    :class="{ on: active, sel: selected }"
    :data-sid="session.id"
    @click="onRowClick"
    @contextmenu.prevent="onCtx"
  >
    <div class="lrow">
      <!-- Checkbox shows ONLY in select mode (or when already selected) — NOT on
           hover (Select now lives in the right-click context menu). Hidden during
           inline rename so the rename input gets the full row. -->
      <span
        v-if="(selecting || selected) && !editing"
        class="lcbox"
        :class="{ on: selected }"
        :title="t('sessions.sidebar.select')"
        @click.stop="store.toggleSelect(session.id)"
      >
        <Icon v-if="selected" name="check" style="width: 11px; height: 11px" />
      </span>
      <span
        v-if="session.pinned && !editing"
        class="pinmark"
        :title="t('sessions.sidebar.pinned')"
        @click.stop="store.togglePin(session.id)"
      >
        <Icon name="pin" style="width: 11px; height: 11px" />
      </span>
      <span
        class="sdot"
        :class="{ pulse: session.status === 'streaming' }"
        :style="{ background: statusColor }"
      />
      <input
        v-if="editing"
        ref="renameInput"
        v-model="draft"
        class="ttl"
        @click.stop
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <span
        v-else
        class="ttl"
        :class="{ unread: session.unread }"
        :title="t('sessions.item.rename')"
        @dblclick.stop="startRename"
      >
        {{ session.title }}
      </span>
      <span v-if="session.unread && !editing" class="undot" :title="t('sessions.item.unread')" />
      <span v-if="!editing" class="tm">{{ session.when }}</span>
    </div>
    <div class="sub">
      <span v-if="!hideProject" class="tag projtag" style="padding: 1px 6px">{{ projName }}</span>
      <span class="smeta">{{ session.model }}</span>
      <!-- Indicators + status badge, grouped on the far right (status rightmost). -->
      <span class="subright">
        <span v-if="indicators.length" class="lind">
          <span v-for="ind in indicators" :key="ind.key" class="lindchip" :title="ind.title">
            <Icon :name="ind.icon" style="width: 11px; height: 11px" />
            {{ ind.count }}
          </span>
        </span>
        <span class="statusbadge" :style="badgeStyle">{{ statusLabel }}</span>
      </span>
    </div>
    <div v-if="!editing" class="liact">
      <span
        class="liactbtn"
        :class="{ on: session.pinned }"
        :title="session.pinned ? t('sessions.sidebar.unpin') : t('sessions.sidebar.pin')"
        @click.stop="store.togglePin(session.id)"
      >
        <Icon name="pin" style="width: 12px; height: 12px" />
      </span>
      <span class="liactbtn danger" :title="t('sessions.item.delete')" @click.stop="askRemove">
        <Icon name="trash" style="width: 13px; height: 13px" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// One session row in the list (liHtml ~1243): selection checkbox, pin mark,
// status dot, title, unread mark, time, project tag + model · status, and
// compact indicator chips (attachments / pending follow-ups / queued). Hover
// reveals pin + delete actions. Title supports inline rename (double-click →
// input). Pin / delete / select route to the store; in select mode a row click
// toggles selection instead of opening the session.
import type { Session, SessionStatus } from '~/composables/useSessionsData'

// Status badge palette — mirrors the app's node-badge convention (.bdg.run / .nx.ok =
// accent, .bdg.wait = amber): done + running use accent (complete/active), waiting amber,
// error danger, draft a neutral chip (a not-yet-run state carries no alert color). Token
// trios only — no hardcoded hex; danger has no *Border token so its border is color-mixed.
const BADGE_STYLE: Record<
  SessionStatus,
  { color: string; background: string; borderColor: string }
> = {
  // draft: neutral OUTLINE chip (transparent fill, not a grey surface) — distinct from the
  // filled accent `done` badge and consistent with the app's no-grey-fill convention.
  idle: { color: 'var(--textDim)', background: 'transparent', borderColor: 'var(--border)' },
  streaming: {
    color: 'var(--accent)',
    background: 'var(--accentDim)',
    borderColor: 'var(--accentBorder)',
  },
  awaiting: {
    color: 'var(--amber)',
    background: 'var(--amberDim)',
    borderColor: 'var(--amberBorder)',
  },
  done: {
    color: 'var(--accent)',
    background: 'var(--accentDim)',
    borderColor: 'var(--accentBorder)',
  },
  error: {
    color: 'var(--danger)',
    background: 'var(--dangerDim)',
    borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
  },
}

const props = defineProps<{
  session: Session
  active: boolean
  selecting: boolean
  // Hide the project chip — redundant when the list is grouped by project (the
  // group header already names it), and frees the sub-row so it stays one line.
  hideProject?: boolean
  // Rename signal from the parent context menu: when `.id` matches this row, the
  // inline rename starts. `n` (nonce) lets the same row be re-triggered.
  renameReq?: { id: number; n: number }
}>()
const emit = defineEmits<{
  // Right-click → ask the parent to open the session context menu at the cursor.
  ctxmenu: [payload: { id: number; x: number; y: number }]
}>()

const { t } = useI18n()
const { STATUS_COLOR } = useSessionsData()
const { projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()

// Delete is destructive + unrecoverable (drops the JSONL transcript) → confirm first.
async function askRemove() {
  const ok = await confirm({
    title: t('sessions.delete.title'),
    description: t('sessions.delete.one', { title: props.session.title }),
  })
  if (ok) store.remove(props.session.id)
}

const statusColor = computed(() => STATUS_COLOR[props.session.status])
const statusLabel = computed(() => t(`sessions.status.${props.session.status}`))
// Badge fill/text/border per status (see BADGE_STYLE). Kept separate from the dot's
// STATUS_COLOR so the badge can read as a proper colored chip while the dot stays muted.
const badgeStyle = computed(() => BADGE_STYLE[props.session.status])
// session.project holds the engine projectId; show the resolved display name.
const projName = computed(() => projectName(props.session.project))
const selected = computed(() => store.selectedIds.has(props.session.id))

// Compact item indicators (§1): attachment / pending follow-up / queued counts.
// Only chips with count > 0 are rendered.
type Indicator = { key: string; icon: string; count: number; title: string }
const indicators = computed<Indicator[]>(() => {
  const out: Indicator[] = []
  const att = props.session.msgs.reduce(
    (sum, m) => sum + (m.role === 'user' && m.att ? m.att.length : 0),
    0,
  )
  if (att > 0)
    out.push({
      key: 'att',
      icon: 'clip',
      count: att,
      title: t('sessions.sidebar.attachments', { n: att }),
    })
  const fu = props.session.followups?.length ?? 0
  if (fu > 0)
    out.push({
      key: 'fu',
      icon: 'quote',
      count: fu,
      title: t('sessions.sidebar.followups', { n: fu }),
    })
  const qd = props.session.queue?.length ?? 0
  if (qd > 0)
    out.push({
      key: 'qd',
      icon: 'clock',
      count: qd,
      title: t('sessions.sidebar.queued', { n: qd }),
    })
  return out
})

// Row click: in select mode toggle selection (and swallow the click so the
// parent's `select` handler doesn't also open the session). Outside select mode
// the click bubbles to the parent which emits `select`.
function onRowClick(e: MouseEvent) {
  if (props.selecting) {
    e.stopPropagation()
    store.toggleSelect(props.session.id)
  }
}

// Inline rename: local UI state; the renamed value is committed to the store.
const editing = ref(false)
const draft = ref('')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')

function startRename() {
  draft.value = props.session.title
  editing.value = true
  nextTick(() => renameInput.value?.focus())
}
function commitRename() {
  if (!editing.value) return
  editing.value = false
  store.rename(props.session.id, draft.value)
}
function cancelRename() {
  editing.value = false
}

// Right-click → bubble the cursor position up so the parent shows one shared menu.
function onCtx(e: MouseEvent) {
  emit('ctxmenu', { id: props.session.id, x: e.clientX, y: e.clientY })
}
// Parent context menu "Rename" → start this row's inline edit when targeted.
watch(
  () => props.renameReq,
  (r) => {
    if (r && r.id === props.session.id) startRename()
  },
)
</script>

<style scoped>
/* Inline rename field: a native <input> reusing .ttl would render on the browser
   default WHITE box, so its theme-light text was white-on-white in dark mode. Pin
   it to theme tokens (dark surface + readable text + accent focus ring). */
input.ttl {
  background: var(--bgInput);
  color: var(--text);
  border: 1px solid var(--accentBorder);
  border-radius: 6px;
  padding: 2px 7px;
  outline: none;
  font: inherit;
}

/* Right-aligned group in the sub-row: indicator chips + status badge, badge rightmost. */
.subright {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: 0 0 auto;
}
/* Status chip: colored text + tint fill + border (bound inline via badgeStyle). Radius 5px
   + 12px mono match the app's .bdg node-badge convention, not the round .tag pill. */
.statusbadge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid;
  border-radius: 5px;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
/* Indicator chips: small mono count pills, subtle (§1). Color tokens only — no
   hardcoded hex. Numeric counts use a fixed 12px mono per the badge rule. */
.lind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lindchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  color: var(--textFaint);
}
/* Keep the meta sub-row on a SINGLE line: never wrap, and let the two text parts
   shrink + ellipsis instead of pushing to a second line. Project chip is capped
   (secondary info) so the model · status — the more useful part — keeps its room. */
.sub {
  flex-wrap: nowrap;
  min-width: 0;
}
.projtag {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smeta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Pin mark is interactive (toggles pin); keep the pointer affordance. */
.pinmark {
  cursor: pointer;
}
/* Row hover actions — ghost pills. Pin hovers to accent (it's a toggle, not
   destructive); only the trash variant goes danger. The shared prototype `.del`
   rule turned BOTH red, so these own classes replace it. */
.liact .liactbtn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--textDim);
  background: var(--bgActive);
  transition:
    color 0.12s,
    background 0.12s;
}
.liact .liactbtn:hover {
  color: var(--accent);
  background: var(--bgHover);
}
.liact .liactbtn.on {
  color: var(--accent);
}
.liact .liactbtn.danger:hover {
  color: var(--danger);
  background: var(--dangerDim, var(--bgHover));
}
</style>
