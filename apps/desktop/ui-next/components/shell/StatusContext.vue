<template>
  <span class="sb-wrap">
    <button
      class="sb-item ctxmini"
      :title="t('sessions.detail.contextUsage')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <span class="ctxbar">
        <i
          v-for="s in barSegments"
          :key="s.key"
          :style="{ width: `${s.pct}%`, background: s.color }"
        />
      </span>
      <span class="ctxn">{{ tokLabel }}/{{ limitLabel }}</span>
    </button>

    <template v-if="open">
      <div class="sb-backdrop" @click="open = false" />
      <div class="pop sb-pop" @click.stop>
        <div class="pr2">
          <div class="pl plnowrap">
            <span>{{ t('sessions.detail.contextWindow') }}</span>
            <span class="ctxn">{{ tokLabel }} / {{ limitLabel }} · {{ Math.round(pct) }}%</span>
          </div>
          <div class="ctxmodel">{{ model }}</div>
          <div v-if="sessionCost != null" class="ctxcost">
            <span>{{ t('sessions.detail.cat.cost') }}</span>
            <span class="ctxn">{{ fmtUsd(sessionCost) }}</span>
          </div>
          <span class="ctxbar" style="width: 100%; height: 8px">
            <i
              v-for="s in barSegments"
              :key="s.key"
              :style="{ width: `${s.pct}%`, background: s.color }"
            />
          </span>
          <div class="cattbl">
            <div class="cathead">
              <span class="catlbl">{{ t('sessions.detail.cat.category') }}</span>
              <span class="catnum">{{ t('sessions.detail.cat.tokens') }}</span>
              <span class="catpct">{{ t('sessions.detail.cat.usage') }}</span>
            </div>
            <div v-for="row in catRows" :key="row.key" class="catrow">
              <span class="catsq" :style="{ background: row.color }" />
              <span class="catlbl">{{ row.label }}</span>
              <span class="catnum">{{ formatTokenCount(row.tokens) }}</span>
              <span class="catpct">{{ row.pct < 0.05 ? '0%' : `${row.pct.toFixed(1)}%` }}</span>
            </div>
          </div>

          <!-- Expandable detail: bulk-loaded memory files + custom agents. -->
          <div v-if="memoryFilesList.length" class="ctxsec">
            <button class="ctxsechead" @click.stop="memoryFilesOpen = !memoryFilesOpen">
              <Icon
                name="chev"
                class="ctxchev"
                :class="{ open: memoryFilesOpen }"
                style="width: 11px; height: 11px"
              />
              {{ t('sessions.detail.cat.memoryFilesSection') }}
              <span class="ctxcount">{{ memoryFilesList.length }}</span>
            </button>
            <div v-if="memoryFilesOpen" class="ctxitems">
              <div v-for="it in memoryFilesList" :key="it.label" class="ctxitem">
                <span class="ctxipath">{{ it.label }}</span>
                <span class="ctxinum">{{ formatTokenCount(it.tokens) }}</span>
              </div>
            </div>
          </div>
          <div v-if="agentsList.length" class="ctxsec">
            <button class="ctxsechead" @click.stop="agentsOpen = !agentsOpen">
              <Icon
                name="chev"
                class="ctxchev"
                :class="{ open: agentsOpen }"
                style="width: 11px; height: 11px"
              />
              {{ t('sessions.detail.cat.agentsSection') }}
              <span class="ctxcount">{{ agentsList.length }}</span>
            </button>
            <div v-if="agentsOpen" class="ctxitems">
              <div v-for="it in agentsList" :key="it.label" class="ctxitem">
                <span class="ctxipath">{{ it.label }}</span>
                <span class="ctxinum">{{ formatTokenCount(it.tokens) }}</span>
              </div>
            </div>
          </div>

          <!-- Footer action: /compact — summarise older turns to free budget (ADR 0047),
               same RPC as the composer's `/compact`. Locked + spinner while it runs. -->
          <div v-if="canCompact" class="ctxfoot">
            <button
              class="ctxaction"
              :disabled="compacting"
              :title="t('sessions.detail.compactHint')"
              @click.stop="onCompact"
            >
              <Icon
                :name="compacting ? 'refresh' : 'foldv'"
                :class="{ ctxspin: compacting }"
                style="width: 13px; height: 13px"
              />
              {{ compacting ? t('sessions.composer.compacting') : t('sessions.detail.compact') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Context-window chip + breakdown popover for the global status bar — renders the
// active session's `/context`-style usage (moved here from the SessionDetail
// header). All math lives in useSessionContextUsage; this owns only the popover
// open state + the two expandable bulk-load sections.
import { computed, ref } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { pushActionToast } from '~/composables/useActionToasts'
import { formatTokenCount } from '~/utils/context-window'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()

const {
  fmtUsd,
  sessionCost,
  model,
  tokLabel,
  limitLabel,
  pct,
  barSegments,
  catRows,
  memoryFilesList,
  agentsList,
} = useSessionContextUsage(() => props.session)

const open = ref(false)
const memoryFilesOpen = ref(false)
const agentsOpen = ref(false)

// Manual `/compact` from the context popover — only for a live (engine-backed)
// session; the store guards overlapping calls + drives `compacting`.
const canCompact = computed(() => !!props.session.engineId)
const compacting = computed(() => props.session.compacting === true)
function onCompact() {
  if (compacting.value) return
  void store.compactSession(props.session.id).then((r) => {
    if (r === 'compacted') pushActionToast(t('sessions.command.notice.compacted'), 'success')
    else if (r === 'nothing') pushActionToast(t('sessions.command.notice.nothingToCompact'), 'info')
    else pushActionToast(t('sessions.command.notice.compactFailed'), 'error')
  })
}
</script>

<style scoped>
.sb-wrap {
  position: relative;
  display: inline-flex;
}
/* The status-bar popover opens UPWARD (the bar is pinned to the window bottom):
   anchor it above the chip, right-aligned. Override the global `.pop` fixed/z. */
.sb-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 95;
}
.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
}

/* ── Context-window breakdown table (Claude-Code /context style) ───────────── */
.ctxmodel {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  margin: 2px 0 8px;
}
.ctxcost {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 8px;
  font-size: 12px;
  color: var(--textDim);
}
.plnowrap {
  white-space: nowrap;
  gap: 10px;
}
.plnowrap > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.plnowrap > .ctxn {
  flex: 0 0 auto;
}
.cattbl {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
}
.cathead,
.catrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.cathead {
  font-size: 12px;
  color: var(--textFaint);
  border-bottom: 1px solid var(--border);
  padding-bottom: 5px;
  margin-bottom: 2px;
}
.catsq {
  width: 9px;
  height: 9px;
  /* design-token-ok: a 9px square legend swatch — the --r-xs token (6px) clamps to
     4.5px on it and turns the square into a dot. */
  border-radius: 2px;
  flex: 0 0 auto;
}
.cathead .catlbl {
  margin-left: 17px;
}
.catlbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.catnum,
.catpct {
  flex: 0 0 auto;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  text-align: right;
}
.catnum {
  min-width: 56px;
}
.catpct {
  min-width: 48px;
  color: var(--textFaint);
}

/* ── Expandable bulk-load sections (MEMORY FILES / CUSTOM AGENTS) ──────────── */
.ctxsec {
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.ctxsechead {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--textFaint);
  font-size: 12px;
}
.ctxsechead:hover {
  color: var(--text);
}
.ctxchev {
  transition: transform 0.12s ease;
}
.ctxchev.open {
  transform: rotate(90deg);
}
.ctxcount {
  margin-left: auto;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  color: var(--textDim);
}
.ctxitems {
  display: flex;
  flex-direction: column;
  margin-top: 4px;
  max-height: 184px;
  overflow-y: auto;
}
.ctxitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.ctxipath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
}
.ctxinum {
  flex: 0 0 auto;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  text-align: right;
}
/* ── Footer action (/compact) ─────────────────────────────────────────────── */
.ctxfoot {
  margin-top: 10px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.ctxaction {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.ctxaction:hover:not(:disabled) {
  background: var(--bgHover);
  border-color: var(--accentBorder);
  color: var(--accent);
}
.ctxaction:disabled {
  cursor: default;
  color: var(--textDim);
}
.ctxspin {
  animation: ctxspin 0.9s linear infinite;
}
@keyframes ctxspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ctxchev {
    transition: none;
  }
  .ctxspin {
    animation: none;
  }
}
</style>
