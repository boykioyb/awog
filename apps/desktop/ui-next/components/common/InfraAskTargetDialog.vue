<template>
  <!-- Hộp chọn đích của "Hỏi agent" — yêu cầu người dùng: "các phần hỏi agent đều
       có option là cho vào session hiện tại hay mở session mới".
       Một host duy nhất cho MỌI màn (Tổng quan · Logs · Explorer · Nhật ký ·
       Kubernetes), vì bốn bản sao của hộp này là bốn chỗ để "phiên mới" hiểu khác
       nhau về việc nó nên rơi vào project nào. -->
  <Teleport to="body">
    <div v-if="chooser.open" class="ovl on" @click.self="closeChooser">
      <div class="ixa" role="dialog" aria-modal="true" @keydown.esc="closeChooser">
        <header class="ixa-hd">
          <Icon name="sparkles" />
          <span class="ixa-ttl">{{ t('infra.ask.chooseTitle') }}</span>
        </header>
        <p v-if="chooser.source" class="ixa-src">{{ chooser.source }}</p>
        <pre class="ixa-preview">{{ preview }}</pre>
        <div class="ixa-opts">
          <button
            class="ixa-opt"
            type="button"
            :disabled="!hasActiveSession"
            @click="deliver(chooser.text, 'current')"
          >
            <Icon name="message" />
            <span class="ixa-opt-ttl">{{ t('infra.ask.chooseCurrent') }}</span>
            <span class="ixa-opt-hint">
              {{ hasActiveSession ? t('infra.ask.chooseCurrentHint') : t('infra.ask.noSession') }}
            </span>
          </button>
          <button class="ixa-opt" type="button" @click="deliver(chooser.text, 'new')">
            <Icon name="plus" />
            <span class="ixa-opt-ttl">{{ t('infra.ask.chooseNew') }}</span>
            <span class="ixa-opt-hint">{{ t('infra.ask.chooseNewHint') }}</span>
          </button>
        </div>
        <footer class="ixa-ft">
          <button class="btn" type="button" @click="closeChooser">{{ t('common.cancel') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'

const { t } = useI18n()
const { chooser, closeChooser, deliver, hasActiveSession } = useInfraAskAgent()

/** Xem trước có cắt: ngữ cảnh một dòng log có thể dài, và hộp này để CHỌN chứ
 *  không phải để đọc. Người dùng vẫn thấy đủ để nhận ra mình đang gửi gì. */
const preview = computed(() => {
  const text = chooser.text
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
})

/** Esc đóng: hộp này là một quyết định, không phải một bước bắt buộc. */
function onKey(e: KeyboardEvent): void {
  if (chooser.open && e.key === 'Escape') closeChooser()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.ixa {
  width: min(520px, calc(100vw - 32px));
  margin-top: 6vh;
  padding: 14px 16px 12px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ixa-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textMuted);
}

.ixa-ttl {
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.ixa-src {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ixa-preview {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--textMuted);
  font-family: var(--sans);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.ixa-opts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ixa-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
  color: var(--textMuted);
  text-align: left;
  cursor: pointer;
}

.ixa-opt:hover:not(:disabled) {
  border-color: var(--accentBorder);
}

.ixa-opt:disabled {
  opacity: 0.55;
}

.ixa-opt-ttl {
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixa-opt-hint {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixa-ft {
  display: flex;
  justify-content: flex-end;
}
</style>
