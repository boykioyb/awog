<template>
  <!-- Tab Kubernetes của `/infra` — BỐ CỤC MỘT MÀN.
       Vì sao tab này tồn tại (và vì sao nó KHÔNG thay chip trong phiên): chip trả
       lời "phiên này nói chuyện với cluster nào"; tab trả lời "máy tôi có cluster
       nào · kubeconfig đọc từ đâu · thêm cluster bằng cách nào · trong cluster có
       gì". Việc ghim ngữ cảnh cho một phiên vẫn chỉ làm được ở chip của phiên đó
       (ADR 0088 §7).

       Hình dạng: MỘT thanh ngữ cảnh (chọn cluster · chọn namespace · mở modal
       quản lý · ↻ · chú thích) + MỘT khung bảng lấp hết phần còn lại. Trang không
       cuộn; chỉ bảng (và thân modal) cuộn bên trong khung của nó. Mọi thứ từng
       xếp dọc ở đây đã dồn vào hai lớp phủ: quản lý cluster và output pod.

       SFC này chỉ ghép khối + giữ controller. Mọi state/lời gọi RPC nằm ở
       `useInfraKube()` (khuôn page-controller của .claude/rules/nuxt-vue.md). -->
  <div class="ik">
    <div class="iktool">
      <div class="ifield">
        <div class="ilbl">{{ t('infra.kube.col.cluster') }}</div>
        <!-- Khoá trong lúc bảng đang nạp: đổi cluster giữa chừng là cảnh race thật
             (dữ liệu cluster cũ về muộn). Controller cũng chặn ở tầng logic bằng
             "thế hệ" ngữ cảnh, đây là lớp thứ hai để người dùng không rơi vào đó. -->
        <AppSelect
          :model-value="pinnedCluster"
          :options="contextOptions"
          :placeholder="t('infra.kube.workloads.noCluster')"
          width="100%"
          :disabled="busy"
          @update:model-value="kube.setCluster"
        />
      </div>

      <div class="ifield">
        <div class="ilbl">{{ t('infra.kube.col.namespace') }}</div>
        <AppSelect
          :model-value="pinnedNamespace"
          :options="namespaceOptions"
          :placeholder="t('infra.kube.nsDefault')"
          width="100%"
          :disabled="!pinnedCluster || busy"
          @update:model-value="kube.setNamespace"
        />
      </div>

      <!-- Bảng context + đường thêm cluster: việc thỉnh thoảng mới làm, nên nằm
           trong modal. Số bên cạnh là số context máy này đọc được. -->
      <button type="button" class="btn" :title="pathsLabel" @click="kube.openClusters()">
        <Icon name="k8s" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.kube.manage.open') }}
        <span v-if="contexts.length" class="ikcount">{{ contexts.length }}</span>
      </button>

      <!-- Icon quay theo `busy`: nút vô hiệu mà đứng im thì người dùng không phân
           biệt được "đang nạp" với "nút hỏng". -->
      <button
        type="button"
        class="btn"
        :disabled="!pinnedCluster || busy"
        :aria-busy="busy"
        :title="t('infra.kube.refresh')"
        @click="kube.refreshWorkload()"
      >
        <Icon
          name="refresh"
          :class="{ ikspin: busy }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
      </button>

      <!-- Chú thích dài (danh tính kubectl dùng, nhật ký hoạt động) không chiếm chỗ
           trên màn: một cú bấm là thấy, bấm ra ngoài là gập. -->
      <div ref="noteWrapRef" class="iknotewrap">
        <button
          type="button"
          class="btn"
          :title="t('infra.kube.footnote.title')"
          :aria-expanded="noteOpen"
          @click="noteOpen = !noteOpen"
        >
          <Icon name="info" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <div v-if="noteOpen" class="smenu iknote" role="note">
          <p class="iknotetxt">{{ t('infra.kube.footnote') }}</p>
        </div>
      </div>
    </div>

    <InfraKubeWorkloads :kube="kube" />

    <!-- Hai lớp phủ của tab. Cả hai Teleport ra body nên chúng không nằm trong dòng
         chảy của trang: mở chúng không đẩy gì và không làm trang cuộn. -->
    <InfraKubeClusters :kube="kube" />
    <InfraKubeOutPane :kube="kube" />
  </div>
</template>

<script setup lang="ts">
import { useInfraKube } from '~/composables/useInfraKube'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

const { t } = useI18n()
// MỘT controller cho cả tab: truyền xuống các khối con dưới dạng prop thay vì gọi
// `useInfraKube()` ở mỗi nơi — gọi hai lần là hai bản state, và hai bản state ở
// cùng một màn nghĩa là bảng pod và ô chọn namespace nói về hai thứ khác nhau.
const kube = useInfraKube()

const { contexts, paths, pinnedCluster, pinnedNamespace, namespaces } = kube

/**
 * Giá trị đang GHIM phải luôn có mặt trong danh sách chọn.
 *
 * Cả hai danh sách đều đến từ một lượt đọc (`~/.kube/config`, `kubectl get
 * namespaces`). Lượt đó hỏng, hoặc bị quyền hạn chế, thì giá trị đang ghim không
 * nằm trong danh sách — ô chọn khi đó hiện placeholder ("chưa chọn cluster" / "theo
 * context") trong khi app VẪN đang nói chuyện với cluster/namespace đó. Người dùng
 * đọc được một ngữ cảnh khác hẳn sự thật.
 */
function withPinned(options: AppSelectOption[], pinned: string): AppSelectOption[] {
  if (!pinned || options.some((o) => o.value === pinned)) return options
  return [{ label: pinned, value: pinned }, ...options]
}

const contextOptions = computed<AppSelectOption[]>(() =>
  withPinned(
    contexts.value.map((ctx) => ({ label: ctx.name, value: ctx.name })),
    pinnedCluster.value,
  ),
)
// Namespace rỗng = "theo context" (kubectl tự dùng namespace khai trong context).
const namespaceOptions = computed<AppSelectOption[]>(() =>
  withPinned(
    [
      { label: t('infra.kube.nsDefault'), value: '' },
      ...namespaces.value.map((name) => ({ label: name, value: name })),
    ],
    pinnedNamespace.value,
  ),
)
const pathsLabel = computed(() =>
  paths.value.length ? t('infra.kube.from', { paths: paths.value.join(' · ') }) : '',
)
// Nguồn duy nhất cho "đang nạp bảng": controller giữ nó, thanh ngữ cảnh chỉ đọc.
const busy = kube.workloadBusy

// Popover ⓘ: đóng khi bấm ra ngoài hoặc Esc — người dùng không phải đoán rằng nó
// là một widget riêng phải tự tắt.
const noteOpen = ref(false)
const noteWrapRef = useTemplateRef<HTMLElement>('noteWrapRef')

function onWindowMousedown(e: MouseEvent): void {
  const target = e.target
  if (!(target instanceof Node)) return
  if (noteOpen.value && !noteWrapRef.value?.contains(target)) noteOpen.value = false
}
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') noteOpen.value = false
}

onMounted(() => {
  window.addEventListener('mousedown', onWindowMousedown)
  window.addEventListener('keydown', onWindowKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowMousedown)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>
