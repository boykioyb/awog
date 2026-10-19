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
  <div class="flex size-full min-h-0 flex-col gap-2.5 overflow-hidden px-4 pt-2.5 pb-3.5">
    <!-- Thanh ngữ cảnh là một CARD, và ba nút bên phải là MỘT cụm nên chúng không
         bị tách rời nhau khi hàng xuống dòng. Nhãn-trên-control ⇒ căn theo ĐÁY để
         các ô không lệch nhau theo trục dọc. -->
    <div
      class="flex flex-none flex-wrap items-end gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm"
    >
      <div class="flex min-w-35 flex-initial basis-65 flex-col gap-1">
        <div class="text-xs text-muted-foreground">{{ t('infra.kube.col.cluster') }}</div>
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

      <div class="flex min-w-35 flex-initial basis-65 flex-col gap-1">
        <div class="text-xs text-muted-foreground">{{ t('infra.kube.col.namespace') }}</div>
        <AppSelect
          :model-value="pinnedNamespace"
          :options="namespaceOptions"
          :placeholder="t('infra.kube.nsDefault')"
          width="100%"
          :disabled="!pinnedCluster || busy"
          @update:model-value="kube.setNamespace"
        />
      </div>

      <div class="ml-auto flex flex-none flex-wrap items-center gap-1.5">
        <!-- Bảng context + đường thêm cluster: việc thỉnh thoảng mới làm, nên nằm
             trong modal. Số bên cạnh là số context máy này đọc được. -->
        <Button type="button" :title="pathsLabel" variant="outline" @click="kube.openClusters()">
          <Icon name="k8s" class="size-3.5" />
          {{ t('infra.kube.manage.open') }}
          <Badge
            v-if="contexts.length"
            variant="secondary"
            class="bg-selected px-1.5 py-0 font-normal text-muted-foreground tabular-nums"
          >
            {{ contexts.length }}
          </Badge>
        </Button>

        <!-- Icon quay theo `busy`: nút vô hiệu mà đứng im thì người dùng không phân
             biệt được "đang nạp" với "nút hỏng". -->
        <Button
          type="button"
          :disabled="!pinnedCluster || busy"
          :aria-busy="busy"
          :title="t('infra.kube.refresh')"
          :aria-label="t('infra.kube.refresh')"
          variant="outline"
          size="icon"
          @click="kube.refreshWorkload()"
        >
          <Icon name="refresh" class="size-3.5" :class="{ 'animate-spin': busy }" />
        </Button>

        <!-- Chú thích dài (danh tính kubectl dùng, nhật ký hoạt động) không chiếm
             chỗ trên màn: một cú bấm là thấy, bấm ra ngoài hoặc Esc là gập. -->
        <Popover v-model:open="noteOpen">
          <PopoverTrigger as-child>
            <Button
              type="button"
              :title="t('infra.kube.footnote.title')"
              :aria-label="t('infra.kube.footnote.title')"
              variant="outline"
              size="icon"
            >
              <Icon name="info" class="size-3.5" />
            </Button>
          </PopoverTrigger>
          <!-- Giữ role="dialog" mặc định của reka: OVERLAYS (useEmbeddedBrowser.ts) bắt
               `[role="dialog"][data-state="open"]` để trình duyệt nhúng nhường chỗ. -->
          <PopoverContent align="end" class="w-85 max-w-[84vw] px-3 py-2.5">
            <p class="m-0 text-xs leading-relaxed whitespace-normal text-muted-foreground">
              {{ t('infra.kube.footnote') }}
            </p>
          </PopoverContent>
        </Popover>
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
import Button from '~/components/ui/button/Button.vue'

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
// là một widget riêng phải tự tắt. `Popover` (reka) tự lo cả hai việc đó.
const noteOpen = ref(false)
</script>
