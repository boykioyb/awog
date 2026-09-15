<template>
  <!-- Khung output của một pod — log hoặc `describe` — trong MỘT modal có hai tab.
       Vì sao modal: log là văn bản dài, để nó nằm trong dòng chảy của trang thì
       hoặc bị cắt, hoặc đẩy cả trang phải cuộn. Trong modal, `pre` là vùng duy nhất
       cuộn và nó lấp hết phần thân.

       Nó cố ý KHÔNG stream (`kubectl logs -f` là tiến trình sống, việc của tab Logs
       trong Workspace Panel — P2 việc 21). Ở đây là ảnh chụp có nút ↻: đọc xong,
       không để lại tiến trình nào chạy nền. -->
  <Teleport to="body">
    <div v-if="out.open" class="ikm-ovl" @click.self="kube.closeOut()">
      <div class="ikm-card wide" role="dialog" aria-modal="true">
        <div class="ikm-head">
          <span class="ikm-title">
            <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ out.pod }}
          </span>
          <span class="iksec-sub">{{ out.title }}</span>

          <div class="ikm-actions">
            <!-- Hai tab của cùng một pod: log và mô tả. `setOutMode` gọi lại đúng
                 op của tab vừa chọn; số dòng đã chọn được giữ nguyên. -->
            <!-- Khoá khi đang nạp: bấm tab khác giữa chừng là hai lệnh chồng nhau
                 trên cùng một khung. -->
            <div class="seg" :class="{ ikoff: out.loading }" role="tablist">
              <span
                role="button"
                tabindex="0"
                :class="{ on: out.mode === 'logs' }"
                @click="kube.setOutMode('logs')"
                @keydown.enter.prevent="kube.setOutMode('logs')"
                @keydown.space.prevent="kube.setOutMode('logs')"
              >
                {{ t('infra.kube.out.tabLogs') }}
              </span>
              <span
                role="button"
                tabindex="0"
                :class="{ on: out.mode === 'describe' }"
                @click="kube.setOutMode('describe')"
                @keydown.enter.prevent="kube.setOutMode('describe')"
                @keydown.space.prevent="kube.setOutMode('describe')"
              >
                {{ t('infra.kube.act.describe') }}
              </span>
            </div>

            <AppSelect
              v-if="out.mode === 'logs' && out.containers.length"
              :model-value="out.container"
              :options="containerOptions"
              width="auto"
              :disabled="out.loading"
              @update:model-value="kube.setContainer"
            />
            <AppSelect
              v-if="out.mode === 'logs'"
              :model-value="String(out.tail)"
              :options="tailOptions"
              width="auto"
              :disabled="out.loading"
              @update:model-value="onTail"
            />
            <button
              type="button"
              class="btn"
              :disabled="out.loading"
              :title="t('infra.kube.refresh')"
              @click="kube.refreshOut()"
            >
              <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button type="button" class="btn" :title="t('common.close')" @click="kube.closeOut()">
              <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
          </div>
        </div>

        <div class="ikm-body">
          <!-- Dòng lệnh đã chạy: có ích khi cần chép sang terminal để tự làm tiếp. -->
          <div v-if="out.command" class="ikcmd">
            <code>{{ out.command }}</code>
            <button type="button" class="btn" @click="kube.copyCommand(out.command)">
              {{ t('infra.kube.blocked.copy') }}
            </button>
          </div>

          <p v-if="out.error" class="ierr">{{ out.error }}</p>

          <!-- Thanh LỌC DÒNG của khung này. Lọc chạy trên chữ ĐÃ tải về (một lần
               `kubectl logs`), không gọi lại cluster và không tốn thêm gì: gõ vào
               đây là lọc tại chỗ, còn muốn lấy nhiều dòng hơn thì đổi ô "số dòng".
               Mặc định GIẤU dòng không khớp (đúng nghĩa "lọc"); nút bên cạnh đổi
               sang chế độ chỉ tô sáng để vẫn giữ được mạch log xung quanh. -->
          <div v-if="out.text || out.loading" class="iklogbar">
            <div class="srch iklogfind">
              <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
              <input
                :value="logQuery"
                type="text"
                spellcheck="false"
                :placeholder="t('infra.kube.log.filter.ph')"
                :aria-label="t('infra.kube.log.filter.ph')"
                @input="onQuery"
              />
              <button
                v-if="logQuery"
                class="ikfindx"
                type="button"
                :title="t('infra.kube.search.clear')"
                :aria-label="t('infra.kube.search.clear')"
                @click="logQuery = ''"
              >
                <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </button>
            </div>
            <span v-if="logQuery" class="ihint" role="status">
              {{ t('infra.kube.log.hits', { shown: matchedCount, total: lineCount }) }}
            </span>
            <button
              v-if="logQuery"
              type="button"
              class="btn"
              :aria-pressed="onlyMatches"
              @click="onlyMatches = !onlyMatches"
            >
              <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ onlyMatches ? t('infra.kube.log.allLines') : t('infra.kube.log.onlyMatches') }}
            </button>
          </div>

          <!-- Đang nạp: chưa có chữ thì hiện dòng "đang nạp", có chữ cũ (bấm ↻, đổi
               số dòng) thì làm mờ chữ cũ. Thân modal trống trơn trước đây trông y
               hệt "không có gì để hiện". -->
          <p v-if="out.loading && !out.text" class="ikload" role="status" aria-busy="true">
            <Icon
              name="refresh"
              class="ikspin"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('infra.kube.loading') }}
          </p>
          <p v-else-if="noMatch" class="ihint">
            {{ t('infra.kube.log.noMatch', { q: logQuery }) }}
          </p>
          <!-- Một khối chữ: chưa lọc, hoặc đang ở chế độ chỉ-hiện-dòng-khớp (mọi
               dòng đều khớp nên tô sáng là vô nghĩa). -->
          <pre v-else-if="displayText !== null" class="ikpre" :class="{ ikdim: out.loading }">{{
            displayText
          }}</pre>
          <!-- Chế độ "tất cả dòng": từng dòng một để tô sáng dòng khớp. -->
          <pre v-else-if="lineViews.length" class="ikpre iklines" :class="{ ikdim: out.loading }">
<span
  v-for="line in lineViews"
  :key="line.i"
  class="ikln"
  :class="{ ikhit: line.hit }"
>{{ line.text }}</span></pre>
          <p v-else-if="!out.error" class="ihint">{{ t('infra.kube.out.empty') }}</p>
          <p v-if="cappedInfo" class="ihint">
            {{ t('infra.kube.log.capped', cappedInfo) }}
          </p>
        </div>

        <div class="ikm-foot">
          <!-- Xoá pod nằm CẠNH thứ nói về pod đó (log/mô tả của chính nó) — chỗ duy
               nhất trong màn mà hành vi phá huỷ có đủ ngữ cảnh để người dùng quyết.
               Vẫn qua hộp duyệt hạ tầng: phải gõ lại tên pod mới xoá được. -->
          <button
            type="button"
            class="btn gdanger"
            :title="t('infra.kube.act.deletePodWhy')"
            :disabled="!!deleting"
            :aria-busy="deleting === out.pod"
            @click="kube.deletePod(out.pod)"
          >
            <Icon
              :name="deleting === out.pod ? 'refresh' : 'trash'"
              :class="{ ikspin: deleting === out.pod }"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('infra.kube.act.deletePod') }}
          </button>
          <button type="button" class="btn" @click="kube.closeOut()">
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { KUBE_TAILS } from '~/composables/useInfraKube'
import type { InfraKubeController } from '~/composables/useInfraKube'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

const props = defineProps<{ kube: InfraKubeController }>()
const { out, deleting } = props.kube

const { t } = useI18n()
const kube = props.kube

/** Trần số dòng ĐƯỢC VẼ: một pod có thể trả về 5000 dòng, dựng 5000 phần tử DOM
 *  chỉ để nhìn là tự bắn vào chân. Dòng thừa vẫn nằm trong bộ nhớ và được đếm ra. */
const MAX_VIEW_LINES = 2000

const logQuery = ref('')
/** `true` = giấu dòng không khớp; `false` = chỉ tô sáng. */
const onlyMatches = ref(true)

function onQuery(e: Event): void {
  const el = e.target
  logQuery.value = el instanceof HTMLInputElement ? el.value : ''
}

const allLines = computed<readonly string[]>(() =>
  out.value.text ? out.value.text.split('\n') : [],
)
const lineCount = computed(() => allLines.value.length)
const q = computed(() => logQuery.value.trim().toLowerCase())
const hits = computed<readonly string[]>(() =>
  q.value ? allLines.value.filter((line) => line.toLowerCase().includes(q.value)) : allLines.value,
)
const matchedCount = computed(() => hits.value.length)
const noMatch = computed(() => !!q.value && matchedCount.value === 0)

/** Chữ hiện dạng MỘT KHỐI — `null` nghĩa là nhánh vẽ-từng-dòng mới đúng. */
const displayText = computed<string | null>(() => {
  if (noMatch.value) return null
  if (!q.value) return out.value.text || null
  if (!onlyMatches.value) return null
  return hits.value.slice(0, MAX_VIEW_LINES).join('\n')
})

const lineViews = computed<{ i: number; text: string; hit: boolean }[]>(() => {
  if (!q.value || onlyMatches.value) return []
  const needle = q.value
  return allLines.value
    .slice(0, MAX_VIEW_LINES)
    .map((text, i) => ({ i, text, hit: text.toLowerCase().includes(needle) }))
})

const cappedInfo = computed<{ shown: number; total: number } | null>(() => {
  if (!q.value) return null
  const total = onlyMatches.value ? matchedCount.value : lineCount.value
  return total > MAX_VIEW_LINES ? { shown: MAX_VIEW_LINES, total } : null
})

// Đổi pod là đổi nội dung: giữ lại chữ đã gõ sẽ lọc nhầm sang log của pod khác.
watch(
  () => out.value.pod,
  () => {
    logQuery.value = ''
    onlyMatches.value = true
  },
)

const containerOptions = computed<AppSelectOption[]>(() => [
  { label: t('infra.kube.out.allContainers'), value: '' },
  ...out.value.containers.map((name) => ({ label: name, value: name })),
])
const tailOptions = computed<AppSelectOption[]>(() =>
  KUBE_TAILS.map((n) => ({ label: t('infra.kube.out.tail', { n }), value: String(n) })),
)

function onTail(value: string): void {
  kube.setTail(Number(value))
}

// Esc đóng khung output — cùng luật với modal quản lý cluster.
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && out.value.open) kube.closeOut()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<style scoped>
/* Nút đóng nằm sát mép phải; nút xoá ở lại bên trái vì nó không phải đường đi tiếp. */
.ikm-foot .btn:last-child {
  margin-left: auto;
}
/* Ô lọc không giãn hết chiều ngang: nó là control, không phải vùng đọc. */
.iklogfind {
  flex: 0 1 260px;
}
/* Nút xoá trong ô lọc: không viền, không nền — nó thuộc về ô nhập, không phải một
   nút ngang hàng với các nút trong thanh. */
.ikfindx {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--textFaint);
  cursor: pointer;
}
.ikfindx:hover {
  color: var(--text);
}
</style>
