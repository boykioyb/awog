# 0090 — Đo tài nguyên bằng `ps` và quy trách nhiệm theo argv + sổ đăng ký spawn

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-19
- **Người quyết định:** kyro (chốt), tech-lead

## Bối cảnh

Người dùng cần một màn "Activity Monitor" của riêng AWOG: **phiên nào** đang ăn bao nhiêu CPU/RAM, GPU ra sao, và **tiến trình nào ngốn nhất**. Nhu cầu này khác hẳn trang `/activity` sẵn có — trang đó đo *token và tiền*, không đo *máy*.

Hai ràng buộc của repo định hình mọi thứ:

- **Không thêm dependency khi chưa có ADR** (CLAUDE.md §Quy tắc làm việc). Các thư viện đo tiến trình (`pidusage`, `systeminformation`) đều là dep mới, và `systeminformation` là dep nặng.
- **Invariant #1 + #4**: số liệu phải lấy trong sidecar, UI không được đụng `child_process`; dòng lệnh đi lên UI là dữ liệu L1.

Điều quyết định thiết kế là **AWOG không có một tiến trình cho mỗi phiên**. Đo trên máy thật:

| Runtime | Hình hài tiến trình | Quy được về phiên? |
|---|---|---|
| Claude SDK (`provider = anthropic`) | mỗi phiên spawn **một tiến trình CLI riêng**, argv mang `--resume=<sdkSessionId>` | **Được, chính xác** |
| Pi (provider khác) | chạy **ngay trong tiến trình sidecar**, dùng chung cho mọi phiên | Không — ở tầng hệ điều hành không tồn tại ranh giới |
| Codex (`provider = openai`) | một daemon `codex app-server` **dùng chung** cho mọi phiên cùng account ([ADR 0087](0087-codex-app-server-as-openai-runtime.md)) | Chỉ tới mức account |

Ngoài ra sidecar còn spawn: PTY terminal ([ADR 0019](0019-pty-terminal-in-sidecar.md)), shell nền ([ADR 0066](0066-session-background-exec-and-wake.md)), shell của một lượt (`Bash` tool), dev server, `git`, và các lần thử kết nối MCP. Dòng lệnh của một `zsh` thì phiên nào cũng giống phiên nào.

## Quyết định

1. **Nguồn số liệu = `ps`**, gọi từ sidecar, zero dependency: `ps -Ao pid=,ppid=,rss=,time=,etime=,args=` — cùng một bộ cờ chạy trên cả macOS lẫn Linux. Windows không có, màn hình xuống thang tử tế.
2. **CPU là HIỆU giữa hai lần đo**, không phải cột `%CPU` của `ps`. Trên BSD/macOS `%CPU` là trung bình suy giảm tính từ lúc tiến trình sinh ra, nên một tiến trình vừa ngốn 100% trong 3 giây mà đã sống 10 tiếng vẫn hiện ~0%. Hệ quả kiến trúc: **RPC `monitor.sample` có trạng thái** (nhớ bản chụp trước) và **UI phải poll** — nhịp đo chính là dữ liệu. Nhịp đầu trả `warmingUp`, mọi `cpuPercent` là `null`, UI hiện "—" chứ không hiện 0.
3. **Quy trách nhiệm ba tầng, tin cậy giảm dần:**
   1. **Sổ đăng ký** `monitor/owned.ts` — nơi spawn tự khai `{pid, kind, sessionId?}`. Năm nơi gọi: PTY, shell nền, shell của lượt, daemon Codex, (để ngỏ cho MCP).
   2. **Dòng lệnh** — `--resume=<uuid>` của CLI claude tra thẳng ra `Session.sdkSessionId`; `--type=renderer|gpu-process|utility` của Chromium; đối số script phân biệt sidecar với Electron main (hai cái **dùng chung một binary** vì `ELECTRON_RUN_AS_NODE`).
   3. **Quan hệ cha-con** — không tự khai thì thuộc về chủ của tổ tiên gần nhất. Đây là cách một `vitest` do model gọi rơi đúng vào phiên sinh ra nó.

   Không tầng nào khớp ⇒ nằm ở nhóm hạ tầng chung, **không gán bừa vào một phiên**.
4. **Nói thẳng giới hạn thay vì lấp liếm.** Mỗi phiên mang một nhãn `attribution`: `own-process` (số liệu là của đúng phiên), `in-engine` (chạy trong sidecar dùng chung), `shared-daemon` (dùng chung daemon theo account). Hai nhãn sau hiện "—" ở cột CPU/RAM kèm một câu giải thích, chứ không hiện số của cả tiến trình dùng chung như thể đó là của phiên.
5. **GPU đo được THEO TIẾN TRÌNH trên macOS — không cần root.**

   > ⚠ **Đính chính bản đầu của ADR này**, vốn khẳng định "GPU theo tiến trình nằm sau `powermetrics`, đòi root, nên chỉ đo được toàn máy". SAI. Chỉ `powermetrics` mới cần root; IORegistry thì không. Đo trên máy thật: `ioreg -r -c IOAccelerator -l -w 0` chạy với quyền người dùng thường trả về **70 client kèm pid trong 17ms / 67 KB**.

   Mỗi `AGXDeviceUserClient` mang `IOUserClientCreator` = `"pid N, tên"` và `AppUsage` chứa `accumulatedGPUTime` (nanosecond). Đó chính là thứ tương đương `ps -o time` nhưng cho GPU ⇒ **cùng một phép tính hiệu giữa hai nhịp** như CPU. Một pid có thể có nhiều client và nhiều mục `AppUsage`, nên gom theo KHỐI `+-o …UserClient` rồi cộng.

   Hệ quả: thẻ GPU nói được "GPU **của AWOG**" chứ không chỉ "GPU của cả máy", và bảng tiến trình có cột GPU sắp xếp được. `Device Utilization %` (toàn máy) vẫn giữ, nhưng tụt xuống dòng chú thích — nó trả lời câu hỏi khác.

   Linux/Windows: không có đường tương đương ⇒ cột GPU **tự ẩn** (điều kiện là "có ít nhất một tiến trình đo được", không phải `process.platform` ở renderer — máy đang đo có thể ở đầu kia SSH).

6. **Số liệu của CẢ MÁY là một khối RIÊNG, không trộn với số liệu của tập đang xem.**
   - **Từng lõi CPU + load average** — `os.cpus()` của Node (gọi `host_processor_info` trên macOS, đọc `/proc/stat` trên Linux) cho thời gian tích luỹ của từng lõi ⇒ lại là phép hiệu quen thuộc. Không cần native module, không cần root. (`kern.cp_times` **không tồn tại** trên macOS và `top` không in per-core — đã thử cả hai.)
   - **RAM thật + swap** — vì **cộng RSS của mọi tiến trình KHÔNG phải "RAM đang dùng"**: bộ nhớ dùng chung bị cộng nhiều lần và phần wired/nén của nhân không thuộc tiến trình nào. Đo trên máy thật: tổng RSS 9.9 GB trong khi máy 16 GB đang dùng **15.9 GB và đã swap 10.9 GB**. Con số đầu làm người dùng yên tâm nhầm. macOS: `vm_stat` với công thức `used = total − (free + speculative)` — **đã đối chiếu khớp `top` từng MiB** — cộng `sysctl vm.swapusage`; Linux: `/proc/meminfo` (`MemTotal − MemAvailable`).
   - Nhiệt độ và điện năng (thứ `macmon` hiển thị) **không** lấy được đường này: chúng nằm sau IOReport, cần native code. Cố ý không đoán.
7. **Dò tiến trình AWOG mồ côi** — tiến trình mang dấu vết bản cài nhưng **nằm ngoài** cây của instance hiện tại, tức sót lại từ một lần chạy trước. Chúng được tách ra một khối riêng trên đầu trang.
8. **Ba PHẠM VI đo, một hợp đồng.** `monitor.sample` nhận `scope`:
   - `'awog'` (mặc định) — cây tiến trình của app. Rẻ nhất, ít nhiễu nhất.
   - `'machine'` — toàn bộ tiến trình của máy này. Vẫn quy về phiên cho phần thuộc AWOG; tiến trình của app khác chỉ có nhãn từ dòng lệnh, **không** bị gán phiên.
   - `'ssh'` + `connId` — máy ở đầu kia một kết nối SSH ĐANG MỞ. Cùng bộ cờ `ps`, cùng parser, cùng cách lấy hiệu CPU; khác mỗi đường truyền. Cố ý **không tự `connect`**: một trang giám sát tự mở kết nối tới máy chủ của người dùng là vượt quyền.

   Bản chụp trước (để tính hiệu CPU) **key theo nguồn** (`'local'` / `ssh:<connId>`): pid của hai máy trùng nhau như chơi, trừ CPU tích luỹ của chúng cho nhau thì ra số vô nghĩa.

   Máy thật có ~700 tiến trình còn bảng thì poll 2 giây/lần, nên danh sách bị **cắt** — hợp của top-150 theo CPU và top-60 theo RAM (cắt một chiều thì chiều sắp xếp kia thành bảng nói dối), cộng toàn bộ cây AWOG. `totals` vẫn cộng trên TẤT CẢ; cắt là chuyện của bảng, không phải của phép cộng.

9. **Được dừng tiến trình, và KHÔNG chỉ tiến trình của AWOG** (nới so với bản đầu, theo yêu cầu của người dùng khi bổ sung phạm vi toàn máy). Sidecar cưỡng chế, không tin pid từ UI: mỗi lần gọi `monitor.kill` đều chụp lại bảng tiến trình và tự kiểm.
   - ❌ Hạ tầng của **chính instance đang chạy** (Electron main, sidecar, renderer, GPU, utility) — giết là tự bắn vào chân.
   - ❌ `pid ≤ 1` (`launchd`/`init`).
   - ✅ Mọi thứ còn lại, kể cả tiến trình không thuộc AWOG. Đây là máy của người dùng; phần quyền để **hệ điều hành** phán — tiến trình của user khác trả `EPERM` và lỗi đó đi thẳng lên UI thay vì bị nuốt.
   - Máy từ xa đi qua `kill -TERM|-KILL <pid>` trên SSH, với `pid` đã kiểm là số nguyên > 1 và nội suy dưới dạng SỐ (không có đường cho chuỗi tuỳ ý vào shell của máy chủ).
   - **Leo thang bắt buộc:** gửi SIGTERM mà tiến trình vẫn còn ở nhịp sau ⇒ nút đổi thành SIGKILL. Một tiến trình quay tít không bao giờ tới lượt chạy trình xử lý tín hiệu — đo được trên chính ca sidecar mồ côi 18 giờ ở 99% CPU, nơi `kill` thường không có tác dụng gì.

10. **Cảnh báo chủ động chạy ở RENDERER, không ở sidecar.** Vòng đo 60 giây nằm trong một composable app-lifetime, đúng mẫu `useGhNotifications`/`useCicdNotify`. Lý do: cấu hình ngưỡng sống ở store của renderer, và repo cố ý KHÔNG để sidecar tự đọc `settings.json` (xem ghi chú `contextConfig` ở CLAUDE.md). Giá phải trả được ghi rõ: app thu vào tray không còn cửa sổ nào thì không có ai đo.

## Phương án đã cân nhắc

- **`app.getAppMetrics()` của Electron** — cho CPU + bộ nhớ theo tiến trình Electron kèm `type`/`serviceName`, sạch hơn phân tích argv. Từ chối làm **nguồn chính**: nó chỉ thấy tiến trình của Electron, mà đúng những thứ người dùng quan tâm nhất — CLI của phiên, daemon Codex, shell của lượt — là con của *sidecar*, không phải của Electron, nên không có trong danh sách. Dùng nó sẽ phải ghép hai nguồn với hai đồng hồ khác nhau; `--type=` trên argv đã cho đúng nhãn đó với một nguồn duy nhất.
- **Thêm `pidusage` / `systeminformation`** — từ chối: dep mới cho một việc `ps` làm đủ, và `systeminformation` là dep lớn với bề mặt rộng hơn nhiều so với nhu cầu.
- **Đọc biến môi trường của tiến trình con** để nhét dấu `AWOG_SESSION_ID` — **đo và loại**: `ps -Eww` trên macOS không trả về env kể cả với tiến trình con của chính mình. `--resume` trên argv đã có sẵn và không cần thêm gì.
- **Thêm cờ nhận diện qua `Options.extraArgs` của Claude Agent SDK** — từ chối: bơm một cờ CLI không tồn tại vào tiến trình thật để phục vụ việc đo là đánh đổi sai; `--resume` đã đủ.
- **Suy ra phiên theo thời điểm spawn** (tiến trình mới xuất hiện ngay sau khi phiên X bắt đầu lượt) — từ chối: sai ngay khi hai phiên chạy song song, mà đó chính là lúc người ta mở màn giám sát.
- **Đặt vòng canh gác trong sidecar** (chạy kể cả khi không còn cửa sổ) — từ chối cho bản này: nó buộc ngưỡng phải đẩy xuống qua IPC hoặc buộc sidecar đọc `settings.json`, tức thêm một đường cấu hình thứ hai cho một tính năng mà mọi nguồn thông báo khác đều chạy ở renderer. Ghi vào "còn nợ" thay vì làm nửa vời.
- **Chỉ đọc, không cho dừng** — người dùng bác: thấy một tiến trình ngốn 99% CPU mà vẫn phải mở Activity Monitor của macOS để giết thì màn hình này không giải quyết việc gì.
- **Chỉ đo cây tiến trình AWOG** (chốt ban đầu) — người dùng ĐẢO sau khi dùng thử: "mỗi tiến trình AWOG thì không có nhiều value lắm". Đúng: phần lớn thời gian AWOG không phải thủ phạm, và một màn giám sát không trả lời được "vậy ai đang ăn máy tôi" thì vẫn phải mở Activity Monitor của macOS.
- **Tự mở kết nối SSH khi người dùng chọn một host** — từ chối: chỉ liệt kê kết nối ĐANG MỞ. Mở kết nối tới máy chủ của người dùng vì họ bấm vào một tab giám sát là hành động vượt quá điều họ yêu cầu.

## Hệ quả

- **Tích cực:** zero dependency mới; một nguồn số liệu, một đồng hồ; quy trách nhiệm theo phiên là **tra bảng** chứ không phải suy đoán; tiến trình rò rỉ từ lần chạy trước lộ ra ngay ở đầu trang.
- **Trade-off:** phân loại dựa trên argv nên **bám vào hình dạng dòng lệnh của bên thứ ba** — Anthropic đổi `--resume` thành cờ khác thì phần quy-về-phiên im lặng mất tác dụng (bảng tiến trình vẫn đúng). `src/monitor/__tests__/classify.test.ts` giữ đúng những dòng lệnh thật đã đo để một lần đổi như vậy làm test đỏ.
- **Trade-off:** nhánh Pi vẫn không tách được CPU theo phiên. Đây là hệ quả của mô hình chạy in-process, không phải của quyết định này; muốn tách phải cho mỗi phiên một tiến trình riêng — một thay đổi kiến trúc lớn hơn nhiều so với giá trị của việc đo.
- **Trade-off:** poll 2 giây nghĩa là mỗi nhịp có một lần `fork` + `exec` của `ps`. Đo được: ~15ms, và chỉ chạy khi trang đang hiện (`onActivated`/`onDeactivated`, phủ cả KeepAlive).
- **Việc cần làm tiếp:**
  - Nhận diện MCP: từ [ADR 0060](0060-connections-adopt-craft-sources-model.md) tiến trình MCP chỉ còn là lần thử kết nối ngắn, nên chưa khai vào sổ. Khi nào có tiến trình MCP sống lâu trở lại thì thêm một lời gọi `registerOwnedProcess`.
  - Windows: `ps` không có, trang xuống thang thành rỗng. Muốn phủ thì cần một đường riêng (PowerShell `Get-CimInstance Win32_Process`).

## Tham chiếu

- [docs/features/activity-monitor.md](../features/activity-monitor.md) — đặc tả tính năng
- [ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) — vì sao nhánh Anthropic có tiến trình CLI riêng
- [ADR 0087](0087-codex-app-server-as-openai-runtime.md) — daemon Codex dùng chung theo account
- [ADR 0019](0019-pty-terminal-in-sidecar.md), [ADR 0066](0066-session-background-exec-and-wake.md) — hai nguồn tiến trình con khác của phiên
