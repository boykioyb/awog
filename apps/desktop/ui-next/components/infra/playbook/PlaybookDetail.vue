<template>
  <!-- Màn chi tiết của `/playbooks` (việc 5.5). Thứ tự cố ý:
       tên → tóm tắt (bước · dịch vụ · quay lui) → biến → hành động →
       SƠ ĐỒ BA HÀNG → danh sách bước → kết quả chạy.
       Người đọc phải nắm được "đụng vào gì, ai chết theo, hỏng thì lui sao" TRƯỚC khi
       nhìn thấy một dòng lệnh nào. -->
  <div class="pb-detail">
    <div v-if="loading" class="pb-dstate">
      <Icon name="refresh" class="ikspin" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pb-dstate-txt" role="status" aria-busy="true">
        {{ t('playbooks.detail.loading') }}
      </p>
    </div>

    <div v-else-if="error" class="pb-dstate">
      <Icon name="alert" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pb-dstate-txt">{{ t('playbooks.detail.error.title') }}</p>
      <p class="pb-dstate-hint">{{ error }}</p>
      <p class="pb-dstate-hint">{{ t('playbooks.detail.error.hint') }}</p>
      <button class="btn sm" type="button" @click="emit('retry')">
        {{ t('playbooks.list.retry') }}
      </button>
    </div>

    <div v-else-if="!playbook" class="pb-dstate">
      <Icon name="book" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pb-dstate-txt">{{ t('playbooks.detail.none.title') }}</p>
      <p class="pb-dstate-hint">{{ t('playbooks.detail.none.hint') }}</p>
    </div>

    <template v-else>
      <header class="pb-head">
        <h2 class="pb-name">{{ playbook.name }}</h2>
        <!-- Chip trạng thái là của LƯỢT CHẠY đang xem, không phải của playbook:
             playbook không có trạng thái riêng (hợp đồng §4). -->
        <span v-if="view.run" class="chip" :class="`st-${view.run.status}`">
          {{ t(`playbooks.status.${view.run.status}`) }}
        </span>
        <span
          v-if="view.source"
          class="pb-src"
          :class="{ ro: view.source === 'builtin' }"
          :title="view.source === 'builtin' ? t('playbooks.source.builtinWhy') : ''"
        >
          {{ t(`playbooks.source.${view.source}`) }}
        </span>
        <span class="pb-tier">
          {{
            t('playbooks.meta.tier', {
              kind: t(`playbooks.kind.${playbook.kind}`),
              tier: t(`playbooks.tier.${playbook.tier}`),
            })
          }}
        </span>
      </header>

      <p v-if="playbook.description" class="pb-desc">{{ playbook.description }}</p>

      <p class="pb-meta">
        {{
          t('playbooks.meta.summary', {
            steps: playbook.steps.length,
            services: view.touchedServices.length,
          })
        }}
        <span v-if="view.rollback.total" :class="{ 'is-bad': view.rollback.missing > 0 }">
          · {{ rollbackLabel }}
        </span>
        <span class="pb-meta-when">
          {{ t('playbooks.meta.updated', { at: playbook.updatedAt }) }}
        </span>
      </p>

      <!-- File HỎNG: nói ngay chỗ nào, vì đây cũng là lý do nút gửi duyệt bị tắt. -->
      <p v-if="view.issues?.length" class="pb-block">
        <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('playbooks.detail.issues', { n: view.issues.length }) }}
      </p>

      <!-- Biến: điền trước khi kiểm tra hoặc chạy -->
      <div v-if="view.variables.length" class="pb-vars">
        <div class="pb-vars-hd">
          <span class="pb-vars-ttl">{{ t('playbooks.variables.title') }}</span>
          <span v-if="view.requiredMissing.length" class="pb-vars-req">
            {{ t('playbooks.variables.required') }}
          </span>
        </div>
        <div class="pb-vars-grid">
          <label v-for="v in view.variables" :key="v.name" class="pb-var">
            <span class="pb-var-lbl">
              {{ v.label || v.name }}
              <span v-if="v.required" class="pb-var-star">*</span>
            </span>
            <input
              class="pb-var-inp"
              type="text"
              :value="view.values[v.name] ?? ''"
              :placeholder="v.default ?? ''"
              @input="onVar(v.name, $event)"
            />
          </label>
        </div>
      </div>

      <!-- Hành động. Nút bị TẮT luôn kèm lý do ngay dưới (luật 3 + luật 4). -->
      <div class="pb-acts">
        <button
          class="btn sm"
          type="button"
          :disabled="view.busy || view.requiredMissing.length > 0"
          @click="emit('preflight')"
        >
          <Icon name="inspect" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.preflight') }}
        </button>

        <button
          class="btn sm"
          type="button"
          :disabled="view.busy || !view.canSubmit || view.requiredMissing.length > 0"
          :title="
            view.canSubmit ? '' : t('playbooks.action.submitBlocked', { n: view.rollback.missing })
          "
          @click="emit('submit')"
        >
          <Icon name="send" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.submit') }}
        </button>

        <!-- Duyệt chỉ có MỘT chiều: hợp đồng không có RPC từ chối, nên UI không mời
             một việc không làm được. -->
        <button
          v-if="view.canApprove"
          class="btn sm pri"
          type="button"
          :disabled="view.busy"
          @click="emit('approve')"
        >
          <Icon name="check" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.approve') }}
        </button>

        <button
          class="btn sm"
          type="button"
          :disabled="view.busy || !view.canRun"
          @click="emit('run')"
        >
          <Icon name="play" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ view.busy ? t('playbooks.action.working') : t('playbooks.action.run') }}
        </button>

        <button
          class="btn sm"
          type="button"
          :disabled="view.busy || !view.canRollback"
          @click="emit('rollback')"
        >
          <Icon name="revert" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.rollback') }}
        </button>

        <!-- Chia sẻ playbook (6.7). Nút chỉ MỞ hộp xuất: bản xuất do sidecar dựng
             từ chính file playbook trên đĩa, nên client không có bản thứ hai để
             lệch. Mẫu "để duyệt" BỊ BUỘC che — sidecar cưỡng chế, không phải một
             công tắc người dùng tắt được. -->
        <button class="btn sm" type="button" :disabled="view.busy" @click="emit('share')">
          <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.share') }}
        </button>

        <!-- Mẫu thứ ba — "báo cáo sau khi chạy" — chỉ có nghĩa khi ĐÃ có lượt chạy:
             nó kể lại việc đã xảy ra, không phải việc sẽ làm. -->
        <button
          v-if="view.run"
          class="btn sm"
          type="button"
          :disabled="view.busy"
          @click="emit('shareRun')"
        >
          <Icon name="book" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.action.shareRun') }}
        </button>
      </div>

      <p v-if="view.rollback.missing > 0" class="pb-block">
        <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('playbooks.action.submitBlocked', { n: view.rollback.missing }) }}
      </p>
      <!-- Bước `do` nào còn thiếu cặp: sidecar đã ghép cặp THEO CHỈ SỐ, UI chỉ đọc
           lại danh sách id nó trả (`summary.missingRollback`) chứ không tự đoán. -->
      <p v-if="view.rollback.missingIds.length" class="pb-block">
        {{ t('playbooks.action.submitMissing', { ids: view.rollback.missingIds.join(', ') }) }}
      </p>
      <p v-if="view.requiredMissing.length > 0" class="pb-block">
        <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('playbooks.variables.required') }}
      </p>

      <PlaybookDiagram
        :columns="view.columns"
        :graph-state="view.graphState"
        :graph-message="view.graphMessage"
        :graph="view.graph"
        @resolve-impact="emit('resolveImpact')"
        @open-graph="emit('openGraph')"
      />

      <PlaybookSteps :columns="view.columns" :mode="view.mode" />

      <PlaybookRunPanel
        :columns="view.columns"
        :preflight="view.preflight"
        :run="view.run"
        :runs="view.runs"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import PlaybookDiagram from '~/components/infra/playbook/PlaybookDiagram.vue'
import PlaybookRunPanel from '~/components/infra/playbook/PlaybookRunPanel.vue'
import PlaybookSteps from '~/components/infra/playbook/PlaybookSteps.vue'
import { useI18n } from '~/composables/useI18n'
import { computed } from 'vue'
import type { PlaybookDetailView } from '~/composables/usePlaybooksManager'
import type { Playbook } from '~/composables/usePlaybooksApi'

const props = defineProps<{
  playbook: Playbook | null
  view: PlaybookDetailView
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  retry: []
  preflight: []
  submit: []
  approve: []
  run: []
  rollback: []
  share: []
  shareRun: []
  resolveImpact: []
  openGraph: []
  setVariable: [name: string, value: string]
}>()

const { t } = useI18n()

/** Dòng "quay lui": có thì nói phủ được bao nhiêu bước ghi, thiếu thì nói thẳng là thiếu. */
const rollbackLabel = computed(() =>
  props.view.rollback.missing > 0
    ? t('playbooks.meta.rollback.none', { n: props.view.rollback.missing })
    : t('playbooks.meta.rollback.yes', {
        covered: props.view.rollback.covered,
        total: props.view.rollback.total,
      }),
)

/** `v-model` trên prop là mutate prop — emit giá trị lên manager thay vì sửa tại chỗ. */
function onVar(name: string, e: Event): void {
  emit('setVariable', name, (e.target as HTMLInputElement).value)
}
</script>

<style scoped>
.pb-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 16px 16px;
}

.pb-dstate {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 34px 20px;
  color: var(--textDim);
  text-align: center;
}

.pb-dstate-txt {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.pb-dstate-hint {
  margin: 0;
  max-width: 460px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pb-name {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}

.pb-src {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Bản dựng sẵn: chỉ đọc, sửa/xoá đều bị sidecar từ chối — nói trước. */
.pb-src.ro {
  color: var(--violet);
}

.pb-tier {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pb-desc {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.pb-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pb-meta .is-bad {
  color: var(--amber);
}

.pb-meta-when {
  margin-left: 6px;
  color: var(--textFaint);
}

.pb-vars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pb-vars-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pb-vars-ttl {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.pb-vars-req {
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pb-vars-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pb-var {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 160px;
}

.pb-var-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pb-var-star {
  color: var(--amber);
}

.pb-var-inp {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pb-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pb-block {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
</style>
