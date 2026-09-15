<template>
  <!-- Danh sách bước của playbook (việc 5.5). Ba trong năm lệnh là ĐỌC, nên mở một
       playbook đang dở vẫn biết đúng mình đang ở đâu — vì vậy mỗi bước nói rõ verb
       của nó chứ không chỉ nói tên.

       Chế độ Đơn giản giấu dòng lệnh sau mục gập; chế độ Kỹ thuật mở sẵn (luật 1). -->
  <section class="pbs">
    <h3 class="pbs-hd">{{ t('playbooks.steps.title') }}</h3>

    <p v-if="!columns.length" class="pbs-empty">{{ t('playbooks.steps.empty') }}</p>

    <ol v-else class="pbs-items">
      <li v-for="col in columns" :key="col.step.id" class="pbs-item">
        <div class="pbs-line">
          <span class="pbs-no">{{ col.index + 1 }}</span>
          <span class="chip" :class="`cls-${col.klass}`">
            {{ t(`playbooks.verb.${col.step.verb}`) }}
          </span>
          <span class="pbs-ttl">{{ col.step.title }}</span>
          <span v-if="col.state" class="pbs-st" :class="`st-${col.state}`">
            {{ t(`playbooks.run.state.${col.state}`) }}
          </span>
        </div>

        <p v-if="col.step.note" class="pbs-note" :title="t('playbooks.steps.note')">
          {{ col.step.note }}
        </p>

        <!-- Cảnh báo gắn NGAY trên bước, không gom xuống cuối: người đọc phải thấy
             "thay bản đang chạy" ở đúng dòng nó xảy ra. -->
        <p v-for="key in col.warnKeys" :key="key" class="pbs-warn">
          <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t(key) }}
        </p>

        <!-- Cột kỹ thuật nằm trong mục gập (spec §"Với người không rành kỹ thuật"). -->
        <details class="pbs-tech" :open="mode === 'expert'">
          <summary>{{ t('playbooks.steps.technical') }}</summary>
          <div class="pbs-cmd">
            <span class="pbs-cmd-lbl">{{ t('playbooks.steps.command') }}</span>
            <code class="pbs-cmd-txt">{{ commandOf(col.step) }}</code>
          </div>
        </details>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookDiagramColumn, PlaybookMode } from '~/composables/usePlaybooksManager'
import type { PlaybookStep } from '~/composables/usePlaybooksApi'

defineProps<{
  columns: PlaybookDiagramColumn[]
  mode: PlaybookMode
}>()

const { t } = useI18n()

/**
 * Lệnh của bước, dựng từ `tool` + `args` — KHÔNG phải chuỗi shell đã ghép sẵn (hợp
 * đồng §4: `args` là mảng). Đây là bản ĐỂ ĐỌC; cờ ngữ cảnh do sidecar chèn lúc chạy
 * nên không có ở đây.
 */
function commandOf(step: PlaybookStep): string {
  return [step.tool, ...step.args].join(' ')
}
</script>

<style scoped>
.pbs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pbs-hd {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.pbs-empty {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbs-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pbs-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
}

.pbs-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pbs-no {
  flex: 0 0 auto;
  min-width: 18px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.pbs-ttl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbs-st {
  margin-left: auto;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbs-st.st-ok {
  color: var(--green);
}

.pbs-st.st-failed {
  color: var(--red);
}

/* Bước bị cổng quyền chặn giữa đường KHÔNG phải bước hỏng (hợp đồng §2): lượt chạy
   về lại `approved` và chạy tiếp được kèm vé. Tô đỏ ở đây là báo sai rằng việc hỏng. */
.pbs-st.st-blocked {
  color: var(--amber);
}

.pbs-st.st-running {
  color: var(--accent);
}

.pbs-note {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbs-warn {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbs-tech {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbs-tech > summary {
  cursor: default;
}

.pbs-cmd {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 0 0;
  min-width: 0;
}

.pbs-cmd-lbl {
  flex: 0 0 auto;
  color: var(--textFaint);
}

/* Dòng lệnh CLI — người dùng copy nguyên văn vào terminal. */
.pbs-cmd-txt {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  /* mono-ok: dòng lệnh CLI, người dùng copy nguyên văn vào terminal */
  font-family: var(--code);
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
