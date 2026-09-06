<template>
  <Teleport to="body">
    <div class="ovl" :class="{ on: open }" @click.self="closePanel">
      <div class="setmodal">
        <div class="setmodalhd">
          <Icon name="tag" style="width: 15px; height: 15px; color: var(--accent)" />
          <span>{{ t('whatsnew.title') }}</span>
          <button
            class="iconbtn"
            style="width: 28px; height: 28px"
            :title="t('common.close')"
            @click="closePanel"
          >
            <Icon name="x" />
          </button>
        </div>
        <div class="setmodalbody">
          <section v-for="rel in releases" :key="rel.version" class="wn-rel">
            <header class="wn-relhd">
              <span class="wn-ver">v{{ rel.version }}</span>
              <span class="wn-date">{{ rel.date }}</span>
            </header>
            <p v-if="rel.highlight" class="wn-hl">{{ pick(rel.highlight) }}</p>
            <ul class="wn-items">
              <li v-for="(item, i) in rel.items" :key="i" class="wn-item">
                <span class="wn-kind" :style="kindStyle(item.kind)">
                  {{ t(`whatsnew.kind.${item.kind}`) }}
                </span>
                <span class="wn-text">{{ pick(item) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// What's New — bundled changelog (utils/changelog.ts), bilingual items picked by
// the active locale. Ports apps/desktop/ui/components/WhatsNewModal.vue to the
// ui-next prototype-CSS modal (.ovl/.setmodal). Open state from useWhatsNew.
import type { ChangeKind, LocalizedText } from '~/utils/changelog'

const { t, locale } = useI18n()
const { open, closePanel, releases } = useWhatsNew()

const pick = (text: LocalizedText) => (locale.value === 'vi' ? text.vi : text.en)

// Each change kind maps to a theme accent so the badge reads at a glance.
const KIND_VAR: Record<ChangeKind, string> = {
  added: 'var(--green)',
  improved: 'var(--accent)',
  changed: 'var(--amber)',
  fixed: 'var(--blue)',
}
const kindStyle = (kind: ChangeKind) => ({
  color: KIND_VAR[kind],
  borderColor: KIND_VAR[kind],
})
</script>

<style scoped>
.wn-rel {
  padding: 14px 0;
  border-top: 1px solid var(--border);
}
.wn-rel:first-child {
  border-top: 0;
  padding-top: 2px;
}
.wn-relhd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.wn-ver {
  font-weight: 650;
  color: var(--text);
}
.wn-date {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.wn-hl {
  color: var(--textMuted);
  line-height: 1.55;
  margin-bottom: 10px;
}
/* Two-column grid: badge column auto-sizes to the widest label so every body
   text aligns to one left edge regardless of locale. */
.wn-items {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 10px;
  align-items: start;
}
.wn-item {
  display: contents;
}
.wn-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  padding: 1px 7px;
  border: 1px solid;
  border-radius: var(--r-pill);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  background: transparent;
}
.wn-text {
  color: var(--text);
  line-height: 1.55;
}
</style>
