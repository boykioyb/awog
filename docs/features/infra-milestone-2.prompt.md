# Prompt khởi động — sau Mốc 1: dọn nợ rồi vào Mốc 2 (Logs & Tổng quan)

> Dán nguyên file này vào phiên mới. Viết cho người/agent **chưa đọc phiên trước**.

## ✅ Trạng thái sau phiên làm Mốc 2 (2026-09-13)

**Mốc 2 đã code xong trong cây làm việc, CHƯA COMMIT** (nhánh `feature/aws-infra`).

| Việc                                                         | Trạng thái                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| 2.1 Chọn nhiều log group · khoảng thời gian · chạy/poll/huỷ  | ✅                                                            |
| 2.2 Bảng kết quả · JSON chi tiết · copy · gửi vào chat       | ✅                                                            |
| 2.3 Monaco + Monarch + gợi ý trường                          | ✅ (phím tắt `⌘Enter`/`⌘.` **chưa nối**)                      |
| 2.4 Thư viện query (mẫu · đã lưu · lịch sử)                  | ✅ `~/.awog/infra/logs/queries.json`                          |
| 2.5 Histogram SVG kéo-zoom                                   | ✅ (`bin(auto)` không tồn tại — bước chọn theo độ dài cửa sổ) |
| 2.6 Ước lượng GB trước · `bytesScanned` sau · không auto-run | ✅                                                            |
| 2.7 Lọc nhanh · chip mức độ · facet                          | ✅                                                            |
| 2.8 Màn Tổng quan: 6 thẻ đèn + giải thích + chip câu hỏi     | ✅ (1/6 thẻ có nguồn thật; 5 thẻ còn lại đèn xám + Hỏi agent) |
| 2.9 Tool `logs_query` / `logs_tail_window`                   | ✅ (popup duyệt kèm ước lượng GB)                             |

**Quyết định còn treo ở dưới đã chốt** — xem mục "Quyết định còn treo" (đã sửa).

## ✅ Phiên 2026-09-13 (chiều) — nối Terraform + kubectl (P1/P2, phần lõi)

Người dùng yêu cầu "nối ngoài AWS còn Terraform và kubectl". Đã land **trong cây làm
việc, CHƯA COMMIT** (nhánh `feature/aws-infra`):

| Việc                                           | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19 · Parser `~/.kube/config` allowlist-key     | ✅ `infra/kubectl/kubeconfig.ts` — chỉ cắt ra tên context/cluster/namespace/user + URL API server; `token`/`client-*-data`/khối `exec` bị bỏ NGAY trong vòng lặp parse (không `parseScalar`). Hỗ trợ cả hai dạng kubectl tự ghi, gộp nhiều file `KUBECONFIG` (file đầu thắng)                                                                                                                                                                                                                                                                            |
| 20 · `kubectl_cli` + 13 · `tf_cli`             | ✅ cùng một lõi `runPinnedCli()` (classify → `decide()` → cổng duyệt → `runInfra` → clamp). Cả hai runtime (Pi AgentTool + server MCP `awoginfra`)                                                                                                                                                                                                                                                                                                                                                                                                       |
| 12 · Discover `*.tf` ≤2 cấp + block `backend`  | ✅ `infra/terraform/discover.ts`; `terraform workspace list` là RPC riêng `infra.tf-workspaces`, chỉ chạy khi người dùng bấm (chạm state thật ⇒ không tự gọi)                                                                                                                                                                                                                                                                                                                                                                                            |
| 18 · Chip Terraform · 25 · Chip kubectl        | ✅ `InfraTerraformChip.vue` · `InfraKubectlChip.vue` trong `SessionContextStrip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Tab **Kubernetes** trong `/infra` (2026-09-14) | ✅ màn thật: `pages/infra.vue` (tab `kubernetes`, mount lười) → `InfraKubernetes.vue` → `useInfraKube.ts` → RPC **`infra.kube`** (10 thao tác đóng). Có: bảng context + _Dùng_, **Thêm cluster EKS** bằng cú bấm (`eks list-clusters` → `eks update-kubeconfig`, việc 25 ✅), bảng **Pods** + ô namespace, **Xem log** (chọn container/số dòng, ↻), **Chi tiết** (describe), **Khởi động lại** deployment, **Xoá pod**. Bố cục **một màn** (việc 25b): thanh ngữ cảnh + khung bảng (Pods ⇄ Deployments), quản lý cluster và log/describe nằm trong modal |
| 14–16 · Plan viewer                            | ⬜ chưa — vẫn là việc lớn nhất còn lại của P1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 21–23 · Logs tab · exec · port-forward         | ⬜ chưa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 24 · "gõ lại tên context" ở prod               | ◐ chỉ mới có phần ma trận (`delete`/`drain` bị chặn ở mặc định)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Mười lăm luật mới đáng nhớ (đừng vô hiệu hoá khi sửa tiếp):**

1. **`kubectl get secret … -o yaml|json|jsonpath` bị CHẶN CỨNG** (`findCredentialOp`) — output
   chính là credential, cùng loại với `aws secretsmanager get-secret-value`. `kubectl get secrets`
   trần (bảng tên) và `describe secret` (chỉ tên khoá + số byte) thì **không** chặn.
2. **`terraform fmt` là `write`, chỉ `fmt -check` mới là `read`** — và `workspace list|show` là
   `read` còn `workspace select|new|delete` là `write`. Đây là các cặp `(động từ, cờ)` mà
   allowlist theo động từ không diễn tả được.
3. **`kubectl logs` và `terraform output|show|state show` là "read nhưng trả NỘI DUNG"** ⇒
   `sensitiveReadOf()` siết lên `ask`. `-o yaml|json` của `kubectl get|describe` cũng vậy.
4. **kubectl/terraform KHÔNG nhận `accountId`** của phiên ⇒ `accountKindOf(undefined) = production`
   (audit #1 F6), nên lệnh ghi luôn hỏi và lệnh phá huỷ luôn bị chặn. Truyền `accountId` của AWS
   vào nhánh kubectl là lỗi theo chiều ngược lại (một account dev sẽ hạ nhầm cluster production).
5. **Ngữ cảnh vào tiến trình con KHÁC NHAU theo công cụ**: `aws` đi bằng CỜ (`--profile`/`--region`)
   và **không** nhận env; `kubectl`/`terraform` đi bằng **env** (`AWS_PROFILE`/`AWS_REGION`, thêm cả
   `AWS_DEFAULT_REGION`) _bên cạnh_ `--context`/`-chdir=`. Vì sao: kubeconfig EKS trỏ user vào exec
   plugin `aws eks get-token`, plugin đó đọc credential từ env của tiến trình kubectl chứ không biết
   profile của phiên. Truyền env cho cả `aws` là tự tạo hai đường ngữ cảnh mâu thuẫn nhau. Giới hạn
   đã biết: `exec.env: [AWS_PROFILE=…]` khai trong chính kubeconfig thắng env của AWOG, mà parser cố
   ý không đọc khối `exec` ⇒ cách sạch nhất là sinh kubeconfig bằng
   `aws eks update-kubeconfig --name <cluster> --region <r> --profile <profile>`.
6. **UI không ghép argv cho kubectl.** Tab Kubernetes gửi _ý định_ (`op` + tên đã chọn) qua RPC
   `infra.kube`; tên do cluster trả về (`--kubeconfig=/etc/passwd` là một cái tên hợp lệ với Kubernetes)
   được validate DNS-1123 ở sidecar rồi mới thành phần tử argv. Và bảng phải dùng `--no-headers`, KHÔNG
   `-o json`/`custom-columns`: hai định dạng sau in nội dung object ⇒ rơi vào nhóm "đọc nhưng trả nội dung"
   và mỗi lần nạp bảng thành một hộp duyệt.
7. **`-o custom-columns[‑file]` là định dạng ĐẦY ĐỦ** (sửa 2026-09-14). Nó chọn cột theo đường dẫn field
   nên `kubectl get secret app -o custom-columns=D:.data.password` in ra đúng credential — trước bản sửa
   này nó lọt qua cả `findCredentialOp` lẫn `sensitiveReadOf`.
8. **Cổng quyền là một hàm dùng chung** (`infra/gated.ts` → `runGated()`), không phải logic nằm trong từng
   RPC: `block` ⇒ không spawn, `ask` ⇒ đòi VÉ do sidecar phát (dùng một lần, gắn vân tay đúng lời gọi),
   `auto` ⇒ chạy và nhật ký ghi lý do. `methods/infra.run.ts` và `methods/infra.kube.ts` cùng gọi nó.
   Vé dùng lại lần hai bị từ chối — có test.

9. **Tab Kubernetes là màn MỘT TRANG, không cuộn.** Chỉ hai vùng được cuộn: thân modal (`.ikm-body`) và
   bảng (`.ikscroll`). Thứ không phải câu hỏi hằng ngày thì nằm trong lớp phủ (modal quản lý cluster, modal
   log/describe hai tab, popover chú thích) — thêm một khối vào luồng của trang là quay lại đúng vấn đề
   "bốn khối xếp dọc" mà bản đầu mắc phải. Kèm theo: **chọn cluster/namespace nạp bảng ngay**; luật
   "không auto-refresh" cấm nạp _sau lưng_ người dùng (poll/watch), không cấm làm theo cú bấm vừa rồi —
   để màn trống chờ người dùng tự tìm nút ↻ là ngõ cụt với người không quen terminal.

10. **Đang nạp thì phải thấy đang nạp.** Chưa có hàng ⇒ khung xương
    (`InfraKubeTableSkeleton.vue`) bám số cột bảng thật; nạp LẠI cùng ngữ cảnh (↻) ⇒ giữ hàng và làm mờ
    (`.ikdim`); đổi cluster/namespace ⇒ xoá hàng rồi hiện khung xương (hàng của namespace khác nằm dưới tên
    namespace mới còn tệ hơn bảng trống). Ô chọn cluster/namespace luôn kèm giá trị đang ghim (`withPinned`),
    nếu không thì lượt đọc danh sách hỏng là ô chọn hiện placeholder sai ngữ cảnh. Trước bản này thân bảng trắng trong lúc nạp trông y hệt "không có pod nào" — đúng lý do người dùng
    bấm ↻ liên tục. Khung log/mô tả cũng phải có dòng "đang nạp" và **báo lý do khi trả `null`** (bị chặn /
    CLI không chạy), thay vì để thân modal trống.
11. **Một hành động ghi tại một thời điểm.** `restarting`/`deleting` giữ **TÊN** đối tượng (không phải
    boolean) ⇒ chỉ nút của đúng hàng đó quay, mọi nút ghi khác khoá (`actionBusy`), và cú bấm thứ hai không
    thành lệnh thứ hai. Cùng lớp bảo vệ đó ở đầu kia: ô chọn cluster/namespace + nút _Dùng_ trong modal bị
    khoá trong lúc bảng đang nạp.
12. **Thế hệ ngữ cảnh (`loadEpoch`) là thứ chống race giữa hai ngữ cảnh.** Mỗi lần đổi cluster/namespace là
    một thế hệ mới; hàm nạp đọc số đó lúc bắt đầu và **bỏ** kết quả về muộn. Không có nó, dữ liệu cluster CŨ
    nằm lại trên màn cluster MỚI. Kèm theo: **thành công lẫn thất bại đều phải có toast** — kể cả lượt nạp
    hỏng (`infra.kube.error.refresh`) và lượt **chép lệnh hỏng** (`copyText` giờ trả `boolean`, vì "Đã chép"
    khi clipboard không ghi được là lời nói dối).
13. **Tìm trong bảng là lọc TẠI CHỖ, không phải một lượt đọc mới.** Ô tìm ở đầu vùng bảng khớp **tên hoặc
    bất kỳ ô nào** (gõ `CrashLoop` phải ra nhóm pod đó, không chỉ khớp tên), và **không phát sinh RPC nào** —
    đo được: 22 lệnh trước khi gõ, vẫn 22 sau khi gõ/chuyển từ khoá. Đổi tab bảng thì **xoá từ khoá**
    (từ khoá gõ cho pod mang sang bảng deployment là lọc nhầm bảng khác, và người dùng sẽ tưởng bảng kia
    rỗng). Không hàng nào khớp ⇒ câu giải thích + nút xoá từ khoá, không phải bảng trắng.
14. **Lọc log chạy trên chữ ĐÃ tải về**, mặc định **giấu** dòng không khớp ("lọc" đúng nghĩa), nút bên cạnh
    đổi sang chế độ **chỉ tô sáng** để giữ mạch log xung quanh; đổi pod thì **xoá từ khoá** (log của pod
    khác). Trần `MAX_VIEW_LINES = 2000`: log 5000 dòng vẫn nằm trong bộ nhớ và được **đếm ra**
    (`{shown}/{total}`) chứ không dựng 5000 phần tử DOM. Đổi `type="search"` → `type="text"` ở hai ô mới vì
    Chromium vẽ thêm nút ✕ của riêng nó ⇒ hai dấu ✕ cạnh nhau (hai ô tìm của tab Logs giữ `type="search"` và
    dựa vào nút gốc đó).
15. **Mục _Báo cáo_ chỉ tính từ hai bảng người dùng ĐÃ đọc, và tự khai nó là công thức.** Không RPC riêng,
    không gọi thêm cluster: `useInfraKubeReport.ts` gom `kube.pods`/`kube.deployments` thành chỉ số, điểm
    0–100 (55% pod sẵn sàng · 35% bản sao deployment · 10% khởi động lại, **mỗi phần chỉ tính khi CÓ dữ liệu**
    nên cụm chỉ có pod không bị trừ điểm vì "không có deployment") — và mọi chỗ hiện con số đều kèm
    "tự tính / không phải SLA". Chưa đo được gì ⇒ đèn **xám** + `—`, tuyệt đối không phải 0 điểm xanh
    (`'—' ≠ 0`). Pod `Completed` (Job/CronJob) **không** tính là chưa sẵn sàng, nhưng vẫn được **nói ra**
    ("N pod đã chạy xong") để "3/5 sẵn sàng" không thành câu đố. **Theo dõi là hành động có người bấm**: mặc
    định tắt, 30s/lượt, trần 15 phút, và `onBeforeUnmount` dừng ngay khi rời mục — đo được 0 lệnh `infra.kube`
    trong 40 giây sau khi rời mục Báo cáo. Một màn "monitor" tự nạp theo nhịp là đúng thứ luật 9 cấm.

**Dùng nhánh kubectl (3 bước, không gõ terminal):**

1. Cắm kubeconfig vào máy (`aws eks update-kubeconfig --name <cluster> --region <r> --profile <p>`,
   hoặc copy file có sẵn vào `~/.kube/config`; `KUBECONFIG` nhiều file cũng đọc, file đầu thắng).
2. Trong phiên, bấm chip **⎈ · Chọn cluster** → chọn _Context_ + _Namespace_ (để trống namespace =
   theo context). Chip đọc `~/.kube/config`, chỉ hiện tên + API server; token/cert không rời file.
3. Nếu máy có `kubectl` ngoài allowlist đường dẫn (OrbStack/asdf/nvm), popover hiện
   **"Bảo lãnh đường dẫn này"** — bấm một lần rồi `kubectl_cli` mới chạy được.

Danh tính để kubectl xác thực **không** phải "account" như AWS: nó nằm ngay trong user block của
kubeconfig — static SA token (như `readonly-context` trên máy này, token không có `exp`), client
cert, hoặc `exec: aws eks get-token`. Chỉ loại `exec` mới cần profile AWS, và đó là lý do luật 5 ở
dưới tồn tại.

**Bề mặt mới cho nợ 0.1b:** cơ chế bảo lãnh đường dẫn binary (`infra.policy.vouchBinary`)
trước đây **không có UI nào gọi**, nên trên máy có `kubectl` qua OrbStack
(`/usr/local/bin/kubectl` → `/Applications/OrbStack.app/…`, ngoài allowlist prefix) thì
`kubectl_cli` luôn trả "Không tìm thấy kubectl". Nay `infra.status` trả thêm `rejectedPath` và
hai chip hiện khối **"Bảo lãnh đường dẫn này"** (`InfraToolBinaryHint.vue`) — một cú bấm, không
phải gõ terminal.

**Chưa đo trên máy thật:** chip và RPC mới chỉ chạy qua test đơn vị + một lượt đọc kubeconfig
THẬT (`~/.kube/config` trên máy này: context `readonly-context`, SA `system:serviceaccount:default:developer`).
`kubectl_cli` đầu-cuối **chưa chạy được** cho tới khi bấm bảo lãnh đường dẫn kubectl.

Gates đã chạy (EXIT 0, tại thời điểm ghi):
`cd apps/desktop/sidecar && pnpm typecheck && npx vitest@2 run` → 73 file / 1346 test ·
`cd apps/desktop/ui-next && pnpm typecheck && pnpm lint` → typecheck im lặng, design-token OK.

**Chưa đo trên dữ liệu thật:** máy này không có phiên SSO sống, nên toàn bộ đường
CloudWatch (`describe-log-groups`, `start-query`, `get-query-results`, `tail`) mới chỉ
chạy qua mock. Trước khi coi L1–L3 "đã nghiệm thu" thì cần một lượt đo thật.

**Nợ Mốc 1 (Việc 1) còn nguyên** — phiên này chỉ làm Việc 2: N1 (QA trong Electron
thật — phải chạy app) · N2 (tách commit — cần người dùng quyết) · N3 (infosec
re-audit) · N4 (5 SFC > 250 dòng) · N5 (gom mã lỗi + cặp khoá en/vi cho mã SSO/nhập) ·
N6 (`AwsProfile` thiếu `ssoRegion`/`externalId`/`durationSeconds`/`credentialProcess`) ·
N7 (`aws sso login` vẫn huỷ mềm; `aws login` đã huỷ cứng).

## ✅ Phiên 2026-09-14 (sáng) — trạng thái chờ, khoá nút, phản hồi

Người dùng yêu cầu: _"thiếu màn loading khi thay đổi data, nhấn các action cũng thiếu animation/loading/
disable tránh race condition, các action update/xoá phải có popup confirm, thành công thất bại phải có
toastr"_. Đã land **trong cây làm việc, CHƯA COMMIT** (nhánh `feature/aws-infra`):

| Chỗ                                                                      | Việc đã làm                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useInfraKube.ts`                                                        | `restarting`/`deleting` (giữ tên) · `workloadBusy` · `loadEpoch` + `restartWorkloadLoad()` · `loadWorkload(withNamespaces)` + `loadFailure()` báo toast khi lượt nạp hỏng · `announceOutFailure()` cho khung log/mô tả · `findClusters`/`addCluster` trả cờ trong `finally` · `copyCommand` báo lỗi khi clipboard không ghi được |
| `InfraKubeWorkloads.vue`                                                 | khung xương / làm mờ (`.ikdim`) · hàng không bấm được khi đang nạp · nút _Khởi động lại_ chỉ quay ở đúng hàng đang chạy và khoá phần còn lại                                                                                                                                                                                     |
| `InfraKubeTableSkeleton.vue` (mới)                                       | khung xương 7 hàng, có `prefers-reduced-motion` + `role="status"`                                                                                                                                                                                                                                                                |
| `InfraKubeClusters.vue` · `InfraKubernetes.vue` · `InfraKubeOutPane.vue` | icon quay + `aria-busy` trên mọi nút đang chạy; khoá ô chọn/tab/nút trong lúc chạy; dòng "đang nạp" trong modal log                                                                                                                                                                                                              |
| `InfraToolBinaryHint.vue`                                                | bảo lãnh đường dẫn có toast **thành công** (sidecar đã ghi nhật ký) lẫn **thất bại**                                                                                                                                                                                                                                             |
| `utils/clipboard.ts`                                                     | `copyText` trả `boolean` (người gọi cũ bỏ qua giá trị ⇒ không đổi hành vi)                                                                                                                                                                                                                                                       |
| `assets/css/app-shell.css`                                               | `.ikspin` · `.ikdim` · `.ikoff` · `.ikload` · phản hồi `:active` cho nút (kể cả trong modal Teleport) + nhánh `prefers-reduced-motion`                                                                                                                                                                                           |
| `InfraKubernetes.vue`                                                    | `withPinned()`: ô chọn cluster/namespace luôn chứa giá trị đang ghim — lượt đọc danh sách hỏng thì ô chọn cũ trước đây hiện placeholder ("chưa chọn cluster") trong khi app vẫn ghim cluster đó                                                                                                                                  |
| i18n                                                                     | `infra.kube.error.refresh` · `infra.kube.restart.failed` · `infra.kube.delete.failed` · `infra.kube.add.failed` · `infra.kube.blocked.copyFailed` · `infra.binary.vouchDone` · `infra.binary.vouchStillBroken` (vi+en, 175 khoá mỗi bên)                                                                                         |

Popup xác nhận **không** dựng mới: `rollout restart` (`write`) và `xoá pod` (`destructive`) đã đi qua hộp
duyệt hạ tầng sẵn có — `write` ⇒ hỏi + vé dùng một lần, `destructive` ⇒ mặc định **chặn**, hiện đúng dòng
lệnh + "chép lệnh", và nút chỉ bật khi gõ lại đúng tên pod.

Gates đã chạy (EXIT 0): `cd apps/desktop/ui-next && pnpm typecheck && pnpm lint` → design-token OK ·
i18n vi/en 175 khoá, 0 lệch. **Chưa** bấm thử trong Electron thật.

Đã đo bằng Playwright trên dev server (`localhost:3031`, `window.awog.request` giả): khung xương 7 hàng khi
nạp lần đầu · hàng ở lại + mờ khi bấm ↻ (kèm icon quay, nút ↻ và ô chọn cluster bị khoá) · đổi namespace thì
xoá hàng và hiện khung xương · hộp duyệt `write` khi _Khởi động lại_ · toast đỏ "Không khởi động lại được
web." + stderr của kubectl khi lệnh hỏng, nút trở lại bình thường sau đó · hộp duyệt `destructive` khi xoá pod
(nhánh **chặn**: "AWOG không chạy lệnh này" + chép lệnh; nhánh **ask**: ô gõ lại tên pod, nút Xác nhận chỉ bật
khi gõ đúng) · toast khi lượt nạp hỏng · toast thành công **và** thất bại của _Bảo lãnh đường dẫn_ · icon quay
ở màn Tài khoản khi đọc `~/.aws`. Ảnh: `/tmp/kube-l1-skeleton.png` … `/tmp/kube-l11-vouch-ok.png`.

## ✅ Phiên 2026-09-14 (khuya) — tìm kiếm, lọc log, mục Báo cáo

Người dùng yêu cầu: _"thiếu input search, trong logs thiếu input filter, thiếu màn report, monitor, đánh giá
theo các metric"_. Đã land **trong cây làm việc, CHƯA COMMIT** (nhánh `feature/aws-infra`):

| Chỗ                           | Việc đã làm                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InfraKubeWorkloads.vue`      | ô **tìm** trong bảng đang xem (khớp tên hoặc bất kỳ ô nào, đếm `Khớp {shown}/{total} hàng`, nút xoá, khối "không hàng nào khớp" + đường thoát) · mục thứ ba của `seg`: **Báo cáo** · `type="text"` cho ô tìm (xem luật 14)                                              |
| `InfraKubeOutPane.vue`        | thanh **lọc dòng** cho log/describe: ô nhập + số dòng khớp, nút đổi _Chỉ dòng khớp ⇄ Tất cả dòng_, trạng thái "không dòng nào khớp", trần 2000 dòng có đếm ra · xoá từ khoá khi đổi pod                                                                                 |
| `useInfraKubeReport.ts` (mới) | toàn bộ phép tính của mục Báo cáo: `splitReady()` · `statusRate()` · chỉ số pod/deployment · **điểm sức khoẻ** 0–100 · đèn 4 mức · `findings[]` (câu nói rõ cái gì lệch) · mẫu xu hướng trong bộ nhớ phiên + vòng **theo dõi** có trần · `reportText` để chép/gửi agent |
| `InfraKubeReport.vue` (mới)   | màn Báo cáo: đèn + điểm + kết luận, 4–5 ô chỉ số, thanh phân bố theo trạng thái + chú giải, top khởi động lại, danh sách phát hiện, dải xu hướng (2 đường + chú giải), nút _Theo dõi_ / _Dừng theo dõi_, _Sao chép báo cáo_, _Hỏi agent_                                |
| `useInfraKube.ts`             | `loadedAt` (mốc "đọc lúc …")                                                                                                                                                                                                                                            |
| i18n                          | 59 khoá `infra.kube.search.*` · `infra.kube.log.*` · `infra.kube.report.*` (vi+en, 234 khoá mỗi bên)                                                                                                                                                                    |

Số liệu của mục Báo cáo **không** có nguồn riêng: nó là cách nhìn khác của đúng hai bảng người dùng vừa nạp
(xem luật 15). Vì vậy nó không tốn thêm giây nào của cluster và không cần hộp duyệt mới.

Đã đo bằng Playwright trên dev server (`localhost:3031`, `window.awog.request` giả):

- **Tìm trong bảng**: gõ `crashloop` ⇒ 1/6 hàng (khớp ô trạng thái) · `api-7d9c` ⇒ 2/6 · `0/2` ⇒ 1/6 (khớp ô
  _Sẵn sàng_, không phải tên) · `zzz` ⇒ khối "Không hàng nào khớp" + nút xoá hoạt động · **số lệnh RPC không
  đổi** trong suốt quá trình gõ (lọc tại chỗ) · chuyển tab ⇒ từ khoá được xoá.
- **Lọc log**: mở pod → gõ `error` ⇒ còn đúng dòng ERROR, "1/5 dòng khớp" · bấm _Tất cả dòng_ ⇒ 5 dòng, chỉ
  dòng khớp có nền + vạch trái · `zzz` ⇒ "0/5 dòng khớp" + "Không dòng nào khớp" và **không** vẽ `pre` rỗng.
- **Báo cáo**: cụm 6 pod (5 tính điểm: 3 ready, 1 `Completed`, 7+2 lần restart) + 3 deployment ⇒ điểm **69**,
  đèn **đỏ**, ô `3/5` (60%) · `Deployment đủ bản sao 2/3` · top khởi động lại `api-7d9c-def 7` / `worker-5f-xyz 2`.
  Cụm sạch chỉ có pod ⇒ điểm **100**, đèn **xanh**, và **không** có ô deployment (thay vì "0/0 đủ bản sao").
  Chưa đọc được gì ⇒ đèn **xám**, **không** có điểm, câu "Chưa đọc được pod/deployment nào…".
- **Theo dõi**: bấm ⇒ icon ↻ quay + `aria-busy` + nhãn đổi _Dừng theo dõi_; sau lượt đọc thứ hai thì dải xu hướng
  hiện (2 đường có chú giải) · đổi dữ liệu rồi ↻ ⇒ đường đi xuống đúng chiều · rời mục ⇒ **0 lệnh `infra.kube`
  trong 40 giây** (vòng lặp đã dừng theo `onBeforeUnmount`).
- **Một màn**: `document.scrollingElement.scrollHeight - clientHeight = 0` ở cả ba mục (Pods · Báo cáo · rỗng).

Gates: `cd apps/desktop/ui-next && npx eslint <6 file đã sửa>` im lặng ·
`node scripts/check-design-tokens.mjs` → OK · i18n vi/en **234 khoá, 0 lệch**.
`pnpm typecheck` **toàn repo lúc ghi đang đỏ** vì phần _Explorer/Dịch vụ/Nhật ký/Bubble_ đang được một phiên
khác viết dở trong cùng cây làm việc (`InfraAskTargetDialog.vue`, `useInfraAuditLog.ts` — cùng một lỗi
`const confirm = useConfirm()` thiếu destructure, và `pages/infra.vue` đang thêm tab); các lỗi đó **không** nằm
trong file của phiên này. Lỗi thật đã bắt được và vá trong phiên này: `InfraKubeReport` **không resolve được**
thành component (Nuxt đăng ký component lúc khởi động dev server, file mới thêm sau đó không có trong sổ đăng
ký) ⇒ thêm import tường minh, đúng khuôn 144 file khác trong repo.

## ✅ Phiên 2026-09-14 (khuya 2) — Region của profile static: bịt chỗ im lặng

Người dùng báo: _"tôi đặt Region rồi mà khi lưu xong ra ngoài vẫn hiển thị chưa có"_. Đã land **trong cây làm việc, CHƯA COMMIT** (nhánh `feature/aws-infra`):

| Chỗ                        | Việc đã làm                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AwsRegionField.vue`       | `manual` chỉ bật khi giá trị đang có là region **không** nằm trong danh sách ⇒ ô rỗng ra **dropdown** chứ không còn là ô gõ tay trống trơn; prop `hintTone: 'info' \| 'warn'`                                                                      |
| `AwsProfileEditor.vue`     | `regionMissing` (kiểu `static` · ô trống · trên đĩa cũng trống) ⇒ **nút Lưu khoá**; lý do ở câu `--amber` dưới ô Region **và** một dòng ngắn ở footer (câu dưới ô bị `.lem-body` cuộn ra ngoài tầm nhìn ở cửa sổ thấp); bỏ hẳn hộp thoại "Vẫn lưu" |
| `InfraAccountsDetail.vue`  | hàng Region trống đọc "Chưa đặt (lệnh AWS sẽ báo thiếu Region)" + màu `--amber` (nhãn cũ "theo mặc định của CLI" đã bỏ vì sai)                                                                                                                     |
| `assets/css/prototype.css` | `.btn:disabled { opacity: .5; cursor: not-allowed }` — nút `:disabled` trước đây trông y hệt lúc bật (chỉ `.gsecbtn`/`.iact` có luật này), nên validate chặn Lưu thì người dùng thấy nút xanh bấm không có gì xảy ra                               |
| i18n                       | `infra.editor.region.requiredHint` · `infra.editor.region.requiredFooter` · `infra.editor.requiredLegend` · `infra.list.value.regionUnset` — vi+en **87/87 · 106/106 khoá, 0 lệch**                                                                |

**Đọc dấu vết trên máy trước khi sửa (đừng đoán):** `main.log` 01:32:13.932 có
`aws: ini unchanged, skipping write` cho **cả** `config` lẫn `credentials` ⇒ lượt Lưu đó không ghi gì, tức
payload không mang `region` (`output: json` đã có trên đĩa từ 01:16:41) · `~/.awog/aws-backups/` chỉ có **2**
bản `config.*` cho **3** lượt `profile_save` trong nhật ký ⇒ lượt 01:32:13 không sinh bản sao nào · bản chụp
trước lượt 01:34:41 cho thấy profile còn **chưa** có `region`, và `region = ap-northeast-1` chỉ xuất hiện sau
lượt đó · ba lượt `NoRegion` (01:17:21 · 01:33:42 · 01:34:00) trong `~/.awog/infra-audit/2026-09.jsonl` chứng
minh `[default] region = ap-northeast-1` **không** cứu được profile khác.

Lượt 01:32 **không** hỏng ở tầng ghi ("vắng mặt = giữ nguyên" là luật đúng); chỗ hỏng là AWOG **im lặng** về
kết quả đó. Nên bản vá không phải "làm region được ghi" mà là làm nó **không thể im lặng** — xem luật 7.

Người dùng đọc lại hộp xác nhận và thấy câu chữ chưa rõ; sau đó yêu cầu **siết thành validate** thay vì thông báo. Hai lượt sửa đó, theo thứ tự:

- **Viết lại câu chữ** (bỏ câu "quay lại để chọn…", bỏ dấu gạch dài, tách thành hai câu ngắn). Không đổi hành vi.
- **Bỏ hẳn hộp thoại "Vẫn lưu"**: thiếu Region giờ là điều kiện KHÔNG hợp lệ của form (`regionMissing` trong `canSave`), nút Lưu khoá, câu yêu cầu hiện ở ô Region. Khoá i18n: xoá `infra.editor.regionMissing.*` và `infra.editor.region.missingHint`, thêm `infra.editor.region.requiredHint`.
  Lý do không giữ "hỏi rồi vẫn ghi": người dùng không tự nguyện chọn "không Region" — họ bấm Lưu và nhận một profile hỏng. Một hộp thoại để bấm cho qua không sửa được điều đó.

Đã đo lại: sidecar thật (code hiện tại) trên một `~/.aws` tạm dựng đúng trạng thái 01:32 ⇒ không region =
`unchanged, skipping write` + `backups: []`; có region = ghi `region = ap-southeast-1` đúng section + một bản
sao lưu · UI trên `localhost:3031` (`window.awog` giả): mở profile chưa có region ⇒ dropdown + tự dò `default`
⇒ `ap-northeast-1` kèm câu "Tự dò từ profile `default` của máy", chọn "Chưa đặt" ⇒ cảnh báo amber + hộp xác
nhận và **0 RPC** `infra.profile-save`, chọn `ap-southeast-1` ⇒ payload `{region, output}` và màn chi tiết sau
khi lưu hiện `ap-southeast-1`. Gates: `npx prettier --check` 8 file đã sửa · `pnpm typecheck` · `pnpm lint`.

**Chưa đo được:** nguyên văn mã renderer chạy đúng lúc 01:32 (file chưa từng commit, đã bị ghi đè) ⇒ cơ chế
"ô Region hiện ra như ô gõ tay trống trơn" là kết luận từ việc dựng lại hành vi đó trên dev server, không phải
đọc lại bản build lịch sử. Toàn bộ lượt đo chạy trên dev server + `window.awog` giả, **chưa** chạy trong Electron.

### Nối tiếp cùng lượt: dấu `*` cho trường bắt buộc

Người dùng hỏi _"các trường required không có dấu * à?"_. Thêm `<span class="ape-req" aria-hidden="true">*</span>`
(`--danger`, `font-weight: 700` — cùng vocabulary với `.sse-req`/`.vpe-req` của SshEditor/VpnEditor) vào nhãn của
**đúng** những ô đang chặn `canSave()`: Tên profile (mọi lượt) · Access key ID + Secret access key (static, tạo mới) ·
Region (static, tạo mới hoặc profile trên đĩa chưa có region) · `sso_session` **hoặc** Start URL + SSO region, Account ID,
Tên role (sso, tạo mới) · Role ARN + Profile nguồn (assume-role, tạo mới). Lượt SỬA không có dấu vì ô trống là "giữ
nguyên" (S2a) — nói cách khác dấu `*` không bao giờ nói sai về ô đang chặn Lưu. `AwsRegionField.vue` nhận prop `required`
(component không tự suy được: cùng ô Region, lượt tạo thì bắt buộc còn lượt sửa thì không), `regionRequired` là bản ổn
định của `regionMissing` (nhãn không được bỏ dấu ngay khi người dùng vừa điền ô), và chú giải
`infra.editor.requiredLegend` ("Ô có dấu * là bắt buộc.") đứng đầu form.

Đo trên `localhost:3031` + `window.awog` giả (1440×900) — tạo mới static: `Tên profile *` · `Access key ID *` ·
`Secret access key *` · `Region *`, `Lưu` disabled; tạo mới sso/session: dấu ở `Tên sso_session` + `Account ID` +
`Tên role` còn Region của profile **không** dấu (đúng `canSave`, đây là lỗ hổng đã biết); sso/manual: `SSO start URL *` +
`SSO region *` + Account ID + Tên role; assume-role: `Role ARN *` + `Profile nguồn *`; sửa `team-alpha` (đã có region):
chỉ còn `Tên profile *`, `Lưu` bật; sửa profile không có region trên đĩa: `Region *` và `Lưu` khoá. Dấu `*` tính ra
`rgb(239, 68, 68)`/`700`. Gates: `npx prettier --check` · `npx eslint` · `node scripts/check-design-tokens.mjs`.

## ✅ Phiên 2026-09-14 (sáng) — profile `login`: sửa được tên, và không đẻ profile thứ hai

Người dùng báo: _"đang login rồi nhưng edit thì vẫn hiện signin lại, sau đó lại tạo 2 profile"_
(2 ảnh: modal Sửa của `hoatq.dev` chỉ có panel chỉ-đọc + nút Đăng nhập lại; danh sách có `console` và
`hoatq.dev` cùng account `797859922771`).

**Chẩn đoán từ dấu vết trên máy (đừng đoán).** `~/.aws/config` có HAI profile cùng
`login_session = arn:aws:iam::797859922771:root` · `~/.awog/aws-backups/` cho thấy lượt ghi 01:36:35Z tạo
`[profile console]` (bản chụp trước đó chưa có nó) và lượt 01:37:12Z tạo `[profile hoatq.dev]` (bản chụp
trước đó ĐÃ có `console`) ⇒ hai lần `aws login` cách nhau 37 giây, cùng một tài khoản ·
`~/.awog/infra-audit/2026-09.jsonl`: `console_login --profile console --region ap-southeast-2`
(01:36:35) rồi `console_login --profile hoatq.dev --region ap-southeast-2` (01:37:12), mỗi lượt kèm một
`resolve_account_id`; `durationMs` của lượt hai là **7865ms** — không ai gõ account/username/mật khẩu
trong 8 giây, tức trình duyệt đã dùng lại phiên Console (`same-device`).
**Gốc rễ:** tên profile được hỏi TRƯỚC khi đăng nhập, mặc định `console`, và KHÔNG đổi được sau đó
(màn Sửa chỉ có panel chỉ-đọc) ⇒ muốn tên khác thì phải đăng nhập lần nữa, mà đăng nhập với tên khác là
TẠO PROFILE THỨ HAI. Phần "vẫn hiện signin lại" là cùng một panel chỉ-đọc: nó không nói gì về việc phiên
đang sống.

Đã land **trong cây làm việc, CHƯA COMMIT** (nhánh `feature/aws-infra`):

| Chỗ                                     | Việc đã làm                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar/infra/aws/profiles.ts`         | `AwsProfile.loginSession` — lộ `login_session` (ARN định danh phiên, **không phải secret**) để UI biết profile nào đang có phiên nào                                                                                                                                                                          |
| `sidecar/infra/aws/profile-ops.ts`      | `assertLoginEdit()`: `kind: 'login'` CHỈ hợp lệ khi `previousName` là một profile `login` có sẵn (đổi tên/region); tạo mới bằng form, đổi kiểu khỏi `login`, ghi đè một profile `login`, và gửi `login_session` trong payload đều ném `LOGIN_READONLY`; `staleConfigKeysFor` dọn `login_session` khi kiểu đổi |
| `AwsProfileEditor.vue`                  | `kind === 'login'` đi vào form thật: Tên + Region, KHÔNG có ô đổi kiểu, KHÔNG có hint "để trống = giữ nguyên" (không còn ô nào để trống); `canSave` = "có gì đã đổi"; `regionMissing` phủ cả `login`                                                                                                          |
| `AwsProfileEditorLoginFields.vue` (mới) | Panel phiên: account id rút từ ARN, ARN phiên, cảnh báo `otherProfilesWithSameSession()` ("cùng phiên này còn có profile: console"), nút Đăng nhập lại; xoá `AwsProfileEditorLoginView.vue` (chỉ-đọc)                                                                                                         |
| `AwsConsoleLogin.vue`                   | Mở từ màn Sửa ⇒ ô TÊN **readonly** + câu giải thích ("đổi tên thì sửa ở màn Sửa"); luồng toolbar vẫn sửa được tên và gợi ý `console-2` khi `console` đã bị chiếm                                                                                                                                              |
| `utils/aws-profile-view.ts`             | `accountIdOfLoginSession`, `otherProfilesWithSameSession`; `accountIdOfProfile` đọc thêm `loginSession` ⇒ profile `login` hiện account id ngay, không phải chờ `resolve_account_id`                                                                                                                           |
| i18n                                    | vi+en **92/92 · 59/59 · 106/106 khoá, 0 lệch** (`infra.editor.login.*`, `infra.editor.error.LOGIN_READONLY`, `infra.login.reloginNameLocked`)                                                                                                                                                                 |

**Đo được.** Sidecar: `npx vitest@2 run` — **83 file / 1516 test pass**, thêm 7 ca cho luật mới (đổi tên giữ
nguyên `login_session` và chỉ còn MỘT dòng `login_session`; đổi region; tạo mới bằng form bị chặn; đổi kiểu
khỏi `login` bị chặn; ghi đè profile `login` bị chặn; `login_session` trong payload bị chặn; `listAwsProfiles`
lộ đúng `loginSession`) · `npx tsc --noEmit` sạch. UI trên `localhost:3031` + `window.awog` giả (1440×900):
sửa `hoatq.dev` ⇒ không có seg kiểu, panel hiện `Tài khoản 797859922771` + ARN phiên + cảnh báo trùng phiên
với `console`, Lưu **disabled**; đổi tên ⇒ payload `{name, previousName, kind:'login', config:{}}` (không có
`login_session`); đổi Region ⇒ `config:{region:'ap-southeast-1'}`; bấm Đăng nhập lại ⇒ modal tên `hoatq.dev`
`readonly=true` kèm câu khoá; luồng toolbar ⇒ tên `console-2`, sửa được. Gates: `npx eslint` toàn `ui-next` ·
`check-design-tokens` · `prettier --check` · `nuxt typecheck`.

**Chưa đo:** toàn bộ lượt UI chạy trên dev server + RPC giả, **chưa** chạy trong Electron; và nhánh
`aws login` thật (trình duyệt) vẫn chưa có lượt chạy đầu-cuối — nợ cũ N1.

**Chặn nốt đường đẻ profile thứ hai (bổ sung cùng lượt).** Đổi tên được là điều kiện cần, nhưng nút _Nhân
bản_ vẫn tạo ra một cặp trùng phiên bằng một cú bấm. `duplicateProfile()` giờ từ chối profile `login`
(`LOGIN_READONLY`), và UI dịch mã đó thành câu người đọc được thay vì để lộ message thô của sidecar —
`LOGIN_READONLY` được thêm vào `PROFILE_ERROR_I18N` (`useAwsProfileErrorMessage.ts`); trước đó nó rơi vào
nhánh fallback nên toast hiện nguyên `LOGIN_READONLY: profile "…" is a Console sign-in profile…`. Chiều
ngược lại vẫn mở: xoá profile `login` chạy bình thường (`deleteProfile` chỉ chặn `credential_process`),
nên dọn cặp trùng phiên đang có trên máy = đổi tên một cái rồi xoá cái kia.

**Đo lại sau lượt đó.** `npx vitest@2 run` **83 file / 1517 test pass** · `tsc --noEmit` sạch · `eslint` +
`check-design-tokens` sạch · i18n vi/en **92/92 · 59/59 · 107/107 khoá, 0 lệch** · Playwright trên
`localhost:3031` (RPC giả): bấm _Nhân bản_ trên `hoatq.dev` ⇒ prompt "Nhân bản 'hoatq.dev' — tên profile
mới", gửi đi ⇒ toast **đỏ** "Đây là profile đăng nhập Console (aws login) — form chỉ đổi được tên và
Region. Muốn có thêm profile khác thì đổi tên profile này, hoặc xoá nó rồi tạo mới." và danh sách vẫn đúng
hai hàng (`console`, `hoatq.dev`) — không sinh profile thứ ba.

## Bối cảnh

Repo **AWOG** (`/Users/kyro/KyroTech/Projects/awog`), nhánh `feature/aws-infra`. Họ tính năng **Hạ tầng** cho phép người dùng và agent làm việc với AWS/Kubernetes/Terraform ngay trong app.

**Mốc 0 đã commit. Mốc 1 (A1–A6) + A7 + A8 đã code xong nhưng CHƯA COMMIT** — 51 file đang nằm trong cây làm việc.

⚠ Cây còn **72 file dở dang KHÔNG liên quan** đến hạ tầng (browser panel, ssh forward, theme-cute, prototype.css…). Đừng commit chúng. Lọc bằng `git status --porcelain | rg "infra|aws"`.

## Trạng thái đo được (chạy lại để xác nhận, đừng tin số này)

```bash
cd apps/desktop/sidecar && pnpm typecheck && npx vitest@2 run   # EXIT 0 · 64 file / 1214 test
cd apps/desktop/ui-next && pnpm typecheck && pnpm lint          # EXIT 0 · design-token OK
```

## Đọc trước khi code

| Thứ tự | Tài liệu                                       | Vì sao                                                         |
| ------ | ---------------------------------------------- | -------------------------------------------------------------- |
| 1      | `docs/decisions/0088-session-infra-context.md` | ADR gốc — luật nền của cả họ                                   |
| 2      | `docs/features/infra.tasks.md`                 | Kế hoạch 8 mốc; **Mốc 2 ở đây**                                |
| 3      | `docs/features/aws-profile-manager.md`         | Mốc 1 đã ship — mục "Điểm lệch có chủ đích" ở cuối             |
| 4      | `docs/features/infra-milestone-1.prompt.md`    | Prompt của phiên trước, để hiểu vì sao code trông như hiện tại |
| 5      | `.claude/rules/security.md`                    | 8 invariant AWOG                                               |
| 6      | `.claude/rules/nuxt-vue.md`                    | Guard design-token làm `pnpm lint` **FAIL** nếu vi phạm        |

## Mốc 1 để lại gì cho bạn dùng

**Sidecar** (`apps/desktop/sidecar/src/`)

- `infra/aws/ini.ts` — parser INI **allowlist-key**, chỉ đọc, vứt secret ngay trong vòng lặp parse
- `infra/aws/ini-edit.ts` · `backup.ts` · `write.ts` — trình soạn INI phẫu thuật + sao lưu 20 bản + ghi nguyên tử có verify/rollback. **Mọi đường ghi `~/.aws` phải qua `applyAwsIniEdits`**
- `infra/aws/profile-ops.ts` · `import-export.ts` · `sso.ts` · `sso-sources.ts` · `account-ids.ts`
- `infra/run.ts` — `runInfra()`, **cổng DUY NHẤT ra CLI**; tự `recordInfraAction`, tự chèn `--profile`/`--region` từ `req.context` (argv tự mang hai cờ đó sẽ bị từ chối)
- `infra/classify.ts` — allowlist cặp `(service, operation)`; `infra/policy.ts` — ma trận quyền; `infra/audit/store.ts` — nhật ký JSONL
- **20 method `infra.*`** đã đăng ký ở `src/index.ts`

**UI** (`apps/desktop/ui-next/`)

- `pages/infra.vue` + `composables/useInfraPage.ts` (page-controller) + `composables/useAwsProfilesApi.ts` (wrapper RPC typed — **đọc file này trước khi gọi RPC nào**)
- `components/infra/` — 17 SFC: danh sách/chi tiết, form theo kiểu, wizard nhập 3 nguồn, wizard SSO 4 bước, xuất 2 chế độ
- `components/session/InfraChip.vue` — chip ngữ cảnh; `composables/useConfirm.ts` có `kind: 'infra'`
- i18n `i18n/locales/{en,vi}/infra-*.json` — 8 file, en/vi khớp khoá

## Việc 1 — dọn nợ trước khi mở mốc mới

| #      | Việc                                                                                                                                                                                                                                                                                                                  | Cỡ  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **N1** | **QA trong Electron THẬT** — chưa ai nhìn `/infra` render. Xem N1 bên dưới                                                                                                                                                                                                                                            | M   |
| N2     | **Tách commit** 51 file theo loại (sidecar core · RPC · UI · i18n · docs), không trộn                                                                                                                                                                                                                                 | S   |
| N3     | **infosec re-audit** trên bộ code SAU vá — lượt audit vừa rồi soi bộ code _trước_ khi vá                                                                                                                                                                                                                              | M   |
| N4     | 5 SFC vượt ~250 dòng: `AwsProfileExport` 648 · `InfraAccounts` 642 · `InfraAccountsDetail` 570 · `AwsProfileEditor` 513 · `AwsSsoImport` 487. Đẩy state machine vào `useAwsProfileImportWizard`/`useAwsSsoImportWizard`                                                                                               | M   |
| N5     | Gom mã lỗi về một `infra/aws/errors.ts` + **một** composable dịch mã ở UI (hiện có ba: `useAwsProfileErrorMessage`, `writeErrorCode`, `friendlyExportError`). Nhóm mã SSO và mã nguồn nhập **chưa có cặp khoá en+vi** nên hiện nguyên văn tiếng Anh trong banner tiếng Việt                                           | S   |
| N6     | `AwsProfile` thiếu `ssoRegion`/`externalId`/`durationSeconds`/`credentialProcess` ⇒ form SSO-thủ-công và assume-role mở với ô rỗng dù file đã có giá trị (an toàn nhờ luật "vắng mặt = giữ nguyên", nhưng người dùng không đối chiếu được)                                                                            | S   |
| N7     | Huỷ khi đang chờ `aws sso login` mới chỉ huỷ **mềm** phía UI — tiến trình `aws` chạy tới hết 180s. Sửa đúng cần `infra.cancel` + registry tiến trình. **Đã trả một nửa cho `aws login`:** `infra.console-login-cancel` + `AbortSignal` của `runInfra` giết được tiến trình; `aws sso login` vẫn dùng đường huỷ mềm cũ | M   |

**N8 — đã xong 2026-09-13.** Người chỉ có `Account ID/alias + IAM username + Password` trước đây
không có đường nào trong app. Nay có hai lớp: khối `AwsProfileCredentialHelp.vue` (2 đường + 2
link tĩnh + nhánh "org chặn khoá dài hạn") đặt đúng chỗ đang tắc, và đường đi thật —
**Thêm profile → Đăng nhập Console** chạy `aws login` trong app (RPC `infra.console-login`, kind
`login`, editor chỉ đọc, nút "Đăng nhập lại"). Chi tiết ở `aws-profile-manager.md`
§"Đăng nhập Console" + §"Lấy credential ở đâu".

⚠ **Chưa QA luồng trình duyệt đầu-cuối** (cùng số phận với N1). Huỷ giữa chừng giờ là huỷ CỨNG
(`infra.console-login-cancel`), và ca **400 Bad Request** gặp lần thử đầu tiên đã được truy tới
đúng nguyên nhân — lỗi đã biết của aws-cli ([aws/aws-cli#10186](https://github.com/aws/aws-cli/issues/10186),
cookie AWS cũ trong trình duyệt) — nên AWOG đẩy URL uỷ quyền lên modal và mở thẳng **cửa sổ ẩn
danh bằng một cú bấm** (RPC `infra.console-login-private`, nút chỉ hiện khi phiên còn sống — sau
khi hết giờ thì callback `127.0.0.1` đã chết nên URL cũ vô dụng); xem `aws-profile-manager.md`
§"Lỗi 400 Bad Request…". **Chưa QA trong Electron thật** (chung số phận với N1): chưa đo đường
"ẩn danh" trên máy có cookie cũ.

### N1 — kịch bản QA cụ thể

Chạy `pnpm dev` ở `apps/desktop/ui-next`, mở app Electron, vào `/infra`. **Sửa sidecar thì phải rebuild + restart sidecar** (dev chạy từ `dist`, không watch — dễ nhầm là code không ăn).

1. Danh sách nhóm theo kiểu render đúng; profile thật `229015218011_Offshore-Developer` hiện ra.
2. **Nút Sửa lưu được thật** — lỗi này từng làm mọi lần lưu ném `EXISTS`, đã vá ở tầng RPC nhưng **chưa ai bấm nút thật**.
3. Tên profile dài + đủ 3 tag (kind/mặc định/hết hạn) có wrap đúng không; menu Nhập có bị cắt ở cửa sổ hẹp không.
4. Wizard SSO bước 1: máy này `~/.aws/config` chỉ có `[default]` và `~/.aws/sso/cache/` chỉ có `kiro-auth-token.json` (**không phải** file cache của aws-cli, không có `startUrl`) ⇒ kỳ vọng **không có nguồn nào**, degrade về 3 ô gõ tay kèm câu giải thích.
5. Chọn đích xuất là một symlink/alias trong Finder ⇒ phải ra `FORBIDDEN_TARGET` đã dịch.
6. Bước 4 wizard SSO hiện dòng `clearedStaticKeys` — có vỡ layout không.

## Việc 2 — Mốc 2: Logs & Tổng quan (`infra.tasks.md`, 2.1 → 2.9)

**Xong mốc này thì: dùng AWOG thay Console để soi log hằng ngày.** CloudWatch Insights là **ưu tiên 1** của cả họ tính năng.

Hai ràng buộc của mốc này, có từ ADR chứ không phải gợi ý:

- **Không bao giờ auto-run.** Ước lượng GB quét **trước khi chạy**, `bytesScanned` thật sau khi chạy (2.6). Chi phí CloudWatch do chính app gây ra là rủi ro đã ghi trong `infra.tasks.md`.
- **`logs` là nơi credential/PII hay nằm nhất** trong allowlist `read` — xem "Quyết định còn treo" bên dưới.

## Luật cứng — đừng phá

1. **Bốn luật ghi `~/.aws`** (ADR 0088 §1b): sửa phẫu thuật · sao lưu trước mỗi lần ghi · ghi nguyên tử + `chmod 600` · **agent KHÔNG có đường ghi này**.
2. **Secret không rời sidecar.** Không lưu lại, không log, không event, không nhật ký lệnh, không vào context model, không vào clipboard, không lên màn hình.
3. **Mọi lời gọi CLI qua `runInfra()`.** Không spawn `aws` ở chỗ khác.
4. **Không tự gọi mạng.** Lệnh tốn tiền / dùng credential chỉ chạy sau một cú bấm của người dùng — không `onMounted`, không `watch`, không "nền cho tiện".
5. **Mọi thao tác ghi vào nhật ký** qua `recordInfraAction`.
6. **Tên profile** validate `^[A-Za-z0-9._@:/+=-]{1,128}$` — KHÔNG dùng `SSH_ID_RE`.
7. **"Vắng mặt = giữ nguyên" không áp cho trường mà ô trống nghĩa là profile HỎNG.** Ca đầu tiên: `region` của profile `static` — nó là điều kiện hợp lệ của form (`canSave`), nút Lưu khoá, KHÔNG phải một hộp thoại để bấm cho qua. Thêm trường như vậy thì thêm vào `canSave`, đừng thêm một cảnh báo rồi vẫn ghi.

## Quy ước code

- TS strict, **cấm `any`**, cấm `@ts-ignore`; import nội bộ sidecar có đuôi `.js`
- Comment kỹ thuật **tiếng Việt** (giải thích _vì sao_); identifier + log **tiếng Anh**
- **Không thêm dependency**; `npx vitest@2 run <file>` chạy được dù repo chưa wire runner
- Vue: `<script setup lang="ts">`, `AppSelect` chứ không `<select>` native, màu qua `useTheme()`, **cấm hardcode hex**
- **Design token** (`pnpm lint` FAIL nếu vi phạm): `font-size: var(--fs-*)` cấm `rem` · `line-height: var(--lh-*)` hoặc **px CHẴN**, cấm mọi hệ số không đơn vị kể cả `1` · `border-radius: var(--r-*)` cấm `<n>px` · icon `var(--icon-*)` hoặc px chẵn
- ⚠ Bẫy: template ref dùng `useTemplateRef('x')`, KHÔNG `ref<HTMLElement>(null)`
- i18n en + vi **đủ cặp**, file riêng theo area trong `i18n/locales/{en,vi}/`

## Nghiệm thu

```bash
cd apps/desktop/sidecar && pnpm typecheck && npx vitest@2 run
cd apps/desktop/ui-next && pnpm typecheck && pnpm lint
```

Tất cả EXIT 0. Hiện **1214 test sidecar xanh** — đừng làm đỏ.

Ngoài typecheck, **đo thật**: bài đo chạy trên **bản sao** `~/.aws` trong thư mục tạm (`AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`/`HOME` trỏ vào đó), và `shasum` `~/.aws` phải **giống hệt trước và sau**.

## Món nợ Mốc 1 — biết để không ngạc nhiên

1. **Cache account id KHÔNG phải đầu vào của ma trận quyền, và cố ý thế.** `~/.awog/infra/account-ids.json` được nhớ để **hiển thị**. Đường tới `accountKindOf()` đi qua ngữ cảnh đã ghim (`settings.infra`, khuôn `InfraChip`) và chỉ áp cho profile đang là **mặc định của app** — xem `pinAccountIdForDefault` trong `useInfraPage.ts`.
   Lý do: agent ghi được `~/.awog` bằng `Bash`, và trường `fp` trong file đó **KHÔNG phải chữ ký** — nó băm metadata mà agent đọc được bằng `cat ~/.aws/config`, bằng thuật toán nằm trong chính repo này, nên forge được bằng shell thuần. Muốn nối cache vào ma trận thì **trước đó** `fp` phải là HMAC với khoá trong OS keychain, hoặc giải món nợ #2.
2. **`~/.awog` vẫn trong tầm ghi của agent qua `Bash`.** `PROTECTED_PATH_RE` (`runtime/permission.ts`) chặn `infra-policy.json`, `infra-audit/`, `infra/account-ids.json` — nhưng **so chuỗi**, tức hàng rào độ sâu chứ không kín. Chốt thật: agent không nên có quyền ghi `~/.awog` ngay từ đầu.
3. **`Bash` chưa nhận `AWS_PROFILE`** — `bash-tool.ts` vẫn gọi `filteredShellEnv()` trần, nên lệnh qua `Bash` chạy bằng profile `default`. Cổng quyền vì thế chấm nhánh Bash theo cột `production` vô điều kiện (giải pháp tạm). Luồn env xuống thì gỡ được.
4. **Token SSO đi qua `--access-token file://<file tạm 0600 trong ~/.awog>`**, không qua argv. Đã **đo trên aws-cli 2.35.9** rằng cờ này mở rộng `file://` và nội dung tới API y hệt giá trị truyền thẳng. Hệ quả: `classify()` nâng `sso list-accounts`/`list-account-roles` từ `read` → `write` vì có `file://` — vô hại vì chúng luôn đi với `decision:'approved'`, nhưng là hành vi lệch cần biết.
5. **Luồng SSO chưa chạy trên dữ liệu thật** (máy này không có phiên SSO sống): `sso-login`/`sso-list`/`sso-create-profiles` và nhánh `ok:true` của `identity-check`.
6. **`describeInfraCommand` (permission.ts) là bản sao có chủ đích** của `withContext()` (run.ts). Gộp khi được phép chạm cả hai.
7. **`verifyUntouched` có một vòng chưa được đo** ("unrelated section appeared") — không viết được ca bắn trúng nó qua API công khai. Phòng thủ theo chiều sâu, nhưng chưa có test.

## Quyết định còn treo — ĐÃ CHỐT (2026-09-13)

Đề bài để mở hai lựa chọn: bỏ nhóm `logs` khỏi `read = auto`, hoặc `read/production = ask`.
Đã chọn **cách thứ ba, hẹp hơn cả hai**: chỉ bốn operation `read` mà kết quả **là nội
dung log** (`logs start-query` · `get-query-results` · `get-log-events` ·
`filter-log-events`) bị siết lên `ask` **trên tài khoản production**.

- `AWS_SENSITIVE_READ_OPS` + `sensitiveReadOf()` — `sidecar/src/infra/classify.ts`
- `InfraDecisionInput.sensitiveRead`, lý do `'sensitive-read'` — `sidecar/src/infra/policy.ts`
- Nối vào cổng quyền cho **cả hai** đường (tool của agent và `Bash`) — `sidecar/src/runtime/permission.ts`

Luật chỉ **siết được** (không nới), áp SAU bypass và TRƯỚC `sessionFloor`, nên van xả
tạm thời cũng không mở được đường đưa log production vào context model. Chi tiết + vì sao
không chọn hai cách kia: [cloudwatch-logs.md](cloudwatch-logs.md) §"Quyết định đã chốt".

## Ba bài học từ Mốc 0 và 1 — áp dụng lại

**Test có thể đang khoá lại chính lỗ hổng.** Đã xảy ra hai lần ở Mốc 0: một ca test khẳng định đúng hành vi nguy hiểm. Khi sửa bảo mật mà test đỏ, đọc xem test đang bảo vệ điều gì trước khi cho rằng code sai.

**Danh sách cấm là allowlist trá hình.** Nhận diện `read` bằng tiền tố động từ cho phép mọi thứ chưa kịp nghĩ tới. Ở Mốc 1 luật tương đương là allowlist **khoá INI được phép ghi**. Ở Mốc 2 nó sẽ là allowlist **log group / lệnh Insights**, không phải denylist.

**Đề xuất sửa của reviewer có thể phá một hàng rào khác.** Ở Mốc 1, cách vá được đề xuất cho lỗi "nút Sửa không lưu được" (`target.name !== (previousName ?? name)`) sẽ làm "tạo mới trùng tên" âm thầm ghi đè. Tự tái hiện từng finding trước khi sửa, và coi đề xuất sửa là giả thuyết chứ không phải lời giải.
