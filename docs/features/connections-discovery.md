# Khám phá MCP server từ registry + gợi ý theo ngữ cảnh

Trạng thái: **Đã code** (gói #38) · Liên quan: [ADR 0025](../decisions/0025-connections-manager.md), [ADR 0060 — mô hình Sources](connections-sources-model.md), [ADR 0037 — remote template fetch](../decisions/0037-remote-project-templates.md) (mẫu tham chiếu cho phần tải nội dung từ host ngoài)

## Vấn đề

Catalog "nhà cung cấp phổ biến" của Connections nằm trong `apps/desktop/sidecar/src/sources/preset-catalog.ts` — **11 entry là hằng số biên dịch**, URL và command viết thẳng trong code. Chính comment ở `methods/source.list-presets.ts` ghi *"Static, no I/O"*. Hệ quả: muốn thêm một server mới, hoặc sửa một URL đã đổi, phải release app mới. Người dùng chỉ còn cách gõ tay toàn bộ cấu hình.

## Giải pháp

Ba mảnh, không mảnh nào thay thế catalog tĩnh:

1. **Nguồn động** — đọc danh sách server từ [MCP Registry chính thức](https://registry.modelcontextprotocol.io), cache xuống đĩa có TTL, luôn degrade khi offline.
2. **Gợi ý theo ngữ cảnh** — dựa trên project đang chọn, đề xuất vài server kèm **bằng chứng cụ thể**.
3. **Tab "Khám phá"** trong picker thêm connection — tìm, xem chi tiết, điền sẵn vào editor.

### Vì sao là registry này

`registry.modelcontextprotocol.io` do chính dự án Model Context Protocol vận hành, API công khai `/v0/servers` không cần khoá, có phân trang cursor, có cờ `isLatest` + `status` để lọc bản mới nhất còn hiệu lực, và có `search=` phía server. Đó là **registry chuẩn của giao thức**, không phải marketplace của một hãng — nên không kéo AWOG vào phụ thuộc thương mại nào. Không thêm dependency: dùng `fetch` sẵn có.

## Kiến trúc

| Thành phần | Vai trò |
|---|---|
| [`sources/registry.ts`](../../apps/desktop/sidecar/src/sources/registry.ts) | Fetch + rào SSRF + validate L1 + cache đĩa + map sang bản nháp `SourceConfig` |
| [`methods/source.discover-registry.ts`](../../apps/desktop/sidecar/src/methods/source.discover-registry.ts) | RPC `source.discoverRegistry` — duyệt / tìm |
| [`methods/source.suggest-sources.ts`](../../apps/desktop/sidecar/src/methods/source.suggest-sources.ts) | RPC `source.suggestSources` — quét project, sinh gợi ý có bằng chứng |
| [`methods/source.discover-preset.ts`](../../apps/desktop/sidecar/src/methods/source.discover-preset.ts) | Mở rộng: giải thêm id động `reg:<name>` bên cạnh id preset tĩnh |
| [`ConnectionDiscoverPanel.vue`](../../apps/desktop/ui-next/components/connection/ConnectionDiscoverPanel.vue) | Tab Khám phá: gợi ý + tìm kiếm + danh sách |
| [`ConnectionDiscoverDetail.vue`](../../apps/desktop/ui-next/components/connection/ConnectionDiscoverDetail.vue) | Màn hình **đồng ý**: hiện đủ command/args/url/env |
| [`ConnectionAddPicker.vue`](../../apps/desktop/ui-next/components/connection/ConnectionAddPicker.vue) | Hai tab: "Nhà cung cấp phổ biến" (tĩnh) · "Khám phá" (động) |

**Một đường ra duy nhất.** Tab Khám phá không có luồng lưu riêng: nó `emit('pick', id)` đúng như tab tĩnh. `source.discoverPreset` nhận cả `github` (tĩnh) lẫn `reg:io.github.foo/bar` (động) và trả về cùng một hình `{ preset, meta }`. Nhờ vậy `pages/connections.vue` và `useConnectionsPage.ts` **không phải sửa một dòng nào**, và luồng đồng ý của người dùng vẫn là đúng luồng cũ.

## Bảo mật

Xem `.claude/rules/security.md`. Đây là phần nặng nhất của tính năng vì registry là host ngoài và nội dung là L1 hoàn toàn không tin.

### SSRF (invariant #7) — ba lớp + không redirect

- **Host là hằng số biên dịch.** `REGISTRY_HOST = 'registry.modelcontextprotocol.io'`. Không có setting, không có param IPC nào đổi được nó ⇒ bề mặt SSRF đúng một tên miền.
- **Lớp 1** `ssrfCheck()` (dùng chung với `mcp/http-client.ts`): protocol http(s), chặn loopback / IP private / link-local / IPv6 ULA theo host literal.
- **Lớp 2** so khớp hostname **chính xác** với hằng số, và bắt buộc `https:`.
- **Lớp 3** `dns.lookup(all)` rồi chạy `blockedHostReason()` trên **từng IP** trả về — chặn DNS rebinding trỏ tên miền registry về mạng nội bộ.
- **Redirect: `redirect: 'manual'`.** Không đi theo redirect nào cả, kể cả cùng host: bất kỳ 3xx nào là lỗi. Chặt hơn `templates/remote.ts` (nơi buộc phải follow vì `raw.githubusercontent.com` 302 sang `objects.githubusercontent.com`); registry trả 200 trực tiếp nên chặt được thì chặt.
- URL `remotes[].url` của từng entry **cũng** qua `ssrfCheck()` + bắt buộc https **ngay lúc map**, nên một entry trỏ `http://127.0.0.1` không bao giờ lọt vào bản nháp.

### Nội dung registry là L1

- Zod validate toàn bộ phản hồi; item hỏng bị bỏ, không giết cả trang.
- Cap: 30s timeout · 4 MB/trang · 100 entry/trang · 5 trang · tối đa 500 entry · 20 args · 20 env key.
- Mọi mảnh chuỗi ghép vào args/env qua regex charset (`NPM_IDENT_RE`, `PYPI_IDENT_RE`, `VERSION_RE`, `ENV_KEY_RE`, và giá trị arg không chứa ký tự điều khiển).
- **Cache đĩa cũng là L1 khi đọc lại**: `~/.awog/mcp-registry-cache.json` được validate lại bằng `CacheSchema` mỗi lần đọc; hỏng ⇒ bỏ qua như không có cache. File ghi atomic (`.tmp` + rename), `chmod 0600`.

### Một entry độc hại không thành lệnh chạy ngầm

Ràng buộc cứng, thực hiện bằng bốn chốt chặn:

1. **Registry không bao giờ chọn được `command`.** Lệnh suy ra từ `registryType` qua bảng allowlist cứng: `npm → npx`, `pypi → uvx`. `runtimeHint` (chuỗi tự do của bên thứ ba) bị **bỏ qua**. Loại khác (`oci`, `nuget`, `mcpb`…) ⇒ `install.kind = 'unsupported'`, UI chỉ hiện link repo và **không có nút cài**.
2. **Không có gì được ghi hay chạy trong luồng khám phá.** `source.discoverRegistry` / `source.suggestSources` / `source.discoverPreset` đều chỉ *trả về dữ liệu*. Việc ghi vẫn nằm ở `source.upsert`; việc chạy vẫn nằm ở `source.test` / runtime.
3. **Màn hình đồng ý bắt buộc.** Trước khi bấm được "Dùng cái này", người dùng nhìn thấy `ConnectionDiscoverDetail`: dòng lệnh đầy đủ (`npx -y @foo/bar@1.2.3 …`) hoặc URL đầy đủ, danh sách env var, danh sách khoá bí mật cần điền, repo nguồn, kèm câu cảnh báo "entry này do bên thứ ba công bố". Sau đó vẫn còn **một lần bấm Lưu** trong `ConnectionEditor` (nơi command/args vẫn sửa được) mới có gì chạm đĩa.
4. **Bản nháp luôn `enabled: false`.** Bật là một hành động riêng của người dùng.

### Bí mật (invariant #1)

Env var được gieo **rỗng** (`{ GITHUB_TOKEN: '' }`), y hệt preset tĩnh; giá trị người dùng nhập đi vào OS keychain qua đường `source.upsert` sẵn có. `secretFields` chỉ mang **tên** để hiển thị. Không có bước nào tự lấy token.

### Bề mặt khác

- Hai RPC mới **không** nằm trong allowlist của Remote Gateway ([remote-gateway-policy.ts](../../apps/desktop/electron/src/remote-gateway-policy.ts) là default-deny, exact-match) ⇒ điện thoại không gọi được. Cố ý.
- `repositoryUrl` chỉ mở khi parse ra `https:`; mở qua `openExternal` sẵn có, không render `<a href>` (tránh điều hướng SPA bằng URL L1).
- Không thêm dependency, không mở cổng, không telemetry: chỉ một GET tới một host, do người dùng chủ động kích hoạt (tab Khám phá lazy-mount — mở picker để chọn preset **không** kéo theo request nào).

## Degrade khi offline

Đây là ràng buộc: người dùng offline **không được mất** thứ đang có.

| Tình huống | Hành vi |
|---|---|
| Catalog tĩnh | Không đổi. `source.listPresets` vẫn "static, no I/O" — tab đầu tiên luôn đầy đủ 11 entry. |
| Cache còn tươi (< 24h) | Trả cache, `origin: 'cache'`, không chạm mạng. |
| Cache hết hạn, mạng OK | Fetch, ghi cache, `origin: 'network'`. |
| Cache hết hạn, mạng hỏng | Trả **cache cũ**, `origin: 'cache'`, `stale: true` + `error` — UI hiện dòng amber "Đang xem bản đã lưu: …". |
| Không cache, mạng hỏng | `origin: 'offline'`, danh sách rỗng, UI nói rõ "danh sách nhà cung cấp phía trên vẫn dùng được". |
| Tìm kiếm khi mạng hỏng | Tự lọc cục bộ trên catalog đã cache thay vì báo lỗi trắng. |

`loadCatalog()` **không bao giờ throw**: lỗi đi kèm kết quả để UI nói được người dùng đang xem dữ liệu nào.

## Gợi ý theo ngữ cảnh

`source.suggestSources({ projectPath })` chỉ **đọc**, và chỉ ba nguồn tín hiệu ở mức nông nhất:

| Nguồn | Đọc gì | Ví dụ tín hiệu |
|---|---|---|
| `readdir` mức 1 | tên file/thư mục | `Dockerfile` → `docker`, `supabase/` → `supabase`, `*.tf` → `terraform` |
| `package.json` | tên dependency | `@sentry/node` → `sentry`, `@octokit/rest` → `github` |
| `.git/config` | host remote | chứa `github.com` → `github` |

Rồi ghép: từ khoá nào khớp một **preset tĩnh** thì ưu tiên preset; không thì lấy một entry registry **cài được** có từ khoá nằm trong `name`/`title`. Tối đa 6 gợi ý, đã cài rồi thì không gợi ý lại.

Cố tình **không** khớp vào `description` — đã thử và nó đẻ ra rác: từ khoá `stripe` khớp một server dựng website chỉ vì mô tả có nhắc "Stripe Checkout". Không có ứng viên sạch cho một từ khoá ⇒ từ khoá đó không sinh gợi ý nào.

> **Giới hạn đã biết.** Catalog nền là 500 entry đầu theo thứ tự tên của registry (registry không có xếp hạng phổ biến), nên gợi ý fallback chỉ tìm trong lát cắt đó. Thực tế phần lớn gợi ý hữu ích đến từ **preset tĩnh** (`github`, `notion`, `slack`, `linear`, `brave`…); phần registry là bonus. Muốn tốt hơn phải chạy `search=` riêng cho từng từ khoá, mà endpoint đó đo được ~25s/lượt — không đáng cho một panel load lúc mở.

Hai quyết định có chủ đích:

- **Giải thích được.** Mỗi gợi ý mang `reason = { code, keyword, evidence }` và UI in ra đúng bằng chứng: *"Có phụ thuộc @sentry/node"*, *"Git remote trỏ tới github.com"*. Không có điểm số mờ.
- **Không bịa.** Cố tình **không** suy từ ngôn ngữ (`go.mod`, `Cargo.toml`, `requirements.txt`): "có go.mod nên đây là một server Go ngẫu nhiên" là gợi ý vô giá trị. Không có tín hiệu ⇒ trả mảng rỗng và UI nói thẳng là không có gợi ý.

## Hợp đồng RPC

```ts
// source.discoverRegistry — duyệt (query rỗng) hoặc tìm
{ query?: string; refresh?: boolean }
  → { entries: RegistryEntry[]; origin: 'network'|'cache'|'offline'; fetchedAt: number|null; stale: boolean; error?: string }

// source.suggestSources — gợi ý theo project
{ projectPath?: string }
  → { suggestions: { id, kind: 'preset'|'registry', name, tagline, type, reason: { code, keyword, evidence } }[] }

// source.discoverPreset — mở rộng, id có thể là preset tĩnh HOẶC `reg:<name>`
{ presetId: string } → { preset: SourceConfig; meta: PresetMeta }
```

## Việc còn lại

- Chưa dựng được lệnh cho `registryType` dạng `oci` / `nuget` / `mcpb` — cố ý, vì chưa có cách sinh `docker run …` an toàn mà không đoán. Muốn mở thì cần ADR + infosec.
- Chưa có nút "cập nhật catalog theo lịch"; TTL 24h + nút Tải lại là đủ cho hiện tại (YAGNI).
- Chạm bề mặt mạng ⇒ nên gọi `infosec` audit trước khi release.
