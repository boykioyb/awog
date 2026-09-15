<template>
  <!-- Modal "cluster trên máy này": những context có trong kubeconfig + đường thêm
       một cluster EKS. Đây là phần trả lời câu hỏi mà chip trong phiên không trả
       lời được — "máy tôi đang có gì, đọc từ file nào, thêm cái mới bằng cách nào"
       — nên nó nằm ở trang `/infra` chứ không nằm trong phiên (ADR 0088 §7).

       Vì sao là MODAL: đây là việc thỉnh thoảng mới làm, còn màn chính là chỗ xem
       pod/log hằng ngày. Để bảng này trên trang thì nó chiếm chỗ và đẩy trang phải
       cuộn. Thân modal tự cuộn nên bảng dài không đẩy gì phía sau. -->
  <Teleport to="body">
    <div v-if="clustersOpen" class="ikm-ovl" @click.self="kube.closeClusters()">
      <div class="ikm-card" role="dialog" aria-modal="true">
        <div class="ikm-head">
          <span class="ikm-title">
            <Icon name="k8s" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('infra.kube.clusters.title') }}
          </span>
          <span class="iksec-sub">{{ pathsLabel }}</span>
          <div class="ikm-actions">
            <button
              type="button"
              class="btn"
              :disabled="contextsLoading"
              :aria-busy="contextsLoading"
              :title="t('infra.kube.refresh')"
              @click="kube.loadContexts(true)"
            >
              <Icon
                name="refresh"
                :class="{ ikspin: contextsLoading }"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </button>
            <button
              type="button"
              class="btn"
              :title="t('common.close')"
              @click="kube.closeClusters()"
            >
              <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
          </div>
        </div>

        <div class="ikm-body">
          <!-- Máy có kubectl nhưng ngoài allowlist đường dẫn (OrbStack, asdf…) ⇒ một
               cú bấm bảo lãnh ở đây, thay vì phải mở popover của chip trong phiên. -->
          <InfraToolBinaryHint tool="kubectl" />

          <p v-if="contextsError" class="ierr">{{ contextsError }}</p>

          <table v-if="contexts.length" class="ct">
            <thead>
              <tr>
                <th>{{ t('infra.kube.col.context') }}</th>
                <th>{{ t('infra.kube.col.cluster') }}</th>
                <th>{{ t('infra.kube.col.namespace') }}</th>
                <th>{{ t('infra.kube.col.user') }}</th>
                <th>{{ t('infra.kube.col.server') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ctx in contexts"
                :key="ctx.name"
                :class="{ on: ctx.name === pinnedCluster }"
              >
                <td class="ct-name">
                  {{ ctx.name }}
                  <span v-if="ctx.name === pinnedCluster" class="ibadge">
                    {{ t('infra.kube.pinned') }}
                  </span>
                  <span v-else-if="ctx.current" class="ct-cur">{{ t('infra.kube.current') }}</span>
                </td>
                <td>{{ ctx.cluster || '—' }}</td>
                <td>{{ ctx.namespace || t('infra.kube.nsDefault') }}</td>
                <td>{{ ctx.user || '—' }}</td>
                <td class="ct-server">{{ ctx.server || '—' }}</td>
                <td class="ct-act">
                  <!-- Khoá khi bảng chính đang nạp: chọn cluster giữa chừng là
                       cùng cảnh race với ô chọn trên thanh ngữ cảnh. -->
                  <button
                    type="button"
                    class="btn"
                    :disabled="ctx.name === pinnedCluster || workloadBusy"
                    @click="kube.setCluster(ctx.name)"
                  >
                    {{ t('infra.kube.use') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!contextsLoading" class="ihint">
            {{ paths.length ? t('infra.kube.clusters.empty') : t('infra.kube.clusters.noFile') }}
          </p>

          <!-- Thêm cluster: chọn → liệt kê → bấm. Không bước nào phải gõ đường dẫn
               hay tên lệnh. Gập sẵn vì mặc định của modal là "xem máy đang có gì". -->
          <div class="ikadd">
            <div class="ikadd-head">
              <span class="ikadd-title">
                <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
                {{ t('infra.kube.add.head') }}
              </span>
              <!-- Khoá khi đang ghi kubeconfig: gập khối giữa chừng không huỷ được
                   lệnh, chỉ làm người dùng mất dấu nó. -->
              <button
                type="button"
                class="btn"
                :disabled="adding"
                :aria-expanded="addOpen"
                @click="addOpen ? kube.closeAdd() : kube.openAdd()"
              >
                <Icon
                  :name="addOpen ? 'chev' : 'plus'"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
                {{ addOpen ? t('infra.kube.add.collapse') : t('infra.kube.add.open') }}
              </button>
            </div>

            <template v-if="addOpen">
              <div class="ikgrid">
                <div class="ifield">
                  <div class="ilbl">{{ t('infra.kube.add.profile') }}</div>
                  <AppSelect
                    :model-value="profile"
                    :options="profileOptions"
                    :placeholder="t('infra.kube.add.profilePh')"
                    width="100%"
                    :disabled="adding"
                    @update:model-value="kube.setProfile"
                  />
                </div>
                <div class="ifield">
                  <div class="ilbl">{{ t('infra.kube.add.region') }}</div>
                  <AppSelect
                    :model-value="region"
                    :options="regionOptions"
                    :placeholder="t('infra.kube.add.regionPh')"
                    width="100%"
                    :disabled="adding"
                    @update:model-value="kube.setRegion"
                  />
                </div>
                <button
                  type="button"
                  class="btn"
                  :disabled="clustersLoading || adding"
                  :aria-busy="clustersLoading"
                  @click="kube.findClusters()"
                >
                  <Icon
                    :name="clustersLoading ? 'refresh' : 'search'"
                    :class="{ ikspin: clustersLoading }"
                    style="width: var(--icon-sm); height: var(--icon-sm)"
                  />
                  {{ clustersLoading ? t('infra.kube.add.finding') : t('infra.kube.add.find') }}
                </button>
              </div>

              <p v-if="clustersError" class="ierr">{{ clustersError }}</p>

              <div v-if="clusters.length" class="iklist">
                <div v-for="name in clusters" :key="name" class="ikrow">
                  <span class="ikrow-name">{{ name }}</span>
                  <button
                    type="button"
                    class="btn pri"
                    :disabled="adding"
                    :aria-busy="adding"
                    @click="kube.addCluster(name)"
                  >
                    <Icon
                      :name="adding ? 'refresh' : 'plus'"
                      :class="{ ikspin: adding }"
                      style="width: var(--icon-sm); height: var(--icon-sm)"
                    />
                    {{ adding ? t('infra.kube.add.adding') : t('infra.kube.add.run') }}
                  </button>
                </div>
              </div>
              <p v-else-if="!clustersLoading && !clustersError" class="ihint">
                {{ t('infra.kube.add.empty') }}
              </p>

              <p v-if="addError" class="ierr">{{ addError }}</p>

              <!-- Ma trận quyền chặn: hiện đúng dòng lệnh để người dùng tự chạy. -->
              <div v-if="addBlocked">
                <p class="iwarn">{{ addBlocked.reason }}</p>
                <div class="ikcmd">
                  <code>{{ addBlocked.command }}</code>
                  <button type="button" class="btn" @click="kube.copyCommand(addBlocked.command)">
                    {{ t('infra.kube.blocked.copy') }}
                  </button>
                </div>
              </div>

              <p class="ihint">{{ t('infra.kube.add.note') }}</p>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Khối này KHÔNG gọi RPC nào trực tiếp: mọi thứ nằm ở `useInfraKube()` (xem
// composables/useInfraKube.ts). Ở đây chỉ bind và dịch.
import type { InfraKubeController } from '~/composables/useInfraKube'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

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

<style scoped>
.ct {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.ct th {
  text-align: left;
  font-weight: 500;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.ct td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

/* Context đang ghim: tô nền để mắt thấy ngay "lệnh sẽ chạy ở đây". */
.ct tr.on td {
  background: var(--accentDim);
}

.ct-name {
  font-weight: 500;
}

.ct-cur {
  margin-left: 6px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
}

.ct-server {
  /* mono-ok: URL API server, người dùng đối chiếu từng ký tự */
  font-family: var(--code);
  font-size: var(--fs-xs);
  word-break: break-all;
}

.ct-act {
  text-align: right;
  white-space: nowrap;
}

/* Khối "thêm cluster": một khung riêng để mắt tách "máy đang có" khỏi "thêm mới". */
.ikadd {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgSubtle);
}

.ikadd-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Nhãn nhóm trong modal: chữ nhỏ + in hoa nhẹ, giống nhãn nhóm của bảng. */
.ikadd-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ikadd-head .btn {
  margin-left: auto;
}

.iklist {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
}
</style>
