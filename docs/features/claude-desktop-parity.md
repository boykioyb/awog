# Parity với Claude Code Desktop — bản đồ 46 hạng mục

**Trạng thái:** đang thực thi · **Cập nhật:** 2026-09-07

Tài liệu này là *bản đồ*, không phải spec. Mỗi hạng mục có spec/ADR riêng khi được làm — cột cuối trỏ tới đó.

## Cách bản đồ này được lập

Toàn bộ 46 hạng mục dưới đây đến từ một lần audit đối chiếu **code thật** của AWOG với bề mặt tính năng của Claude Code Desktop (tool model được cấp, RPC, UI, cấu hình). `CLAUDE.md` và `docs/features/*.md` **không** được dùng làm nguồn kết luận — chỉ dùng để định vị file, rồi xác nhận lại bằng `path:line`. Vài chỗ tài liệu cũ lệch với code; những chỗ đó ghi rõ trong cột Ghi chú.

Ký hiệu: **✅ xong** · **🟡 một phần** · **⬜ chưa** · **❌ đã quyết định không làm** (có ADR nêu lý do) · ⚠️ đụng bề mặt bảo mật, cần infosec.

---

## A. Tool cho model — chênh lệch giữa 2 runtime

AWOG chọn runtime **theo provider** (ADR 0058): `provider === 'anthropic'` ⇒ nhánh Claude Agent SDK, còn lại ⇒ nhánh Pi. Hệ quả ít ai để ý: **đổi provider là đổi năng lực của agent**. Đây là nhóm gap khó chịu nhất khi dùng thật, vì nó im lặng.

| # | Hạng mục | TT | Ghi chú |
|---|---|---|---|
| 1 | WebSearch có backend thật cho Pi | ✅ | Stub cũ (`builtin-stubs.ts`) *khai báo* tool rồi luôn trả lỗi ⇒ model đốt một lượt tool call mới biết hỏng. Đã gỡ khỏi danh sách + nói thẳng trong system prompt. Backend search thật vẫn **chưa có** — xem [agent-tools-parity.md](./agent-tools-parity.md) |
| 2 | Browser: a11y tree · console · network · viewport · multi-tab | ✅ | 5 → 14 action, và từ 2026-09-08 chạy trên **cả hai runtime**: nhánh Claude SDK cấp qua `mcp__awogbrowser__browser_tool`, cùng handler với Pi nên duyệt web không biến mất khi dùng tài khoản Anthropic. `snapshot` trả cây role/name + ref (click theo ref, không theo pixel), xuyên shadow root, che input password |
| 3 | Dev server từ file cấu hình + đọc log server | ✅ | `{project}/.awog/dev-servers.json`. **`dev_server(start)` KHÔNG spawn** — cổng quyền khoá theo *tên tool* (`EXEC_TOOLS = {'Bash'}`) nên một tool tự spawn sẽ đi qua không bị hỏi, không bị chặn ở plan mode, không đụng luật deny. Nó trả chuỗi lệnh đã kiểm tra và bắt model chạy qua `Bash(run_in_background)` — cổng thật. Đường spawn duy nhất là RPC sau nút bấm, có `confirmCommand` đóng khe TOCTOU giữa lúc đọc config và lúc đồng ý |
| 4 | `read_terminal` — đọc PTY người dùng tự gõ | ✅ | Ring buffer trong `terminal/manager.ts`; gate `chatSession` nên **có cả trong plan mode** (read-only, và lập kế hoạch chính là lúc cần đọc terminal nhất) |
| 5 | Codegraph — index symbol + call path | ✅ | Không thêm dependency, không dùng TS compiler API. Masking pass giữ **nguyên độ dài byte + vị trí newline** nên mọi offset regex vẫn map ra `path:line` thật. Đo trên repo này: cold 881ms/1148 file, warm 106ms, index 2.68MB. `refs useTheme` ra 10 file trong khi `rg -l` ra 12 — 2 file thừa chỉ nhắc tên trong comment. Giới hạn được **nói cho model biết**, nên câu trả lời luôn là "không có tham chiếu đã index", không bao giờ là "không ai gọi" |
| 6 | Monitor / wait-for-condition | ✅ | Tool `monitor` **không nhận `command`** — lệnh phải khởi động trước bằng `Bash(run_in_background)`, và đó mới là chỗ qua cổng quyền; thêm `command` sẽ là cửa sau thật vì `monitor` không nằm trong `EXEC_TOOLS`. **Đính chính brief cũ**: `AMBIENT_TASK_TYPES` không phải nguyên nhân — tiến trình CLI có vòng đời bằng đúng một lượt, đóng stdin là mọi việc nền chết theo |
| 7a | Subagent chọn model lúc gọi (Pi) | ✅ | TIER đóng (opus/sonnet/haiku/fable), không phải model id tự do — prompt là L1, id bịa sẽ làm provider trả 400 giữa lượt |
| 7b | Subagent chạy nền (Pi) | ✅ | Vòng đời = đúng bằng lượt cha, **cố ý không** dùng mô hình sống-qua-lượt của ADR 0066: background shell là tiến trình OS, còn subagent sống sau lượt sẽ gọi tool khi không còn lượt nào để hỏi quyền |
| 7c | Subagent trong worktree cô lập | ✅ | Khoá đổi sang `{ kind: 'task' \| 'session', id }`, layout task giữ nguyên byte nên không phải migrate; sweeper quét **cả hai** loại. Subagent chat được cô lập nhưng **không bao giờ tự merge**, và điều đó cưỡng chế **bằng kiểu** — `integrateTaskBranches()` không nhận owner. Task được merge vì có công tắc người dùng đã bật + có điểm ráo; một lượt chat không có cả hai |
| 7d | Subagent fork context của cha (Pi) | ✅ | Đuôi transcript cha, trần nằm trong đường dựng context chứ không phải lời khuyên trong prompt |
| 7e | Nhắn tiếp cho subagent cũ (Pi) | ✅ | `SendMessage` chạy thêm lượt trên đúng context cũ; chỉ nhắn được khi subagent đã xong lượt |
| 8 | Findings có cấu trúc (file/line/severity/verdict) | ✅ | Đủ 3 bề mặt (transcript · fullscreen · export) + bắc sang nhánh SDK. Luật validate **khác nhau theo từng trường có chủ ý**: severity lạ ⇒ bỏ cả dòng (xếp blocker thành minor là báo cáo sai); vượt trần ⇒ **từ chối cả lời gọi**, không cắt im lặng (cắt khiến model tưởng đã báo hết); trùng ⇒ bỏ dòng trùng giữ phần còn lại; path hỏng ⇒ **giữ finding, chỉ mất link** (card file hứa "bấm là mở được", còn finding thì chữ mới là nội dung). Hạn chế đã ghi: `PreviewRef` không mang số dòng ⇒ bấm mở FILE, chưa nhảy tới DÒNG |
| 9 | Lazy tool loading thật | ✅ | Pi tiêu ngân sách byte **rẻ-trước** nên server nhỏ giữ tool trực tiếp, chỉ server đắt bị hoãn; hoà thì so id vì bộ tool đổi giữa chừng phá prompt cache. SDK quyết theo từng server, và **không bao giờ** nạp thẳng server khai timeout > 5s (chỉ thêm một khoảng chờ chết vào turn-1) |
| 10 | Quy ước scratchpad | ✅ | `.awog/scratch/`, wire đủ **4 điểm append** + subagent; `.gitignore` đã bỏ qua |
| 11 | Tool `KillShell` | ✅ | UI đã quảng cáo tool này từ lâu trong khi runtime Pi không có — model bật được dev server mà không tắt được |
| 12 | Đọc PDF theo trang | ✅ | Tool `Read` đọc PDF theo khoảng trang (extractor tự viết, không thêm dep). Cái "đánh đổi chờ tech-lead quyết" hoá ra **không phải đánh đổi**: giữ `document` block cho PDF vừa cỡ (không mất bố cục/ảnh), còn PDF quá cỡ thì rơi về dòng tham chiếu nói rõ cách đọc theo trang. Trước đó nó **biến mất hoàn toàn** — không block, không cả dòng nói file tồn tại |

## B. Điều phối & tự động hoá

| # | Hạng mục | TT | Ghi chú |
|---|---|---|---|
| 13 | Lịch chạy / cron | ✅ | [ADR 0082](../decisions/0082-scheduled-runs.md). Union rời rạc thay cron string (validate được bằng zod, render ngược ra tiếng người). DST xử lý bằng dựng lại `Date` local chứ không cộng ms. Quá hạn ⇒ chạy bù **đúng một lần**. Chỉ cho mode `execute`/`plan` — `ask` sẽ park hộp xin quyền ở nơi không cửa sổ nào thấy. **Luôn có trần chi tiêu**, bỏ trống ≠ vô hạn |
| 14 | Agent tự hẹn giờ thức dậy | ✅ | Tool `schedule_wakeup` dùng lại store lịch của #13, không dựng hàng đợi thứ hai. **Cả hai runtime** từ 2026-09-08: nhánh SDK cấp qua `awogsurfaces` (đi nhờ server có sẵn để hưởng `unbridgeSurfaceToolName`, thay vì dựng server riêng rồi phải viết lại cơ chế gấp tên). Chính sách một bản: `WAKEUP_TEXT` + `createWakeupRunner` |
| 15 | Workflow bằng script + cache theo hash input | ❌ | [ADR 0085](../decisions/0085-workflow-as-script.md) — **Rejected** (script) · **Deferred** (cache), kèm điều kiện mở lại đo được. Lý do gọn: (1) **cache là cái giá của script, không phải phần thưởng** — nó tồn tại để bù cho việc call stack JS không checkpoint được, mà AWOG đã có frontier bền vững trên `events.log`; (2) hộp cát cho *ngôn ngữ* không phải hộp cát cho *năng lực* — thứ nguy hiểm (`agent()` có tool ghi + shell) nằm trong hộp theo thiết kế, nên `node:vm` (vốn **không** phải ranh giới an toàn) lẫn isolate thật đều không mua được gì; (3) 0 workflow trên đĩa, 3 task từ trước tới nay ⇒ chưa có ca thật nào chạm giới hạn của DAG. Nhu cầu thật (fan-out động, rẽ nhánh theo verdict) nếu xuất hiện sẽ giải bằng primitive **khai báo** `forEach`/`when`, ADR riêng |
| 16 | Worktree riêng cho node song song | ✅ | [ADR 0081](../decisions/0081-task-node-worktree-isolation.md). Trước đó 4 node song song ghi chung `project.path` và auto-commit đua nhau — lỗi tranh chấp thật |
| 17 | Session nhắn cho session | ✅ | Hộp thư + người dùng bấm, **không** tự khởi động lượt. 3 trần chặn vòng lặp; số hop đếm lúc **gửi** nên cắt được cả khi chưa ai bấm giao. Tin từ phiên A là L1 với phiên B — hàng rào nonce sinh SAU khi bên gửi viết xong |
| 18 | Trigger Task/Workflow từ xa | ✅ | Đã làm trọn vẹn (dòng cũ ghi ⬜ là lỗi thời). Chỉ mở ACTION (`tasks.create`/`approvePhase`/`cancel`/`pause`/`resume`); phần ĐỌC giữ gateway-local (`remote.tasks`/`remote.task`) để điện thoại không nhận cả DAG + trace. `tasks.create` khoá sau công tắc unattended vì node task chạy `mode:execute` theo cấu tạo. Loại tường minh `rerunPhase`/`discuss`/`delete`/`rename` |
| 19 | Watch PR + CI check runs → đẩy vào phiên | ✅ | Một `gh api graphql` cho cả danh sách, mọi giá trị đi bằng variable. **Cố ý không** gọi `postSessionMessage()` — nhánh đó đóng khung "người dùng chuyển tiếp cho bạn", mà log CI không phải thứ người dùng đưa. Dấu vân tay persist ra đĩa nên mở lại app không phát lại CI hôm qua |
| 20 | Push notification thật | ❌ | **Từ chối** ([ADR 0084](../decisions/0084-wake-when-no-window-and-push-scope.md)): payload mã hoá nhưng **metadata thì không** — bên thứ ba biết máy này vừa xong việc lúc nào, tần suất nào. Đúng thứ invariant #5 cấm, và phá mô hình tailnet-only của ADR 0067. Phần khả thi đã làm: thông báo phát từ **tiến trình main** nên sống độc lập với cửa sổ |
| 21 | Ngân sách cấp Task | ✅ | Trước đó `types/shared.ts` tự nhận "closes the budget per task invariant" nhưng `node-runner.ts` không hề có budget — code không khớp lời hứa |
| 22 | Auto-wake khi cửa sổ UI đóng | ✅ | Main park wake rồi phát lại **nguyên văn** trên cùng kênh khi renderer subscribe lại ⇒ không có nhánh code thứ hai. Cố ý **không** drain trong `preload.onEvent`: ~10 module cùng subscribe ở đó, module nào đăng ký trước sẽ nuốt mất wake mà không xử lý |

## C. Phiên & transcript

| # | Hạng mục | TT | Ghi chú |
|---|---|---|---|
| 23 | Tìm kiếm xuyên tất cả phiên | ✅ | RPC `sessions.search` **đã tồn tại và chạy được** từ trước, docstring còn ghi "Backs the UI's Cmd+K search palette" — nhưng caller duy nhất là remote-PWA. Desktop chỉ lọc tiêu đề. Gap rẻ nhất cả repo |
| 24 | Chương + mục lục transcript | ✅ | 3 lớp chống lạm dụng: chính sách trong description · 1 chương/lượt · ledger per-session chặn trùng tiêu đề + trần 10 |
| 25 | Widget inline do model sinh | ✅ | `sandbox=""` + `default-src 'none'`, script TẮT tới khi người đọc bật. Giữ HTML thay vì rút về SVG tĩnh: SVG inline cũng mang `<script>` — **cái mua được bảo mật là cái hộp, không phải ngôn ngữ**. Fence là ` ```awog:widget `, cố ý KHÔNG cướp ` ```html ` |
| 26 | Card "model gửi file cho user" | ✅ | `assertInsideWorkspace` + `stat` bắt buộc; path ngoài workspace không thành card mà báo lại model |
| 27 | Chip "việc ngoài phạm vi" | ✅ | Cờ bỏ qua theo `eid` trong localStorage — chip nằm trong transcript **trên đĩa** nên cờ chỉ trong component sẽ sống lại sau reload, trông y như model lải nhải |
| 28 | Archive phiên | ✅ | Trước chỉ có `delete` (vĩnh viễn) + `pinned` |
| 29 | Xem log sự kiện thô của phiên | ✅ | Dòng JSONL hỏng trả về `kind: 'malformed'` thay vì làm sập RPC — đó là giá trị chính của công cụ debug |
| 30 | Export JSON | ✅ | Sidecar vẫn tự sở hữu đường ghi (`.awog/exports/`), không nhận path từ UI |
| 31 | Render cell `.ipynb` | ✅ | Qua modal preview dùng chung; markdown/code/output kể cả ảnh và traceback; windowing 30 cell |
| 32 | Chip diff-stat + Create PR ở thanh trạng thái | ✅ | `git.status` có field `additions/deletions` nhưng `parsePorcelainV2` **chưa bao giờ điền** ⇒ phải cộng từ `git.diff` |
| 33 | Xem output job nền | ✅ | Kèm RPC `sessions.backgroundRead` |
| 34 | Follow-up do model gợi ý | ✅ | Model tự phát qua tool. **Cố ý chọn cách phủ kém hơn**: heuristic dẫn xuất từ văn bản sẽ bịa lời cho model — cùng họ lỗi confabulation repo đang chống |
| 35 | Artifact có URL/version/bình luận | ⬜ | **Khuyến nghị không làm** — trái local-first. Dừng ở export file |

## D. Cấu hình & hệ sinh thái

| # | Hạng mục | TT | Ghi chú |
|---|---|---|---|
| 36 | Plugin có version + update | ✅ | So **3 phía bằng git blob SHA-1** (baseline `.install.json` · đĩa · nguồn): nguồn đổi ⇒ `status`, người dùng sửa ⇒ `localModified`, **cả hai ⇒ xung đột, bắt chọn tay**. Áp dụng dựng bundle ở thư mục tạm rồi `rename` nên hỏng giữa chừng không để lại trạng thái nửa vời. Update cũ = `rm -rf` ghi đè mù |
| 37 | Marketplace tìm plugin/skill | 🟡 | **Code xong** (`templates/marketplace.ts` + 2 RPC + store + `TemplateDiscoverDialog`/`TemplateConsentPanel`). Thiếu duy nhất: repo danh mục `boykioyb/awog-templates` chưa tồn tại (404) — đó là việc **xuất bản**, không phải code |
| 38 | MCP registry động + gợi ý theo ngữ cảnh | ✅ | Registry chính thức của MCP. `redirect: 'manual'` + kiểm tra **từng IP** sau `dns.lookup` (chặn DNS rebinding). `command` suy từ allowlist cứng — `runtimeHint` do registry cấp bị **bỏ qua**. Cache 24h, degrade offline 4 mức đã đo thật |
| 39 | Luật quyền theo pattern lệnh + 3 tầng | ✅ ⚠️ | [ADR 0080](../decisions/0080-command-scoped-permission-rules.md). Đây là **lỗ hổng**, không phải thiếu tính năng: "always allow" cho `git status` từng mở khoá **mọi lệnh Bash** trong phiên |
| 40 | Tự đề xuất allowlist từ lịch sử | ✅ | Chỉ đề xuất từ lời gọi người dùng **đã đồng ý** (step `done`), không bao giờ từ lời gọi bị từ chối. Nội dung luật **không đến từ UI** — park server-side dưới id ngẫu nhiên, renderer chỉ gửi lại id + tầng |
| 41 | Statusline tuỳ biến | ❌ | Đã build rồi **gỡ bỏ** (2026-09-07). Nó có lý ở terminal — nơi không có chrome thường trực nên muốn biết model/branch phải gõ lệnh hỏi. AWOG là GUI và **chính thanh đó đã có sẵn** `StatusConfig` (model + effort), `StatusBranch` (branch + file bẩn + diff-stat), `StatusContext` (thanh % ngữ cảnh) ⇒ 6/12 biến trùng với chip đang hiện ngay cạnh. Đây là bài học về parity: chép một tính năng mà không chép **lý do nó tồn tại** thì ra một thứ thừa. Phần settings phân tầng (#43) giữ nguyên — statusline chỉ là consumer đầu tiên, không phải lý do |
| 42 | Output style do người dùng tự viết | ✅ | Store 2 tier `.awog/styles/<id>.md`, 3 RPC, Settings → Styles, chọn được trong picker, bản của user **đè** bản dựng sẵn cùng id. Id lạ không còn degrade im lặng — sidecar log `warn` nêu rõ lượt đó chạy KHÔNG style |
| 43 | Settings phân tầng + hợp nhất storage | ✅ | 2 tầng user→project, merge sâu 2 cấp, UI cho biết giá trị đến từ tầng nào. Bằng chứng cho "setting ở localStorage là setting giả": remote gateway đọc `defaults.provider` từ file mà UI **chưa bao giờ ghi** ⇒ mọi phiên tạo từ điện thoại rơi về model cứng |
| 44 | `/init` quét repo sinh CLAUDE.md | ✅ | Quét qua `git ls-files` (tôn trọng `.gitignore` miễn phí), ngân sách 4000 file / 20k ký tự. **Không bao giờ ghi đè** file có sẵn — trả nháp để người dùng tự trộn |
| 45 | Skill eval / doctor | ✅ | Doctor 17 luật tĩnh, 0 đồng, đọc `SKILL.md` **RAW** (store trả `null` cho file thiếu `name`/`description` — đúng file cần soi nhất). Eval kích hoạt có trần calls/USD/wallclock, và tổng đã tiêu đo bằng usage thật sau khi thêm `completePiWithUsage` |
| 46 | Keymap: thêm action, đồng bộ | ✅ | 6 → 14 action, bindings theo người dùng qua settings. Chord **không làm** (kéo theo máy trạng thái + phát hiện xung đột 2 tầng, ngoài phạm vi) |

---

## Bug phát hiện trong lúc audit

Những cái này **không phải** thiếu tính năng — là code sai đang chạy.

| Bug | Vị trí | TT |
|---|---|---|
| "Always allow" theo tên tool ⇒ leo thang quyền im lặng | `runtime/permission.ts` | ✅ ADR 0080 |
| 4 node song song ghi chung working tree + auto-commit đua nhau | `tasks/node-runner.ts`, `tasks/engine.ts` | ✅ ADR 0081 |
| Multi-select của `AskUserQuestion` mất `description` từng lựa chọn | `SessionGateCard.vue` | ✅ |
| Pi advertise `WebSearch` rồi luôn trả lỗi | `builtin-stubs.ts` | ✅ |
| UI liệt kê tool `KillShell` không tồn tại ở runtime Pi | `SessionConfigPopover.vue` | ✅ |
| `.gitignore` có `tasks/` **không neo gốc** ⇒ nuốt luôn `sidecar/src/tasks/` | `.gitignore` | ✅ |
| `parsePorcelainV2` phụ thuộc thứ tự dòng ⇒ `detachedAt` **không bao giờ** được điền (git phát `branch.oid` trước `branch.head`), cảnh báo detached HEAD mất phần sha | `git/parser.ts` | ✅ |
| Test `discoverGitRepos` dựng `.git` rỗng rồi mong nó là repo — mâu thuẫn với chính helper `makeRepo` của nó; source đúng, test sai | `git/__tests__/discover.test.ts` | ✅ |
| Mode `execute` từ xa bỏ qua permission park | `electron/src/remote-gateway-policy.ts` | ⬜ ⚠️ |
| Trust của hook tier project lưu ở `{project}/.awog/.trust.json` — **trong repo**. Ai commit được `.awog/hooks/evil.json` thì cũng commit được trust của nó. Cùng lớp với F1, phát hiện khi viết [ADR 0085](../decisions/0085-workflow-as-script.md) §3 | `hooks/store.ts` | ✅ Chuyển sang `~/.awog/hook-trust/<băm đường dẫn>`, file cũ **không nạp, không migrate**. Cố ý lệch ADR 0080 F2 ở một điểm: file hỏng ⇒ coi như rỗng chứ không cấm ghi đè — mất luật là mất DENY (fail-**open**), mất trust là hook không chạy (fail-**closed**) |

Hai dòng cuối nằm ngoài phạm vi các đợt vừa rồi và cần infosec xử lý riêng. Dòng `remote-gateway-policy.ts` là **ghi chú do chính repo tự viết trong code**, không phải kết luận của lần audit này.

## Audit bảo mật sau khi ship (2026-09-07)

Một lượt infosec chạy trên đúng phần vừa thêm đã **chặn merge** với 1 Critical + 2 High. Ghi lại vì bài học quan trọng hơn bản vá:

| # | Mức | Nội dung | TT |
|---|---|---|---|
| F1 | **Critical** | Luật quyền tier project đọc từ `{project}/.awog/permission-rules.json` — file **nằm trong repo**. Chỉ cần một repo lạ commit `{"rule":"Bash(*)"}` là nạn nhân clone về, mở project, rồi model chạy lệnh **không hỏi**. Bản vá quyền chống được lệnh ghép và pattern rộng, nhưng lại tự mở một cửa mới ở tầng lưu trữ | ✅ Luật tier project chuyển sang AWOG home khoá theo đường dẫn project — "dự án này **trên máy này**", không bao giờ đi theo git. File cũ trong repo **không nạp, không migrate im lặng** |
| F2 | High | Một entry hỏng (`"action": "alow"`) làm `safeParse` cả file thất bại ⇒ **mọi luật DENY biến mất im lặng** (fail-**open**). Lần "always allow" kế tiếp còn ghi đè xoá sạch file | ✅ Validate **từng entry**; từ chối ghi đè file hỏng |
| F3 | High | ADR hứa "DENY thắng mọi tầng" nhưng nhánh thoát sớm đứng **trước** chỗ đọc luật ⇒ `Read`/`Grep`/`Glob`/`WebFetch`/`Task`/`mcp__*` và toàn bộ nhóm SSH không bao giờ đọc luật. Luật deny parse thành công rồi **vô tác dụng** | ✅ Đọc DENY trước mọi nhánh thoát sớm, cho mọi tool |
| F4 | Medium | `read_terminal` đẩy nguyên văn buffer (kể cả `export TOKEN=…`, output phiên `ssh prod`) lên provider, không qua redact | ✅ Redact trước khi trả |
| F5 | Medium | Body terminal không escape `</terminal-output>` ⇒ tiến trình bất kỳ in ra chuỗi đóng là thoát khỏi hàng rào untrusted, đứng vào chỗ model đọc như văn bản hệ thống | ✅ Hàng rào mang nonce sinh mới mỗi lần gọi |
| F6 | Medium | `redact.ts` chỉ che **giá trị chuỗi** dưới khoá nhạy cảm ⇒ lọt array/object; và không đọc nội dung chuỗi ⇒ lọt `PGPASSWORD=…`, `-H 'X-Api-Key: …'` | ✅ Che cả nhánh con bất kể kiểu + lớp thứ 3 quét gán trong chuỗi |
| F8 | Medium | Worktree: `canCommit` chỉ kiểm tra **cấu hình** auto-commit, không kiểm tra commit có xảy ra thật ⇒ node fail giữa chừng thì `rm -rf` xoá trắng việc chưa commit. Merge cũng rơi vào nhánh đang checkout, không phải nhánh đã ghi | ✅ Không xoá mù nữa: còn thay đổi ⇒ commit `WIP` (`--no-verify`, vì hook fail chính là một trong các đường mất trắng); cứu không được ⇒ **giữ nguyên checkout** thay vì xoá. Nhánh đích neo lúc cấp worktree, HEAD lệch ⇒ không merge, pause task |
| F15 | Low | `mergeOne` đẩy `git stderr` thô lên event UI, không qua sanitizer của đường RPC | ✅ |
| F9–F14 | Low/Med | Chi phí matcher nhân số luật; cache theo `mtime+size`; `run_in_background` không nằm trong subject của luật; chưa có UI xem/thu hồi luật | ✅ F9 xong; `run_in_background` xử lý bằng F12 (lời gọi detached vẫn quét đủ nhưng KHÔNG được chốt ALLOW); UI xem/thu hồi luật xong 2026-09-07. Còn lại: cache theo `mtime+size` |

## Audit lần 2 (2026-09-08) — sau khi allowlist Remote Gateway mở rộng

Bốn lượt audit song song, **cả bốn đều chặn merge**. Bản vá nằm ở 7 commit `fix(...)`
trên nhánh này. Những mục đáng ghi lại:

| # | Mức | Nội dung | TT |
|---|---|---|---|
| A1 | **Critical** | `sessions.steer` không kẹp chế độ. Mọi method khác từ chối phiên chạy chế độ không cần duyệt khi `unattended` tắt, riêng steer thì không ⇒ một frame từ điện thoại lái được phiên `execute` | ✅ Steer đọc chế độ THẬT của phiên đích |
| A2 | High | Thu hồi thiết bị không hạ `unattended`. Công tắc là toàn cục, không gắn thiết bị ⇒ thiết bị ghép nối **tiếp theo** thừa hưởng ngay quyền chạy không duyệt | ✅ Revoke hạ luôn công tắc |
| A3 | High | Bộ so khớp glob sai ở **biên thư mục**: biến `filled` dùng chung cho mọi vị trí bắt đầu, nên `*` khớp xuyên `/` | ✅ Tách nhánh `cross` + tiền tính `nextSlash`, kèm test hồi quy |
| A4 | High | `will-navigate` không bắn cho redirect server và iframe con ⇒ một cú 302 đưa Browser pane ra ngoài allowlist. Lần vá trước sửa `browser.ts` mà **bỏ sót `window.ts`** | ✅ `will-redirect` + `will-frame-navigate` ở cả hai, cộng chặn permission request và download |
| A5 | High | Trust của hook neo vào **ID lấy từ frontmatter** — tức nằm trong chính file sửa được | ✅ ID ép theo tên file; vân tay băm trên bytes đã parse; script ngoài `.awog/hooks` fail-closed |
| A6 | High | `confirmCommand` của dev server là tuỳ chọn ⇒ quên ở một call site là fail-**open** | ✅ Bắt buộc |
| A7 | Medium | Spec widget khẳng định "không có kênh rò rỉ vì CSP chặn hết". Khẳng định SAI: CSP không có directive nào quản việc trang **tự điều hướng chính nó** | ✅ `openFull()` gửi bản không script; đính chính thẳng câu sai trong spec |
| A8 | High | `redact.ts` bậc hai: 200 KB mất ~57 giây, đủ lỡ 3 nhịp heartbeat và bị `killWedged()` giết engine giữa lượt | ✅ Trần cho mọi lượng tử mở + atomic group + trần đầu vào 1 MiB. Gấp đôi input ⇒ gấp đôi thời gian |

**F4b — hàng rào chống che nhầm tự mở ra một lỗ.** Đáng ghi riêng vì nó chỉ lộ ra khi
**kiểm chứng lại một bản vá đã pass**, không phải khi audit. Bản vá "che nhầm mã nguồn"
thay luật `dài ≥ 12` bằng hàng rào "định danh thuần" `^[A-Za-z_][A-Za-z_.-]*$`. Hàng rào
đó chặn `password: hashedPassword` đúng ý đồ — và nuốt trọn
`SECRET_KEY=change-me-in-production`. Quét **577 phiên thật**: ~950 lần khớp bị bỏ qua,
phần áp đảo là thông tin đăng nhập đang lọt (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`,
`AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD=postgres`). Đóng bằng ngoại lệ hẹp cho khoá kiểu
biến môi trường và cờ CLI; khoá viết thường cố ý không nới (đo được: +104 nhãn i18n, +0
bí mật thật).

**Điều đáng rút ra (lần 2):** báo cáo của agent **chẩn đoán sai nguyên nhân** hiệu năng
(quy cho nhánh PEM; thủ phạm thật là hai lượng tử khác), và một agent khác **khẳng định
sai** rằng nhánh Claude SDK không gọi `evaluatePermissionRules`. Cả hai chỉ lộ ra khi tự
đo và tự đọc lại `path:line`. Một suite xanh và một báo cáo gọn gàng không thay được việc
tự nhìn — nhất là ở regex và ở chỗ nói "không có đường nào tới đây".

**Điều đáng rút ra:** F1 sinh ra *từ chính bản vá* của một lỗ hổng khác. Luật cũ hỏng vì khoá theo tên tool; luật mới khoá theo nội dung đúng như thiết kế, nhưng việc đặt tier project **trong repo** đã lặng lẽ biến cấu hình quyền thành thứ người lạ ghi được. Sửa một lỗ ở tầng logic mà không xét lại tầng lưu trữ là cách tạo ra lỗ tiếp theo.

Bài học đó đã được nâng thành **luật đứng** ở [ADR 0085](../decisions/0085-workflow-as-script.md) D-4: *tier nằm trong repo không bao giờ mang mã thực thi, và không bao giờ tự mang bản ghi trust của chính nó.* Áp luật đó ngược lại repo thì lộ ngay `hooks/store.ts:129` (xem bảng bug ở trên).

## Bảy tool bắc cầu sang nhánh Claude SDK (2026-09-08)

Runtime chọn **theo provider** (ADR 0058), nên mọi tool chỉ đăng ký ở `runtime/tools/index.ts`
là một **lỗ năng lực im lặng**: đổi provider của một agent sang `anthropic` là model mất tool đó,
không báo gì. Đợt này đóng bảy cái: `schedule_wakeup` · `read_terminal` · `browser_tool` ·
`dev_server` · `code_index` · `list_sessions` · `send_session_message`.

Khuôn dùng chung cho cả bảy, và **phần thân không bao giờ được chép**: nhánh Pi bọc thành
AgentTool (schema TypeBox), nhánh SDK bọc thành MCP tool (schema zod), cùng gọi một runner. Với
`read_terminal` lý do không phải cho gọn mà là bảo mật — khử bí mật và hàng rào nonce nằm trong
runner đó, nên một bản dựng lại ở bridge sẽ trôi khỏi bản kia một cách im lặng, và cái trôi đi là
bảo mật.

**Tiêu chí đặt tool vào server nào**: tên server hiện ra trong luật quyền và trong `disabledTools`,
nên nó phải nói đúng tool là gì. `schedule_wakeup` đi nhờ `awogsurfaces` (nó là thứ model ĐẶT VÀO
phiên, cùng họ). `read_terminal` có server riêng vì nó là NGUỒN ĐỌC dữ liệu L1 — gộp chung thì một
luật viết cho `mcp__awogsurfaces__*` vô tình phủ luôn nó. Tương tự `awogdev` (đọc log + dừng tiến
trình) và `awogsessions` (đọc danh bạ phiên khác + ghi vào hộp thư phiên khác) — biên tin cậy khác
hẳn nhóm surface.

**Hỏng sẵn lộ ra vì test đòi hai runtime giống nhau** (test đòi cùng nhãn ⇒ hoá ra nhãn chưa đúng ở
runtime NÀO): 7 tool AWOG-native chưa từng có nhãn transcript nên hiện tên thô; `dev_server`/
`code_index` có nhãn mà thiếu icon nên trông như một lượt subagent; và cả bảy không nằm trong nhóm
nào của Session config nên không tắt riêng được.

## Một lớp bug lặp lại: tool bắc cầu đổi tên

Xuất hiện **ba lần trong một ngày**, nên ghi lại thành luật thay vì ba lần sửa rời:

Mỗi tool bắc sang nhánh Claude SDK đổi tên `foo` → `mcp__<server>__foo`. Bất kỳ chỗ nào so tên **bằng chuỗi trần** sẽ im lặng bỏ sót ở nhánh đó — mà nhánh đó là `provider === 'anthropic'`, đường phổ biến nhất.

| Lần | Chỗ so tên trần | Hậu quả |
|---|---|---|
| 1 | `disabledTools` → `disallowedTools` (4 bề mặt model→người dùng) | Công tắc trông như đã tắt, model vẫn gọi được |
| 2 | `isGatedTool` trong `runtime/permission.ts` (`browser_tool`) | `navigate`/`click`/`fill` chạy **không qua cổng**, kể cả trong plan mode |
| 3 | `sessions/step-mapper.ts` | Chỉ là icon sai — vô hại, nhưng cùng gốc |

Đặc điểm khiến nó khó bắt: **typecheck không thấy** (hai chuỗi đều hợp lệ) và **nhánh Pi không thấy** (tên trần vẫn khớp). Quy tắc: mỗi lần bắc thêm một tool sang SDK, tìm mọi nơi so tên tool đó bằng `===` và đổi sang matcher chấp nhận cả hai dạng. Test hồi quy: `runtime/tools/__tests__/bridged-tool-gating.test.ts` (có cả ca ngược — `browser_tool_helper` của bên thứ ba KHÔNG được ăn theo cổng).

## Dọn nợ kỹ thuật (2026-09-07)

Bốn mục nợ đã xử lý xong (gỡ khỏi danh sách bên dưới); ghi lại phần *quyết định*, không ghi lại phần diff.

**Thẻ xin quyền không còn lách qua store.** Luật mà "Always allow" sắp ghi nay đi trên chính `PermBlock.suggestion` — store điền nó ngay trong handler `session.permission-request` (event vốn đã mang `suggestions`, store chỉ đang vứt đi). Nhờ đó `useSessionPermissionRule.ts` bỏ được cả hai chỗ lách: listener tự mở ở module load, và lượt RPC thứ hai. Một lần bấm nay chỉ còn **một** lời gọi `store.setPermission(id, msgIndex, 'allow', true, scope)`; nó trả về đúng tầng sidecar đã ghi (`savedScopes`) cho thẻ hiển thị. Điều kiện đúng đắn về thứ tự nay được giữ theo cách khác: mọi thứ store sở hữu (trạng thái block, `pendingPermission`, trạng thái phiên) settle **đồng bộ** trước `await`, nên lượt sau có park prompt kế tiếp thì cũng không ai trả lời nhầm. `pushRequest` đổi thành trả promise nhưng **nuốt lỗi bên trong** — phần lớn caller không `await`, unhandled rejection sẽ là hồi quy. Nội dung luật vẫn KHÔNG bao giờ đi từ renderer xuống: UI chỉ chọn tầng.

**Chữ ký metadata header** nay gồm `archived`/`archivedAt`/`todos`/`bookmarks`. Riêng cặp `archived` lấy **trọn vẹn theo đĩa** thay vì "copy khi có": bỏ lưu trữ là *xoá hẳn key* (`session-manager.ts`), nên nếu chỉ copy-khi-có thì bản local `archived: true` sẽ hoàn tác đúng thao tác vừa làm bên ngoài. `todos`/`bookmarks` luôn ghi thành mảng (rỗng khi xoá hết) nên copy-khi-có là đủ.

**`sessions.search` loại phiên đã lưu trữ, mặc định.** Lưu trữ nghĩa là "giấu phiên đi mà không xoá", và `sessions.list` đã ẩn nó; nếu tìm kiếm vẫn lôi ra thì thao tác dọn dẹp chỉ có tác dụng một nửa — tệ nhất là ở chỗ dễ bực nhất: phiên vừa cất đi lại chen lên đầu kết quả vì nó mới nhất. Chọn theo `sessions.list` cho một mặc định duy nhất, `includeArchived: true` mở lại. Bẫy ngược ("tìm mãi không thấy vì quên là đã lưu trữ") **không** được bỏ qua bằng cách im lặng: kết quả trả thêm `archivedHidden` — số phiên đã lưu trữ có khớp nhưng bị giấu (cận dưới khi kết quả đã đầy) — đủ để UI mời mở rộng phạm vi. **Chưa có UI đọc field đó** ⇒ xem mục nợ bên dưới.

**`git.checkInstalled`** dùng `gitVersion()`/`gitAtLeast()` của `git/runner.ts`, không tự parse nữa. Đổi lại probe cache theo vòng đời tiến trình: cài git trong lúc app đang chạy thì phải khởi động lại mới hết banner — chấp nhận được cho một phép đo bootstrap (hiện chưa bề mặt nào gọi lại RPC này để thử lần hai).

## Nợ kỹ thuật ghi nhận, chưa xử lý

- `sessions.setArchived` + `sessions.listEvents` chưa vào allowlist Remote Gateway (⚠️ cần infosec nếu muốn lên PWA).
- ~~`sessions.search` trả `archivedHidden` mà UI chưa đọc~~ — **đã xong**: `useSessionSearch.ts` đọc field này và `SessionList.vue:297` hiện dòng "còn N phiên trong kho lưu trữ khớp".
- Comment ở `git/runner.ts` (mục "Version probe") vẫn viết `git.checkInstalled` "keeps its own parse" — đã hết đúng sau lần dọn 2026-09-07.
- `resolveSessionProjectPath` cache theo vòng đời sidecar — phiên bị trỏ sang project khác sẽ đọc cache cũ.
- Nhánh Claude SDK: job nền external không có file log ⇒ vĩnh viễn chỉ có metadata, kể cả sau khi có `sessions.backgroundRead`.
- `rerunPhase` invalidate hạ nguồn theo **topology**, không theo fingerprint đầu vào ([ADR 0085](../decisions/0085-workflow-as-script.md) phần Bối cảnh). Hôm nay nó biểu hiện thành *chạy lại nhiều hơn cần* (tốn tiền, có trần chặn) chứ không phải bỏ sót ⇒ ghi nhận là nợ, không phải lỗi.

## Thứ tự đề xuất cho đợt sau

1. **Parity runtime** (#1 backend search, #7a–7e, #9) — nhóm khiến "đổi provider = đổi năng lực".
2. **#13 cron** — hạng mục duy nhất mở ra loại use-case mới hoàn toàn (agent chạy khi không ai ngồi máy). Task engine JSONL restart-safe đã hợp sẵn.
3. **#43 hợp nhất settings** — chặn trước, vì #41/#46 đều phụ thuộc nó.
4. **#2 browser** và **#5 codegraph** — đắt, làm khi đã hết việc rẻ.
5. ~~**#15 workflow script**~~ — **đã đóng** bằng [ADR 0085](../decisions/0085-workflow-as-script.md) (Rejected/Deferred). Không nằm trong hàng đợi nữa; muốn mở lại phải thoả điều kiện §5 của ADR.
