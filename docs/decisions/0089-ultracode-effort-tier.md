# 0089 — Bậc "Ultracode" của Claude Code là bậc thứ sáu của picker effort

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-13
- **Người quyết định:** kyro (chốt), tech-lead

## Bối cảnh

AWOG có một picker "Mức suy luận" năm bậc (`ThinkingLevel` = `low | medium | high | extra-high | max`) dùng chung cho cả ba runtime. Trên nhánh Claude SDK nó đi ra hai field của `Options`: `effort` (ánh xạ 1:1, `extra-high → xhigh`) và `thinking` (chỉ `low` = tắt, các bậc trên đều `adaptive` + `summarized`). [ADR 0078](0078-reasoning-effort-parity.md) đã chốt phần ánh xạ này và ghi rõ "Anthropic không đổi gì".

Rà lại SDK `@anthropic-ai/claude-agent-sdk@0.3.260` (CLI bundled 2.1.260) thì lộ ra một bậc NGOÀI thang `EffortLevel` mà AWOG chưa từng chạm tới:

- `Settings.ultracode?: boolean` (`sdk.d.ts:7867`) — *"xhigh effort plus standing dynamic-workflow orchestration"*, session-scoped, đi qua `--settings` (tức `Options.settings`) hoặc control request `apply_flag_settings`. Đòi workflows bật + model hỗ trợ xhigh.
- `Settings.workflowKeywordTriggerEnabled` (`sdk.d.ts:6219`) — từ khoá `ultracode` trong prompt opt-in lượt đó vào Workflow tool (mặc định bật).
- CLI bundled có 54 chuỗi `ultracode`, trong đó `/effort ultracode` — tức **trong Claude Code nó là một GIÁ TRỊ của chính cái picker effort**, loại trừ nhau với `max`, chứ không phải một công tắc chồng lên bậc khác.

Chuỗi `ultracode` trước ADR này không xuất hiện ở đâu trong `apps/` lẫn `docs/`.

## Quyết định

1. **Mô hình dữ liệu:** thêm `SessionSettings.ultracode?: boolean` — một field RIÊNG, **không** thêm bậc thứ sáu vào `ThinkingLevel`. Lý do: `ThinkingLevel` là từ vựng dùng chung cho Pi + Codex + Claude SDK và còn chảy qua Settings → Mặc định, LLM mặc định của project, và cấu hình PR-review; nhét một khái niệm chỉ-Anthropic vào đó là bắt ba runtime và bốn bề mặt UI phải xử lý một giá trị mà chúng không có gì tương đương.
2. **Mô hình UI thì ngược lại:** nó hiện ra là **bậc thứ sáu của cùng một danh sách**, chỉ ở picker effort của PHIÊN (status bar), chỉ khi provider là `anthropic`. Chọn Ultracode ⇒ ghim kèm `level = 'extra-high'`; chọn bậc khác ⇒ tắt cờ. Hai cái loại trừ nhau, đúng như `/effort` của Claude Code.
3. **Runtime là nơi cưỡng chế, không phải UI:** `effortFromSettings()` / `thinkingFromSettings()` trả `xhigh` + thinking bật khi cờ bật, bất kể `level` mang giá trị gì. Một phiên cũ (hoặc một payload lệch) không bao giờ gửi được `--effort low` cạnh một cờ tự nhận là xhigh.
4. **Chỉ ghi cờ khi BẬT.** `sdkSettings()` không bao giờ gửi `ultracode: false`: `settingSources` của AWOG có `'user'`, nên gửi `false` là đè cấu hình người dùng tự đặt trong `~/.claude/settings.json`.
5. **Persist** cùng `level` trong header phiên (`sessions.upsert`), dù SDK gọi nó là session-scoped: với người dùng, đây là một lựa chọn trong picker — mở lại app thấy nó tụt về Max thì đúng là mất lựa chọn.
6. **Không gate theo model.** CLI tự hạ bậc im lặng khi model không hỗ trợ xhigh; AWOG nói điều đó ra trong tooltip của hàng thay vì dựng một danh sách model tự bảo trì (sẽ lệch mỗi lần Anthropic ra model mới).

Kèm theo, sửa một lỗi cùng họ lộ ra lúc rà: node của Task ghim cứng `level: 'medium'` ([node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts)), nên mức suy luận người dùng chọn không bao giờ tới được Tasks trên BẤT KỲ runtime nào. Nay Task chụp `thinkingLevel` lúc tạo — cùng đường với `commitCoAuthor` / `autoCommit*`, vì cấu hình sống ở renderer còn sidecar không đọc được.

## Phương án đã cân nhắc

- **Option A — bậc thứ sáu trong `ThinkingLevel`.** Trung thực nhất với `/effort`, nhưng bắt Pi và Codex phải hạ bậc một giá trị vô nghĩa với chúng, và làm Settings → Mặc định có thể đặt toàn app về một bậc chỉ chạy trên một provider. Từ chối: một khái niệm riêng của runtime rò vào enum dùng chung.
- **Option B — checkbox độc lập cạnh picker.** Rẻ nhất, nhưng sinh ra trạng thái "Thấp + Ultracode" không ai giải thích được, và buộc phải đoán xem `--effort low` hay cờ ultracode thắng. Từ chối.
- **Option C (đã chọn) — dữ liệu tách rời, UI gộp làm một bậc, runtime cưỡng chế.** Giữ được cả hai: enum dùng chung không bị bẩn, mà người dùng vẫn thấy đúng một danh sách loại trừ nhau.
- **`Query.applyFlagSettings()` để bật/tắt giữa phiên.** Chưa làm: AWOG dựng `Options` mỗi lượt nên `--settings` lúc khởi động đã đủ; giữ lại cho lúc cần đổi ngay giữa một lượt đang chạy.

## Hệ quả

- **Tích cực:** bậc cao nhất của Claude Code lần đầu dùng được từ AWOG, không phải mở terminal. `ThinkingLevel` vẫn sạch. Mọi mâu thuẫn effort/thinking bị khoá ở một chỗ duy nhất (`shared.ts`) và có test.
- **Tiêu cực / Trade-off:** cờ bật mà thiếu điều kiện (workflows tắt, model không xhigh, org chặn) thì CLI **lặng lẽ bỏ qua** — AWOG không có tín hiệu để báo lại, chỉ nói trước trong tooltip. Ultracode còn kéo theo Workflow tool: một lượt có thể sinh ra nhiều agent con và tốn token hơn hẳn, đây là đánh đổi người dùng tự chọn.
- **Việc cần làm tiếp:**
  - Chạy thật một lượt có cờ và bắt payload để xác nhận CLI nhận (`AWOG_CLAUDE_DEBUG=1`), vì mọi thứ trên đây đo từ `sdk.d.ts` + binary chứ chưa chạy end-to-end.
  - Cân nhắc đọc `supportedEffortLevels` từ init message của SDK (`sdk.d.ts:1288`) để hiện/ẩn hàng theo khả năng THẬT của model.
  - **Mobile Remote Control bỏ cờ:** `toEngineSettings()` trong [remote-gateway-policy.ts](../../apps/desktop/electron/src/remote-gateway-policy.ts) dựng lại `settings` từ một bộ key cố định, nên một lượt gửi từ điện thoại chạy ở `level` (= xhigh) nhưng KHÔNG có điều phối workflow. Degrade lành, cố ý để nguyên lần này: mở rộng chỗ đó là chạm allowlist ⇒ cần infosec re-audit.
  - `AgentDefinition.effort` (per-subagent) vẫn chưa dùng.

## Tham chiếu

- [ADR 0078 — reasoning effort parity](0078-reasoning-effort-parity.md) (bảng ánh xạ 1:1 và divergence ở `low`)
- [ADR 0058 — Claude Agent SDK vs Pi runtime](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (vì sao provider `anthropic` chạy nhánh riêng)
- [ADR 0085 — workflow as script](0085-workflow-as-script.md) (cái mà "dynamic-workflow orchestration" bật lên)
- [docs/reference/claude-sdk-options.md](../reference/claude-sdk-options.md) — bảng đối chiếu 66 `Options`
- `sdk.d.ts:7867` (`Settings.ultracode`), `sdk.d.ts:6219` (`workflowKeywordTriggerEnabled`), `sdk.d.ts:2035` (`Options.settings`)
