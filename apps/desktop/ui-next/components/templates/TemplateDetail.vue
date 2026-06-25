<template>
  <div class="tdt">
    <div class="dh">
      <div class="tdt-icn"><Icon name="templates" style="width: 15px; height: 15px" /></div>
      <div class="dt">{{ template.name }}</div>
      <span v-if="template.entities.length" class="tag">
        {{ t('templates.detail.entityCount', { n: template.entities.length }) }}
      </span>
      <span style="flex: 1" />
      <button class="btn pri sm" :title="t('templates.detail.install')" @click="emit('install')">
        <Icon name="act" style="width: 13px; height: 13px" />
        {{ t('templates.detail.install') }}
      </button>
      <button
        class="iconbtn tdt-danger"
        :title="t('templates.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p v-if="template.description" class="tdt-desc">{{ template.description }}</p>

      <div class="tdt-section">
        <div class="tdt-section-hd">{{ t('templates.detail.entities') }}</div>
        <div v-if="!groups.length" class="tdt-empty">
          {{ t('templates.detail.noEntities') }}
        </div>
        <div v-for="g in groups" :key="String(g.kind)" class="tdt-group">
          <div class="tdt-group-hd">
            <span class="tdt-group-name">{{ t('templates.kind.' + g.kind) }}</span>
            <span class="chip">{{ g.entities.length }}</span>
          </div>
          <div class="tdt-chips">
            <span v-for="e in g.entities" :key="e.kind + '/' + e.id" class="chip mono">
              {{ e.id }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Template detail pane — header (install / delete) + the bundled manifest grouped
// by kind. Rendered in prototype CSS (.dh header + .dscroll body), matching the
// skills/agents detail markup. Grouping is derived from the `template` prop so it
// always reflects the row LibraryView has selected (which owns its own selection
// state); the page owns dialog + delete state.
import { computed } from 'vue'
import {
  KIND_ORDER,
  type ConfigKind,
  type ProjectTemplate,
  type TemplateEntityRef,
} from '~/stores/templates'

const props = defineProps<{ template: ProjectTemplate }>()

const emit = defineEmits<{ install: []; delete: [] }>()

const { t } = useI18n()

// Manifest grouped by kind, in canonical kind order, with a count chip per group.
type Group = { kind: ConfigKind; entities: TemplateEntityRef[] }
const groups = computed<Group[]>(() => {
  const byKind = new Map<ConfigKind, TemplateEntityRef[]>()
  for (const e of props.template.entities) {
    const list = byKind.get(e.kind) ?? []
    list.push(e)
    byKind.set(e.kind, list)
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    entities: byKind.get(kind) ?? [],
  }))
})
</script>

<style scoped>
.tdt {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.tdt-icn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}
.tdt-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.tdt-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0 0 18px;
}
.tdt-section-hd {
  font-size: 0.8462rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--textDim);
  margin-bottom: 12px;
}
.tdt-empty {
  font-size: 0.9615rem;
  color: var(--textDim);
}
.tdt-group {
  margin-bottom: 16px;
}
.tdt-group-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.tdt-group-name {
  font-size: 0.9615rem;
  font-weight: 550;
  color: var(--text);
}
.tdt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
