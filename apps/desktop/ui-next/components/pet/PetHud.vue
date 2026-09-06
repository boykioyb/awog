<template>
  <div class="hud">
    <template v-if="model.state === 'offline'">
      <div class="empty">{{ t('pet.offline') }}</div>
    </template>

    <template v-else>
      <button
        v-for="item in model.items"
        :key="`${item.kind}-${item.id}`"
        class="row"
        @click="emit('open', item)"
      >
        <span class="dot" :class="`is-${item.hint}`" />
        <span class="rowbody">
          <span class="rowtop">
            <span class="title">{{ item.title }}</span>
            <span class="meta" :class="`is-${item.hint}`">{{ metaOf(item) }}</span>
          </span>
          <!-- What it is actually saying/doing right now. Without this the HUD only
               repeats the session titles, which is the least changing thing about it. -->
          <span v-if="item.preview" class="preview">{{ item.preview }}</span>
        </span>
      </button>

      <button v-if="extra > 0" class="row more" @click="emit('activity')">
        {{ t('pet.more', { count: extra }) }}
      </button>

      <div v-if="!model.items.length" class="empty">{{ t('pet.empty') }}</div>

      <!-- Permission: the summary always shows, the buttons only when the HUD is
           deliberately open (hover/pinned) — never during an auto-peek, so a glance
           can't turn into an accidental approval. -->
      <div v-if="model.permission" class="perm">
        <div class="perm-head">
          <span class="perm-tool">{{ model.permission.toolName }}</span>
          <span v-if="model.permission.target" class="perm-target">
            {{ model.permission.target }}
          </span>
        </div>
        <div v-if="expanded" class="perm-actions">
          <button class="btn deny" @click="emit('decide', 'deny')">{{ t('pet.perm.deny') }}</button>
          <button class="btn allow" @click="emit('decide', 'allow')">
            {{ t('pet.perm.allow') }}
          </button>
        </div>
        <div v-else class="perm-hint">{{ t('pet.perm.hint') }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AwogPetItem, AwogPetModel } from '~/types/awog-bridge'

// Mini-HUD next to the pet (docs/features/desktop-pet.md): at most three rows of
// what needs the user, plus the parked permission. Deliberately NOT a second tray
// popover — no rate limits, no usage, no scrolling. Anything bigger belongs in the
// app, which is one click away on any row.
const props = defineProps<{ model: AwogPetModel; expanded: boolean }>()
const emit = defineEmits<{
  open: [item: AwogPetItem]
  activity: []
  decide: [decision: 'allow' | 'deny']
}>()

const { t } = useI18n()

// How much did not fit in the three rows — surfaced so the HUD never silently
// hides work.
const extra = computed(() => {
  const { running, attention, unread } = props.model.counts
  return Math.max(0, running + attention + unread - props.model.items.length)
})

function metaOf(item: AwogPetItem): string {
  if (item.hint === 'running' && typeof item.percent === 'number') return `${item.percent}%`
  return t(`pet.hint.${item.hint}`)
}
</script>

<style scoped>
.hud {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: var(--r-btn);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  color: var(--text);
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--bgHover);
}
/* Two stacked lines: title + what it is doing. The dot stays on the first line. */
.rowbody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rowtop {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview {
  /* Fixed 12px, like every other hint chip: this is secondary text, and the row must
     not grow when the user raises the app font size. */
  font-size: 12px;
  line-height: 1.35;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  flex: none;
  font-size: 12px;
  font-family: var(--mono, ui-monospace, monospace);
  line-height: 1;
  color: var(--textDim);
}
.meta.is-awaiting {
  color: var(--amber);
}
.meta.is-running {
  color: var(--accent);
}
.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--textMuted);
}
.dot.is-awaiting {
  background: var(--amber);
}
.dot.is-running {
  background: var(--accent);
}
.dot.is-unread {
  background: var(--green);
}
.more {
  color: var(--textDim);
  justify-content: center;
}
.empty {
  padding: 6px 6px;
  color: var(--textDim);
}

.perm {
  margin-top: 4px;
  padding: 6px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.perm-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.perm-tool {
  flex: none;
  font-weight: 600;
  color: var(--amber);
}
.perm-target {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.perm-hint {
  color: var(--textDim);
}
.perm-actions {
  display: flex;
  justify-content: flex-end;
  /* Wide gap on purpose: a mis-click here approves a tool call. */
  gap: 12px;
}
.btn {
  padding: 4px 12px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.btn:hover {
  background: var(--bgHover);
}
.btn.allow {
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  color: var(--accent);
}
.btn.deny {
  color: var(--textDim);
}
</style>
