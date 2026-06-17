# 0042 — WebFetch tool có thật (SSRF-guarded)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-16
- **Người quyết định:** AWOG core (theo yêu cầu user)

## Bối cảnh

Dưới Pi SDK runtime ([ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md)), model Claude (OAuth-conditioned) vẫn phát ra các tool built-in của Claude Code: `WebFetch`, `WebSearch`, `TodoWrite`, `Task`. AWOG đăng ký **stub graceful** ([ADR 0030](0030-subagent-task-tool.md)) để tránh lỗi `Tool <name> not found`.

Stub `WebFetch` ([builtin-stubs.ts](../../apps/desktop/sidecar/src/runtime/tools/builtin-stubs.ts)) luôn trả về:

> `Fetching URLs is not available in this environment (the agent has no outbound network access).`

Trong Session, mỗi lần model muốn đọc một trang web → nhận đúng câu này. User báo đây là trải nghiệm lỗi: agent nên đọc được nội dung URL công khai.

**Ràng buộc:** invariant #7 ([security.md](../../.claude/rules/security.md)) — *No SSRF từ model client*. URL fetch đến từ **model output → L1 untrusted** (cao hơn cả MCP config do user tự gõ). Vì vậy guard phải chặt hơn `ssrfCheck` hiện có ở [mcp/http-client.ts](../../apps/desktop/sidecar/src/mcp/http-client.ts) (vốn chỉ check hostname literal, không resolve DNS).

## Quyết định

Thay stub `WebFetch` bằng **tool thật** ([web-fetch-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/web-fetch-tool.ts)) fetch URL http/https công khai và trả nội dung dạng text (HTML → text). Guard SSRF nhiều lớp:

1. **Protocol + hostname literal** — reuse `ssrfCheck` (chỉ http/https; chặn loopback/private/link-local literal).
2. **DNS resolution** — `dns.lookup(host, { all: true })`, re-check **mọi** IP đã resolve qua `blockedHostReason` (tách export từ http-client). Chặn hostname trỏ vào IP nội bộ / DNS-rebinding.
3. **Redirect thủ công** — `redirect: 'manual'`, chạy lại toàn bộ guard ở **mỗi** hop (cap `MAX_REDIRECTS=5`). Chặn URL công khai bounce sang target nội bộ.
4. **Giới hạn tài nguyên** — timeout 20s (toàn request), download cap 2 MB (đọc stream theo byte, không buffer cả body), output cap 50k ký tự.

`WebSearch` **vẫn là stub** (chưa wire search backend / API key). `prompt` param được nhận để tương thích API nhưng không hành động (AWOG trả nội dung trực tiếp, không tóm tắt qua sub-model).

Reuse hạ tầng `fetch` của Node (Node ≥ 20) — **không thêm dependency** (HTML→text bằng regex strip, không thêm parser lib).

## Phương án đã cân nhắc

- **Giữ stub (status quo)** — đơn giản, an toàn tuyệt đối, nhưng agent mù web → từ chối.
- **Reuse thẳng `ssrfCheck` của MCP** — không đủ: bỏ qua DNS, mà URL ở đây là L1 (model output) nên bypass bằng hostname trỏ private IP. Từ chối.
- **Pin IP sau resolve (đóng TOCTOU hoàn toàn)** — cần custom undici dispatcher (connect tới IP nhưng giữ SNI/Host cho HTTPS). Quá phức tạp so với threat model desktop local; hoãn (xem trade-off).
- **Tóm tắt nội dung qua sub-model (như Claude Code)** — thêm 1 round-trip LLM + chi phí; YAGNI cho v1. Trả text capped là đủ trung thực.
- **Thêm html-to-text / turndown** — cần ADR cho dependency; regex strip đủ cho v1.

## Hệ quả

- **Tích cực:** Session/Task/subagent đọc được URL công khai; hết thông báo "not available". Guard mạnh hơn MCP (có DNS + redirect re-check). Zero dependency mới.
- **Tiêu cực / Trade-off:**
  - **TOCTOU DNS** còn hở: giữa lúc `lookup` và lúc `fetch`, bản ghi DNS có thể đổi sang IP nội bộ. Threat model desktop 1-user chấp nhận; pin-IP là việc tương lai.
  - HTML→text bằng regex thô (mất cấu trúc, không xử lý JS-rendered page).
  - Output cap 50k ký tự — trang lớn bị cắt.
- **Việc cần làm tiếp:**
  - Cập nhật [docs/features/subagent-task-tool.md](../features/subagent-task-tool.md) (bảng stub) + [docs/features/sessions.md](../features/sessions.md).
  - Cân nhắc cho user **bật/tắt** WebFetch ở Settings (mặc định bật) nếu cần chính sách offline tuyệt đối.
  - infosec review: xác nhận guard + cân nhắc pin-IP / allowlist host tùy chọn.

## Tham chiếu

- [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) — Pi SDK runtime
- [ADR 0030](0030-subagent-task-tool.md) — subagent Task tool + builtin stubs
- [security.md](../../.claude/rules/security.md) — invariant #7 (no SSRF), trust level L1
- [mcp/http-client.ts](../../apps/desktop/sidecar/src/mcp/http-client.ts) — `ssrfCheck` / `blockedHostReason`
