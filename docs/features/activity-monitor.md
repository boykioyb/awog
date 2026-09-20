# Activity Monitor — giám sát CPU / GPU / RAM tới tầng phiên

> Trang `/monitor`: AWOG đang ăn bao nhiêu máy, **phiên nào** chịu trách nhiệm, **tiến trình nào ngốn nhất**, và dừng được tiến trình ngay tại chỗ.

- **Trạng thái:** Đã code, chưa release
- **Ngày:** 2026-09-19
- **Phạm vi:** `apps/desktop/sidecar/src/monitor/` (5 module + 2 RPC) + `apps/desktop/ui-next` (1 trang, 1 composable, 3 component)
- **Quyết định kiến trúc:** [ADR 0090](../decisions/0090-activity-monitor-process-attribution.md)

> ⚠ **Đừng nhầm với trang `/activity`.** Trang đó đo **token và tiền** ([activity-page.md](activity-page.md)). Trang này đo **máy**. Hai trang không dùng chung dữ liệu, không dùng chung RPC, và cố ý mang hai tên khác nhau.

## Vì sao cần

Sự cố đã đo được trên máy thật khi khảo sát tính năng này: một **tiến trình sidecar mồ côi** (PID 30331) chạy **17 giờ 25 phút ở 99,7% CPU**, cha đã thoát nên nó bị launchd nhận nuôi, kéo theo hai tiến trình `claude` CLI kẹt lại. Không có bề mặt nào trong AWOG nói ra chuyện đó; người dùng chỉ thấy quạt kêu.

## Màn hình

```
┌ Giám sát tài nguyên ─────────────── [lọc] [Tạm dừng] ┐
│ ⚠ 2 tiến trình AWOG còn sót lại      ← chỉ hiện khi có
│   Engine (sidecar)  mồ côi  100%  178 MB  17h25m  [■]
├──────────────────────────────────────────────────────┤
│ CPU 28%  │ RAM 789 MB │ GPU 14%      │ Ngốn nhiều nhất│
│ 100%=1lõi│ 7 tiến trình│ (toàn máy)  │ Engine (sidecar)│
├──────────────────────────────────────────────────────┤
│ Theo phiên                        CPU    RAM   Tiến trình
│ ● Refactor thanh toán  tiến trình riêng  25%  416MB   2
│ ● Hỏi nhanh nginx      trong engine      —     —      0
│   Phiên này chạy ngay trong tiến trình engine dùng chung…
├──────────────────────────────────────────────────────┤
│ Tiến trình                    [CPU|RAM|PID]
│ Claude CLI  opus-4-8  «Refactor thanh toán»  18%  [■]
│   /Applications/AWOG.app/…/claude --resume=4c08…
└──────────────────────────────────────────────────────┘
```

- **Nhịp đo 2 giây**, chỉ chạy khi trang đang hiện. Nút **Tạm dừng** giữ nguyên số liệu ở lần đo cuối.
- **Nhịp đầu tiên không có số CPU** (hiện "—" + "Đang đo nhịp đầu tiên…"): CPU tức thời là *hiệu* giữa hai lần đo, một lần đọc đơn lẻ không nói được tiến trình đang bận hay đang ngủ.
- **Đơn vị CPU: 100% = một lõi**, giống `top` và Activity Monitor của macOS. Máy 10 lõi thì tổng có thể lên 1000%; thẻ đầu ghi rõ số lõi.
- Bấm một dòng phiên → mở phiên đó.

## Ba phạm vi đo

Chọn ở thanh đầu trang. Mỗi phạm vi là một tập tiến trình khác nhau, nên đổi phạm vi là **vứt mốc CPU cũ** và đo lại từ đầu (bảng của máy khác hiện trong lúc chờ là bảng nói dối).

| Phạm vi | Đo gì | Có gì / không có gì |
|---|---|---|
| **AWOG** (mặc định) | cây tiến trình của app | đủ: quy về phiên · mồ côi · GPU máy này |
| **Toàn máy** | mọi tiến trình của máy này | vẫn quy về phiên cho phần của AWOG; tiến trình app khác chỉ có nhãn từ dòng lệnh, **không** bị gán phiên |
| **SSH · `<host>`** | máy ở đầu kia một kết nối đang mở | **không** có: cây AWOG, phiên, mồ côi, GPU — máy đó không chạy AWOG nên mọi khái niệm ấy đều vô nghĩa |

Nhãn các thẻ tổng đi theo phạm vi (`CPU · Toàn máy`, `RAM · prod-web-01`). Con số của cả máy mà nhãn ghi "của AWOG" là đúng loại nói dối mà trang này tồn tại để tránh.

**SSH chỉ dùng kết nối ĐANG MỞ.** Trang không tự `connect`: mở một kết nối tới máy chủ của người dùng vì họ bấm vào một tab giám sát là vượt quá điều họ yêu cầu. Kết nối đang xem bị đóng ⇒ tự rơi về kết nối khác, hoặc về máy này.

**Danh sách bị cắt khi đo cả máy.** Máy thật có ~700 tiến trình và bảng poll 2 giây/lần; gửi hết là vài trăm KB mỗi nhịp cho những dòng 0% không ai đọc. Cắt = hợp của **top 150 theo CPU** và **top 60 theo RAM** (cắt một chiều thì chiều sắp xếp kia thành bảng nói dối) cộng toàn bộ cây AWOG. `totals` vẫn cộng trên TẤT CẢ, và UI nói rõ bảng đã bị cắt.

Sampler giữ bản chụp trước **theo từng nguồn** (`local` / `ssh:<connId>`): pid của hai máy trùng nhau như chơi, trừ CPU tích luỹ của chúng cho nhau thì ra số vô nghĩa.

## Thang màu: xanh · vàng · đỏ

Mọi ngưỡng **suy từ dung lượng thật của máy đang đo** (số lõi, RAM vật lý — sidecar trả về `coreCount` + `totalMemKb`; máy từ xa hỏi qua `nproc`/`sysctl` + `/proc/meminfo`/`hw.memsize`, một lệnh, cache theo kết nối).

Lý do không dùng vài con số cố định: cùng "2 GB" là bình thường trên máy 64 GB và là báo động trên máy 8 GB; cùng "300% CPU" là một cú build lành mạnh trên máy 10 lõi và là máy đang quỳ trên máy 2 lõi. **Một thang không biết máy to bằng nào thì màu đỏ của nó không mang thông tin gì.**

| Đo cái gì | Chia cho | 🟢 | 🟡 | 🔴 |
|---|---|---|---|---|
| CPU một tiến trình | một lõi | < 50% | 50–90% | ≥ 90% |
| CPU tổng | số lõi × 100 | < 30% | 30–70% | ≥ 70% |
| RAM một tiến trình | RAM vật lý | < 2% | 2–8% | ≥ 8% |
| RAM tổng | RAM vật lý | < 25% | 25–50% | ≥ 50% |
| GPU | — | < 50% | 50–85% | ≥ 85% |

Mốc đỏ của CPU một tiến trình (90% = ghim trọn một lõi) **trùng ngưỡng mặc định của cảnh báo** "CPU cao kéo dài", để màu trên bảng và nội dung thông báo không nói hai chuyện khác nhau.

Màu dùng token `--green` / `--amber` / `--danger`. ⚠ **Không dùng `--accent` cho mức "khoẻ"**: accent là màu người dùng đổi được ở Settings → Appearance, nên ai chọn accent đỏ là cả thang màu mất nghĩa.

`totalMemKb = 0` (máy từ xa không đọc được RAM) ⇒ cột RAM **không tô màu** và thẻ **không vẽ vạch mức**, thay vì tô theo một mẫu số bịa.

### Thẻ và bảng

- **4 thẻ tổng**: giá trị tô theo mức, kèm **vạch mức** = phần dung lượng đã dùng trên tổng của máy. Thẻ RAM còn ghi "x% của 32.0 GB" — "4.1 GB" một mình không cho biết nhiều hay ít.
- Số cột thẻ theo **container query** (bề rộng panel, không phải bề rộng cửa sổ): **2 hoặc 4, không bao giờ 3** — bốn thẻ chia ba cột thì thẻ thứ tư đứng lẻ một hàng.
- **Hai khối dưới (`Theo phiên`, `Tiến trình`) là card** (`.tile`), đồng bộ với hàng thẻ. Bảng nhúng trong banner mồ côi khử skin card bằng `:deep` để không thành card lồng card.
- **Sắp xếp nằm ở tiêu đề cột** (tên · PID · CPU · RAM · thời gian chạy), bấm lại để đảo chiều, mũi tên ▲/▼ chỉ chiều hiện tại. Cụm nút CPU/RAM/PID rời trước đây đã bỏ: nó không nói được chiều, và tiêu đề cột mới là chỗ người ta bấm theo phản xạ.
- Ô tên tiến trình: **dòng 1 là tên, dòng 2 là tag + dòng lệnh**. Nhồi tag vào dòng 1 thì ở bề rộng panel thật (611px đo được) tag bị cắt còn `cla…` — hiện một tag không đọc được thì thà đừng hiện. `table-layout: fixed` ấn định bề rộng ô nhưng **không** cắt nội dung tràn, nên ô này phải tự `overflow: hidden` (không có thì hàng tag đè thẳng lên cột PID/CPU — lỗi đã đo).

## Quy trách nhiệm: tiến trình nào của phiên nào

Ba tầng, tin cậy giảm dần ([ADR 0090](../decisions/0090-activity-monitor-process-attribution.md) §3):

| Tầng | Cơ chế | Nhãn `attribution` |
|---|---|---|
| 1 | Nơi spawn tự khai vào `monitor/owned.ts` | `registry` |
| 2 | `--resume=<uuid>` trên argv của CLI claude → `Session.sdkSessionId` | `sdk-session-id` |
| 3 | Thừa kế từ tổ tiên gần nhất đã xác định | `inherited` |

Không tầng nào khớp ⇒ nằm ở nhóm hạ tầng chung. **Không bao giờ gán bừa vào một phiên.**

### Giới hạn được nói ra, không bị lấp liếm

Mỗi phiên mang một nhãn, và hai nhãn sau hiện **"—"** kèm một câu giải thích thay vì một con số sai:

| Nhãn | Nghĩa | Khi nào |
|---|---|---|
| `own-process` | số liệu là của đúng phiên này | nhánh Claude SDK (provider `anthropic`) |
| `in-engine` | chạy trong tiến trình engine dùng chung | nhánh Pi |
| `shared-daemon` | dùng chung daemon với các phiên khác cùng account | nhánh Codex ([ADR 0087](../decisions/0087-codex-app-server-as-openai-runtime.md)) |

Phiên `in-engine`/`shared-daemon` **vẫn được liệt kê** — bỏ đi thì người dùng tưởng phiên đã dừng. Riêng shell mà phiên spawn (`Bash` tool, shell nền, terminal) thì mọi nhánh đều quy về được, vì nơi spawn có khai sổ.

## GPU — đo được theo từng tiến trình

> ⚠ **Đính chính.** Bản đầu của tài liệu này nói GPU theo tiến trình "nằm sau `powermetrics`, đòi root". Sai: chỉ `powermetrics` cần root, IORegistry thì không. Đo thật: `ioreg -r -c IOAccelerator -l -w 0` với quyền người dùng thường trả về 70 client kèm pid trong **17ms / 67 KB**.

Mỗi `AGXDeviceUserClient` mang `IOUserClientCreator = "pid N, tên"` và `AppUsage` chứa `accumulatedGPUTime` (nanosecond) — tương đương `ps -o time` nhưng cho GPU, nên dùng **cùng phép hiệu giữa hai nhịp** như CPU. Một pid có nhiều client và nhiều mục `AppUsage` ⇒ gom theo khối `+-o …UserClient` rồi cộng.

Kết quả:

- Thẻ GPU nói **"GPU · AWOG"** (hoặc · Toàn máy) với con số của đúng tập đang xem; `Device Utilization %` của cả máy tụt xuống dòng chú thích vì nó trả lời câu hỏi khác.
- Bảng tiến trình có **cột GPU**, sắp xếp được như CPU/RAM.
- Cột tự ẩn khi không đo được, và điều kiện là "**có ít nhất một tiến trình đo được**" chứ không phải `process.platform` ở renderer — máy đang đo có thể nằm ở đầu kia SSH.

Linux: `nvidia-smi` cho mức toàn máy nếu có; không có đường per-process tương đương. Windows: không có.

## Khối "Máy": từng lõi CPU · load average · RAM thật · swap

Khối riêng, **không trộn** với hàng thẻ (hàng thẻ nói về *tập đang xem*, khối này nói về *cái máy*).

**Từng lõi** — `os.cpus()` của Node gọi `host_processor_info` trên macOS và đọc `/proc/stat` trên Linux, trả về thời gian tích luỹ của từng lõi ⇒ lại là phép hiệu quen thuộc. Không native module, không root. (Đã thử và loại: `kern.cp_times` không tồn tại trên macOS, `top` không in per-core, `powermetrics` đòi root.) Kèm **load average** từ `os.loadavg()`.

**RAM thật + swap** — đây là một **sửa sai về tính đúng đắn**, không phải trang trí: cộng RSS của mọi tiến trình KHÔNG phải "RAM đang dùng" (bộ nhớ dùng chung bị cộng nhiều lần; phần wired/nén của nhân không thuộc tiến trình nào). Tổng RSS ra 9.9 GB trong khi máy 16 GB đang thiếu bộ nhớ thật sự.

> ⚠ **Đính chính lần hai.** Bản sửa đầu dùng `used = total − (free + speculative)` vì nó khớp `top` từng MiB. Khớp `top` nhưng **vô dụng**: công thức đó tính cả trang `inactive` — vốn phần lớn là file cache macOS thu hồi tức thì — nên ra **99% trên mọi máy Mac chạy được vài tiếng**. Một vạch lúc nào cũng đỏ không mang thông tin gì, đúng cái bẫy mà mục "Thang màu" bên trên tự cảnh báo. Người dùng phát hiện: *"phần số đỏ này hơi ảo không"*.

Cách tính hiện tại, và vì sao:

| | |
|---|---|
| **RAM đang dùng** | `App (anonymous − purgeable) + Wired + phần nén` — đúng định nghĩa "Memory Used" của Activity Monitor, tức con số người dùng đối chiếu được bằng công cụ của chính hệ điều hành. Đo thật: **13.2 / 16.0 GB = 83%** (thay vì 99%). |
| **File cache** | Hiện thành **đoạn nhạt riêng** trên vạch (2.7 GB). Nó CÓ chiếm chỗ nhưng nhường lại ngay khi cần, nên không được trông ngang hàng với phần bị chiếm thật. |
| **Màu RAM** | Theo `kern.memorystatus_vm_pressure_level` (1 bình thường · 2 cảnh báo · 4 nguy cấp) — **phán quyết của chính nhân**, thứ nó dùng để quyết định nén và swap. Phần trăm là chỉ báo tồi trên macOS vì hệ điều hành cố tình giữ RAM đầy. Chỉ rơi về ngưỡng phần trăm (75/92) khi nền tảng không cung cấp áp lực. |
| **Swap** | **Chỉ số tuyệt đối** (11.3 GB). `vm.swapusage` có trường `total` nhưng đó là kích thước swapfile HIỆN TẠI mà macOS tự nới khi cần — **không phải trần**. Hiện "11.4/12.0 GB = 95%" là bịa ra một cái trần rồi báo động vì sắp chạm nó. Màu so với **RAM vật lý**: vàng ở 20%, đỏ ở 50% (swap bằng nửa RAM = máy đã thiếu bộ nhớ trầm trọng). |
| Linux | `MemTotal − MemAvailable` vốn đã trừ cache thu hồi được nên không dính bẫy trên; cache lấy từ `Cached + Buffers`. Chưa có nguồn áp lực (PSI có thể thêm sau). |

**Không có**: nhiệt độ và điện năng (thứ `macmon` hiển thị) — chúng nằm sau IOReport, cần native code. Cố ý không đoán.

Khối này **ẩn ở phạm vi SSH**: đó là máy khác, đo nó cần thêm lệnh riêng (xem "Còn nợ").

## Tiến trình mồ côi

Tiến trình mang dấu vết bản cài nhưng **nằm ngoài cây của instance đang chạy** ⇒ sót lại từ lần chạy trước. Hiện thành một khối đỏ **trên đầu trang**, không lẫn vào bảng chung.

Nhận diện so khớp trên **file chạy** (argv[0], hoặc argv[1] khi argv[0] là trình thông dịch), **không** trên cả dòng lệnh. Lỗi đã đo được và đã sửa: so khớp cả dòng lệnh khiến `zsh -c "cd …/sidecar && node …"` bị gắn nhãn mồ côi và UI mời người dùng giết nó. Test giữ nguyên ca này (`classify.test.ts`).

## Dừng tiến trình

| | |
|---|---|
| ❌ Cấm | Hạ tầng của **chính instance đang chạy**: Electron main, sidecar, renderer, GPU, utility — giết là tự bắn vào chân, đã có nút Thoát app |
| ❌ Cấm | `pid ≤ 1` (`launchd`/`init`) |
| ✅ Cho phép | Mọi thứ còn lại, **kể cả tiến trình không thuộc AWOG**. Đây là máy của người dùng; phần quyền để hệ điều hành phán — tiến trình của user khác trả `EPERM` và lỗi đó đi thẳng lên UI thay vì bị nuốt |

> Bản đầu chỉ cho giết tiến trình của AWOG. Người dùng đảo sau khi dùng thử, cùng lúc với việc bổ sung phạm vi toàn máy: một công cụ giám sát mà vẫn phải mở Activity Monitor của macOS để giết thì không giải quyết việc gì.

> ⚠ **Đính chính.** Luật bảo vệ ban đầu ở UI áp cho MỌI tiến trình có `kind` là `sidecar`/`electron-*`, không chỉ của instance đang chạy. Hệ quả ở phạm vi toàn máy: mọi tiến trình Chromium của Chrome/Claude **và cả sidecar AWOG mồ côi** đều mất nút dừng — đúng thứ trang này sinh ra để giết. Sidecar vốn đã kiểm đúng (`inOurTree && PROTECTED`); thiếu sót là UI không biết cái nào "của ta". Nay `MonitorProcess.own` mang thông tin đó lên, và UI chỉ bảo vệ khi `own === true`.

Máy từ xa đi qua `kill -TERM|-KILL <pid>` trên SSH, với `pid` đã kiểm là số nguyên > 1 và **nội suy dưới dạng SỐ** — không có đường nào cho một chuỗi tuỳ ý vào shell của máy chủ.

**Sidecar cưỡng chế, không tin pid từ UI.** pid là dữ liệu L1 và pid bị tái sử dụng liên tục; một ảnh chụp cũ 2 giây trên UI là quá đủ để pid đã đổi chủ. Mỗi lần gọi `monitor.kill` đều chụp lại bảng tiến trình và tự kiểm lại từ đầu. UI chỉ ẩn nút cho đẹp.

Mặc định `SIGTERM` (có cơ hội dọn dẹp); `force: true` → `SIGKILL`. Cả hai đi qua hộp xác nhận nêu rõ hậu quả.

**Leo thang là bắt buộc, không phải tuỳ chọn.** Một tiến trình quay tít trong vòng lặp chặt **không bao giờ tới lượt chạy trình xử lý tín hiệu**, nên SIGTERM rơi vào hư không — đo trên chính ca sidecar mồ côi 18 giờ ở 99% CPU: `kill 30331` không có tác dụng gì. Nếu UI chỉ có SIGTERM thì đúng loại tiến trình mà màn hình này sinh ra để bắt lại là loại duy nhất nó không giết được. Vì thế: gửi SIGTERM xong mà tiến trình vẫn còn ở nhịp đo sau ⇒ nút đổi thành **⚡ "Giết ngay"** (đỏ sẵn, không chờ hover). Cờ này quên ngay khi pid biến mất — pid được cấp lại cho tiến trình khác, và tiến trình mới không được thừa hưởng nút SIGKILL của tiến trình đã chết.

## Cảnh báo (thông báo chủ động)

Trang chỉ phát hiện khi người dùng MỞ nó ra — mà không ai mở trang giám sát khi chưa nghi ngờ gì. Ca 18 giờ ở 99% CPU nằm im suốt đêm đúng vì thế. `composables/useResourceAlerts.ts` là vòng canh gác chạy nền, khởi động một lần từ layout cửa sổ chính (popout không báo lần hai).

- **Nhịp 60 giây**, chậm hơn nhiều so với 2 giây của trang: đây là canh gác, không phải đồng hồ. Một lượt là một `ps` (~15ms).
- **MẶC ĐỊNH BẬT**, khác `cicdEvents` (mặc định tắt vì mỗi lượt là một chùm lệnh `aws`/`gh`).
- Đi qua **cùng một kênh gửi** với hộp thư GitHub và cảnh báo CI/CD: `Settings → Thông báo → Kênh gửi` (toast / hệ điều hành / cả hai). Bấm vào cảnh báo → mở `/monitor`.

| Luật | Điều kiện | Mặc định |
|---|---|---|
| Tiến trình sót lại | có tiến trình AWOG mồ côi | **bật** |
| CPU cao kéo dài | một tiến trình ≥ ngưỡng % **liên tục** ≥ N phút | **bật** (90%, 5 phút) |
| RAM vượt ngưỡng | tổng RSS của AWOG ≥ N GB | **tắt** (4 GB) |

RAM mặc định tắt vì ngưỡng "đúng" phụ thuộc hoàn toàn vào máy — đó phải là con số người dùng chọn, không phải con số ta đoán hộ.

**Chống spam là phần khó, không phải phần ngưỡng.** Một tiến trình chạy tít 3 tiếng phải báo MỘT lần, không phải 180 lần:

- Mỗi sự cố có một khoá đang-mở (theo pid, hoặc khoá chung cho ngưỡng RAM). Khoá chỉ gỡ khi điều kiện **thôi đúng** — pid biến mất, hoặc số tụt xuống dưới ngưỡng.
- CPU dùng **mốc thời gian** chứ không đếm số nhịp: `now - since ≥ N phút`, nên đổi nhịp đo không làm sai luật.
- RAM có **trễ 10%** khi hạ, để một con số dao động quanh ngưỡng không nhấp nháy.
- Khoá cố ý **chỉ nằm trong RAM**: khởi động lại app là lúc ta MUỐN báo lại — một tiến trình mồ côi sống sót qua một lần khởi động lại chính là tin đáng báo nhất.
- `cpuPercent === null` (nhịp đầu, chưa có hiệu) **không** được coi là "mát".
- Tiến trình mồ côi đã có cảnh báo riêng nói đúng vấn đề của nó ⇒ luật CPU bỏ qua chúng, không báo hai lần cùng một chuyện.
- Trần 2 cảnh báo CPU mỗi lượt; mồ côi gộp thành một cảnh báo vì chúng hay đi theo chùm.

⚠ Rough edge đã biết: bấm vào cảnh báo **trong khi hộp Settings đang mở** thì modal đóng lại và điều hướng về `/` đè lên `/monitor`. Đây là hành vi sẵn có của surface Settings (mọi toast bấm được đều dính), không riêng cảnh báo này.

### Kênh gửi dùng chung

`composables/useAppNotify.ts` — `presentNotification()` + `ensureNotificationPermission()` + `osDeliverable()`. Trước đó logic này bị chép nguyên văn ở `useGhNotifications` và `useCicdNotify`; cảnh báo tài nguyên là nơi thứ BA, đúng ngưỡng Rule of Three của repo, nên nó được tách ra và **cả hai nơi cũ đã chuyển sang dùng chung** (hành vi giữ nguyên, kể cả chi tiết hộp thư GitHub đặt TÊN REPO làm tiêu đề thông báo hệ điều hành — `nativeTitle`).

## Tab "Đĩa": dung lượng · gợi ý dọn · quét sâu

Trang có hai màn (`Tiến trình` / `Đĩa`) thay vì một trang dài — hai thứ khác hẳn nhau.

Hai màn là **thanh tab thật** (`.montabs`) ngay dưới tiêu đề, mỗi tab có icon và tab đang mở có **gạch accent 2px** dưới chân.

- Cố ý **không** dùng `.ptab` sẵn có: tab active của nó tô nền xám `--bgActive`, kiểu đã bị bác cho control chọn (quy ước selection = accent-tint, `.claude/rules/nuxt-vue.md`).
- **Toolbar của từng màn nằm DƯỚI thanh tab**, không nằm trên. Control thuộc về nội dung tab mà đặt phía trên nó thì thứ tự đọc bị ngược.
- ⚠ Trước đó bộ chọn màn là một `.seg` nằm chung nhóm control bên phải. Nhóm đó bị `space-between` đẩy sát mép và đổi số lượng theo từng màn, nên **chính cái nút vừa bấm nhảy chỗ ngay sau cú bấm** — đo được: trôi ngang ~200px, và ở panel hẹp còn tụt xuống dòng dưới. Thanh tab thì cố định: lệch `{x: 0, y: 0}` giữa hai màn.

### Ổ đĩa

Chỉ ổ chứa **thư mục nhà** (`df <home>`) cộng ổ gắn ngoài. Không liệt kê cả `df`: trên APFS, `/`, `/System/Volumes/VM|Preboot|Update|Data` dùng CHUNG một container nên `df` in bảy dòng cùng dung lượng. Lọc thêm hai thứ đo được trên máy thật: volume cùng container với ổ nhà (`/Volumes/Recovery` — lặp lại y hệt số của dòng trên) và ảnh đĩa đang mount dưới 1 GB. Ngưỡng màu: vàng 85%, đỏ 93% (ổ gần đầy là vấn đề thật ở ~95%).

### Gợi ý dọn

Danh mục cố định trong `monitor/disk.ts`, đường dẫn **tương đối với thư mục nhà** — không bao giờ ghép từ input nào. Mỗi mục có nhãn `safe` (hệ thống tự sinh lại) hoặc `review` (xoá được nhưng mất state / phải build lại lâu), kèm một câu nói rõ **mất gì khi xoá** — người dùng không đoán được điều đó từ đường dẫn.

Mỗi dòng có **icon theo loại** (chọn theo *thứ sẽ mất*, không theo thư mục nằm ở đâu: cache `refresh` · build `layers` · kho gói `download` · log `listul` · thùng rác `trash`), tô accent hoặc amber khớp với nhãn `safe`/`review` — hai mươi dòng chữ thuần thì phải đọc từng dòng mới biết cái nào là gì.

Hai nút mỗi dòng: **Quét sâu** (mở drawer ở đúng mục đó) và **Chuyển vào Thùng rác**. ⚠ Quét sâu phải là một NÚT: trước đó lối vào duy nhất là bấm vào chữ tên mục, không có gì báo hiệu nó bấm được, nên với người chưa biết thì coi như tính năng không tồn tại.

Thư mục build/dependency trong project (`node_modules`, `.nuxt`, `.output`, `.next`, `dist`, `target`) tìm ở **cấp 1** của các project AWOG đang quản lý; UI truyền `projectRoots` xuống, sidecar không tự quyết định quét cây nào của người dùng.

**Đo tự động ngay khi mở tab.** Danh sách sắp theo dung lượng giảm dần, nên số đo chảy về tới đâu thì mục to nhất nổi lên tới đó, kèm dòng tổng "có thể dọn an toàn".

⚠ Bản đầu chờ người dùng bấm nút "Đo" vì `du` tốn hàng chục giây. Nhưng như vậy thì lần mở đầu tiên cột Dung lượng **toàn `—`**, mà một danh sách tên là *gợi ý dọn* thì cái duy nhất biến nó thành gợi ý chính là con số đó: không có nó, người dùng không có cách nào biết nên xoá mục nào. Nay `load()` tự gọi `measureAll()` — và **chỉ khi chưa có số nào** (`measured === 0`), nên quay lại tab không đo lại; muốn số mới thì bấm "Đo lại".

⚠ **`du` chậm và không làm nhanh được**: đo trên máy thật, `du -sk ~/Library/Caches` (19.7 GB) mất **19,5 giây**. Vì thế API tách đôi — `disk.targets` trả danh sách ngay (chỉ `stat`), rồi UI hỏi `disk.size` **từng mục một**, tối đa 3 mục song song, hiện dần. Một RPC "quét hết rồi trả tổng" là cầm chắc một trang treo vài phút. Đo là **một cú bấm có chủ ý**, không tự chạy khi mở tab.

**Bấm lần nữa là đo LẠI, không phải đo tiếp.**

> ⚠ Bản đầu lọc `sizes[path] === undefined` nên chỉ đo những mục chưa biết — tức bấm lần thứ hai **không làm gì cả**, và con số đứng yên suốt phiên dù người dùng vừa xoá thứ gì hoặc cache vừa phình ra. Một nút bấm vào không có phản hồi thì người dùng chỉ kết luận là nó hỏng. Đo lại sau khi sửa: lần bấm đầu 3 lời gọi `disk.size`, lần thứ hai thêm 3 nữa và con số thay đổi.

- Nhãn nút đi theo trạng thái: `Đo dung lượng` → `Đang đo…` (kèm `Đang đo n/tổng mục`) → `Đo lại`.
- Giá trị cũ **được giữ trên màn hình** trong lúc đo lại thay vì xoá về `—`: bảng không nhấp nháy trống, và một con số cũ vẫn hữu ích hơn khoảng trống.
- Chuyển một mục vào Thùng rác thì **quên số đo của chính nó** — cache là thứ hay quay lại ngay, và khi đó con số cũ sẽ là lời nói dối về dung lượng mới.

Con số "có thể dọn an toàn" **chỉ cộng mục `safe`** — gộp cả mục `review` vào là mời người dùng xoá thứ họ sẽ tiếc. Kết quả thật trên máy phát triển: **33,5 GB** (cache ứng dụng 19,7 · `~/.cache` 12,2 · npm cache 1,0 · cargo 0,3 · logs 0,25).

### Gom theo ứng dụng

Công tắc ở đầu bảng. Bật lên thì mỗi ứng dụng là **một hàng** với tổng CPU/GPU/RAM của mọi tiến trình con, bấm để mở ra từng tiến trình. Hai mươi dòng helper của Chrome không trả lời được câu "Chrome đang ăn bao nhiêu máy"; một dòng cộng lại thì có.

Tên ứng dụng lấy từ **bundle `.app` ngoài cùng** trên đường dẫn: helper của Chrome nằm ở `…/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/…`, và thứ cần gom là `Google Chrome`, không phải từng helper.

> ⚠ **Không tách argv0 bằng khoảng trắng.** Đường dẫn bundle macOS đầy khoảng trắng, nên `command.split(/\s+/)[0]` cắt ra `/Applications/Google` rồi basename ra `Google` — đúng cái làm bảng hiện ba dòng cùng tên "Google"/"Claude" không phân biệt được gì (lỗi đã đo). Nhãn tiến trình con Chromium của app KHÁC nay cũng ghép tên app vào (`Google Chrome · Renderer`), vì "Renderer" một mình thì ba ứng dụng đều giống nhau.

**Dừng cả ứng dụng**: gửi tín hiệu tới từng tiến trình dừng được của nhóm, một hộp xác nhận cho cả nhóm nêu rõ `n/tổng`. Cố ý **không** đoán "tiến trình chính" rồi trông chờ nó kéo con theo — nhiều app để tiến trình con sống sót, và đoán sai thì người dùng bấm xong vẫn thấy app chạy. Nhóm mà mọi tiến trình đều thuộc AWOG đang chạy thì không có nút (không có gì hợp lệ để giết).

### Duyệt toàn đĩa

> Người dùng hỏi: *"mới có Gợi ý dọn thôi à? thế còn toàn bộ đĩa đâu?"* — đúng: danh mục rác là một danh sách **soạn sẵn**, nên mọi thứ ngoài nó vô hình, kể cả khi nó chiếm 300 GB.

Ba lối vào ở đầu tab, cộng nút **Duyệt** trên mỗi thẻ ổ:

| Lối vào | Trỏ tới |
|---|---|
| Thư mục nhà | `home` (sidecar trả về, không đoán ở renderer) |
| Ứng dụng | `/Applications` |
| Toàn ổ | **mount của ổ chứa thư mục nhà** |

⚠ "Toàn ổ" **không phải `/`**. Trên APFS, `/` là volume hệ thống niêm phong còn dữ liệu người dùng nằm ở volume Data, mà `du -x` dừng ở biên filesystem — đo được: quét `/` ra `Applications 32.4 GB · private 8.6 GB · Library 8.5 GB` và **không có `/Users`**, tức một bức tranh sai về chỗ trống đã đi đâu. Quét `/System/Volumes/Data` mới ra `Users 300 GB`.

### Chuẩn hoá đường dẫn (firmlink APFS)

> Người dùng báo ba lỗi tưởng rời rạc: *"nút quay lại không dùng được, breadcrumb cũng không nhấn được, folder đang không có button xoá"*. Cả ba là **MỘT** lỗi.

Trên APFS, cùng một thư mục có **hai đường dẫn hợp lệ**: `/Users/kyro` và `/System/Volumes/Data/Users/kyro` (firmlink). Ổ dữ liệu mount ở `/System/Volumes/Data`, nên duyệt từ thẻ ổ hoặc từ "Toàn ổ" sinh ra dạng thứ hai — và mọi phép so khớp theo tiền tố đều trượt:

- `canTrash` không thấy tiền tố thư mục nhà ⇒ **mất nút xoá**;
- breadcrumb không nhận ra `~` ⇒ rơi vào nhánh fallback dựng **một mẩu duy nhất**, mà mẩu cuối thì `disabled` ⇒ **không bấm được**;
- cùng nhánh fallback đó làm mọi đường dẫn ngoài `~` (ví dụ `/Applications/...`) cũng không có breadcrumb dùng được.

`canonicalPath()` chuẩn hoá **ở biên** (`assertScannable`, chỗ duy nhất đường dẫn đi vào) thay vì bắt mọi nơi so khớp phải nhớ cả hai dạng: `/System/Volumes/Data/X` → `/X`, `/System/Volumes/Data` → `/`. Entry phát ra vì thế luôn ở dạng chuẩn.

Breadcrumb cũng được dựng **từ segment cho mọi đường dẫn** (`~` chỉ là cách rút gọn phần đầu khi nó nằm trong nhà), nên `/Applications` ra `/ › Applications` bấm được từng cấp.

### ĐỌC phủ cả đĩa, XOÁ chỉ trong thư mục nhà

Hai phạm vi **cố ý khác nhau**:

| | Phạm vi | Cưỡng chế ở |
|---|---|---|
| Đọc (đo, liệt kê) | mọi đường dẫn tuyệt đối, trừ filesystem ảo (`/dev`, `/proc`, `/sys`, snapshot Time Machine) | `assertScannable` trong sidecar |
| Xoá (vào Thùng rác) | chỉ trong thư mục nhà, sâu ≥ 2 cấp | `shell:trashItem` ở Electron main |

Khi **cả thư mục đang xem** nằm ngoài phạm vi xoá (`/Library`, `/Applications`…), drawer bỏ hẳn cột nút và hiện **một dòng giải thích**: *"Thư mục này nằm ngoài thư mục nhà nên AWOG chỉ xem, không xoá. macOS cũng đòi quyền quản trị cho hầu hết thứ ở đây."*

> ⚠ Bản đầu hiện `—` ở mỗi dòng. Hai mươi dòng dấu gạch câm không nói được lý do, nên người dùng kết luận nút xoá bị hỏng (*"tôi thấy đang - hết không có button xóa?"*). Nói MỘT lần ở đầu danh sách thì rõ; cột nút cũng không còn chiếm chỗ vô ích.

> ⚠ Bản đầu chặn ĐỌC ngoài thư mục nhà. Nới ra vì nó chặn luôn câu hỏi chính của trang. Đây là thao tác chỉ-đọc và chỉ cộng kích thước; hệ điều hành vẫn từ chối thư mục không có quyền. Ranh giới XOÁ thì **không** nới — **nhìn được cả đĩa ≠ xoá được cả đĩa**. UI ẩn nút Thùng rác (hiện `—` kèm tooltip) cho mục ngoài phạm vi, để khỏi mời bấm một thứ chắc chắn bị từ chối.

### Quét sâu — DRAWER, có tiến độ thật

Bấm tên một mục ở bảng gợi ý là mở drawer ở đúng mục đó. Kết quả về **dần**, kèm `n/tổng` và tên mục vừa đo xong.

> ⚠ **Một giả định sai, đã đo.** Bản đầu chạy `du -kx -d 1 <parent>` rồi đọc stdout theo dòng, tin rằng `du` in mỗi thư mục con ngay khi duyệt xong nó. **Trên macOS thì không**: khi stdout là pipe, libc đệm theo KHỐI, nên toàn bộ 400 dòng về cùng một lúc ở giây thứ 21.7 — đúng bằng lúc `du` kết thúc. Streaming trên giấy, spinner trên thực tế.

Cách hiện tại:

1. **`readdir` thư mục cha** — tức thì, nên biết ngay có bao nhiêu mục và hiện được `n/tổng`.
2. **File** lấy kích thước từ `stat` (không cần `du`).
3. **Thư mục** chạy `du -skx` cho TỪNG cái, tối đa 4 cùng lúc, phát kết quả ngay khi mỗi cái xong.

Đo lại trên `~/Library/Caches` (161 mục con, 19.7 GB): danh sách tên hiện ở **1ms**, kết quả đầu tiên ở **7ms**, xong ở **11.7 giây** — nhanh hơn cả bản `du -d 1` cũ (21.7s) vì 4 luồng chạy song song. Vừa có tiến độ vừa nhanh hơn.

Chi tiết:

- Thanh tiến độ **chạy theo tỉ lệ thật**; chỉ trong khoảnh khắc chưa biết tổng (`readdir` chưa xong) mới là thanh chạy tới lui — biết tổng rồi mà vẫn để thanh giả vờ là nói dối về tiến độ.
- **Đệm theo đường dẫn + quét lại THỦ CÔNG.** Lần xuống rồi quay lại là chuyện xảy ra liên tục khi đi tìm chỗ chiếm dung lượng, mà mỗi lượt quét là một loạt tiến trình `du` cày đĩa. Kết quả giữ trong RAM; nút ⟳ ở đầu drawer để quét lại khi cần. Đo: mở `Caches` → vào `Google` → quay lại → vào lại `Google` tốn **2 lượt quét** thay vì 4; bấm ⟳ thành 3.
  - Chỉ ghi đệm khi lượt quét **chạy hết** — một lượt bị huỷ giữa chừng mà đem cache thì lần sau mở lại sẽ thấy danh sách cụt và tưởng đó là toàn bộ.
  - Xoá một mục thì **bỏ đệm của nó và mọi tổ tiên**: dung lượng của mọi cấp chứa nó vừa đổi, giữ số cũ ở cấp trên là để bảng nói dối ngay sau thao tác của người dùng.
  - Kết quả lấy từ đệm hiện dòng **"Kết quả quét lúc HH:MM"** — một con số dung lượng không kèm thời điểm thì người dùng không biết nó còn đúng không.
- **Huỷ được**: đóng drawer hoặc lần sang thư mục khác là giết mọi tiến trình `du` của lượt cũ. Không có nó, quét vài thư mục lớn là để lại một đống tiến trình đang cày đĩa mà không ai đọc kết quả.
- Event lọc theo `scanId`, nên dòng còn sót của lượt đã huỷ không lọt vào danh sách của thư mục đang mở.
- Trần 400 mục con: một thư mục 10k mục không được biến thành 10k event.
- `-x` để không vượt sang filesystem khác (tránh đi lạc vào ổ mạng rồi treo).

> Bản đầu đặt quét sâu thành một khối ở cuối trang. Người dùng bác: đây là luồng **lần xuống nhiều cấp**, nên mỗi cú bấm lại phải cuộn xuống tìm kết quả rồi cuộn lên chọn tiếp. Drawer đứng yên một chỗ suốt cả luồng.

> Bản đầu đặt nó thành một khối ở cuối trang. Người dùng bác: quét sâu là luồng **lần xuống nhiều cấp**, nên mỗi cú bấm lại phải cuộn xuống tìm kết quả rồi cuộn lên chọn tiếp. Drawer đứng yên một chỗ suốt cả luồng.

Chi tiết đáng giữ:

- **Thư mục và file phân biệt rõ**: icon thư mục tô accent + mũi tên khi rê chuột (bấm được), icon file xám (không bấm được). `TreeEntry.isDir` đến từ sidecar chứ không đoán theo tên. ⚠ Đây không chỉ là thẩm mỹ: bản đầu mọi dòng đều là `<button>`, nên bấm vào một file là gọi `readdir` trên file → lỗi. File nay render thành `<div>`, không phải nút — mời bấm một thứ chỉ để báo lỗi là tệ hơn không mời.
- **Breadcrumb `~ / Library / Caches`** ở tiêu đề, mỗi cấp bấm để nhảy thẳng về. Drawer chỉ hiện MỘT cấp mỗi lúc, nên đây là chỗ duy nhất cho thấy đang ở đâu trong cây — một dòng đường dẫn chết thì không làm được việc đó.
- Hàng dùng **grid 3 cột** (tên · dung lượng 62px · nút), không phải flex. Với flex, bề rộng cột số còn phụ thuộc độ dài tên ở CÙNG hàng — đo được: tên dài đẩy số lệch phải 14px và cột số răng cưa, trong khi việc chính của panel là *so sánh* dung lượng. Tên dài (pnpm store đặt tên kiểu `https+++codeload.github.com+…`) cắt bằng `…`; ⚠ chỉ `overflow: hidden` là chưa đủ — flex/grid item mặc định `min-width: auto` nên **từ chối co nhỏ hơn nội dung**, và trước khi thêm `min-width: 0` thì tên tràn đè lên cả dung lượng lẫn nút xoá.
- **Mọi nhãn bị cắt đều có `title`** (tên tiến trình, tên nhóm ứng dụng, tiêu đề phiên, tên mục trong drawer — tooltip của drawer là đường dẫn ĐẦY ĐỦ, vì nó chứa luôn tên và còn trả lời "nằm ở đâu"). Cắt chữ mà không có tooltip là bịt đường xem tên đầy đủ, không còn cách nào khác.
- Mỗi dòng có **vạch tỉ lệ so với mục lớn nhất cùng cấp** — mắt so sánh hình nhanh hơn so sánh số, mà đây đúng là việc "tìm cái nào nặng".
- Nút **lên một cấp tự tắt ở thư mục nhà**: sidecar từ chối mọi đường dẫn ngoài đó, nên một nút dẫn tới lỗi là nút nói dối.
- **Xoá cả thư mục đang mở** bằng nút thùng rác ở đầu drawer (chỉ hiện khi nó nằm trong phạm vi xoá). Không có đường này thì muốn xoá thư mục vừa xem xong, người dùng phải lùi lên cấp trên rồi dò lại nó trong danh sách cha — đúng lúc họ đã biết chắc nó là thứ cần xoá. Xoá xong thì tự lùi lên cấp cha, vì chỗ đang đứng không còn nữa.
  - ⚠ Hộp xác nhận cố ý **không kèm dung lượng**: con số duy nhất có trong tay là tổng các mục *đang liệt kê*, mà danh sách bị cắt ở 400 mục — đưa một số thiếu vào hộp xác nhận xoá là đưa bằng chứng sai cho một quyết định không dễ hoàn tác.
- **Esc** và bấm nền đều đóng.
- ⚠ Drawer và nền mờ phải khai **`-webkit-app-region: no-drag`**. Thanh trên của app CHÍNH LÀ thanh tiêu đề cửa sổ (`.top { -webkit-app-region: drag }`), và vùng kéo được tính ở tầng cửa sổ — một lớp phủ nằm ĐÈ lên nó mà không tự trừ mình ra thì **click bị nuốt**: nút quay lại và breadcrumb bấm không ăn (lỗi đã đo, xuất hiện ngay khi drawer đổi sang `top: 0`). Chính comment trong `app-shell.css` đã cảnh báo: *"a control that sits inside a drag region swallows its own clicks"*.
- UI phải dùng đường dẫn **sidecar TRẢ VỀ** (`disk.tree` → `{ scanId, path }`), không phải cái nó vừa gửi: sidecar chuẩn hoá firmlink nên entry ở dạng `/Users/...` trong khi UI còn giữ `/System/Volumes/Data/Users/...` — breadcrumb và `canTrash` khi đó nói về một đường dẫn khác với danh sách đang hiện.
- Drawer chạy **suốt chiều cao**, chỉ chừa thanh trạng thái (đúng quy ước sẵn có: *"leave the status bar interactive while a drawer is open"*). ⚠ Bản đầu viết `top: var(--topbar-h, 48px)` — nhưng **`--topbar-h` không tồn tại** trong repo (chỉ có `--statusbar-h`), nên nó thực chất ghim cứng 48px, một con số không liên quan tới chiều cao thanh trên thật, và để hở một dải ở đỉnh.
- Đường dẫn rút gọn về `~/…`. ⚠ Bản đầu dùng `direction: rtl` để cắt đầu chuỗi — mẹo đó đảo luôn dấu `/` mở đầu xuống cuối, ra `Users/kyro/Library/Caches/` (lỗi đã đo).

### Hiện trong Finder · Sao chép đường dẫn · menu chuột phải

Hai nút trên **mọi hàng** của cả bảng gợi ý lẫn cây quét sâu, cộng một bộ nữa trong header của drawer cho chính thư mục đang mở, cộng **menu chuột phải** trên mọi hàng.

⚠ Ba lỗi hình học của cùng một nguyên nhân — *cột hành động được ghim theo số nút CŨ*:

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Bốn nút vuông thành bốn viên thuốc hẹp | cột `.act` ghim 88px (đúng cho hai nút); `width: 32px` chỉ là **basis**, `flex-shrink` mặc định 1 nên con flex bị bóp | cột 160px + `flex: 0 0 auto` ⇒ lần sau thêm nút sẽ **tràn (nhìn thấy ngay)** thay vì âm thầm bóp |
| Cột Dung lượng trong drawer xô lệch giữa các hàng (đo: 578 vs 544) | cột hành động để `auto`, mà số nút đổi theo hàng (ngoài thư mục nhà không có nút xoá) | **ô giữ chỗ vô hình** ở khe xoá, chỉ render khi danh sách CÓ ít nhất một hàng xoá được |
| Hàng không xoá được lệch 4px so với hàng xoá được | ô giữ chỗ ghim `26px`, trong khi `.iconbtn` là **32px ở theme awog nhưng 30px ở theme cute** | ô giữ chỗ mang luôn class `iconbtn` (khử viền/bóng) ⇒ tự lấy đúng khổ của từng theme, không ghim số |
| Dải trắng chết ở mép phải drawer khi mở thư mục ngoài nhà | bản sửa trước ghim cột hành động `104px` = trường hợp 3 nút, nên thư mục **không hàng nào xoá được** vẫn chừa khe xoá trống trên mọi hàng | cột trở lại `auto` + ô giữ chỗ vô hình `v-else-if="anyTrashable"` ⇒ danh sách không xoá được thì không ai render nó |

`anyTrashable` là giá trị của **cả danh sách**, không phải từng hàng — đó là lý do ô giữ chỗ không làm hàng xô lệch trở lại. Và nó **không ghim con số nào**: mang class `iconbtn` nên chiếm đúng khổ nút của theme đang chạy. Đo cả hai ca: thư mục ngoài nhà 2 khe · danh sách trộn (xoá được lẫn không) 3 khe, `firstX`/`sizeRight` bằng nhau ở mọi hàng, `gapRight` = 12 ở cả hai ca.

**Menu là `useFileContextMenu` dùng chung với tab Files của Sessions**, không phải bản thứ hai. Composable nhận thêm cờ `absolute`:

| | workspace (Sessions Files, Code Workspace) | `absolute: true` (tab Đĩa) |
|---|---|---|
| Đường dẫn | tương đối với một root | tuyệt đối, **không có root nào** |
| Hàng cần root | VS Code · mở bằng app mặc định · copy đường dẫn tương đối · tạo/đổi tên/xoá qua `fs.*` | **vắng** |
| Xoá | `fs.deletePath` | `onTrash` của bề mặt → **Thùng rác**, hoàn tác được |

Cố ý **không** có "Mở bằng ứng dụng mặc định" ở chế độ `absolute`: nó CHẠY trình xử lý của file, mạnh hơn hẳn việc chỉ mở Finder ở chỗ file nằm, và tab Đĩa liệt kê cả những file người dùng chưa từng biết mình có.

**`shell:revealDiskPath` là IPC riêng, không nới `shell:revealPath`.** Cái sẵn có đòi một workspace root và chặn mọi thứ ngoài nó — gắn nút "Hiện trong Finder" vào phạm vi đó thì nó chết ở đúng những dòng đáng bấm nhất (`/Applications`, `/Library`, ổ ngoài). Phạm vi của IPC mới khớp phần **ĐỌC** của sidecar (chặn `/dev`,`/proc`,`/sys`, snapshot), đã đo trên máy thật: `/Applications` · `~/Library/Caches` · `/System/Volumes/Data` cho qua; `/dev`, `/dev/null`, đường dẫn tương đối, đường dẫn không tồn tại đều bị chặn.

⚠ **Nút Thùng rác trên bảng gợi ý nay cũng gate theo `canTrash`** như cây quét sâu vẫn làm. Danh mục có `projectRoots` do UI truyền xuống, mà một project đặt ở ổ ngoài vẫn sinh ra dòng `node_modules` — nút xoá của nó trước đó luôn hiện và luôn bị Electron main từ chối. Ngoài phạm vi ⇒ hiện icon `info` kèm tooltip, không phải nút chết.

### Dọn bằng công cụ

Có những chỗ **Thùng rác với không tới**: layer của Docker nằm trong máy ảo của nó, simulator do CoreSimulator quản lý, còn kho gói của pnpm là **hard-link** — xoá tay là hỏng mọi `node_modules` đang trỏ vào đó. Cách đúng duy nhất là để chính công cụ đó dọn phần thừa của nó.

Danh mục **cố định trong `monitor/cleanup.ts`**; UI chỉ gửi **một `id`**, không bao giờ gửi chuỗi lệnh. Đó là ranh giới quan trọng: `cleanup.run` với bất kỳ thứ gì ngoài danh mục đều trả `Unknown cleanup action` (đã thử `rm -rf /`, `docker-prune; rm -rf ~`).

| Id | Lệnh |
|---|---|
| `simctl-unavailable` | `xcrun simctl delete unavailable` |
| `brew-cleanup` | `brew cleanup --prune=all` |
| `docker-prune` | `docker system prune -f` |
| `pnpm-store-prune` | `pnpm store prune` |
| `npm-cache-clean` | `npm cache clean --force` |
| `go-clean-cache` | `go clean -cache` |

Cố ý **`docker system prune -f` chứ không `-a --volumes`**: `--volumes` xoá dữ liệu database của người dùng, `-a` xoá cả image còn dùng tới. Dọn rác không được đi kèm mất dữ liệu.

`cleanup.actions` **dò từng công cụ** bằng một lệnh chỉ-đọc rồi chỉ trả về những cái chạy được, nên máy không có Docker thì không thấy dòng Docker. ⚠ `simctl` vắng mặt khi `xcode-select -p` trỏ vào `/Library/Developer/CommandLineTools` thay vì một bản Xcode đầy đủ — lúc đó `xcrun simctl` thật sự không dùng được (exit 72), không phải lỗi dò.

**Lệnh hiện nguyên văn ngay trên hàng**, không giấu sau cái nhãn, và hộp xác nhận nhắc lại đúng chuỗi đó cộng một câu: *xoá hẳn, KHÔNG qua Thùng rác nên không hoàn tác được* — khác hẳn phần Thùng rác ở dưới. Trong lúc chạy, **mọi nút đều khoá** (các lệnh này đụng cùng một đĩa), rồi output của công cụ lên toast: đó là thứ duy nhất trả lời "giải phóng được bao nhiêu", nên không nuốt nó.

### Xoá — vào Thùng rác, không phải `rm -rf`

| | |
|---|---|
| Cơ chế | `shell.trashItem` của Electron — **hoàn tác được từ Finder** |
| Vì sao không `rm -rf` | Một lời gọi sai đường dẫn không có đường lùi, và đường dẫn ở đây đến từ renderer (L1) |
| Xác nhận | Hộp xác nhận nêu đường dẫn + dung lượng + nói rõ là vào Thùng rác |

**Ba hàng rào cưỡng chế ở Electron main**, không tin UI đã lọc:

1. phải là đường dẫn tuyệt đối, và `realpath` để khử symlink trỏ ra ngoài;
2. phải nằm TRONG thư mục nhà — nhưng **không được là chính thư mục nhà**;
3. phải sâu **ít nhất hai cấp** dưới nhà, để một lỗi nào đó không biến thành "vứt cả `~/Documents` vào thùng rác".

Bên đọc có cổng riêng: `disk.size`/`disk.tree` chỉ nhận đường dẫn trong thư mục nhà (`resolve` rồi so tiền tố). Đã kiểm: `/etc`, `/`, `/Users` đều bị từ chối.

## Hợp đồng IPC

| Method | Params | Trả về |
|---|---|---|
| `monitor.sample` | — | `MonitorSnapshot` |
| `monitor.reset` | — | `{ ok: true }` — quên mốc đo cũ (UI gọi khi vào trang) |
| `monitor.kill` | `{ pid, force?, connId? }` | `{ pid, signal }` |
| `disk.volumes` | — | `{ volumes }` — rẻ |
| `disk.targets` | `{ projectRoots? }` | `{ targets, home }` — chỉ `stat`, trả ngay |
| `disk.size` | `{ path }` | `{ path, sizeKb }` — **chậm**, gọi từng mục |
| `disk.tree` | `{ path }` | `{ scanId, path }` — `path` đã chuẩn hoá; kết quả về qua event |
| `disk.tree-cancel` | `{ scanId }` | `{ ok }` |
| `cleanup.actions` | — | `{ actions }` — chỉ những công cụ dò thấy trên máy |
| `cleanup.run` | `{ id }` | `{ ok, output }` — `id` ngoài danh mục ⇒ lỗi |

Kênh Electron (không qua sidecar): `shell:trashItem` `{ path }` · `shell:revealDiskPath` `{ path }`.

Event của lượt quét: `disk.tree-list` `{ scanId, total }` → `disk.tree-entry` `{ scanId, entry }` (mỗi mục) → `disk.tree-done` `{ scanId, count, truncated?, error? }`.

`monitor.sample` **có trạng thái** (nhớ bản chụp trước để tính hiệu CPU). Đó là lý do UI poll thay vì nhận event.

```ts
type MonitorSnapshot = {
  at: number
  coreCount: number
  warmingUp: boolean                     // nhịp đầu — mọi cpuPercent là null
  gpu: { utilizationPercent: number | null; memoryUsedMb: number | null; source: 'ioreg' | 'nvidia-smi' | null }
  totals: { cpuPercent: number | null; rssKb: number; processCount: number }
  processes: MonitorProcess[]            // cây của instance hiện tại
  sessions: MonitorSession[]
  orphans: MonitorProcess[]              // mang dấu AWOG nhưng ngoài cây
}
```

## Bảo mật

- **Dòng lệnh là L1** — đi qua `redactString` (dùng chung với `sessions/redact.ts`) và cắt ở 400 ký tự trước khi rời sidecar. Đo trên argv thật của CLI claude: không có credential, nhưng shell của một lượt thì chạy lệnh do model sinh ra.
- **Biến môi trường KHÔNG bao giờ đọc** — và macOS cũng không cho (`ps -Eww` trả rỗng kể cả với tiến trình con của chính mình, đã đo).
- **Đường ghi đếm được đúng ba**: `monitor.kill`, `shell.trashItem` và `cleanup.run` — mỗi cái có cổng kiểm riêng ở trên. `cleanup.run` **không nhận chuỗi lệnh**, chỉ nhận id tra vào danh mục cứng, nên không có bề mặt command injection.
- UI không đụng `child_process` (invariant #4): mọi thứ đi qua RPC.

## File

| Path | Vai trò |
|---|---|
| `sidecar/src/monitor/process-table.ts` | Gọi `ps`, parse `[[dd-]hh:]mm:ss` |
| `sidecar/src/monitor/sampler.ts` | CPU tích luỹ → CPU tức thời; chặn pid tái sử dụng |
| `sidecar/src/monitor/classify.ts` | Đọc argv → loại tiến trình + `sdkSessionId` + model |
| `sidecar/src/monitor/identity.ts` | "Tiến trình này có phải của AWOG không" (dò mồ côi + cổng giết) |
| `sidecar/src/monitor/owned.ts` | Sổ đăng ký pid → chủ sở hữu, do nơi spawn khai |
| `sidecar/src/monitor/snapshot.ts` | Dựng cây, quy trách nhiệm 3 tầng, cuộn theo phiên |
| `sidecar/src/monitor/gpu.ts` | `ioreg` / `nvidia-smi` |
| `sidecar/src/monitor/kill.ts` | Cổng kiểm + `process.kill` (+ định tuyến sang SSH) |
| `sidecar/src/monitor/remote.ts` | Đọc `ps` và dừng tiến trình trên máy ở đầu kia SSH |
| `sidecar/src/monitor/system.ts` | Từng lõi CPU · load average · RAM thật · swap |
| `sidecar/src/monitor/disk.ts` | Ổ đĩa · danh mục rác · quét sâu (CHỈ ĐỌC) |
| `sidecar/src/monitor/cleanup.ts` | Danh mục lệnh dọn cố định + dò công cụ + chạy theo id |
| `electron/src/ipc.ts` → `shell:trashItem` | Chuyển vào Thùng rác + ba hàng rào đường dẫn |
| `electron/src/ipc.ts` → `shell:revealDiskPath` | Hiện trong Finder, phạm vi = phần ĐỌC (chặn filesystem ảo) |
| `ui-next/composables/useFileContextMenu.ts` | Menu chuột phải dùng chung; cờ `absolute` cho tab Đĩa |
| `ui-next/composables/useDiskManager.ts` | Điều phối đo song song có giới hạn + gọi xoá |
| `ui-next/components/monitor/MonitorDisk.vue` | Màn Đĩa |
| `ui-next/components/monitor/MonitorSystem.vue` | Khối "Máy" |
| `ui-next/composables/useMonitorManager.ts` | Poll, dẫn xuất bảng, gói lệnh dừng |
| `ui-next/pages/monitor.vue` | Trang (thin template) |
| `ui-next/components/monitor/` | `MonitorSummary` · `MonitorSessions` · `MonitorProcesses` |
| `ui-next/composables/useResourceAlerts.ts` | Vòng canh gác 60s + luật ngưỡng + chống spam |
| `ui-next/composables/useAppNotify.ts` | Kênh gửi dùng chung (toast / hệ điều hành) cho cả 3 nguồn |

Năm nơi spawn khai vào sổ: `terminal/manager.ts` (PTY), `sessions/bg-registry.ts` (shell nền), `runtime/tools/bash-tool.ts` (shell của lượt), `runtime/codex/app-server.ts` (daemon).

## Còn nợ

- **Windows** — `ps` không có, trang xuống thang thành rỗng. Muốn phủ cần đường riêng qua PowerShell.
- **Đường SSH chưa chạy thử trên máy chủ thật** — mới chỉ rà code và kiểm hàng rào (pid ≤ 1 bị chặn, `connId` lạ bị từ chối). Bộ cờ `ps` và parser dùng chung với đường cục bộ, nhưng một bản `ps` khác (busybox, Alpine) có thể in khác.
- **MCP** — từ [ADR 0060](../decisions/0060-connections-adopt-craft-sources-model.md) tiến trình MCP chỉ còn là lần thử kết nối ngắn nên chưa khai sổ.
- **Lịch sử** — hiện chỉ có ảnh chụp tại thời điểm này, không có biểu đồ theo thời gian. Muốn có thì cần một vòng đệm trong sidecar.
- **Lệnh dọn không đo được kết quả** — chỉ có output nguyên văn của công cụ. Muốn nói "giải phóng 3.1 GB" một cách chắc chắn thì phải `df` trước/sau, mà số đó lẫn với mọi thứ khác đang ghi đĩa cùng lúc.
- **`simctl` chỉ dò thấy khi có Xcode đầy đủ** — máy chỉ cài Command Line Tools thì dòng đó vắng mặt (đúng, nhưng người dùng không biết tại sao).
- **Canh gác cần một cửa sổ đang mở** — vòng đo nằm ở renderer (đúng mẫu của `useGhNotifications`/`useCicdNotify`). App thu vào tray mà không còn cửa sổ nào thì không có ai đo. Muốn phủ thì phải dời vòng đo xuống sidecar, và khi đó cấu hình ngưỡng phải đẩy xuống qua IPC chứ không để sidecar tự đọc `settings.json`.
