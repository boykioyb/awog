# 0054 — Rollup usage + cost theo ngày cho trang Activity

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-25
- **Người quyết định:** developer (sidecar) + tech-lead

## Bối cảnh

Trang Activity cần thống kê token usage + chi phí (USD ước lượng theo giá model)
trong nhiều khoảng thời gian (1d/7d/30d/90d/all), breakdown theo model / account /
ngày. Nguồn dữ liệu là JSONL của Sessions (`~/.awog/sessions/<id>.jsonl`) và Tasks
(`~/.awog/tasks/<id>/events.log`) — append-only, có thể rất lớn (một session từng
chạm 1.2 GB trước khi sửa O(steps²)).

Ràng buộc:

- Local-first, không database (MVP). Data layer = filesystem JSON/JSONL.
- Không được quét toàn bộ history mỗi lần mở trang (perf).
- API key / secret KHÔNG rời sidecar (8 invariant). Chỉ lưu account **id**.
- `dashboard.usage` (Home tile) trước đây cố tình BỎ task usage vì shape khác;
  lần này Activity phải gộp cả task.

## Quyết định

**Rollup cache theo local-day**, lưu tại `~/.awog/usage/daily/<YYYY-MM-DD>.json`.
Mỗi file một ngày, nội dung là map bucket:

```
key = "<accountId>|<provider>|<model>|<source>"   (source = session | task)
→ { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, turns }
```

Guardrail bất biến:

- **Ngày < hôm nay là bất biến** → tính một lần, ghi cache `frozen: true`, lần sau
  đọc thẳng cache (không quét lại JSONL).
- **"Hôm nay" không bao giờ freeze** → luôn tính lại từ log (turn mới phải vào).

Khi cần tính một ngày chưa cache: làm **một pass bounded** đọc ngược JSONL
(`collectSessionTurnsSince` mở rộng từ `collectUsageSince`), bucket theo ngày, dừng
khi vượt cửa sổ. Bỏ qua session ngoài range theo `updatedAt` trước khi chạm file
(tái dùng `listSessionSummaries()` — ADR 0048). Ghi cache atomic (tmp + rename),
đọc parse-safe (schema kiểm tra; cache hỏng → recompute).

Range `all` đặt trần `MAX_LOOKBACK_DAYS = 365`; phần cũ hơn bị bỏ và **log rõ**
(không silent cap).

**Cost** = override giá (Settings key `modelPricing`) ⊕ catalog mặc định
(`src/pricing/catalog.ts`, USD/1M token). Model không có giá → cost bỏ qua + flag
vào `missingPrices`.

**Attribution per-turn:** thêm field optional `accountId` vào `SessionMessage`
(ghi lúc finalize turn từ run settings) và `TaskRun.usage` (event `run.usage` mới).
Turn legacy thiếu id → fallback accountId hiện tại của session.

## Phương án đã cân nhắc

- **Quét JSONL trực tiếp mỗi request, không cache** — đơn giản nhưng range 30/90d
  + history lớn = quét lại GB mỗi lần mở trang. Từ chối vì perf.
- **Index incremental kiểu sessions/index.json** (cập nhật khi append event) —
  chính xác realtime nhưng phải sửa append path của cả session + task, phức tạp
  hơn và rủi ro drift. Rollup theo ngày (frozen quá khứ) đạt cùng mục tiêu perf
  với code ít hơn, KISS thắng. Có thể nâng cấp sau nếu cần realtime.
- **Dùng `cost` field của Pi `Model`** thay catalog riêng — Pi có sẵn giá nhưng
  không cho user override và không kiểm soát được nguồn/ngày. Từ chối; catalog
  riêng + override linh hoạt hơn.

## Hệ quả

- **Tích cực:** mở Activity nhanh (đọc KB cache cho ngày quá khứ); task usage được
  gộp lần đầu; user override được giá; secret không rời sidecar.
- **Trade-off:** ngày hôm nay tính lại mỗi request (chấp nhận — bounded theo
  activity trong ngày). Task usage chỉ có cho run chạy SAU khi event `run.usage`
  ship (run cũ không có token → vắng mặt, đã log là known gap, không bịa).
- **Việc cần làm tiếp:** infosec review (đọc credentials cho label); kiểm thử
  range `all` với history lớn; UI-next wire `activity.summary` / `activity.pricing`
  (đang làm song song).

## Tham chiếu

- ADR 0048 — session index lazy-load (`listSessionSummaries` tái dùng)
- ADR 0024 — task execution engine (events.log, `run.usage` thêm vào union)
- `apps/desktop/sidecar/src/pricing/catalog.ts`, `src/usage/rollup.ts`
- `apps/desktop/ui-next/composables/useActivity.ts` (contract phía UI)
