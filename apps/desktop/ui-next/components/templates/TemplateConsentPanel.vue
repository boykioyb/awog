<template>
  <div class="tcp">
    <div class="tcp-head">
      <div class="tcp-name">{{ inspection.name }}</div>
      <span v-if="inspection.version" class="chip">{{ inspection.version }}</span>
      <span v-if="inspection.alreadyInstalled" class="chip">
        {{ t('templatesDiscover.consent.alreadyInstalled') }}
      </span>
    </div>
    <p v-if="inspection.description" class="tcp-desc">{{ inspection.description }}</p>

    <!-- Nguồn thật của bundle: người dùng phải đọc được nó trước khi đồng ý. -->
    <div class="tcp-src">
      <span class="tcp-src-lbl">{{ t('templatesDiscover.consent.source') }}</span>
      <span class="tcp-src-url">{{ inspection.sourceUrl }}</span>
    </div>

    <!-- Cảnh báo bề mặt nguy hiểm: hook = script chạy được, rule = vào thẳng
         system prompt. Chỉ hiện khi bundle thật sự có, và nói rõ hậu quả. -->
    <div v-if="risky.length" class="tcp-warn">
      <Icon name="shield" class="tcp-warn-ic" />
      <div class="tcp-warn-tx">
        <div class="tcp-warn-hd">{{ t('templatesDiscover.consent.riskTitle') }}</div>
        <div v-for="kind in risky" :key="kind" class="tcp-warn-line">
          {{ t('templatesDiscover.consent.risk.' + kind) }}
        </div>
      </div>
    </div>

    <div v-if="inspection.undisclosedKinds.length" class="tcp-warn undisclosed">
      <Icon name="alert" class="tcp-warn-ic" />
      <div class="tcp-warn-tx">
        <div class="tcp-warn-hd">{{ t('templatesDiscover.consent.undisclosedTitle') }}</div>
        <div class="tcp-warn-line">
          {{ t('templatesDiscover.consent.undisclosed', { kinds: undisclosedLabels }) }}
        </div>
      </div>
    </div>

    <!-- Danh sách ĐẦY ĐỦ: mọi entity sẽ được ghi, không cắt bớt, không "…and N
         more". Đây là thứ người dùng đang đồng ý. -->
    <div class="tcp-section">
      <div class="tcp-section-hd">
        <span>{{ t('templatesDiscover.consent.willWrite') }}</span>
        <span class="chip">{{ inspection.entities.length }}</span>
      </div>
      <div v-if="!groups.length" class="tcp-empty">
        {{ t('templatesDiscover.consent.nothing') }}
      </div>
      <div v-for="g in groups" :key="g.kind" class="tcp-group">
        <div class="tcp-group-hd">
          <span class="tcp-group-nm" :class="{ risky: isRisky(g.kind) }">
            {{ t('templates.kind.' + g.kind) }}
          </span>
          <span class="chip">{{ g.entities.length }}</span>
        </div>
        <div v-for="e in g.entities" :key="e.kind + '/' + e.id" class="tcp-ent">
          <span class="tcp-ent-id">{{ e.id }}</span>
          <span class="tcp-ent-file">{{ e.file }}</span>
        </div>
      </div>
    </div>

    <div class="tcp-foot">
      {{
        t('templatesDiscover.consent.footprint', {
          files: inspection.fileCount,
          size: sizeLabel,
        })
      }}
    </div>
    <div class="tcp-note">{{ t('templatesDiscover.consent.stagingNote') }}</div>
  </div>
</template>

<script setup lang="ts">
// Màn hình đồng ý bắt buộc trước khi cài một template từ danh mục (gói #37).
//
// Nó KHÔNG tóm tắt. Bundle có thể chứa hook (script chạy được) và rule (đi thẳng
// vào system prompt của mọi lượt), nên mọi entity sẽ được ghi đều được liệt kê
// đầy đủ kèm đường dẫn file — cùng nguồn thật, số file và dung lượng.
//
// Panel chỉ HIỂN THỊ. Ràng buộc thật nằm ở engine: `templates.marketplaceInstall`
// đòi `inspection.token` (băm của đúng kế hoạch này) và từ chối ghi nếu nguồn đã
// đổi — nên không có cách nào cài mà không đi qua bước này.
import { computed } from 'vue'
import { KIND_ORDER, type ConfigKind, type MarketplaceInspection } from '~/stores/templates'

const props = defineProps<{ inspection: MarketplaceInspection }>()

const { t } = useI18n()

// Hai loại entity có hậu quả thực thi/prompt — cái người dùng cần thấy trước nhất.
const RISKY_KINDS: readonly ConfigKind[] = ['hook', 'rule']
const isRisky = (kind: ConfigKind): boolean => RISKY_KINDS.includes(kind)

const risky = computed<ConfigKind[]>(() => {
  const present = new Set(props.inspection.entities.map((e) => e.kind))
  return RISKY_KINDS.filter((k) => present.has(k))
})

const undisclosedLabels = computed(() =>
  props.inspection.undisclosedKinds.map((k) => t('templates.kind.' + k)).join(', '),
)

type Group = { kind: ConfigKind; entities: MarketplaceInspection['entities'] }
const groups = computed<Group[]>(() => {
  const byKind = new Map<ConfigKind, MarketplaceInspection['entities']>()
  for (const e of props.inspection.entities) {
    const list = byKind.get(e.kind) ?? []
    list.push(e)
    byKind.set(e.kind, list)
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    entities: byKind.get(kind) ?? [],
  }))
})

const KB = 1024
const sizeLabel = computed(() => {
  const bytes = props.inspection.totalBytes
  if (bytes < KB) return `${bytes} B`
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`
  return `${(bytes / (KB * KB)).toFixed(1)} MB`
})
</script>

<style scoped>
.tcp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tcp-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tcp-name {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.tcp-desc {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}
.tcp-src {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.tcp-src-lbl {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.tcp-src-url {
  /* mono-ok: URL repo — người dùng copy-paste được vào trình duyệt/terminal */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--text);
  overflow-wrap: anywhere;
}
.tcp-warn {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amber);
}
.tcp-warn.undisclosed {
  background: var(--dangerDim);
  border-color: var(--danger);
}
.tcp-warn-ic {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  margin-top: 2px;
  color: var(--amber);
}
.tcp-warn.undisclosed .tcp-warn-ic {
  color: var(--danger);
}
.tcp-warn-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.tcp-warn-hd {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.tcp-warn-line {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}
.tcp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.tcp-section-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.tcp-empty,
.tcp-note,
.tcp-foot {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.tcp-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tcp-group-hd {
  display: flex;
  align-items: center;
  gap: 7px;
}
.tcp-group-nm {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.tcp-group-nm.risky {
  color: var(--amber);
}
.tcp-ent {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  min-width: 0;
}
.tcp-ent-id {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.tcp-ent-file {
  /* mono-ok: đường dẫn file trong bundle */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow-wrap: anywhere;
}
.tcp-foot {
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
</style>
