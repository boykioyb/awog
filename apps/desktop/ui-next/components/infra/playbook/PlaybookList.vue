<template>
  <!-- Cột trái của `/playbooks` (việc 5.5). Hai nhóm rời nhau — Triển khai · Hướng
       dẫn — theo LOẠI playbook, vì playbook KHÔNG có trạng thái riêng: trạng thái
       là của từng lượt chạy (xem `usePlaybooksApi.PlaybookRun`). SFC chỉ bind; state
       ở `usePlaybooksManager()`. -->
  <div class="pb-list">
    <div v-if="loading" class="pbl-state">
      <Icon name="refresh" class="ikspin" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pbl-state-txt" role="status" aria-busy="true">{{ t('playbooks.list.loading') }}</p>
    </div>

    <!-- Lỗi phải nói CÁCH SỬA, không chỉ nói đã hỏng (luật 3). -->
    <div v-else-if="error" class="pbl-state">
      <Icon name="alert" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pbl-state-txt">{{ error }}</p>
      <button class="btn sm" type="button" @click="emit('refresh')">
        {{ t('playbooks.list.retry') }}
      </button>
    </div>

    <div v-else-if="!groups.length" class="pbl-state">
      <Icon name="book" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <p class="pbl-state-txt">{{ t('playbooks.list.empty.title') }}</p>
      <p class="pbl-state-hint">{{ t('playbooks.list.empty.hint') }}</p>
      <button class="btn sm" type="button" @click="emit('refresh')">
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('playbooks.toolbar.refresh') }}
      </button>
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.key" class="pbl-group">
        <div class="pbl-group-hd">{{ t(`playbooks.group.${group.key}`) }}</div>
        <ul class="pbl-items">
          <li v-for="item in group.items" :key="keyOf(item)">
            <button
              type="button"
              class="pbl-item"
              :class="{ on: keyOf(item) === selectedKey }"
              @click="emit('open', item)"
            >
              <span class="pbl-dot" :class="`src-${item.source}`" />
              <span class="pbl-main">
                <span class="pbl-name">{{ item.name }}</span>
                <span class="pbl-meta">
                  {{
                    t('playbooks.list.meta', {
                      source: t(`playbooks.source.${item.source}`),
                      steps: item.stepCount,
                    })
                  }}
                </span>
              </span>
              <!-- File HỎNG: nói ra, đừng để nó trông như một dòng bình thường —
                   `issues` khác rỗng cũng là thứ tắt luôn nút gửi duyệt. -->
              <span
                v-if="item.issues.length"
                class="pbl-bad"
                role="img"
                :aria-label="t('playbooks.list.broken')"
                :title="t('playbooks.list.broken')"
              >
                <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </span>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookGroupKey } from '~/composables/usePlaybooksManager'
import type { PlaybookSummary } from '~/composables/usePlaybooksApi'

defineProps<{
  groups: { key: PlaybookGroupKey; items: PlaybookSummary[] }[]
  selectedKey: string
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  open: [summary: PlaybookSummary]
  refresh: []
}>()

const { t } = useI18n()

/**
 * Danh tính một dòng. `source` là MỘT PHẦN của khoá chứ không phải nhãn: cùng một
 * id nằm ở tier dựng sẵn và tier project là hai playbook khác nhau, nên so bằng
 * `id` không thôi sẽ tô sáng nhầm dòng. Trùng công thức với `summaryKey` ở manager.
 */
function keyOf(item: PlaybookSummary): string {
  return `${item.source}:${item.projectId ?? ''}:${item.id}`
}
</script>

<style scoped>
.pb-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 8px 6px 12px;
  gap: 10px;
}

.pbl-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 30px 18px;
  color: var(--textDim);
  text-align: center;
}

.pbl-state-txt {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbl-state-hint {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.pbl-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Nhãn nhóm viết sentence-case, KHÔNG all-caps (luật UI của repo). */
.pbl-group-hd {
  padding: 4px 8px 2px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 550;
}

.pbl-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pbl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: default;
}

.pbl-item:hover {
  background: var(--bgHover);
}

/* Trạng thái đang chọn = accent-tint + thanh accent, KHÔNG nền xám đặc. */
.pbl-item.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
}

/* Chấm tô theo NGUỒN: dựng sẵn (chỉ đọc) · dùng chung · riêng dự án. Đây là thứ
   duy nhất phân biệt được hai playbook cùng id ở hai tier. */
.pbl-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--textDim);
}

.pbl-dot.src-builtin {
  background: var(--violet);
}

.pbl-dot.src-global {
  background: var(--accent);
}

.pbl-dot.src-project {
  background: var(--blue);
}

.pbl-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pbl-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbl-meta {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pbl-bad {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  color: var(--amber);
}
</style>
