<template>
  <!-- Khối "Workload": hai bảng của cluster + namespace đang ghim.
       Đây là VÙNG CHÍNH của tab một-màn: nó lấp hết chỗ còn lại và chỉ BẢNG bên
       trong được cuộn. Pods và Deployments là hai tab của cùng một chỗ, không phải
       hai khối xếp dọc — xếp dọc là lý do màn cũ phải cuộn.

       Không nạp gì khi chưa có cluster. Nạp khi: người dùng chọn cluster/namespace
       (ý định rõ ràng) hoặc bấm ↻ — luật "không auto-refresh" của
       docs/features/infra-explorer.md cấm nạp sau lưng, không cấm làm theo cú bấm. -->
  <section
    class="flex min-h-0 flex-auto flex-col gap-2 overflow-hidden rounded-xl border bg-muted px-3.5 py-3"
  >
    <!-- Hàng đầu (tab + ô tìm kiếm + chỉ dẫn) được phép xuống dòng thay vì kéo rộng
         khung: một dòng phụ vẫn chưa phải cuộn trang. -->
    <div class="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        class="gap-0.5 rounded-lg bg-background p-0.5"
        :model-value="tab"
        @update:model-value="onTab"
      >
        <ToggleGroupItem value="pods" size="sm" :class="SEG_ITEM">
          {{ t('infra.kube.pods.tab', { n: pods.length }) }}
        </ToggleGroupItem>
        <ToggleGroupItem value="deployments" size="sm" :class="SEG_ITEM">
          {{ t('infra.kube.deploys.tab', { n: deployments.length }) }}
        </ToggleGroupItem>
        <ToggleGroupItem value="report" size="sm" :class="SEG_ITEM">
          {{ t('infra.kube.tab.report') }}
        </ToggleGroupItem>
      </ToggleGroup>

      <!-- Tìm trong bảng ĐANG XEM, lọc tại chỗ trên các hàng đã tải (không gọi
           cluster thêm lần nào). Chỉ hiện khi có hàng để tìm — ô tìm kiếm trên một
           bảng rỗng là thứ bấm vào không ra gì. Không giãn hết chiều ngang: nó là
           control, không phải vùng đọc. -->
      <div v-if="showSearch" class="relative shrink basis-60">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim"
        />
        <Input
          class="h-ctrl-sm pr-8 pl-8"
          :model-value="search"
          type="text"
          spellcheck="false"
          :placeholder="t('infra.kube.search.ph')"
          :aria-label="t('infra.kube.search.ph')"
          @update:model-value="onSearch"
        />
        <!-- Nút xoá nằm TRONG ô nhập: không viền, không nền — nó thuộc về ô, không
             phải một nút ngang hàng với các nút khác trên thanh. -->
        <Button
          v-if="search"
          variant="ghost"
          size="iconSm"
          class="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-faint hover:bg-transparent hover:text-foreground"
          type="button"
          :title="t('infra.kube.search.clear')"
          :aria-label="t('infra.kube.search.clear')"
          @click="search = ''"
        >
          <Icon name="x" />
        </Button>
      </div>

      <span v-if="busy" class="text-xs text-faint">{{ t('infra.kube.loading') }}</span>
      <span v-else-if="search.trim()" class="text-xs text-faint" role="status">
        {{ t('infra.kube.search.showing', { shown: shownCount, total: totalCount }) }}
      </span>
      <!-- Dấu chỉ chỗ bấm được: hàng pod mở khung log/chi tiết, và không có mũi tên
           thì người mới không biết điều đó. -->
      <span v-else-if="tab === 'pods' && pods.length" class="text-xs text-faint">
        {{ t('infra.kube.pods.rowHint') }}
      </span>
    </div>

    <!-- Lệnh bị chặn giữa đường (ma trận quyền, hoặc CLI không dùng được): hiện
         lý do + đúng dòng lệnh để người dùng tự chạy. Không có nút chạy. Một dải
         ngang, không phải khối dọc — nó là tin nhắn, không phải nội dung để đọc lâu. -->
    <div v-if="blocked" class="flex min-w-0 flex-wrap items-center gap-2">
      <p class="text-xs text-warning">{{ blocked.reason }}</p>
      <InfraKubeCmd v-if="blocked.command" :command="blocked.command" @copy="kube.copyCommand" />
      <!-- Không có dòng lệnh nghĩa là lỗi trước khi spawn (hay gặp nhất: kubectl
           ngoài allowlist đường dẫn) ⇒ lối sửa nằm trong modal quản lý cluster. -->
      <Button v-else type="button" variant="outline" @click="kube.openClusters()">
        <Icon name="shield" />
        {{ t('infra.kube.manage.open') }}
      </Button>
    </div>

    <p v-if="namespacesError" class="text-xs text-warning">{{ namespacesError }}</p>

    <!-- Chưa ghim cluster: hai câu khác nhau cho hai tình huống khác nhau. Máy CÓ
         cluster thì chỉ cần chỉ lên thanh trên; máy CHƯA có kubeconfig (lần đầu
         dùng) thì phải chỉ sang modal quản lý, vì ở thanh trên chẳng có gì để chọn. -->
    <p v-if="!pinnedCluster" class="text-xs text-faint">
      {{ contexts.length ? t('infra.kube.workloads.pickFirst') : t('infra.kube.clusters.noFile') }}
    </p>
    <!-- Nút ở trạng thái rỗng không giãn hết chiều ngang khung. -->
    <Button
      v-if="!pinnedCluster && !contexts.length"
      type="button"
      class="self-start"
      variant="outline"
      @click="kube.openClusters()"
    >
      <Icon name="plus" />
      {{ t('infra.kube.manage.open') }}
    </Button>

    <template v-else>
      <p v-if="activeError" class="text-xs text-destructive">{{ activeError }}</p>

      <!-- Mục Báo cáo dùng CHUNG vùng này nhưng là cách nhìn khác: số liệu tổng
           hợp + theo dõi. `v-if` (không phải `v-show`) là cố ý — rời mục là component
           bị tháo, và vòng theo dõi (nếu đang bật) dừng theo. -->
      <InfraKubeReport v-if="tab === 'report'" :kube="kube" />

      <!-- Đang nạp: có hàng cũ thì giữ nguyên và LÀM MỜ (đổi namespace nhìn thấy
           ngay là dữ liệu đang được thay), chưa có hàng nào thì hiện khung xương.
           Trước đây cả hai trường hợp đều là thân trắng, không phân biệt được với
           "không có pod nào". -->
      <!-- Bảng nằm TRỰC TIẾP trên nền khối nên tự nâng mình lên card. Chỉ BẢNG cuộn,
           phần đầu khung thì đứng yên. -->
      <div
        v-else
        class="min-h-0 flex-auto overflow-x-hidden overflow-y-auto rounded-xl border bg-card shadow-sm"
        :class="activeLoading && 'pointer-events-none opacity-40 transition-opacity'"
      >
        <template v-if="tab === 'pods'">
          <InfraKubeTableSkeleton v-if="activeLoading && !pods.length" />
          <InfraKubeTable
            v-else-if="filteredPods.length"
            :columns="podColumns"
            :rows="filteredPods"
            :clickable="!activeLoading"
            @row="kube.openLogs"
          />
          <div v-else-if="search.trim()" :class="NO_MATCH">
            <span class="text-xs text-faint">
              {{ t('infra.kube.search.noMatch', { q: search }) }}
            </span>
            <Button type="button" variant="outline" @click="search = ''">
              <Icon name="x" />
              {{ t('infra.kube.search.clear') }}
            </Button>
          </div>
          <p v-else-if="!podsLoading && !podsError" :class="EMPTY">
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
              <Button
                type="button"
                :disabled="actionBusy"
                :aria-busy="restarting === row.name"
                variant="outline"
                @click="kube.restartDeployment(row.name)"
              >
                <Icon
                  :name="restarting === row.name ? 'refresh' : 'play'"
                  :class="{ 'motion-safe:animate-spin': restarting === row.name }"
                />
                {{ t('infra.kube.act.restart') }}
              </Button>
            </template>
          </InfraKubeTable>
          <div v-else-if="search.trim()" :class="NO_MATCH">
            <span class="text-xs text-faint">
              {{ t('infra.kube.search.noMatch', { q: search }) }}
            </span>
            <Button type="button" variant="outline" @click="search = ''">
              <Icon name="x" />
              {{ t('infra.kube.search.clear') }}
            </Button>
          </div>
          <p v-else-if="!deploymentsLoading && !deploymentsError" :class="EMPTY">
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

/** Một mục của segmented control: track nhạt, mục đang chọn nổi lên như card. */
const SEG_ITEM =
  'h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm'
/** Không hàng nào khớp: câu giải thích + đường thoát, cùng một hàng. */
const NO_MATCH = 'flex flex-wrap items-center gap-2 p-2.5'
/** Bảng rỗng (không phải do lọc). */
const EMPTY = 'p-2.5 text-xs text-faint'

/** ToggleGroup phát rỗng khi bấm lại mục đang chọn — bỏ qua (giống `setTab` no-op). */
function onTab(v: unknown): void {
  if (v === 'pods' || v === 'deployments' || v === 'report') setTab(v)
}

// Tab đang xem là state CỦA MÀN HÌNH (đổi tab không gọi cluster), nên nó sống ở
// đây chứ không ở controller. Ba mục: hai BẢNG của cùng một ngữ cảnh, và mục Báo
// cáo — cùng số liệu đó nhưng nhìn theo chỉ số thay vì từng hàng.
const tab = ref<'pods' | 'deployments' | 'report'>('pods')

/** Từ khoá tìm trong bảng đang xem. Lọc TẠI CHỖ trên hàng đã tải: không RPC nào,
 *  không tốn thêm giây nào của cluster. */
const search = ref('')
const needle = computed(() => search.value.trim().toLowerCase())

function onSearch(v: string): void {
  search.value = v
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
