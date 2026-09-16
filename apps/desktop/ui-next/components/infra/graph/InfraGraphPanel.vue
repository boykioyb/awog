<template>
  <!-- Panel chi tiết của node đang chọn: thuộc tính resolver trả về + nút MỞ RỘNG
       đúng node này một bước ("dựng dần", hợp đồng §6). Read-only: panel không có
       hành động ghi nào — graph không có nút ghi. -->
  <aside class="igp">
    <header class="igp-hd">
      <span class="igp-ico">
        <Icon :name="icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
      <span class="igp-ttl" :title="node.label">{{ node.label }}</span>
      <button
        class="igp-x"
        type="button"
        :title="t('infra.graph.panel.close')"
        @click="emit('close')"
      >
        <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </header>

    <div class="igp-chips">
      <span class="chip">{{ node.service }}</span>
      <span v-if="node.region" class="chip">{{ node.region }}</span>
      <span v-if="isRoot" class="chip root">{{ t('infra.graph.node.root') }}</span>
      <span v-if="node.inferred" class="chip inf">{{ t('infra.graph.node.inferred') }}</span>
    </div>

    <p v-if="node.kind === 'external'" class="igp-note warn">
      {{ t('infra.graph.panel.externalNote') }}
    </p>
    <p v-else-if="node.inferred" class="igp-note warn">
      {{ t('infra.graph.panel.inferredNote') }}
    </p>

    <div class="igp-sec">
      <div class="igp-lbl">{{ t('infra.graph.panel.detail') }}</div>
      <dl v-if="entries.length" class="igp-dl">
        <template v-for="[key, value] in entries" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
      <p v-else class="igp-empty">{{ t('infra.graph.panel.noDetail') }}</p>
    </div>

    <footer class="igp-ft">
      <!-- G4, nửa đầu: node → nhóm log. Nút CHỈ hiện khi sidecar suy được nhóm
           (`logGroup` vắng mặt = không suy được); mời người dùng sang màn Logs với
           một tên nhóm đoán bừa sẽ mở ra một màn trống, và cái trống đó đọc như
           "chặng này không ghi gì". -->
      <button
        v-if="node.logGroup"
        class="btn sm"
        type="button"
        :title="node.logGroup.value"
        @click="emit('open-logs', node.logGroup)"
      >
        <Icon name="table" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.graph.panel.openLogs') }}
      </button>
      <button
        v-if="node.expandable"
        class="btn sm"
        type="button"
        :disabled="expanding"
        :aria-busy="expanding"
        @click="emit('expand', node.id)"
      >
        <Icon
          :name="expanding ? 'refresh' : 'plus'"
          :class="{ spin: expanding }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ expanding ? t('infra.graph.node.expanding') : t('infra.graph.node.expand') }}
      </button>
      <p v-else class="igp-empty">{{ t('infra.graph.node.noExpand') }}</p>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { graphServiceIcon } from '~/composables/useInfraGraph'
import type { InfraGraphNode } from '~/composables/useInfraGraphApi'

const props = defineProps<{
  node: InfraGraphNode
  isRoot: boolean
  /** Lượt mở rộng của CHÍNH node này đang bay. */
  expanding: boolean
}>()

const emit = defineEmits<{
  expand: [id: string]
  close: []
  'open-logs': [group: { kind: 'exact' | 'prefix'; value: string }]
}>()

const { t } = useI18n()

const icon = computed(() => graphServiceIcon(props.node.service))
const entries = computed(() => Object.entries(props.node.detail))
</script>

<style scoped>
.igp {
  display: flex;
  flex-direction: column;
  width: 300px;
  min-width: 260px;
  border-left: 1px solid var(--border);
  background: var(--bgPanel);
  overflow: hidden;
}

.igp-hd {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  box-shadow: inset 0 -1px 0 var(--border);
}

.igp-ico {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}

.igp-ttl {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.igp-x {
  padding: 6px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.igp-x:hover {
  background: var(--bgHover);
  color: var(--text);
}

.igp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 9px 11px 0;
}

.chip.root {
  color: var(--accent);
  border-color: var(--accentBorder);
}

.chip.inf {
  color: var(--amber);
  border-color: var(--amber);
}

.igp-note {
  margin: 9px 11px 0;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.igp-note.warn {
  border: 1px solid var(--border);
  background: var(--bgSubtle);
  color: var(--textMuted);
}

.igp-sec {
  padding: 10px 11px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.igp-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  margin-bottom: 6px;
}

.igp-dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.igp-dl dt {
  color: var(--textDim);
  word-break: break-word;
}

.igp-dl dd {
  margin: 0;
  color: var(--text);
  word-break: break-word;
}

.igp-empty {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.igp-ft {
  padding: 9px 11px;
  box-shadow: inset 0 1px 0 var(--border);
}

/* Cùng khuôn với `.iad-spin` của InfraAccountsDetail.vue — `.spin` không phải class
   toàn cục nên SFC tự khai keyframes. */
.spin {
  animation: igp-spin 0.8s linear infinite;
}

@keyframes igp-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
