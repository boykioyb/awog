<template>
  <section class="page on" data-page="infra">
    <div class="infra-shell">
      <!-- ĐIỀU HƯỚNG HAI TẦNG (2026-09-15). Trước đó là MỘT hàng 12 tab phẳng —
           ở cỡ cửa sổ thường nó xuống hai dòng, và hàng thứ hai trông như một
           thanh khác chứ không phải phần tiếp của thanh thứ nhất.

           Tầng 1 = SÁU NHÓM theo CÂU HỎI người dùng đang hỏi, không theo dịch vụ AWS:
             · Tổng quan  — "mọi thứ có ổn không"
             · Tài nguyên — "tôi đang có những gì"      (Dịch vụ · Topology · Kubernetes)
             · Sức khoẻ   — "nó đang chạy thế nào"      (Giám sát · Bảng · Logs)
             · Chi phí    — "tốn bao nhiêu, bỏ được gì"
             · Thay đổi   — "ai vừa đổi gì"             (Triển khai · Nhật ký · Báo cáo)
             · Tài khoản  — "tôi đang đứng ở account nào"

           Tầng 2 chỉ hiện khi nhóm có NHIỀU HƠN MỘT màn. Nhóm một màn (Tổng quan ·
           Chi phí · Tài khoản) không sinh ra một hàng chứa đúng một nút — đó là
           chrome không mang tin.

           `tab` VẪN LÀ NGUỒN SỰ THẬT, nhóm chỉ suy ra từ nó. Mọi đường vào sẵn có
           (`requestGraphOpen` từ /playbooks, khoảng thời gian gieo từ Logs sang Giám
           sát) đều gọi `selectTab` và không cần biết nhóm tồn tại.

           NHỚ MÀN CUỐI CỦA MỖI NHÓM: quay lại "Sức khoẻ" thì về đúng màn vừa xem,
           không phải luôn nhảy về màn đầu nhóm.

           Mount lười giữ nguyên cho mọi tab dữ liệu: mở /infra không được gọi
           `describe-log-groups` hay một lô metric chỉ vì một tab tồn tại. -->
      <!-- Hàng trên của trang: nhóm (bên trái) + thanh ngữ cảnh AWS (bên phải).
           Thanh ngữ cảnh nằm NGOÀI `role="tablist"`: nó không phải một tab, và
           nhét một control khác loại vào trong tablist là nói dối screen reader. -->
      <div class="infra-top">
        <div class="infra-sections" role="tablist" :aria-label="t('infra.nav.label')">
          <button
            v-for="g in GROUPS"
            :key="g.id"
            class="infra-section-tab"
            :class="{ active: activeGroup === g.id }"
            type="button"
            role="tab"
            :aria-selected="activeGroup === g.id"
            @click="selectGroup(g.id)"
          >
            <Icon :name="GROUP_ICONS[g.id]" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t(`infra.nav.${g.id}`) }}
          </button>
        </div>

        <!-- Đơn giản / Chuyên sâu — MỘT công tắc, một lựa chọn nhớ chung cho cả khu
             (`useInfraMode`, kèm luật Đọc-được / Chính-xác).

             CHỈ HIỆN Ở TAB NÓ THẬT SỰ ĐỔI THỨ GÌ ĐÓ. Bản 2026-09-16 cho nó lên
             thanh đầu ở MỌI tab, và người dùng bác ngay: "không thấy sự khác biệt
             ở đâu trong khi nó lại nằm ở global page". Đúng — chín trên mười hai
             màn không có định danh máy nào để rút gọn, nên ở đó nó là một cái nút
             bấm không làm gì. Lựa chọn vẫn dùng chung và vẫn được nhớ; chỉ cái
             CONTROL là đi theo nơi nó có tác dụng. -->
        <div
          v-if="MODE_TABS.includes(tab)"
          class="seg infra-mode"
          role="tablist"
          :aria-label="t('infra.mode.label')"
        >
          <span
            v-for="m in ['simple', 'expert'] as const"
            :key="m"
            :class="{ on: mode === m }"
            role="tab"
            :aria-selected="mode === m"
            :title="t(`infra.mode.${m}Why`)"
            @click="setMode(m)"
          >
            {{ t(`infra.mode.${m}`) }}
          </span>
        </div>

        <!-- Tài khoản + region dùng cho MỌI thứ bên dưới (bảng tài nguyên, danh
             mục, Logs, Kubernetes). Đặt ở hàng tab vì đây là chỗ duy nhất trên
             trang luôn hiển thị, ở mọi tab. -->
        <InfraContextBar
          :profiles="allProfiles"
          :profile="defaultProfile"
          :region="pinnedRegion"
          :loading="loading"
          :error="error"
          @select-profile="setDefaultProfile"
          @select-region="setRegion"
          @manage="selectTab('accounts')"
        />
      </div>

      <!-- Tầng 2. Chỉ tồn tại khi nhóm có nhiều hơn một màn — xem comment trên. -->
      <div
        v-if="subTabs.length > 1"
        class="infra-subs"
        role="tablist"
        :aria-label="t(`infra.nav.${activeGroup}`)"
      >
        <button
          v-for="item in subTabs"
          :key="item"
          class="infra-sub-tab"
          :class="{ active: tab === item }"
          type="button"
          role="tab"
          :aria-selected="tab === item"
          @click="selectTab(item)"
        >
          <Icon :name="TAB_ICONS[item]" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t(`infra.tab.${item}`) }}
        </button>
      </div>

      <div class="infra-body">
        <div v-show="tab === 'overview'" class="infra-pane">
          <InfraOverview @open-logs="onOpenLogs" />
        </div>

        <!-- Tab "Dịch vụ": danh mục mở ra TRƯỚC (mặc định), chọn một dịch vụ thì
             danh mục nhường chỗ cho bảng của chính khung Explorer — cột dịch vụ đã
             ghim vẫn nguyên ở bên trái. Hai mặt nằm trong cùng một tab nên không có
             cú nhảy tab nào ở giữa. -->
        <div v-show="tab === 'services'" class="infra-pane">
          <InfraServicesCatalog
            v-if="servicesMounted"
            v-show="catalogOpen"
            :services="services"
            :groups="groups"
            :pinned="pinnedServices"
            :in-use="inUseServices"
            :row-hits="rowHits"
            :closable="openedView"
            :loading="catalogLoading"
            :error="catalogError"
            :mock="catalogMock"
            @pin="togglePin"
            @open-target="onServiceTarget"
            @open-view="onServiceView"
            @console="openUrl"
            @close="catalogOpen = false"
            @retry="retryCatalog"
          />
          <InfraExplorer
            v-if="servicesMounted"
            v-show="!catalogOpen"
            ref="explorerRef"
            @open-catalog="openCatalog"
            @open-tab="selectTab"
            @rows="onRowsChanged"
          />
        </div>

        <!-- Tab "Topology" (Mốc 5): graph kiến trúc & luồng request. KHÔNG mount
             lười như Logs/CICD/K8s — và cũng không cần: `useInfraGraph` cố ý không
             tự chạy (không `onMounted`/`watch` nào gọi resolver sau lưng người dùng),
             nên mount sẵn không tốn một lệnh CLI nào cho tới cú bấm đầu tiên. -->
        <div v-show="tab === 'graph'" class="infra-pane">
          <InfraGraph @open-logs="onOpenNodeLogs" />
        </div>

        <div v-if="auditMounted" v-show="tab === 'audit'" class="infra-pane">
          <InfraAuditLog />
        </div>

        <div v-if="logsMounted" v-show="tab === 'logs'" class="infra-pane">
          <InfraLogs :seed="logsSeed" />
        </div>

        <!-- Tab "Giám sát" (Mốc 6, 6.3–6.4) đứng NGAY SAU Logs: hai màn chia sẻ một
             trục thời gian và đổi khoảng cho nhau (`useInfraWindowSync`), nên cặp
             phải nằm cạnh nhau mới tìm thấy. Mount lười như Logs — `useInfraMetrics`
             cố ý không tự nạp (mỗi lượt nạp là một lô `get-metric-data` tính tiền
             theo số metric × số điểm), nhưng nó VẪN đăng ký một watcher nhận khoảng
             gieo từ Logs, và watcher đó chỉ sống khi màn này đã mount. -->
        <div v-if="monitoringMounted" v-show="tab === 'monitoring'" class="infra-pane">
          <InfraMonitoring />
        </div>

        <!-- Tab "Bảng điều khiển" (Mốc 6, M4): bảng tự lắp + ba mẫu dựng sẵn. Đứng
             NGAY SAU Giám sát vì nó là chỗ những biểu đồ ghim từ đó đi tới. Mount
             lười cùng luật với các tab dữ liệu khác; `useInfraDashboards` cấm tự nạp
             số liệu, nên mở tab chỉ đọc file chứ không gọi `get-metric-data`. -->
        <div v-if="dashboardsMounted" v-show="tab === 'dashboards'" class="infra-pane">
          <InfraDashboards />
        </div>

        <!-- Tab "Chi phí" (Mốc 7, 7.1–7.3): tháng này · dự báo · dò lãng phí · sinh
             playbook dọn dẹp. Đứng SAU Bảng điều khiển vì nó trả lời câu hỏi tiếp theo
             của cùng một người: "cái gì đang tốn, và bỏ được cái nào". -->
        <!-- Ba tab con dùng CHUNG một instance: `useInfraCost()` là singleton cấp
             module nên tách thành ba instance cũng vẫn một kho, nhưng một instance
             thì cổng kiểm tài khoản và chip câu hỏi chỉ tồn tại một bản. -->
        <div v-if="costMounted" v-show="COST_TABS.includes(tab)" class="infra-pane">
          <InfraCost :view="costView" />
        </div>

        <!-- Tab "Kế hoạch" — playbook. Đứng trong nhóm Thay đổi vì nó là thứ TẠO RA
             thay đổi, cạnh Triển khai · Nhật ký · Báo cáo. Trước 2026-09-15 là trang
             riêng `/playbooks` trên nav rail. -->
        <div v-if="playbooksMounted" v-show="tab === 'playbooks'" class="infra-pane">
          <InfraPlaybooks />
        </div>

        <!-- Tab "Báo cáo" (Mốc 6, 6.6): danh mục bốn loại. Mount lười vì màn này
             hỏi sidecar danh mục ngay khi mount; không có tab thì không có lời gọi. -->
        <div v-if="reportsMounted" v-show="tab === 'reports'" class="infra-pane">
          <InfraReports />
        </div>

        <!-- Tab "Triển khai" (Mốc 4): bảng xuyên nguồn GitHub Actions · CodePipeline
             · CodeBuild · Amplify. Mount lười cùng lý do với Logs: mở `/infra`
             không được chạy `gh run list` cho mọi dự án và vài lệnh `aws` chỉ vì
             tab tồn tại. Nó cũng KHÔNG tự làm mới — chỉ nạp khi mở tab hoặc bấm ↻. -->
        <div v-if="deliveryMounted" v-show="tab === 'delivery'" class="infra-pane">
          <InfraCicd @open-logs="onOpenCicdLogs" />
        </div>

        <div v-if="k8sMounted" v-show="tab === 'kubernetes'" class="infra-pane">
          <InfraKubernetes />
        </div>

        <div v-show="tab === 'accounts'" class="infra-pane">
          <InfraAccounts
            v-model:search="search"
            :profiles="profiles"
            :all-profiles="allProfiles"
            :loading="loading"
            :error="error"
            :selected="selected"
            :default-profile="defaultProfile"
            @select="select"
            @new-profile="openNewProfile"
            @edit="openEditProfile"
            @duplicate="refresh"
            @delete="refresh"
            @set-default="setDefaultProfile"
            @check-identity="refresh"
            @import="openImport"
            @import-sso="openSsoImport"
            @console-login="openConsoleLogin"
            @account-id-resolved="pinAccountIdForDefault"
            @export="openExport"
          />
        </div>
      </div>
    </div>

    <!-- thêm / sửa profile (A3) -->
    <AwsProfileEditor
      :open="overlay === 'editor'"
      :profile="editTarget"
      :profiles="allProfiles"
      :default-region="pinnedRegion"
      @save="onEditorSaved"
      @cancel="closeEditor"
      @relogin="onRelogin"
    />

    <!-- nhập: dán khối / file / CSV (A4) -->
    <AwsProfileImport
      :open="overlay === 'import'"
      :profiles="allProfiles"
      @close="closeImport"
      @done="onImportDone"
    />

    <!-- nhập từ SSO: login → list-accounts/roles → tick hàng loạt (A5) -->
    <AwsSsoImport
      :open="overlay === 'sso-import'"
      :profiles="allProfiles"
      @close="closeSsoImport"
      @done="onSsoImportDone"
    />

    <!-- đăng nhập Console (`aws login`) — đường ít thao tác nhất, không sinh khoá
         dài hạn và không cần terminal -->
    <AwsConsoleLogin
      :open="overlay === 'console-login'"
      :profiles="allProfiles"
      :default-region="pinnedRegion"
      :preset-profile="consoleLoginTarget"
      @close="closeConsoleLogin"
      @done="onConsoleLoginDone"
    />

    <!-- xuất cấu hình / kèm khoá có rào (A6) -->
    <AwsProfileExport
      :open="overlay === 'export'"
      :profiles="allProfiles"
      :selected="selected"
      @close="closeExport"
    />

    <!-- Hộp "ghim biểu đồ vào một bảng" (Mốc 6, M4). Host Ở ĐÂY chứ không ở
         `AppGlobalHosts`: cú bấm mở nó nằm trong tab Giám sát của chính trang này,
         nên nó không cần sống ở cửa sổ nào khác. Nó tự đọc trạng thái từ
         `useInfraDashboardPin()` — không props, không emit. -->
    <InfraDashboardPinDialog />
  </section>
</template>

<script setup lang="ts">
// /infra — Tài khoản (Mốc 1, ADR 0088 §1b + docs/features/aws-profile-manager.md).
// Trang CHỈ điều phối: thanh section (khung cho Explorer sau này) + màn danh
// sách/chi tiết profile (<InfraAccounts>) + 4 overlay CRUD/nhập/xuất. Toàn bộ
// state/luồng nằm ở useInfraPage() (page-controller, khuôn useSshPage.ts); trang
// không tự gọi RPC và không import `useAwsProfilesApi` trực tiếp.
import AwsProfileEditor from '~/components/infra/AwsProfileEditor.vue'
import InfraKubernetes from '~/components/infra/InfraKubernetes.vue'
import InfraLogs from '~/components/infra/logs/InfraLogs.vue'
import InfraOverview from '~/components/infra/InfraOverview.vue'
import AwsConsoleLogin from '~/components/infra/AwsConsoleLogin.vue'
import AwsProfileExport from '~/components/infra/AwsProfileExport.vue'
import AwsProfileImport from '~/components/infra/AwsProfileImport.vue'
import AwsSsoImport from '~/components/infra/AwsSsoImport.vue'
import InfraAccounts from '~/components/infra/InfraAccounts.vue'
import InfraAuditLog from '~/components/infra/audit/InfraAuditLog.vue'
import InfraContextBar from '~/components/infra/InfraContextBar.vue'
import InfraCicd from '~/components/infra/cicd/InfraCicd.vue'
import InfraExplorer from '~/components/infra/explorer/InfraExplorer.vue'
import InfraGraph from '~/components/infra/graph/InfraGraph.vue'
import InfraMonitoring from '~/components/infra/metrics/InfraMonitoring.vue'
import InfraReports from '~/components/infra/reports/InfraReports.vue'
import InfraServicesCatalog from '~/components/infra/explorer/InfraServicesCatalog.vue'
import { OVERVIEW_ERRORS_WINDOW_SECONDS } from '~/composables/useInfraOverview'
import { useInfraExplorerCatalog } from '~/composables/useInfraExplorerCatalog'
import { useInfraPage } from '~/composables/useInfraPage'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import type { InfraTab } from '~/composables/useInfraTabOpen'
import { useInfraServiceOpen } from '~/composables/useInfraServiceOpen'
import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
import { useLinkOpen } from '~/composables/useLinkOpen'
import type { InfraCatalogService } from '~/composables/useInfraResourcesApi'
import type { LogsSeed } from '~/composables/useInfraLogs'

const { t } = useI18n()
const { mode, setMode } = useInfraMode()

// Ba mục của thanh section. `overview` đứng đầu và là mặc định: `/infra` trả lời
// "mọi thứ có ổn không" trước khi trả lời "có những tài khoản nào"
// (docs/features/infra-explorer.md §Màn mở đầu).
// Thứ tự hiển thị nay do `GROUPS` quyết (xem dưới) — không còn một mảng phẳng thứ
// hai, vì hai danh sách cùng nói về thứ tự là hai chỗ để quên đồng bộ khi thêm màn.
const TAB_ICONS: Record<InfraTab, string> = {
  overview: 'home',
  services: 'layers',
  graph: 'branch',
  delivery: 'zap',
  audit: 'book',
  logs: 'table',
  monitoring: 'act',
  dashboards: 'panel',
  cost: 'tag',
  budgets: 'flag',
  waste: 'trash',
  playbooks: 'listul',
  reports: 'file',
  kubernetes: 'k8s',
  accounts: 'shield',
}

/**
 * SÁU NHÓM của tầng 1, gom theo CÂU HỎI chứ không theo dịch vụ AWS — xem comment ở
 * template. Thứ tự là thứ tự người ta hỏi: có ổn không → có những gì → chạy thế nào
 * → tốn bao nhiêu → ai đổi gì → tôi đang ở account nào.
 */
type InfraGroupId = 'overview' | 'resources' | 'health' | 'cost' | 'changes' | 'accounts'

const GROUPS: readonly { id: InfraGroupId; tabs: readonly InfraTab[] }[] = [
  { id: 'overview', tabs: ['overview'] },
  { id: 'resources', tabs: ['services', 'graph', 'kubernetes'] },
  { id: 'health', tabs: ['monitoring', 'dashboards', 'logs'] },
  { id: 'cost', tabs: ['cost', 'budgets', 'waste'] },
  { id: 'changes', tabs: ['delivery', 'playbooks', 'audit', 'reports'] },
  { id: 'accounts', tabs: ['accounts'] },
]

const GROUP_ICONS: Record<InfraGroupId, string> = {
  overview: 'home',
  resources: 'layers',
  health: 'act',
  cost: 'tag',
  changes: 'zap',
  accounts: 'shield',
}

/**
 * Ba tab con của nhóm Chi phí. Khai thành hằng vì BA chỗ cần đúng cùng danh sách —
 * điều kiện `v-show` của khung, cú mount lười, và phép suy `costView` — và ba chuỗi
 * rời nhau là ba chỗ để quên khi thêm tab thứ tư.
 */
const COST_TABS: readonly InfraTab[] = ['cost', 'budgets', 'waste']

/**
 * Các tab mà công tắc Đơn giản/Chuyên sâu thật sự đổi thứ gì đó:
 *   services  — bộ cột của bảng Explorer
 *   waste     — cột chi tiết thô của bảng lãng phí
 *   playbooks — khối kỹ thuật của từng bước
 *   audit     — lệnh rút gọn / argv đầy đủ, và ARN rút gọn / đầy đủ (CloudTrail)
 * Thêm màn mới có định danh máy để rút gọn thì thêm tên vào ĐÂY, nếu không công
 * tắc sẽ không hiện ở đó và không ai biết nó tồn tại.
 */
const MODE_TABS: readonly InfraTab[] = ['services', 'waste', 'playbooks', 'audit']

const tab = ref<InfraTab>('overview')
/** Tab Logs chỉ được mount sau cú bấm đầu tiên (xem comment ở template). */
const logsMounted = ref(false)
/**
 * Tab Kubernetes mount lười cùng lý do: mở `/infra` không được tự đọc
 * `~/.kube/config` chỉ vì tab tồn tại. Khác Logs ở chỗ đây là đọc FILE, không
 * phải gọi CLI dùng credential — nhưng vẫn chỉ nạp khi người dùng hỏi.
 */
const k8sMounted = ref(false)
/**
 * Tab Triển khai (Mốc 4) mount lười: một lượt nạp là nhiều tiến trình `aws` cộng
 * một `gh run list` cho MỖI dự án có remote GitHub — mở `/infra` không được làm
 * việc đó sau lưng người dùng.
 */
const deliveryMounted = ref(false)
/**
 * Tab Dịch vụ (danh mục 3.8 + bảng 3.1–3.7) mount lười cùng lý do với Logs: mở
 * `/infra` không được đọc danh mục, không được dò quyền, cũng không được chạm CLI
 * chỉ vì tab tồn tại. Khác Logs ở chỗ nó KHÔNG tốn lời gọi nào cho tới khi người
 * dùng chọn một dịch vụ — `useInfraExplorer` cấm `watch`/`onMounted` gọi `list`.
 */
const servicesMounted = ref(false)
/**
 * Mặt nào của tab Dịch vụ đang hiện: danh mục (`true`, mặc định) hay bảng tài
 * nguyên (`false`). Mặc định là danh mục vì đó là câu hỏi đầu tiên ("tôi có những
 * dịch vụ gì?") và nó không tốn lời gọi nào.
 */
const catalogOpen = ref(true)
/** Đã từng mở một view chưa — nút "Quay lại" của danh mục chỉ có nghĩa khi có. */
const openedView = ref(false)
/** Nhật ký chỉ đọc dữ liệu cục bộ; vẫn mount lười cho nhất quán. */
const auditMounted = ref(false)
/**
 * Tab Giám sát (Mốc 6) mount lười. Không phải vì nó tự nạp — `useInfraMetrics` cấm
 * điều đó — mà vì nó ĐĂNG KÝ một watcher nhận khoảng thời gian gieo từ Logs, và
 * watcher chỉ sống khi màn đã mount. Mount sẵn cũng không tốn lời gọi nào, nhưng
 * mount lười giữ cho mọi tab dữ liệu của trang này có cùng một luật.
 */
const monitoringMounted = ref(false)
/**
 * Tab Bảng điều khiển (Mốc 6, M4) mount lười: nó đọc danh sách bảng của cả hai tier
 * ngay khi mount. Đọc thư mục thì rẻ, nhưng vẫn là một lượt I/O không ai hỏi — và
 * mọi tab dữ liệu của trang này đã theo cùng một luật.
 */
const dashboardsMounted = ref(false)
/**
 * Tab Chi phí (mốc 7) mount lười — và ở đây nó quan trọng hơn mọi tab khác: một lượt
 * nạp là ba request `ce` TÍNH TIỀN. `useInfraCost` cấm tự chạy, nên mount cũng không tốn
 * gì; mount lười chỉ để mọi tab dữ liệu của trang này giữ cùng một luật.
 */
const costMounted = ref(false)
/** Tab Báo cáo (Mốc 6) mount lười: màn này hỏi danh mục ngay khi mount. */
const reportsMounted = ref(false)
/**
 * Tab Kế hoạch (chuyển vào 2026-09-15) mount lười: `usePlaybooksManager` có `onMounted`
 * nạp danh sách playbook của MỌI project đã đăng ký. Đọc file cục bộ thì rẻ, nhưng vẫn
 * là I/O không ai hỏi khi người dùng chỉ mở /infra để xem Tổng quan.
 */
const playbooksMounted = ref(false)
const logsSeed = ref<LogsSeed | null>(null)
let seedNonce = 0

function selectTab(next: InfraTab): void {
  if (next === 'logs') logsMounted.value = true
  if (next === 'monitoring') monitoringMounted.value = true
  if (next === 'dashboards') dashboardsMounted.value = true
  if (COST_TABS.includes(next)) costMounted.value = true
  if (next === 'playbooks') playbooksMounted.value = true
  if (next === 'reports') reportsMounted.value = true
  if (next === 'kubernetes') k8sMounted.value = true
  if (next === 'services') servicesMounted.value = true
  if (next === 'delivery') deliveryMounted.value = true
  if (next === 'audit') auditMounted.value = true
  tab.value = next
  const group = GROUPS.find((g) => g.tabs.includes(next))
  if (group) lastTabOf.value = { ...lastTabOf.value, [group.id]: next }
}

/**
 * Nhóm suy TỪ tab, không phải một state thứ hai. Hai state cho cùng một vị trí là hai
 * chỗ để lệch nhau — và mọi đường vào sẵn có (`requestGraphOpen`, khoảng gieo từ Logs)
 * chỉ biết đặt `tab`.
 */
const activeGroup = computed<InfraGroupId>(
  () => GROUPS.find((g) => g.tabs.includes(tab.value))?.id ?? 'overview',
)

/** Tab con đang mở, hoặc `cost` khi trang đang ở một nhóm khác (khung bị ẩn). */
const costView = computed<'cost' | 'budgets' | 'waste'>(() =>
  tab.value === 'budgets' || tab.value === 'waste' ? tab.value : 'cost',
)

const subTabs = computed<readonly InfraTab[]>(
  () => GROUPS.find((g) => g.id === activeGroup.value)?.tabs ?? [],
)

/**
 * Màn xem gần nhất của mỗi nhóm. Quay lại "Sức khoẻ" mà luôn rơi về Giám sát là bắt
 * người dùng bấm lại lần thứ hai mỗi lần ghé qua nhóm khác.
 */
const lastTabOf = ref<Partial<Record<InfraGroupId, InfraTab>>>({})

function selectGroup(id: InfraGroupId): void {
  const group = GROUPS.find((g) => g.id === id)
  if (!group) return
  const remembered = lastTabOf.value[id]
  const next = remembered && group.tabs.includes(remembered) ? remembered : group.tabs[0]
  if (next) selectTab(next)
}

/** Mở mặt danh mục (nút "Tất cả dịch vụ" ở cột trái của khung Explorer). */
function openCatalog(): void {
  servicesMounted.value = true
  catalogOpen.value = true
}

// ── Danh mục + ghim (task 3.8) ──────────────────────────────────────────────
// Danh mục và ghim là state MỌC MODULE (`useInfraExplorerCatalog`) vì hai tab cùng
// đọc chúng: ghim ở tab Dịch vụ phải đổi sidebar của tab Explorer.
const {
  services,
  groups,
  pinnedServices,
  togglePin,
  ensureCatalog,
  catalogLoading,
  catalogError,
  catalogMock,
  retryCatalog,
} = useInfraExplorerCatalog()
const explorerRef = useTemplateRef<InstanceType<typeof InfraExplorer>>('explorerRef')
// Danh mục + ghim là mặc định của `/infra → Dịch vụ`, nên nạp ngay khi trang mở
// (nó chỉ serialize hằng số ở sidecar — không chạm CLI, không tốn credential).
void ensureCatalog()

/** Dòng đang có trên màn Explorer, để ⌘K của tab Dịch vụ tìm được cả dữ liệu. */
const explorerRows = ref<
  { viewId: string; label: string; name: string; values?: Record<string, string> }[]
>([])

const rowHits = computed(() => explorerRows.value)
const inUseServices = computed(() => {
  const set = new Set<string>()
  for (const r of explorerRows.value) {
    const svc = services.value.find((s) => s.target.kind === 'view' && s.target.viewId === r.viewId)
    if (svc) set.add(svc.id)
  }
  return set
})

const { openExternally } = useLinkOpen()

function openUrl(url: string): void {
  void openExternally(url)
}

/** Một mục trong danh mục: tab nội bộ mở ngay, view thì chuyển tab rồi mở view. */
async function onServiceTarget(target: InfraCatalogService['target']): Promise<void> {
  if (target.kind === 'console') {
    if (target.url) openUrl(target.url)
    return
  }
  if (target.kind === 'tab') {
    selectTab(target.tab)
    return
  }
  await onServiceView({ viewId: target.viewId })
}

/**
 * Mở một view từ danh mục: danh mục nhường chỗ cho bảng (cùng một tab), rồi nhờ
 * `InfraExplorer` mở view. Khung Explorer mount lười nên phải chờ một nhịp sau khi
 * bật `v-if` — gọi trước đó là gọi vào `null`. Đây là lý do `InfraExplorer` expose
 * `openView` qua `defineExpose`.
 */
async function onServiceView(payload: {
  viewId: string
  values?: Record<string, string>
}): Promise<void> {
  // `openedView` bật TRƯỚC khi mở: từ đây danh mục có một chỗ để quay về.
  openedView.value = true
  selectTab('services')
  catalogOpen.value = false
  await nextTick()
  explorerRef.value?.openView(payload.viewId, payload.values)
}

// ── ⌘K palette → mở một dịch vụ ─────────────────────────────────────────────
// Palette (⌘K) chỉ ghi MỘT id dịch vụ vào cầu nối mọc-module `useInfraServiceOpen`
// rồi điều hướng tới `/infra`; trang phân giải id đó theo danh mục nó đã sở hữu và
// mở bằng CHÍNH `onServiceTarget` (view → bảng, tab → chuyển tab). Dịch vụ mức
// `console` do palette tự mở ngoài trình duyệt nên không tới được đây.
//
// `immediate: true` xử lý ca mount mới (palette đặt id TRƯỚC khi trang mount); khi
// trang đang sống (KeepAlive) thì watcher bắt luôn lần đặt id kế tiếp. `consume()`
// lấy-và-xoá nên cùng một dịch vụ mở lại lần sau vẫn kích hoạt (null → id là một
// thay đổi). `services` là state chia sẻ với palette nên khi tới đây đã có dữ liệu.
const { pending: pendingServiceOpen, consume: consumeServiceOpen } = useInfraServiceOpen()
watch(
  pendingServiceOpen,
  (id) => {
    if (!id) return
    consumeServiceOpen()
    const svc = services.value.find((s) => s.id === id)
    if (svc) void onServiceTarget(svc.target)
  },
  { immediate: true },
)

// Cầu nối thứ hai, cùng khuôn: `/playbooks` xin mở thẳng tab Topology khi nó không
// suy được ảnh hưởng lan. `selectTab` là đường DUY NHẤT đổi tab (nó còn bật cờ mount
// lười của các tab khác), nên đi qua đó chứ không gán thẳng `tab.value`.
// Cầu nối "xin mở một tab" (`useInfraTabOpen`). Ba bên xin: màn Kế hoạch xin Topology
// khi chưa dựng được ảnh hưởng lan, màn Chi phí xin Kế hoạch sau khi dựng bản nháp dọn
// dẹp, và route cũ `/playbooks` xin Kế hoạch khi có người mở deep-link.
const { pending: pendingTabOpen, consume: consumeTabOpen } = useInfraTabOpen()
watch(
  pendingTabOpen,
  (want) => {
    if (!want) return
    consumeTabOpen()
    selectTab(want)
  },
  { immediate: true },
)

// ── Cầu nối khoảng thời gian Logs ⇄ Giám sát (Mốc 6, 6.3) ────────────────────
// PHẦN NÀY THUỘC TRANG, không thuộc composable nào: áp một khoảng vào một màn mà
// người dùng không nhìn thấy là gieo vào chỗ trống. Mỗi màn tự tiêu thụ phần DỮ LIỆU
// của mình (`InfraLogs` và `useInfraMetrics` đều có watcher riêng, đăng ký trên
// instance của màn đó) — ở đây chỉ CHUYỂN TAB, và KHÔNG `consume`: tiêu thụ ở đây là
// lấy mất mảnh dữ liệu mà màn kia đang chờ.
//
// Đi qua `selectTab` chứ không gán thẳng `tab.value`: tab mới còn phải bật cờ mount
// lười, mà màn chưa mount thì watcher nhận-khoảng của nó chưa tồn tại. Thứ tự trong
// cùng một tick là đúng: cờ bật trước, DOM cập nhật sau, watcher `immediate` của màn
// vừa mount đọc được cú gieo còn nguyên đó.
const { pendingLogs, pendingMonitoring } = useInfraWindowSync()
watch(pendingLogs, (seed) => {
  if (seed) selectTab('logs')
})
watch(pendingMonitoring, (seed) => {
  if (seed) selectTab('monitoring')
})

/** Explorer báo lên danh sách dòng đang có (cho ⌘K của tab Dịch vụ). */
function onRowsChanged(
  rows: { viewId: string; label: string; name: string; values?: Record<string, string> }[],
): void {
  explorerRows.value = rows
}

/** Tổng quan → "Mở trong Logs": gieo câu lệnh rồi chuyển tab. KHÔNG chạy truy vấn. */
function onOpenLogs(query: string): void {
  logsMounted.value = true
  logsSeed.value = { query, windowSeconds: OVERVIEW_ERRORS_WINDOW_SECONDS, nonce: ++seedNonce }
  tab.value = 'logs'
}

/**
 * Sơ đồ → "xem log của node này" (G4). Mở chế độ TAIL chứ không phải Insights: đọc
 * dòng mới nhất bằng `filter-log-events` không tính tiền theo GB quét, nên nó mở
 * được ngay sau một cú bấm mà không cần bắt người dùng đọc một con số ước lượng.
 *
 * `prefix` (API Gateway — node không mang stage) chỉ LỌC danh sách nhóm: người dùng
 * chọn nốt stage. Đoán hộ stage là mở một nhóm có thể không tồn tại.
 */
function onOpenNodeLogs(group: { kind: 'exact' | 'prefix'; value: string }): void {
  logsMounted.value = true
  logsSeed.value = {
    windowSeconds: 3600,
    nonce: ++seedNonce,
    mode: 'tail',
    ...(group.kind === 'exact' ? { group: group.value } : { pattern: group.value }),
  }
  tab.value = 'logs'
}

/**
 * Triển khai → "mở log của bước này" (CodeBuild): log build nằm ở CloudWatch nên
 * việc đọc nó thuộc tab Logs. Gieo ĐÚNG group + câu lọc theo stream rồi chuyển tab
 * — KHÔNG chạy truy vấn (chạy là cú bấm của người dùng, và nó tốn tiền).
 */
function onOpenCicdLogs(group: string, stream: string): void {
  logsMounted.value = true
  // Tên stream có thể chứa `"` (CloudWatch cho phép) — nhét nguyên vào chuỗi lọc
  // là làm hỏng cú pháp truy vấn ngay từ lúc gieo.
  const safe = stream.replace(/["\\]/g, '')
  const filters = safe ? ` | filter @logStream like "${safe}"` : ''
  logsSeed.value = {
    query: `fields @timestamp, @message${filters} | sort @timestamp desc | limit 200`,
    windowSeconds: 3600,
    nonce: ++seedNonce,
    group,
  }
  tab.value = 'logs'
}

const {
  profiles,
  allProfiles,
  loading,
  error,
  search,
  selected,
  defaultProfile,
  select,
  setDefaultProfile,
  setRegion,
  pinAccountIdForDefault,
  overlay,
  editTarget,
  openNewProfile,
  openEditProfile,
  closeEditor,
  openImport,
  closeImport,
  openSsoImport,
  closeSsoImport,
  openExport,
  closeExport,
  onEditorSaved,
  onImportDone,
  onSsoImportDone,
  refresh,
  pinnedRegion,
  consoleLoginTarget,
  openConsoleLogin,
  closeConsoleLogin,
  onConsoleLoginDone,
} = useInfraPage()

// "Đăng nhập lại" trong màn sửa của profile `login`: đóng editor rồi mở modal
// đăng nhập với ĐÚNG tên profile đó (không gợi ý tên mới — xem presetProfile).
function onRelogin(name: string): void {
  closeEditor()
  openConsoleLogin(name)
}
</script>

<style scoped>
.infra-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
}

/* Hàng trên: tab + thanh ngữ cảnh. `flex-wrap` vì ở cửa sổ hẹp (720px) sáu tab
   đã chiếm gần hết hàng — thanh ngữ cảnh xuống dòng dưới, và đường kẻ dưới cùng
   vẫn là của cả hàng. */
.infra-top {
  display: flex;
  align-items: center;
  gap: 4px;
  /* Đáy phải có đệm: tab đang chọn có nền + viền riêng, sát đường kẻ dưới thì
     pill dính vào đường phân cách và trông như bị cắt chân. */
  padding: 10px 16px 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  row-gap: 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}

.infra-sections {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.infra-section-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: var(--r-btn);
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* 550/650 chứ không phải 400 kế thừa từ `body`: ở 12px, độ đậm mảnh làm nhãn
     tab khó đọc trên nền tối (ảnh chụp 2026-09-14: "text trên tab hơi mỏng khó
     đọc"). Đây là dãy độ đậm có sẵn của app — `.li .ttl` dùng 550, `.iov-title`
     dùng 650 — nên tab vẫn nằm trong hệ, không phải một cỡ mới. */
  font-weight: 550;
  cursor: default;
}

.infra-section-tab.active {
  color: var(--text);
  background: var(--accentDim);
  border-color: var(--accentBorder);
  font-weight: 650;
}

/* Tầng 2. Khác tầng 1 về THỨ BẬC chứ không chỉ về cỡ: tầng trên là pill accent-tint,
   tầng này là chữ + gạch chân accent. Dùng lại pill ở đây thì hai hàng trông ngang
   hàng nhau và người đọc không biết cái nào chứa cái nào.

   KHÔNG dùng nền xám cho mục đang chọn (.claude/rules/nuxt-vue.md §UI patterns) — màu
   accent + thanh 2px là luật chọn của cả app. */
.infra-subs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  padding: 6px 16px 0;
  flex: 0 0 auto;
  box-shadow: inset 0 -1px 0 var(--border);
}

.infra-sub-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px 7px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  cursor: default;
}

.infra-sub-tab:hover {
  color: var(--text);
}

.infra-sub-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 650;
}

.infra-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* Mỗi pane lấp hết chỗ còn lại của .infra-body và tự quản vùng cuộn của nó.

   LUÔN là một <div> BỌC, KHÔNG bao giờ gắn thẳng class này lên component con: Vue
   đưa scope-id của cha xuống phần tử gốc của component con, nên `.infra-pane` sẽ
   ĐÈ `display` của chính khung đó. Đo được trên khung Explorer — `.ixe` là grid
   hai cột, bị ép thành flex-column nên cột "Dịch vụ đã ghim" chảy xuống nằm trên
   bảng (ảnh chụp 2026-09-14). */
.infra-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Phần tử gốc của khung bên trong lấp hết pane và tự cuộn. */
.infra-pane > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* Bóng của nút và skin card của bảng KHÔNG khai ở đây nữa — chúng là quy tắc toàn
   app (`.btn` ở prototype.css, `.tblcard` ở app-shell.css) sau khi người dùng chốt
   "áp dụng theo hướng global cho toàn bộ app" (2026-09-15). Bản cũ khoanh vùng bằng
   `.infra-shell :deep(.btn)` vì khi đó đổi `.btn` toàn cục là ngoài phạm vi yêu cầu;
   phạm vi ấy nay đã đổi. Giữ lại một bản sao ở đây sẽ thành định nghĩa thứ hai về
   "nút nổi" — hai chỗ để sửa, hai chỗ để lệch. */
</style>
