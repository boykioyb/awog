<template>
  <Teleport to="body">
    <div v-if="aiOpen" class="ovl on ltai-ovl" @click.self="aiOpen = false">
      <div class="ltai-card" role="dialog" aria-modal="true" :aria-label="t('logtime.ai.title')">
        <div class="ltai-head">
          <div>
            <div class="ltai-title">
              {{ t('logtime.ai.titleWithDate', { d: longDateOf(date) }) }}
            </div>
            <div class="ltai-sub">{{ t('logtime.ai.sub') }}</div>
          </div>
          <span class="ltai-sp" />
          <button class="ltai-x" :title="t('common.close')" @click="aiOpen = false">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="ltai-body">
          <!-- Đang gọi model. -->
          <div v-if="store.composeBusy" class="ltai-state">
            <Icon name="refresh" class="ltai-spin" />
            <span>{{ t('logtime.ai.busy') }}</span>
          </div>

          <!-- Lỗi: engine chưa chạy vs lỗi model, hai câu khác nhau. -->
          <p v-else-if="store.composeError" class="ltai-err">
            <Icon name="alert" />
            <span>
              {{
                store.composeError === 'engine-unavailable'
                  ? t('logtime.ai.noEngine')
                  : t('logtime.ai.failed')
              }}
            </span>
          </p>

          <template v-else>
            <!-- Ngữ cảnh AWOG chèn vào lượt — hiện đúng như bản phác để người dùng thấy
                 model soạn dựa trên gì, không phải hộp đen. -->
            <div class="ltai-ctxh">
              <Icon name="inspect" />
              <span>{{ t('logtime.ai.contextTitle') }}</span>
            </div>
            <pre class="ltai-ctx">{{ store.composeContext }}</pre>

            <div v-if="store.composeLines.length === 0" class="ltai-state">
              {{ t('logtime.ai.none') }}
            </div>

            <template v-else>
              <div class="ltai-sech">
                <Icon name="check" class="ltai-sechic" />
                <span>
                  {{
                    t('logtime.ai.draftCount', {
                      n: store.composeLines.length,
                      h: fmt(proposedTotal),
                    })
                  }}
                </span>
              </div>
              <ul class="ltai-list">
                <li v-for="(line, i) in store.composeLines" :key="i" class="ltai-row">
                  <span class="ltai-hours tnum">{{ fmt(line.hours) }}h</span>
                  <b class="ltai-proj">{{ labelOf(line.projectKey) }}</b>
                  <span class="ltai-note">{{ line.note }}</span>
                  <span v-if="line.issue !== undefined" class="chip">
                    <Icon name="link" />
                    <span>#{{ line.issue }}</span>
                  </span>
                </li>
              </ul>
            </template>
          </template>
        </div>

        <div class="ltai-foot">
          <span class="ltai-hint">{{ t('logtime.ai.hint') }}</span>
          <span class="ltai-sp" />
          <button class="btn" type="button" @click="aiOpen = false">
            {{ t('logtime.ai.editManually') }}
          </button>
          <button
            class="btn pri"
            type="button"
            :disabled="store.composeBusy || store.composeLines.length === 0"
            @click="acceptCompose"
          >
            {{ t('logtime.ai.accept', { n: store.composeLines.length }) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Soạn logtime bằng AI (ADR 0091, Nhóm C). Model soạn dòng công nháp từ việc AWOG đo
// được; NHẬN xong vẫn là NHÁP đi qua cổng `addEntry`, đẩy PMS vẫn là bước riêng có xác
// nhận (`LogtimePushModal`). Model không bao giờ tự đẩy.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'

const { t } = useI18n()
const { aiOpen, store, date, longDateOf, labelOf, fmt, acceptCompose } = useLogtimeManager()

const proposedTotal = computed(() => store.composeLines.reduce((s, l) => s + l.hours, 0))
</script>

<style scoped>
.ltai-ovl {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ltai-card {
  background: var(--bgPanel);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 680px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ltai-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  box-shadow: inset 0 -1px 0 var(--border);
  flex: 0 0 auto;
}
.ltai-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltai-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltai-sp {
  flex: 1;
}
.ltai-x {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltai-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltai-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ltai-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltai-spin {
  width: var(--icon-sm);
  height: var(--icon-sm);
  animation: ltai-rot 0.9s linear infinite;
}
@keyframes ltai-rot {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ltai-spin {
    animation: none;
  }
}
.ltai-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 14px 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltai-err > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}
.ltai-ctxh {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltai-ctxh > .icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
.ltai-ctx {
  margin: 0;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
  font-family: var(--code); /* mono-ok: khối ngữ cảnh dạng thẻ, đọc như code */
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textMuted);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.ltai-sech {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.ltai-sechic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}
.ltai-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltai-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltai-hours {
  flex: 0 0 auto;
  font-weight: 650;
  color: var(--accent);
  min-width: 40px;
}
.ltai-proj {
  flex: 0 0 auto;
  font-weight: 600;
}
.ltai-note {
  flex: 1;
  min-width: 0;
  color: var(--textMuted);
  word-break: break-word;
}
.ltai-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 11px 16px;
  box-shadow: inset 0 1px 0 var(--border);
  flex: 0 0 auto;
}
.ltai-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
