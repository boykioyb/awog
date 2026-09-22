<template>
  <Teleport to="body">
    <div v-if="taskOpen" class="ovl on ltt-ovl" @click.self="close">
      <div class="ltt-card" role="dialog" aria-modal="true" :aria-label="t('logtime.task.title')">
        <div class="ltt-head">
          <div>
            <div class="ltt-title">{{ t('logtime.task.title') }}</div>
            <div class="ltt-sub">{{ t('logtime.task.sub') }}</div>
          </div>
          <span class="ltsp" />
          <button class="ltt-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
        <!-- Ô tìm: gõ là HỎI LẠI PMS theo `q` (debounce). Luôn hiện khi có danh sách hoặc
             đang có từ khoá — kể cả khi tìm ra 0 kết quả, để còn sửa/xoá từ khoá. -->
        <div v-if="taskQuery || taskOptions.length > 0" class="ltt-search">
          <Icon name="search" />
          <input
            ref="searchRef"
            v-model="taskQuery"
            :placeholder="t('logtime.task.search')"
            @keydown.esc="taskQuery = ''"
          />
          <Icon v-if="taskLoading" name="refresh" class="ltt-spin" />
          <span v-else-if="taskQuery" class="ltt-count tnum">{{ taskOptions.length }}</span>
        </div>
        <div class="ltt-body">
          <div v-if="taskLoading && taskOptions.length === 0" class="ltt-note">
            {{ t('logtime.task.loading') }}
          </div>
          <div v-else-if="taskOptions.length === 0 && taskQuery" class="ltt-note">
            {{ t('logtime.task.noMatch', { q: taskQuery }) }}
          </div>
          <div v-else-if="taskOptions.length === 0" class="ltt-note">
            {{ t('logtime.task.none') }}
          </div>
          <button
            v-for="opt in taskOptions"
            v-else
            :key="opt.value"
            type="button"
            class="ltt-row"
            @click="pickTask(opt)"
          >
            <span class="ltt-lbl">{{ opt.label }}</span>
          </button>
        </div>
        <div class="ltt-foot">
          <span class="ltt-hint">{{ t('logtime.task.hint') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Chọn task để gắn vào dòng công. Danh sách lấy từ `worklog_list_tasks(projectId)`
// của chính nguồn đang nối — không có danh sách cứng nào ở phía AWOG.
import { nextTick, watch, useTemplateRef } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'

const { t } = useI18n()
const { taskOpen, taskLoading, taskOptions, taskQuery, searchTasks, pickTask } = useLogtimeManager()

// Tự focus ô tìm khi modal mở để gõ ngay, không phải bấm chuột trước.
const searchRef = useTemplateRef<HTMLInputElement>('searchRef')
watch(taskOpen, (open) => {
  if (open) void nextTick(() => searchRef.value?.focus())
})

// Gõ là HỎI LẠI PMS theo `q` — debounce 300ms để không bắn một request mỗi phím.
// `openTaskPicker` đã nạp loạt đầu (và reset `taskQuery=''`), nên bỏ qua lần watch đổi
// về '' ngay khi mở; chỉ tìm khi người dùng thực sự gõ.
let debounce: ReturnType<typeof setTimeout> | null = null
watch(taskQuery, (q) => {
  if (!taskOpen.value) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void searchTasks(q), 300)
})

function close(): void {
  taskOpen.value = false
}
</script>

<style scoped>
.ltt-ovl {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ltt-card {
  background: var(--bgPanel);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 560px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ltt-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltt-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltt-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltsp {
  flex: 1;
}
.ltt-x {
  width: 28px;
  height: 28px;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltt-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltt-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px 0;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgInput);
}
.ltt-search:focus-within {
  border-color: var(--accentBorder);
}
.ltt-search > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}
.ltt-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltt-count {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.ltt-spin {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--accent);
  animation: ltt-rot 0.9s linear infinite;
}
@keyframes ltt-rot {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ltt-spin {
    animation: none;
  }
}
.ltt-body {
  padding: 12px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltt-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  color: inherit;
  font-family: inherit;
  padding: 9px 11px;
  cursor: pointer;
  min-width: 0;
}
.ltt-row:hover {
  border-color: var(--accentBorder);
}
.ltt-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltt-note {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.ltt-foot {
  padding: 11px 16px;
  box-shadow: inset 0 1px 0 var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltt-hint {
  color: var(--textDim);
}
</style>
