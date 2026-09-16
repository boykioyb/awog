# Terminal cho pod (Kubernetes)

Tab **Terminal** trong khung chi tiết một pod ở `/infra → Kubernetes` mở một **shell tương tác** bên trong pod bằng `kubectl exec -it`. Bổ sung cạnh hai tab sẵn có (Log · Chi tiết); pod nào cũng có.

## Người dùng thấy gì

- Bấm một hàng pod → khung chi tiết mở (mặc định tab **Log**). Chuyển sang tab **Terminal**.
- Lần đầu mở tab Terminal → hiện **hộp duyệt hạ tầng** (kubectl exec là lệnh `write` ⇒ ma trận quyền luôn "hỏi", cả tài khoản thường lẫn production). Duyệt xong → shell mở ngay trong khung, gõ lệnh trực tiếp như một terminal thật.
- Dùng lại toàn bộ `WorkspaceTerminal`: nhiều tab (bấm **+** = mở thêm shell vào cùng pod), tách ô, snippet, copy/paste, theme terminal.
- Đổi sang tab Log rồi quay lại: shell **không** bị giết (mount lười + `v-show`). Đóng khung hoặc đổi pod: PTY bị kill.

## Vì sao thiết kế thế này

- **Đi qua ĐÚNG cổng quyền hiện có.** Mở shell trong pod = chạy lệnh tuỳ ý trong cluster, nên nó không được có đường tắt. Method mới `infra.kube.exec` gọi `gateInfraDecision()` — cùng hàm mà `infra.kube`/`infra.run` dùng — nên cùng vé duyệt do sidecar phát, cùng ma trận quyền, cùng nhật ký. Khác biệt duy nhất: **sau khi được duyệt** thì spawn PTY thay vì chạy một-shot.
- **RPC riêng, không phải `op` của `infra.kube`.** `infra.kube` chạy một-shot (bắt stdout rồi trả về); một shell là tiến trình sống, stream hai chiều qua PTY (`terminal.*`). Hai hình dạng ⇒ hai method.
- **Tên pod/container qua regex DNS-1123 trước khi vào argv**; `--context`/`--namespace` do sidecar chèn qua `withContext` (không do UI ghép); env qua `infraEnv` (lọc bỏ OAuth/API token, và luồn `AWS_PROFILE` xuống cho exec-plugin `aws eks get-token` của EKS — thiếu bước này thì shell auth hỏng hoặc rơi vào account `[default]`).

## Điểm chạm code

| Lớp | File | Vai trò |
|---|---|---|
| Sidecar | `infra/gated.ts` | `gateInfraDecision()` tách quyết định cổng khỏi việc spawn; `runGated` dùng lại nó |
| Sidecar | `infra/run.ts` | export `withContext`/`infraEnv` để đường PTY chèn context + env giống hệt một-shot |
| Sidecar | `terminal/manager.ts` | `spawnProcess()` — spawn file/args/env do caller dựng vào PTY (dùng chung ring-buffer + `terminal.*` với `create()`) |
| Sidecar | `methods/infra.kube-exec.ts` | RPC `infra.kube.exec`: validate → gate → spawn PTY → ghi nhật ký (`surface: 'terminal'`, `tool: 'kube_exec'`) |
| Frontend | `composables/useInfraKube.ts` | `KubeOut.mode` thêm `'terminal'`; `startPodExec(cols,rows)` chạy luồng có cổng; `call()` nhận tham số `method` |
| Frontend | `components/infra/kube/InfraKubeExecTab.vue` | `WorkspaceTerminal` + transport kube-exec (create = startPodExec; write/resize/kill = `terminal.*`) |
| Frontend | `components/infra/kube/InfraKubeOutPane.vue` | Tab thứ ba "Terminal", mount lười + giữ qua `v-show`, `:key` theo pod |

## Giới hạn đã biết

- Exec vào **container mặc định** của pod (hoặc container đang chọn ở tab Log nếu có). Chưa có bộ chọn container riêng trong tab Terminal — pod nhiều container chỉ vào được container mặc định trừ khi chọn trước ở tab Log.
- `exec` được xếp lớp `write` (hỏi mỗi lần mở), **không** phải `destructive`. Nếu muốn chặn hẳn shell trên production thì cần một quyết định phân lớp riêng (ảnh hưởng cả đường `kubectl exec` của agent), chưa làm trong bản này.
- Còn nợ **infosec re-audit** cho bề mặt mới này (thêm một đường spawn PTY + một RPC chạm cluster).
