<template>
  <!-- SƠ ĐỒ BA HÀNG (việc 5.5) — phần chính của trang, không phải trang trí.
       Ba hàng xếp chồng, CÙNG một trục ngang là thứ tự bước:
         1. bước            — thẻ bước: số thứ tự · verb · tên · cảnh báo
         2. dịch vụ bị chạm — tô theo LỚP LỆNH của hành động
         3. ảnh hưởng lan   — suy từ graph kiến trúc thật (A1), KHÔNG bịa
       Vẽ bằng layout CSS (không thêm thư viện): mỗi hàng là một flex track, mỗi cột
       rộng CỐ ĐỊNH nên ba hàng thẳng cột với nhau mà không cần đo gì. -->
  <section class="pbd">
    <div class="pbd-hd">
      <span class="pbd-ttl">{{ t('playbooks.diagram.title') }}</span>
      <span class="pbd-legend">
        <span class="chip cls-read">{{ t('playbooks.diagram.legend.read') }}</span>
        <span class="chip cls-write">{{ t('playbooks.diagram.legend.write') }}</span>
        <span class="chip cls-destructive">{{ t('playbooks.diagram.legend.destructive') }}</span>
      </span>
    </div>

    <!-- Hàng 1 — bước -->
    <div class="pbd-row">
      <div class="pbd-lbl">{{ t('playbooks.diagram.row.step') }}</div>
      <div class="pbd-track">
        <div v-for="col in columns" :key="col.step.id" class="pbd-col pbd-step">
          <span class="pbd-no">{{ col.index + 1 }}</span>
          <span class="pbd-step-main">
            <span class="pbd-step-ttl" :title="col.step.title">{{ col.step.title }}</span>
            <span class="pbd-step-foot">
              <span class="chip" :class="`cls-${col.klass}`">
                {{ t(`playbooks.verb.${col.step.verb}`) }}
              </span>
              <span v-if="col.state" class="pbd-state" :class="`st-${col.state}`">
                {{ t(`playbooks.run.state.${col.state}`) }}
              </span>
            </span>
          </span>
          <span
            v-for="key in col.warnKeys"
            :key="key"
            class="pbd-warn"
            :title="t(key)"
            role="img"
            :aria-label="t(key)"
          >
            <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
          </span>
        </div>
      </div>
    </div>

    <!-- Hàng 2 — dịch vụ bị chạm -->
    <div class="pbd-row">
      <div class="pbd-lbl">{{ t('playbooks.diagram.row.service') }}</div>
      <div class="pbd-track">
        <div v-for="col in columns" :key="col.step.id" class="pbd-col pbd-svc">
          <template v-if="col.services.length">
            <span v-for="svc in col.services" :key="svc" class="chip" :class="`cls-${col.klass}`">
              {{ svc }}
            </span>
          </template>
          <span v-else class="pbd-none" :title="t('playbooks.diagram.service.none')">—</span>
        </div>
      </div>
    </div>

    <!-- Hàng 3 — ảnh hưởng lan -->
    <div class="pbd-row">
      <div class="pbd-lbl">{{ t('playbooks.diagram.row.impact') }}</div>

      <div v-if="graphState === 'ready'" class="pbd-track">
        <div v-for="col in columns" :key="col.step.id" class="pbd-col pbd-impact">
          <template v-if="col.impact.length">
            <span
              v-for="node in col.impact"
              :key="node.id"
              class="chip pbd-node"
              :class="{ inferred: node.inferred }"
              :title="node.inferred ? t('playbooks.diagram.impact.inferred') : node.service"
            >
              {{ node.label }}
            </span>
          </template>
          <span v-else class="pbd-none" :title="t('playbooks.diagram.impact.none')">—</span>
        </div>
      </div>

      <!-- Trạng thái của hàng 3 khi chưa có graph. Mỗi trạng thái nói CÁCH SỬA (luật 3):
           chưa dựng thì mời dựng, hỏng thì mời thử lại, rỗng thì nói vì sao rỗng. -->
      <div v-else class="pbd-impact-state">
        <template v-if="graphState === 'loading'">
          <span class="pbd-state-txt">
            {{ t('playbooks.diagram.impact.loading') }}
          </span>
        </template>

        <template v-else-if="graphState === 'unavailable'">
          <span class="pbd-state-txt strong">
            {{ t('playbooks.diagram.impact.unavailable.title') }}
          </span>
          <span class="pbd-state-hint">
            {{ graphMessage || t('playbooks.diagram.impact.unavailable.hint') }}
          </span>
          <button class="btn sm" type="button" @click="emit('openGraph')">
            <Icon name="layers" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('playbooks.diagram.impact.gotoGraph') }}
          </button>
        </template>

        <template v-else-if="graphState === 'error'">
          <span class="pbd-state-txt">{{ graphMessage }}</span>
          <button class="btn sm" type="button" @click="emit('resolveImpact')">
            {{ t('playbooks.list.retry') }}
          </button>
        </template>

        <template v-else>
          <span class="pbd-state-txt">{{ t('playbooks.diagram.impact.hint') }}</span>
          <span class="pbd-state-hint">{{ t('playbooks.diagram.impact.buildHint') }}</span>
          <button class="btn sm" type="button" @click="emit('resolveImpact')">
            <Icon name="scan" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('playbooks.diagram.impact.action') }}
          </button>
        </template>
      </div>
    </div>

    <!-- Nguồn traffic PHẢI nói ra (hợp đồng §3): ảnh hưởng suy từ CloudWatch khác
         hẳn suy từ X-Ray, và người đọc cần biết mình đang tin cái nào. -->
    <p v-if="graphState === 'ready' && graph" class="pbd-src">
      {{
        t('playbooks.diagram.impact.traffic', {
          source: t(`playbooks.diagram.traffic.${graph.trafficSource}`),
        })
      }}
      <span v-if="graph.truncated" class="pbd-src-flag">
        · {{ t('playbooks.diagram.impact.truncated') }}
      </span>
      <span class="pbd-src-rerun" role="button" tabindex="0" @click="emit('resolveImpact')">
        {{ t('playbooks.list.retry') }}
      </span>
    </p>

    <!-- Những thứ resolver ĐÃ BỎ QUA — nói ra thay vì để "ảnh hưởng lan ngắn" bị đọc
         thành "không có gì phụ thuộc". `notes` là khoá i18n, không phải câu tiếng Anh. -->
    <p v-if="graphState === 'ready' && graph?.notes.length" class="pbd-notes">
      <span v-for="note in graph.notes" :key="note" class="pbd-note">{{ t(note) }}</span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookDiagramColumn, PlaybookGraphState } from '~/composables/usePlaybooksManager'
import type { InfraGraph } from '~/composables/useInfraGraphApi'

defineProps<{
  columns: PlaybookDiagramColumn[]
  graphState: PlaybookGraphState
  graphMessage: string
  // Hình dạng dây của `infra.graph-*` chỉ có MỘT bản khai — bản của workstream graph.
  // Trang này là người DÙNG graph, không phải nguồn thứ hai của nó.
  graph: InfraGraph | null
}>()

const emit = defineEmits<{
  resolveImpact: []
  openGraph: []
}>()

const { t } = useI18n()
</script>

<style scoped>
.pbd {
  /* Bề rộng CỘT là thứ giữ ba hàng thẳng nhau — khai MỘT lần ở đây. */
  --pbd-col: 176px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgSubtle);
}

.pbd-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pbd-ttl {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.pbd-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.pbd-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.pbd-lbl {
  flex: 0 0 96px;
  padding-top: 6px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Track cuộn ngang khi playbook nhiều bước — ba hàng cuộn bằng nhau vì cùng bề rộng
   cột, cùng khoảng cách, cùng điểm bắt đầu. */
.pbd-track {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 2px;
}

/* Đổi bề rộng thì đổi ở biến `--pbd-col` của `.pbd`, không phải ba con số. */
.pbd-col {
  flex: 0 0 var(--pbd-col);
  width: var(--pbd-col);
  min-width: 0;
}

.pbd-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
}

.pbd-no {
  flex: 0 0 auto;
  min-width: 16px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.pbd-step-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.pbd-step-ttl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbd-step-foot {
  display: flex;
  align-items: center;
  gap: 5px;
}

.pbd-warn {
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--amber);
}

.pbd-state {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbd-state.st-failed {
  color: var(--red);
}

.pbd-state.st-ok {
  color: var(--green);
}

/* Bước bị cổng quyền chặn KHÔNG phải bước hỏng (hợp đồng §2). */
.pbd-state.st-blocked {
  color: var(--amber);
}

.pbd-state.st-running {
  color: var(--accent);
}

.pbd-svc,
.pbd-impact {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  padding: 5px 8px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
}

.pbd-impact {
  border-style: solid;
}

.pbd-none {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Cạnh suy luận vẽ NÉT ĐỨT (hợp đồng §3) — ở đây là chip viền đứt. */
.chip.pbd-node.inferred {
  border-style: dashed;
  color: var(--textDim);
}

.pbd-impact-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  min-width: 0;
}

.pbd-state-txt {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbd-state-txt.strong {
  color: var(--text);
  font-weight: 650;
}

.pbd-state-hint {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbd-src {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbd-src-flag {
  color: var(--amber);
}

.pbd-src-rerun {
  color: var(--accent);
  cursor: default;
}

.pbd-notes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
}

.pbd-note {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.chip.cls-read {
  color: var(--blue);
  border-color: var(--blue);
}

.chip.cls-write {
  color: var(--green);
  border-color: var(--green);
}

.chip.cls-destructive {
  color: var(--red);
  border-color: var(--red);
}
</style>
