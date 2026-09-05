<template>
  <LibraryEntityModal
    :open="open"
    :title="t('connections.picker.title')"
    :width="640"
    @close="emit('close')"
  >
    <div class="cap">
      <!-- Two "how do you want to start" options: hand-build, or describe with AI. -->
      <div class="cap-quick">
        <button type="button" class="cap-opt" @click="emit('scratch')">
          <span class="cap-opt-ic"><Icon name="plus" style="width: 15px; height: 15px" /></span>
          <span class="cap-opt-tx">
            <span class="cap-opt-t">{{ t('connections.picker.scratch') }}</span>
            <span class="cap-opt-s">{{ t('connections.picker.scratchSub') }}</span>
          </span>
        </button>
        <button type="button" class="cap-opt" @click="emit('ai')">
          <span class="cap-opt-ic accent">
            <Icon name="sparkles" style="width: 15px; height: 15px" />
          </span>
          <span class="cap-opt-tx">
            <span class="cap-opt-t">{{ t('connections.picker.ai') }}</span>
            <span class="cap-opt-s">{{ t('connections.picker.aiSub') }}</span>
          </span>
        </button>
      </div>

      <!-- Catalog of common providers → pre-filled config. -->
      <div class="cap-seplbl">{{ t('connections.picker.orPick') }}</div>
      <div class="cap-grid">
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          class="cap-card"
          @click="emit('pick', p.id)"
        >
          <SourceAvatar :source="pseudoSource(p)" size="md" />
          <span class="cap-card-tx">
            <span class="cap-card-nm">
              {{ p.name }}
              <span class="tag cap-card-badge">{{ t('connections.typeBadge.' + p.type) }}</span>
            </span>
            <span class="cap-card-tl">{{ p.tagline }}</span>
          </span>
        </button>
      </div>
      <div v-if="!presets.length" class="cap-empty">{{ t('connections.picker.empty') }}</div>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// "Add a connection" picker (UI-parity area 3) — the first step of the add-source
// flow, opened by the LibraryView "+" trigger. Offers two quick starts (blank form
// / AI creator) plus a catalog of common providers. Picking a provider emits its
// catalog id; the page fetches the pre-filled draft (source.discoverPreset) and
// seeds ConnectionEditor. Craft-parity "add a known service → pre-filled config".
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import type { Source, SourcePresetMeta } from '~/stores/connections'

defineProps<{
  open: boolean
  presets: SourcePresetMeta[]
}>()

const emit = defineEmits<{
  close: []
  scratch: []
  ai: []
  pick: [id: string]
}>()

const { t } = useI18n()

// A minimal Source built from the preset meta so SourceAvatar can render the row
// icon. Presets carry an emoji `icon`, so SourceAvatar's fast path renders it
// without touching the sidecar (source.resolveIcon is never hit for a preset).
function pseudoSource(p: SourcePresetMeta): Source {
  const base = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    provider: p.provider,
    enabled: true,
    icon: p.icon,
    tagline: p.tagline,
    timeoutMs: 30000,
    trust: 'prompt' as const,
  }
  if (p.type === 'api') return { ...base, type: 'api', api: { baseUrl: '', authType: 'none' } }
  if (p.type === 'local') return { ...base, type: 'local', local: { path: '' } }
  return { ...base, type: 'mcp', mcp: {} }
}
</script>

<style scoped>
.cap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cap-quick {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.cap-opt {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.cap-opt:hover {
  border-color: var(--accent);
  background: var(--bgHover);
}
.cap-opt-ic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: var(--r-sm);
  background: var(--bgActive);
  color: var(--textMuted);
  border: 1px solid var(--border);
}
.cap-opt-ic.accent {
  color: var(--accent);
}
.cap-opt-tx {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cap-opt-t {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}
.cap-opt-s {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.4;
}
.cap-seplbl {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--textDim);
  padding-top: 2px;
  border-top: 1px solid var(--border);
  margin-top: -2px;
}
.cap-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.cap-card {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 12px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.cap-card:hover {
  border-color: var(--accent);
  background: var(--bgHover);
}
.cap-card-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cap-card-nm {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}
.cap-card-badge {
  font-size: 12px;
  padding: 1px 6px;
  text-transform: uppercase;
}
.cap-card-tl {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.4;
}
.cap-empty {
  font-size: var(--fs-sm);
  color: var(--textDim);
  text-align: center;
  padding: 12px 0;
}
</style>
