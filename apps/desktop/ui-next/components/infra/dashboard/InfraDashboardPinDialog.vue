<template>
  <!-- "Ghim biểu đồ này vào một bảng" (mốc 6, M4).
       Hộp này KHÔNG vẽ lại biểu đồ và không hỏi lại dữ liệu: nó chỉ trả lời một câu
       — biểu đồ vừa bấm ở màn Giám sát sẽ nằm trong bảng nào. Bảng dựng sẵn KHÔNG
       có mặt trong danh sách: chúng nằm trong mã và chỉ đọc được, nên mời người
       dùng ghim vào đó là mời họ đâm vào một lượt lưu chắc chắn hỏng. -->
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="closePin">
      <div class="idp" role="dialog" aria-modal="true">
        <header class="idp-hd">
          <Icon name="pin" class="idp-hd-ic" />
          <span class="idp-ttl">{{ t('infra.dashboard.pin.title') }}</span>
        </header>

        <p class="idp-sub">{{ t('infra.dashboard.pin.subtitle') }}</p>

        <!-- Tiêu đề + số chuỗi: hai thứ duy nhất hộp này cầm của biểu đồ, nói ra để
             người dùng nhận ra mình đang ghim đúng cái vừa bấm. -->
        <div class="idp-subject">
          <span class="idp-name">{{ pending?.title }}</span>
          <span class="idp-size">
            {{ t('infra.dashboard.pin.series', { n: pending?.series.length ?? 0 }) }}
          </span>
        </div>

        <p v-if="!sidecarAvailable" class="idp-state">{{ t('infra.dashboard.noSidecar') }}</p>

        <!-- Tạo bảng mới: hai ô, không hơn. Mô tả để trống — nó không phải thứ ai
             đọc lúc quyết định, và một trường bắt buộc ở đây chỉ sinh ra chữ "bảng
             mới" lặp lại ở mọi bảng. -->
        <template v-else-if="creating">
          <div class="idp-field">
            <div class="idp-lbl">{{ t('infra.dashboard.pin.nameLabel') }}</div>
            <input
              v-model="name"
              class="idp-inp"
              type="text"
              :maxlength="MAX_LABEL_CHARS"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('infra.dashboard.pin.namePlaceholder')"
              @keydown.enter="submitNew"
            />
          </div>
          <div class="idp-field">
            <div class="idp-lbl">{{ t('infra.dashboard.pin.tierLabel') }}</div>
            <div class="idp-seg">
              <span
                :class="{ on: tier === 'global' }"
                role="button"
                :aria-pressed="tier === 'global'"
                @click="tier = 'global'"
              >
                {{ t('infra.dashboard.tier.global') }}
              </span>
              <!-- Chỉ mời tier project khi phiên CÓ project: không có thì
                   `createDashboard` từ chối, và một lựa chọn luôn dẫn tới lỗi là
                   một lựa chọn không nên có mặt. -->
              <span
                v-if="projectId"
                :class="{ on: tier === 'project' }"
                role="button"
                :aria-pressed="tier === 'project'"
                @click="tier = 'project'"
              >
                {{ t('infra.dashboard.tier.project') }}
              </span>
            </div>
          </div>
          <p v-if="error" class="idp-err">{{ error }}</p>
        </template>

        <template v-else>
          <p v-if="listLoading" class="idp-state">{{ t('common.loading') }}</p>
          <p v-else-if="writable.length === 0" class="idp-state">
            {{ t('infra.dashboard.pin.empty') }}
          </p>
          <div v-else class="idp-opts">
            <button
              v-for="d in writable"
              :key="`${d.source}:${d.projectId ?? ''}:${d.id}`"
              class="idp-opt"
              type="button"
              :disabled="busy"
              @click="submitExisting(d)"
            >
              <span class="idp-opt-ttl">{{ d.name }}</span>
              <span class="idp-opt-hint">
                {{
                  t('infra.dashboard.pin.rowHint', {
                    n: d.chartCount,
                    tier: t(`infra.dashboard.tier.${d.tier}`),
                  })
                }}
              </span>
            </button>
          </div>
          <p v-if="error" class="idp-err">{{ error }}</p>
        </template>

        <footer class="idp-ft">
          <button class="btn" type="button" :disabled="busy" @click="backOrClose">
            {{ creating ? t('common.back') : t('common.cancel') }}
          </button>
          <button
            v-if="sidecarAvailable && !creating"
            class="btn pri"
            type="button"
            :disabled="busy"
            @click="creating = true"
          >
            <Icon name="plus" class="idp-ic" />
            {{ t('infra.dashboard.pin.create') }}
          </button>
          <button
            v-else-if="creating"
            class="btn pri"
            type="button"
            :disabled="busy || !name.trim()"
            :aria-busy="busy"
            @click="submitNew"
          >
            {{ t('infra.dashboard.pin.confirm') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp ghim một biểu đồ của màn Giám sát vào bảng điều khiển.
//
// ĐỔI TÊN KHOÁ TRƯỚC KHI GHI. `validateDashboard` đòi khoá chuỗi duy nhất trên TOÀN
// bảng, mà ghim cùng một biểu đồ hai lần là chuyện bình thường (so sánh hai khoảng
// thời gian cạnh nhau). Nên lượt ghim hỏi trước bảng đích đang dùng những khoá nào
// (`takenKeys`) rồi đi qua `remapChartKeys` — nếu không thì cú ghim thứ hai trả về
// `dashboard.error.duplicateSeries` và người dùng không hiểu mình vừa làm sai gì.
//
// ĐỌC TRƯỚC KHI GHI. Cả `takenKeys` lẫn `appendChart` đọc bản ĐẦY ĐỦ của bảng đích:
// `list` chỉ trả tóm tắt, và ghi đè bằng tóm tắt là xoá sạch biểu đồ của bảng đó.
import { ref, watch } from 'vue'
import { useInfraDashboardPin } from '~/composables/useInfraDashboardPin'
import { remapChartKeys, useInfraDashboards } from '~/composables/useInfraDashboards'
import type {
  DashboardRef,
  DashboardSummary,
  WritableDashboardSource,
} from '~/composables/useInfraDashboards'

/** Khớp `MAX_LABEL_CHARS` của lược đồ sidecar — chặn ở ô nhập thay vì để zod ném. */
const MAX_LABEL_CHARS = 200

const { t } = useI18n()
const toast = useToast()
const { open, pending, closePin } = useInfraDashboardPin()
const {
  writableSummaries,
  projectId,
  sidecarAvailable,
  refresh,
  listLoading,
  takenKeys,
  appendChart,
  createDashboard,
} = useInfraDashboards()

const creating = ref(false)
const name = ref('')
const tier = ref<WritableDashboardSource>('global')
const busy = ref(false)
const error = ref('')

const writable = writableSummaries

/**
 * Mỗi lần MỞ là một lần quét lại danh sách. Bảng có thể vừa được tạo ở tab Bảng
 * điều khiển, hoặc ở một cửa sổ khác — danh sách cũ ở đây là mời người dùng ghim
 * vào một bảng không còn tồn tại.
 *
 * Mặc định tier `global`: nó ghi được kể cả khi phiên không ghim project nào, và
 * một bảng theo dõi tài khoản AWS thường không thuộc về một dự án cụ thể.
 */
watch(open, (v) => {
  if (!v) return
  creating.value = false
  name.value = ''
  error.value = ''
  tier.value = 'global'
  void refresh()
})

function backOrClose(): void {
  if (creating.value) {
    creating.value = false
    error.value = ''
    return
  }
  closePin()
}

async function submitExisting(d: DashboardSummary): Promise<void> {
  const chart = pending.value
  if (!chart || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // `writableSummaries` đã lọc bỏ `builtin`, nhưng TypeScript không narrow qua
    // `.filter()` — nhánh dưới nói ra điều đó cho cả trình biên dịch lẫn người đọc.
    const source: WritableDashboardSource = d.source === 'project' ? 'project' : 'global'
    const dest: DashboardRef = {
      source,
      ...(source === 'project' && d.projectId !== undefined ? { projectId: d.projectId } : {}),
      id: d.id,
    }
    const taken = await takenKeys(dest)
    const res = await appendChart(dest, remapChartKeys(chart, taken))
    if (!res.ok) {
      error.value = res.error
      return
    }
    toast.add({ title: t('infra.dashboard.pin.pinned', { name: d.name }), color: 'success' })
    closePin()
  } finally {
    busy.value = false
  }
}

async function submitNew(): Promise<void> {
  const chart = pending.value
  const label = name.value.trim()
  if (!chart || !label || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Bảng mới chưa có khoá nào, nên không cần `remapChartKeys`: khoá của biểu đồ
    // vừa ghim là duy nhất trong một bảng rỗng theo định nghĩa.
    const res = await createDashboard({
      source: tier.value,
      name: label,
      description: '',
      charts: [chart],
    })
    if (!res.ok) {
      error.value = res.error
      return
    }
    toast.add({ title: t('infra.dashboard.pin.created', { name: label }), color: 'success' })
    closePin()
  } finally {
    busy.value = false
  }
}

// Trạng thái mở nằm ở MỌC MODULE nên listener phải hỏi `open` chứ không thể dựa vào
// vòng đời của component này.
useEscToClose(
  () => open.value,
  () => closePin(),
)
</script>

<style scoped>
.idp {
  width: min(560px, calc(100vw - 32px));
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

.idp-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textMuted);
}

.idp-hd-ic {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  color: var(--accent);
}

.idp-ttl {
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.idp-sub {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.idp-subject {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
}

.idp-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.idp-size {
  flex: 0 0 auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-variant-numeric: tabular-nums;
}

.idp-state {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.idp-opts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  max-height: 40vh;
  overflow-y: auto;
}

.idp-opt {
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

.idp-opt:hover:not(:disabled) {
  border-color: var(--accentBorder);
}

.idp-opt:disabled {
  opacity: 0.55;
  cursor: default;
}

.idp-opt-ttl {
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.idp-opt-hint {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}

.idp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.idp-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.idp-inp {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}

.idp-inp:focus {
  border-color: var(--accentBorder);
}

.idp-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  align-self: flex-start;
}

.idp-seg > span {
  padding: 3px 10px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.idp-seg > span.on {
  color: var(--accent);
  background: var(--accentDim);
}

.idp-err {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.idp-ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.idp-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
</style>
