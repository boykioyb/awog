<template>
  <!-- Khối "Workload": hai bảng của cluster + namespace đang ghim.
       Đây là VÙNG CHÍNH của tab một-màn: nó lấp hết chỗ còn lại và chỉ BẢNG bên
       trong được cuộn. Pods và Deployments là hai tab của cùng một chỗ, không phải
       hai khối xếp dọc — xếp dọc là lý do màn cũ phải cuộn.

       Không nạp gì khi chưa có cluster. Nạp khi: người dùng chọn cluster/namespace
       (ý định rõ ràng) hoặc bấm ↻ — luật "không auto-refresh" của
       docs/features/infra-explorer.md cấm nạp sau lưng, không cấm làm theo cú bấm. -->
  <section class="iksec ikmain">
    <div class="ikmain-head">
      <!-- `.seg` là khuôn segmented control sẵn có của app; `role/tabindex/keydown`
           để bàn phím đi được, không chỉ chuột. -->
      <div class="seg" role="tablist">
        <span
          role="button"
          tabindex="0"
          :class="{ on: tab === 'pods' }"
          @click="setTab('pods')"
          @keydown.enter.prevent="setTab('pods')"
          @keydown.space.prevent="setTab('pods')"
        >
          {{ t('infra.kube.pods.tab', { n: pods.length }) }}
        </span>
        <span
          role="button"
          tabindex="0"
          :class="{ on: tab === 'deployments' }"
          @click="setTab('deployments')"
          @keydown.enter.prevent="setTab('deployments')"
          @keydown.space.prevent="setTab('deployments')"
        >
          {{ t('infra.kube.deploys.tab', { n: deployments.length }) }}
        </span>
        <span
          role="button"
          tabindex="0"
          :class="{ on: tab === 'report' }"
          @click="setTab('report')"
          @keydown.enter.prevent="setTab('report')"
          @keydown.space.prevent="setTab('report')"
        >
          {{ t('infra.kube.tab.report') }}
        </span>
      </div>

      <!-- Tìm trong bảng ĐANG XEM, lọc tại chỗ trên các hàng đã tải (không gọi
           cluster thêm lần nào). Chỉ hiện khi có hàng để tìm — ô tìm kiếm trên một
           bảng rỗng là thứ bấm vào không ra gì. -->
      <div v-if="showSearch" class="srch ikfind">
        <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <input
          :value="search"
          type="text"
          spellcheck="false"
          :placeholder="t('infra.kube.search.ph')"
          :aria-label="t('infra.kube.search.ph')"
          @input="onSearch"
        />
        <button
          v-if="search"
          class="ikfindx"
          type="button"
          :title="t('infra.kube.search.clear')"
          :aria-label="t('infra.kube.search.clear')"
          @click="search = ''"
        >
          <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </button>
      </div>

      <span v-if="busy" class="ihint">{{ t('infra.kube.loading') }}</span>
      <span v-else-if="search.trim()" class="ihint" role="status">
        {{ t('infra.kube.search.showing', { shown: shownCount, total: totalCount }) }}
      </span>
      <!-- Dấu chỉ chỗ bấm được: hàng pod mở khung log/chi tiết, và không có mũi tên
           thì người mới không biết điều đó. -->
      <span v-else-if="tab === 'pods' && pods.length" class="ihint">
        {{ t('infra.kube.pods.rowHint') }}
      </span>
    </div>

    <!-- Lệnh bị chặn giữa đường (ma trận quyền, hoặc CLI không dùng được): hiện
         lý do + đúng dòng lệnh để người dùng tự chạy. Không có nút chạy. -->
    <div v-if="blocked" class="ikblock">
      <p class="iwarn">{{ blocked.reason }}</p>
      <div v-if="blocked.command" class="ikcmd">
        <code>{{ blocked.command }}</code>
        <button type="button" class="btn" @click="kube.copyCommand(blocked.command)">
          {{ t('infra.kube.blocked.copy') }}
        </button>
      </div>
      <!-- Không có dòng lệnh nghĩa là lỗi trước khi spawn (hay gặp nhất: kubectl
           ngoài allowlist đường dẫn) ⇒ lối sửa nằm trong modal quản lý cluster. -->
      <button v-else type="button" class="btn" @click="kube.openClusters()">
        <Icon name="shield" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.kube.manage.open') }}
      </button>
    </div>

    <p v-if="namespacesError" class="iwarn">{{ namespacesError }}</p>

    <!-- Chưa ghim cluster: hai câu khác nhau cho hai tình huống khác nhau. Máy CÓ
         cluster thì chỉ cần chỉ lên thanh trên; máy CHƯA có kubeconfig (lần đầu
         dùng) thì phải chỉ sang modal quản lý, vì ở thanh trên chẳng có gì để chọn. -->
    <p v-if="!pinnedCluster" class="ihint">
      {{ contexts.length ? t('infra.kube.workloads.pickFirst') : t('infra.kube.clusters.noFile') }}
    </p>
    <button
      v-if="!pinnedCluster && !contexts.length"
      type="button"
      class="btn ikempty-btn"
      @click="kube.openClusters()"
    >
      <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('infra.kube.manage.open') }}
    </button>

    <template v-else>
      <p v-if="activeError" class="ierr">{{ activeError }}</p>

      <!-- Mục Báo cáo dùng CHUNG vùng này nhưng là cách nhìn khác: số liệu tổng
           hợp + theo dõi. `v-if` (không phải `v-show`) là cố ý — rời mục là component
           bị tháo, và vòng theo dõi (nếu đang bật) dừng theo. -->
      <InfraKubeReport v-if="tab === 'report'" :kube="kube" />

      <!-- Đang nạp: có hàng cũ thì giữ nguyên và LÀM MỜ (đổi namespace nhìn thấy
           ngay là dữ liệu đang được thay), chưa có hàng nào thì hiện khung xương.
           Trước đây cả hai trường hợp đều là thân trắng, không phân biệt được với
           "không có pod nào". -->
      <!-- `tblcard`: bảng nằm TRỰC TIẾP trên nền trang nên tự nâng mình lên card
           (skin ở assets/css/app-shell.css). Không gắn vào `.ikscroll` toàn cục vì
           `InfraKubeReport` dùng cùng class đó cho một chồng `.tile` — bọc thêm một
           card quanh các card là hai tầng bóng, đọc thành lỗi chứ không phải độ sâu. -->
      <div v-else class="ikscroll tblcard" :class="{ ikdim: activeLoading }">
        <template v-if="tab === 'pods'">
          <InfraKubeTableSkeleton v-if="activeLoading && !pods.length" />
          <InfraKubeTable
            v-else-if="filteredPods.length"
            :columns="podColumns"
            :rows="filteredPods"
            :clickable="!activeLoading"
            @row="kube.openLogs"
          />
          <div v-else-if="search.trim()" class="iknomatch">
            <span class="ihint">{{ t('infra.kube.search.noMatch', { q: search }) }}</span>
            <button type="button" class="btn" @click="search = ''">
              <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.kube.search.clear') }}
            </button>
          </div>
          <p v-else-if="!podsLoading && !podsError" class="ihint">
            {{ t('infra.kube.pods.empty') }}
          </p>
        </template>

        <template v-else>
          <!-- Deployments chỉ có MỘT hành động và hành động đó là ghi ⇒ nút trong
                 hàng, không phải cả hàng bấm được (bấm hàng mà không có gì để bấm
                 thì lạ hơn là tiện). -->
          <InfraKubeTableSkeleton v-if="activeLoading && !deployments.length" />
          <InfraKubeTable
            v-else-if="filteredDeployments.length"
            :columns="deployColumns"
            :rows="filteredDeployments"
          >
            <template #actions="{ row }">
              <!-- Nút của ĐÚNG hàng đang chạy mới quay; mọi nút ghi khác bị khoá
                   trong lúc đó, để cú bấm thứ hai (chuột đúp / bấm vội vì tưởng
                   chưa ăn) không thành hai `rollout restart`. -->
              <button
                type="button"
                class="btn"
                :disabled="actionBusy"
                :aria-busy="restarting === row.name"
                @click="kube.restartDeployment(row.name)"
              >
                <Icon
                  :name="restarting === row.name ? 'refresh' : 'play'"
                  :class="{ ikspin: restarting === row.name }"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
                {{ t('infra.kube.act.restart') }}
              </button>
            </template>
          </InfraKubeTable>
          <div v-else-if="search.trim()" class="iknomatch">
            <span class="ihint">{{ t('infra.kube.search.noMatch', { q: search }) }}</span>
            <button type="button" class="btn" @click="search = ''">
              <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.kube.search.clear') }}
            </button>
          </div>
          <p v-else-if="!deploymentsLoading && !deploymentsError" class="ihint">
            {{ t('infra.kube.deploys.empty') }}
          </p>
        </template>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import InfraKubeReport from '~/components/infra/kube/InfraKubeReport.vue'
import type { InfraKubeController, KubeRow } from '~/composables/useInfraKube'

const props = defineProps<{ kube: InfraKubeController }>()
const {
  contexts,
  pinnedCluster,
  restarting,
  deleting,
  namespacesError,
  pods,
  podsLoading,
  podsError,
  deployments,
  deploymentsLoading,
  deploymentsError,
  blocked,
} = props.kube

const kube = props.kube
const { t } = useI18n()

// Tab đang xem là state CỦA MÀN HÌNH (đổi tab không gọi cluster), nên nó sống ở
// đây chứ không ở controller. Ba mục: hai BẢNG của cùng một ngữ cảnh, và mục Báo
// cáo — cùng số liệu đó nhưng nhìn theo chỉ số thay vì từng hàng.
const tab = ref<'pods' | 'deployments' | 'report'>('pods')

/** Từ khoá tìm trong bảng đang xem. Lọc TẠI CHỖ trên hàng đã tải: không RPC nào,
 *  không tốn thêm giây nào của cluster. */
const search = ref('')
const needle = computed(() => search.value.trim().toLowerCase())

function onSearch(e: Event): void {
  const el = e.target
  search.value = el instanceof HTMLInputElement ? el.value : ''
}

/** Khớp ở TÊN hoặc ở bất kỳ ô nào (trạng thái, số lần restart, tuổi…) — gõ
 *  "CrashLoop" phải ra đúng nhóm pod đó, không chỉ khớp tên. */
function matchRow(row: KubeRow): boolean {
  const n = needle.value
  if (!n) return true
  return row.name.toLowerCase().includes(n) || row.cells.some((c) => c.toLowerCase().includes(n))
}

const filteredPods = computed(() => pods.value.filter(matchRow))
const filteredDeployments = computed(() => deployments.value.filter(matchRow))
const totalCount = computed(() =>
  tab.value === 'pods' ? pods.value.length : deployments.value.length,
)
const shownCount = computed(() =>
  tab.value === 'pods' ? filteredPods.value.length : filteredDeployments.value.length,
)
/** Ô tìm kiếm chỉ có nghĩa khi có hàng (hoặc khi đang có từ khoá để mà xoá). */
const showSearch = computed(
  () => tab.value !== 'report' && (search.value !== '' || totalCount.value > 0),
)

function setTab(next: 'pods' | 'deployments' | 'report'): void {
  if (next === tab.value) return
  tab.value = next
  // Từ khoá gõ cho bảng pod mang sang bảng deployment là lọc nhầm một bảng khác —
  // và người dùng sẽ tưởng bảng kia rỗng.
  search.value = ''
}

const busy = computed(
  () => podsLoading.value || deploymentsLoading.value || props.kube.namespacesLoading.value,
)
// Chỉ bảng ĐANG XEM mới hiện trạng thái nạp của nó: nạp pod không làm mờ bảng
// deployment mà người dùng đang đọc.
const activeLoading = computed(() =>
  tab.value === 'pods' ? podsLoading.value : deploymentsLoading.value,
)
/** Có một hành động GHI đang chạy ⇒ khoá mọi nút ghi trong khung. */
const actionBusy = computed(() => !!restarting.value || !!deleting.value)
const activeError = computed(() =>
  tab.value === 'pods' ? podsError.value : deploymentsError.value,
)

// Cột map THEO VỊ TRÍ vào `row.cells`, nên thứ tự ở đây phải khớp đúng thứ tự của
// `kubectl get pods -o wide`: NAME READY STATUS RESTARTS AGE IP NODE (hai cột cuối
// `NOMINATED NODE`/`READINESS GATES` luôn `<none>` trong đời thật nên bỏ — bảng chỉ
// đọc tới cột nào được khai ở đây).
const podColumns = computed(() => [
  t('infra.kube.col.name'),
  t('infra.kube.col.ready'),
  t('infra.kube.col.status'),
  t('infra.kube.col.restarts'),
  t('infra.kube.col.age'),
  t('infra.kube.col.ip'),
  t('infra.kube.col.node'),
])
// `kubectl get deployments -o wide`: NAME READY UP-TO-DATE AVAILABLE AGE CONTAINERS
// IMAGES SELECTOR. Cột map theo VỊ TRÍ nên muốn hiện IMAGES thì phải khai cả
// CONTAINERS đứng trước nó; SELECTOR thì bỏ (một chuỗi label dài, không ai đọc
// trong bảng).
const deployColumns = computed(() => [
  t('infra.kube.col.name'),
  t('infra.kube.col.ready'),
  t('infra.kube.col.upToDate'),
  t('infra.kube.col.available'),
  t('infra.kube.col.age'),
  t('infra.kube.col.containers'),
  t('infra.kube.col.images'),
])
</script>

<style scoped>
/* Hàng đầu (tab + ô tìm kiếm + chỉ dẫn) được phép xuống dòng thay vì kéo rộng
   khung: một dòng phụ vẫn chưa phải cuộn trang. */
.ikmain-head {
  flex-wrap: wrap;
}
/* Ô tìm kiếm không giãn hết chiều ngang: nó là control, không phải vùng đọc. */
.ikfind {
  flex: 0 1 240px;
}
/* Nút xoá nằm TRONG ô nhập: không viền, không nền — nó thuộc về ô, không phải một
   nút ngang hàng với các nút khác trên thanh. */
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
/* Không hàng nào khớp: câu giải thích + đường thoát, cùng một hàng. */
.iknomatch {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px;
}
/* Lệnh bị chặn: một dải ngang, không phải khối dọc — nó là tin nhắn, không phải
   nội dung để đọc lâu. */
/* Nút ở trạng thái rỗng không giãn hết chiều ngang khung. */
.ikempty-btn {
  align-self: flex-start;
}
.ikblock {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.ikblock .iwarn {
  margin: 0;
}
</style>
