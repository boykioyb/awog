# 0078 — Reasoning effort parity hai runtime: nhánh Pi map 1:1 với thang Claude Code

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-05
- **Người quyết định:** Tech Lead + user (chốt phương án A — ưu tiên bám picker Claude Code)
- **Quan hệ:** **amend [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) item 6** — **chỉ** phần bảng mapping `ThinkingLevel → SimpleStreamOptions.reasoning`. Phần còn lại của item 6 (degrade khi `model.reasoning === false`, thay hằng `SUPPORTS_THINKING` bằng `model.reasoning` của Pi) **giữ nguyên hiệu lực**.
- **Bằng chứng:** [claude-agent-sdk-0.3.260-upgrade.md §3](../features/claude-agent-sdk-0.3.260-upgrade.md) (Track B).

## Bối cảnh

Danh sách hiển thị không sai: `THINKING_LEVELS` = `low | medium | high | extra-high | max`, nhãn `common.thinking.*` khớp đúng picker của Claude Code, dùng chung cho cả 3 picker (Settings → Defaults, chip status-bar, per-project LLM defaults). Lệch nằm ở **mapping runtime**:

| Picker | Claude Code | AWOG → Anthropic ([`effortFromLevel` — claude-sdk/shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts)) | AWOG → provider khác ([`LEVEL_MAP` — runtime/thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts)) |
|---|---|---|---|
| Low | `low` | `low` + thinking disabled | **off** |
| Medium | `medium` | `medium` | **`low`** |
| High | `high` | `high` | **`medium`** |
| Extra high | `xhigh` | `xhigh` | **`high`** |
| Max | `max` | `max` | **`xhigh`** |

Nhánh Anthropic 1:1 đúng. Nhánh Pi **dịch xuống đúng một nấc trên toàn thang**.

Comment đầu [thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts) biện minh việc dịch bằng *"Pi's reasoning scale differs"*. Lý do đó **không còn đúng**: thang của Pi là `off | minimal | low | medium | high | xhigh | max`, **trùng tên với Claude Code ở đúng 5 nấc trên**. Không có ràng buộc kỹ thuật nào bắt phải dịch.

Bốn hệ quả đã kiểm chứng trên catalog model của `pi-ai@0.85.0`:

1. **Mất một nấc, không sập.** OpenAI `gpt-5.x` / o-series khai đủ `low…max` ⇒ chọn "High" thực tế chạy `medium`, chọn "Max" chạy `xhigh`. Nấc `max` của Pi **không bao giờ với tới được**.
2. **Hai nấc trên cùng sập vào nhau ở model không khai `xhigh`/`max`.** `getSupportedThinkingLevels` chỉ nhận `xhigh`/`max` khi model khai tường minh trong `thinkingLevelMap`; không khai thì `clampThinkingLevel` tụt về `high`. Gemini 3.1 Pro chỉ khai `minimal…high` ⇒ "Extra high" và "Max" cho ra **y hệt** `high`. OpenAI **không** dính ca này.
3. **Cùng một nhãn, hai hành vi tuỳ provider.** Đổi account Anthropic → OpenAI mà giữ nguyên "High": effort thực tụt `high` → `medium`, im lặng, **không có gì trên UI báo**.
4. **Lệch ngay bên trong một session Anthropic.** Subagent `Task` ([ADR 0030](./0030-subagent-task-tool.md)) honor provider/model của chính AGENT.md, nên session Anthropic delegate sang agent ghim OpenAI/Google là rơi vào nhánh Pi với mapping lệch — cùng một session, hai thang effort. (`/compact` **không** dính: `runCompact` gọi `generateSummary` không truyền `reasoning`.)

## Quyết định

### 1. Mapping 1:1 toàn thang trên nhánh Pi

```
low → 'low'   |   medium → 'medium'   |   high → 'high'   |   extra-high → 'xhigh'   |   max → 'max'
```

Một map duy nhất trong [thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts), ba call-site tự hưởng: [run-stream.ts:483](../../apps/desktop/sidecar/src/runtime/run-stream.ts) (chat Pi), [invoke.ts:363](../../apps/desktop/sidecar/src/runtime/invoke.ts) (task node + one-shot method của provider ngoài Anthropic), [tools/task-tool.ts:321](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) (subagent).

Nấc `minimal` của Pi **tiếp tục không dùng**. Lưới degrade **giữ nguyên**: `model.reasoning === false` → `undefined`; `clampThinkingLevel` + `getSupportedThinkingLevels` vẫn là lưới an toàn cho model không khai `xhigh`/`max`.

### 2. Cái giá đã chấp nhận: một điểm lệch MỚI ở nấc `low`

Đây là phần quan trọng nhất của ADR này, cố ý không làm nhẹ đi.

Phương án A **đẻ ra một điểm lệch mới**. `thinkingFromLevel` trên nhánh Claude SDK ([shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts)) vẫn trả `{ type: 'disabled' }` ở `'low'` — ADR này **không** đụng tới nó. Nên từ bản này:

| "Low" | Anthropic (Claude SDK) | Provider khác (Pi) |
|---|---|---|
| Hành vi | `effort: 'low'` **+ extended thinking TẮT** — model không sinh thinking block | `reasoning: 'low'` — **có** thinking, ở mức nông nhất |

Hợp đồng cũ *"Low = tắt thinking, đồng nhất hai runtime"* bị phá: Anthropic giữ tắt, Pi bật. Phương án B (`low → off`) tránh được đúng điểm lệch này, nhưng đổi lại "Low" của AWOG không giống "Low" của Claude Code. **User chốt ưu tiên bám picker Claude Code** ⇒ chọn A, nhận điểm lệch.

Ghi lại đây như một **known divergence** để lần sau ai đọc `thinking.ts` cạnh `shared.ts` không tưởng là bug rồi "sửa cho đồng bộ" theo hướng ngược lại.

**Hướng đóng nó về sau (không phải việc của ADR này):** cho `thinkingFromLevel` bật thinking ở `'low'` — tức mọi level đều `{ type: 'adaptive', display: 'summarized' }`. Hoãn vì đó là **thay đổi hành vi thấy được trên nhánh Anthropic** (nhánh user dùng hằng ngày): "Low" đang không hề sinh thinking block sẽ bắt đầu sinh. Nó cần vòng QA + mục changelog riêng, không được đi ké PR này.

## Phương án đã cân nhắc

- **(B) `low → off`, sửa 4 nấc còn lại** (`medium→medium`, `high→high`, `extra-high→xhigh`, `max→max`) — sửa đúng 4 nấc đang lệch **và** giữ hợp đồng "Low = tắt thinking" chung cho hai runtime, tức không đẻ điểm lệch mới. **Loại:** "Low" của AWOG vẫn không phải "Low" của Claude Code, và tiêu chí user chốt là bám picker Claude Code tuyệt đối. Đổi một điểm lệch **thấy được ở tất cả các nấc** lấy một điểm lệch **chỉ ở nấc thấp nhất, chỉ ở việc có/không hiện thinking block** là đánh đổi có lợi.
- **(C) Không làm gì** — **loại:** không phải bug im lặng vô hại. Nó rơi mất một nấc trên mọi provider ngoài Anthropic, làm hai lựa chọn trên Gemini cho ra kết quả y hệt, và tạo lệch effort **bên trong một session** khi có subagent. Chi phí sửa là một map trong một file.
- **(D) Giữ mapping, bù bằng UI** — hiện nhãn/tooltip khác nhau theo provider — **loại:** đó là hợp thức hoá lệch chứ không sửa lệch; và nấc `max` của Pi vẫn không bao giờ với tới được dù nhãn có nói gì.

## Hệ quả

- **Hành vi thấy được:** cùng một lựa chọn cũ, từ bản này model **nghĩ sâu hơn một nấc** trên **mọi provider ngoài Anthropic** ⇒ **chậm hơn và tốn token hơn**. Đây không phải fix thầm lặng.
- **Bắt buộc có mục changelog `kind: 'fixed'`** trong [changelog.ts](../../apps/desktop/ui-next/utils/changelog.ts) nói thẳng "tốn token hơn ở cùng một mức", khi cắt release. **Chưa làm ở PR này** vì entry changelog gắn với version thật (CI [release.yml](../../.github/workflows/release.yml) fail nếu top entry ≠ version).
- **Gemini:** "Extra high"/"Max" vẫn clamp về `high`. Từ nay đó là **năng lực model**, không còn là lỗi mapping — đừng báo lại như bug.
- **Anthropic không đổi gì.** `effortFromLevel` + `thinkingFromLevel` giữ nguyên; QA parity chỉ cần xác nhận nhánh này *không* đổi.
- **Không có migration dữ liệu.** `Session.thinkingLevel`, `settings.defaults.thinkingLevel`, `ProjectLlmDefaults.level` và allowlist `LEVELS` ở [remote-gateway-policy.ts:196](../../apps/desktop/electron/src/remote-gateway-policy.ts) **đều không đổi** — giá trị persist là nhãn AWOG, không phải giá trị Pi. **Rollback = revert 1 file**, không cần migration ngược.
- **Amend ADR 0029 item 6** (chỉ bảng mapping). Ai đọc item 6 sau này phải đọc ADR này để lấy bảng đúng.
- **Không có test tự động cho lớp runtime** ⇒ verify bằng **QA thủ công đọc log request** theo bảng ở [§5 của plan doc](../features/claude-agent-sdk-0.3.260-upgrade.md): OpenAI `gpt-5.x` High phải là `reasoning: 'high'` (trước: `medium`), Max phải là `'max'` (trước: `xhigh`); model không reasoning vẫn `undefined`.
- **Yêu cầu kèm theo, đi cùng PR implement:** viết lại khối comment đầu [thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts) — nó đang mô tả sai hiện trạng và **là nguồn gốc của bug**; đồng thời sửa khối comment trên `effortFromLevel`/`thinkingFromLevel` trong [shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts) đang nhắc lại cùng lời biện minh *"the Pi path shifts levels down"*, và ghi vào đó điểm lệch `low` ở §2 để người đọc sau gặp `{ type: 'disabled' }` biết đó là có chủ đích.

## Tham chiếu

- [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) — item 6, bảng mapping mà ADR này amend
- [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) — runtime chọn theo provider; lý do tồn tại hai đường effort
- [ADR 0030](./0030-subagent-task-tool.md) — subagent honor provider của AGENT.md; nguồn của lệch trong-một-session
- [claude-agent-sdk-0.3.260-upgrade.md](../features/claude-agent-sdk-0.3.260-upgrade.md) — §3 (Track B) evidence, §5 QA plan, §6 rollback
- [dual-sdk-runtime.md](../features/dual-sdk-runtime.md) — mô tả hai runtime
