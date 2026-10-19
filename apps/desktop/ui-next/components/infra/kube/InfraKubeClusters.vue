<template>
  <!-- Modal "cluster trên máy này": những context có trong kubeconfig + đường thêm
       một cluster EKS. Đây là phần trả lời câu hỏi mà chip trong phiên không trả
       lời được — "máy tôi đang có gì, đọc từ file nào, thêm cái mới bằng cách nào"
       — nên nó nằm ở trang `/infra` chứ không nằm trong phiên (ADR 0088 §7).

       Vì sao là MODAL: đây là việc thỉnh thoảng mới làm, còn màn chính là chỗ xem
       pod/log hằng ngày. Để bảng này trên trang thì nó chiếm chỗ và đẩy trang phải
       cuộn. Thân modal tự cuộn nên bảng dài không đẩy gì phía sau.
       Esc / bấm nền / nút ✕ (DialogContent tự vẽ) đều gọi `closeClusters()`. -->
  <Dialog :open="clustersOpen" @update:open="(v: boolean) => !v && kube.closeClusters()">
    <DialogContent
      :aria-describedby="undefined"
      class="flex max-h-[min(47.5rem,88vh)] w-[94vw] max-w-245 min-h-0 flex-col gap-0 overflow-hidden p-0"
    >
      <div class="flex min-w-0 shrink-0 items-center gap-2 border-b py-3 pr-12 pl-3.5">
        <DialogTitle class="inline-flex shrink-0 items-center gap-1.5 text-base font-semibold">
          <Icon name="k8s" class="size-3.5" />
          {{ t('infra.kube.clusters.title') }}
        </DialogTitle>
        <span class="min-w-0 truncate text-xs text-muted-foreground">{{ pathsLabel }}</span>
        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            :disabled="contextsLoading"
            :aria-busy="contextsLoading"
            :title="t('infra.kube.refresh')"
            :aria-label="t('infra.kube.refresh')"
            variant="outline"
            size="iconMd"
            @click="kube.loadContexts(true)"
          >
            <Icon name="refresh" :class="{ 'motion-safe:animate-spin': contextsLoading }" />
          </Button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-3 pb-3.5">
        <!-- Máy có kubectl nhưng ngoài allowlist đường dẫn (OrbStack, asdf…) ⇒ một
             cú bấm bảo lãnh ở đây, thay vì phải mở popover của chip trong phiên. -->
        <InfraToolBinaryHint tool="kubectl" />

        <p v-if="contextsError" class="text-xs text-destructive">{{ contextsError }}</p>

        <Table v-if="contexts.length">
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead :class="HEAD">{{ t('infra.kube.col.context') }}</TableHead>
              <TableHead :class="HEAD">{{ t('infra.kube.col.cluster') }}</TableHead>
              <TableHead :class="HEAD">{{ t('infra.kube.col.namespace') }}</TableHead>
              <TableHead :class="HEAD">{{ t('infra.kube.col.user') }}</TableHead>
              <TableHead :class="HEAD">{{ t('infra.kube.col.server') }}</TableHead>
              <TableHead :class="HEAD" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <!-- Context đang ghim: tô nền để mắt thấy ngay "lệnh sẽ chạy ở đây". -->
            <TableRow
              v-for="ctx in contexts"
              :key="ctx.name"
              class="data-[state=selected]:bg-selected"
              :data-state="ctx.name === pinnedCluster ? 'selected' : undefined"
            >
              <TableCell :class="[CELL, 'font-medium']">
                {{ ctx.name }}
                <Badge
                  v-if="ctx.name === pinnedCluster"
                  variant="outline"
                  class="ml-1 text-muted-foreground"
                >
                  {{ t('infra.kube.pinned') }}
                </Badge>
                <span v-else-if="ctx.current" class="ml-1.5 text-xs text-faint">
                  {{ t('infra.kube.current') }}
                </span>
              </TableCell>
              <TableCell :class="CELL">{{ ctx.cluster || '—' }}</TableCell>
              <TableCell :class="CELL">{{ ctx.namespace || t('infra.kube.nsDefault') }}</TableCell>
              <TableCell :class="CELL">{{ ctx.user || '—' }}</TableCell>
              <!-- mono-ok: URL API server, người dùng đối chiếu từng ký tự -->
              <TableCell :class="[CELL, 'font-mono text-xs break-all']">
                {{ ctx.server || '—' }}
              </TableCell>
              <TableCell :class="[CELL, 'text-right whitespace-nowrap']">
                <!-- Khoá khi bảng chính đang nạp: chọn cluster giữa chừng là
                     cùng cảnh race với ô chọn trên thanh ngữ cảnh. -->
                <Button
                  type="button"
                  :disabled="ctx.name === pinnedCluster || workloadBusy"
                  variant="outline"
                  @click="kube.setCluster(ctx.name)"
                >
                  {{ t('infra.kube.use') }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else-if="!contextsLoading" class="text-xs text-faint">
          {{ paths.length ? t('infra.kube.clusters.empty') : t('infra.kube.clusters.noFile') }}
        </p>

        <!-- Thêm cluster: chọn → liệt kê → bấm. Không bước nào phải gõ đường dẫn
             hay tên lệnh. Gập sẵn vì mặc định của modal là "xem máy đang có gì".
             Một khung riêng để mắt tách "máy đang có" khỏi "thêm mới". -->
        <div class="flex flex-col gap-2 rounded-xl border bg-muted p-3">
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
            >
              <Icon name="plus" class="size-3.5" />
              {{ t('infra.kube.add.head') }}
            </span>
            <!-- Khoá khi đang ghi kubeconfig: gập khối giữa chừng không huỷ được
                 lệnh, chỉ làm người dùng mất dấu nó. -->
            <Button
              type="button"
              class="ml-auto"
              :disabled="adding"
              :aria-expanded="addOpen"
              variant="outline"
              @click="addOpen ? kube.closeAdd() : kube.openAdd()"
            >
              <Icon :name="addOpen ? 'chev' : 'plus'" />
              {{ addOpen ? t('infra.kube.add.collapse') : t('infra.kube.add.open') }}
            </Button>
          </div>

          <template v-if="addOpen">
            <!-- Hàng ô chọn: ô co giãn, nút giữ nguyên. -->
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex min-w-0 flex-[1_1_10rem] flex-col gap-1.5">
                <Label class="text-sm font-normal text-dim">
                  {{ t('infra.kube.add.profile') }}
                </Label>
                <AppSelect
                  :model-value="profile"
                  :options="profileOptions"
                  :placeholder="t('infra.kube.add.profilePh')"
                  width="100%"
                  :disabled="adding"
                  @update:model-value="kube.setProfile"
                />
              </div>
              <div class="flex min-w-0 flex-[1_1_10rem] flex-col gap-1.5">
                <Label class="text-sm font-normal text-dim">{{ t('infra.kube.add.region') }}</Label>
                <AppSelect
                  :model-value="region"
                  :options="regionOptions"
                  :placeholder="t('infra.kube.add.regionPh')"
                  width="100%"
                  :disabled="adding"
                  @update:model-value="kube.setRegion"
                />
              </div>
              <Button
                type="button"
                :disabled="clustersLoading || adding"
                :aria-busy="clustersLoading"
                variant="outline"
                @click="kube.findClusters()"
              >
                <Icon
                  :name="clustersLoading ? 'refresh' : 'search'"
                  :class="{ 'motion-safe:animate-spin': clustersLoading }"
                />
                {{ clustersLoading ? t('infra.kube.add.finding') : t('infra.kube.add.find') }}
              </Button>
            </div>

            <p v-if="clustersError" class="text-xs text-destructive">{{ clustersError }}</p>

            <!-- Danh sách cluster EKS tìm được: mỗi dòng một tên + nút thêm. -->
            <div v-if="clusters.length" class="flex max-h-65 flex-col overflow-y-auto">
              <div
                v-for="name in clusters"
                :key="name"
                class="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-b-0"
              >
                <span class="min-w-0 flex-1 truncate text-sm text-foreground">{{ name }}</span>
                <Button
                  type="button"
                  :disabled="adding"
                  :aria-busy="adding"
                  variant="default"
                  @click="kube.addCluster(name)"
                >
                  <Icon
                    :name="adding ? 'refresh' : 'plus'"
                    :class="{ 'motion-safe:animate-spin': adding }"
                  />
                  {{ adding ? t('infra.kube.add.adding') : t('infra.kube.add.run') }}
                </Button>
              </div>
            </div>
            <p v-else-if="!clustersLoading && !clustersError" class="text-xs text-faint">
              {{ t('infra.kube.add.empty') }}
            </p>

            <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>

            <!-- Ma trận quyền chặn: hiện đúng dòng lệnh để người dùng tự chạy. -->
            <div v-if="addBlocked" class="flex flex-col gap-2">
              <p class="text-xs text-warning">{{ addBlocked.reason }}</p>
              <InfraKubeCmd :command="addBlocked.command" @copy="kube.copyCommand" />
            </div>

            <p class="text-xs text-faint">{{ t('infra.kube.add.note') }}</p>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Khối này KHÔNG gọi RPC nào trực tiếp: mọi thứ nằm ở `useInfraKube()` (xem
// composables/useInfraKube.ts). Ở đây chỉ bind và dịch.
import type { InfraKubeController } from '~/composables/useInfraKube'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ kube: InfraKubeController }>()
// Bóc ref ra binding top-level để template tự unwrap (ref lồng trong object không
// được unwrap). `kube` là object ổn định do component cha tạo một lần.
const {
  contexts,
  paths,
  contextsLoading,
  contextsError,
  pinnedCluster,
  clustersOpen,
  addOpen,
  profiles,
  profile,
  region,
  clusters,
  clustersLoading,
  clustersError,
  adding,
  addError,
  addBlocked,
  regionOptions,
  workloadBusy,
} = props.kube

const { t } = useI18n()

/** Ô tiêu đề / ô dữ liệu của bảng context — chữ nhỏ, căn ĐỈNH vì tên context dài
 *  xuống dòng thì các cột một dòng không bị đẩy xuống giữa. */
const HEAD = 'h-auto px-2.5 py-1.5 text-xs font-medium whitespace-nowrap'
const CELL = 'px-2.5 py-1.5 align-top text-foreground'

const pathsLabel = computed(() =>
  paths.value.length ? t('infra.kube.from', { paths: paths.value.join(' · ') }) : '',
)
const profileOptions = computed<AppSelectOption[]>(() =>
  profiles.value.map((name) => ({ label: name, value: name })),
)

// Hàm/handler gọi thẳng qua `kube` (`kube.setCluster`, `kube.addCluster`…) — chúng
// không phải ref nên không cần bóc, và để nguyên đường dẫn giúp thấy rõ khối này
// dùng đúng chừng ấy API của controller.
const kube = props.kube

// Esc đóng modal: lớp phủ không có nút Esc nào khác, và một modal không tắt được
// bằng bàn phím là modal bắt người dùng với tay ra chuột.
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && clustersOpen.value) kube.closeClusters()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>
