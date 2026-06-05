# Feature: Auto-update

**Trạng thái:** In Review

Quyết định kiến trúc: [ADR 0028](../decisions/0028-auto-update.md). Quy trình release: [release.md](../release.md).

## Overview

Thông báo trong app khi có phiên bản AWOG mới trên GitHub Releases, cho phép người dùng **tải** rồi **khởi động lại để cài** — không phải vào trang web tải tay. Windows + Linux(AppImage) cài tự động trong app; macOS + Linux(.deb) hiển thị thông báo + mở trang tải (notify-only, xem ADR 0028 vì sao).

## User Stories

- *Là người dùng*, tôi muốn được báo khi có bản mới để không bỏ lỡ tính năng/bản vá.
- *Là người dùng*, tôi muốn chủ động quyết định **khi nào tải** (không tốn băng thông ngầm) và **khi nào khởi động lại** (không gián đoạn việc đang làm).
- *Là người dùng macOS/.deb*, khi có bản mới tôi muốn một cú nhấp để mở trang tải đúng phiên bản.
- *Là người dùng*, tôi muốn tắt tự kiểm tra cập nhật và tự bấm "Kiểm tra ngay" khi cần.

## Functional Behavior

### State machine (`stores/update.ts`)

```
idle ──check──> checking ──┬─> not-available ─(2.5s)─> idle
                           ├─> error ─────────────────> idle (toast)
                           └─> available ──[user: Tải]──> downloading ──progress──> downloaded
                                       └─[notify-only]─> available (banner "Mở trang tải")
downloaded ──[user: Khởi động lại]──> (quitAndInstall → app thoát & cài)
```

- **`autoDownload = false`** — phát hiện bản mới **không** tự tải; chờ người dùng bấm "Tải xuống" (hỏi trước khi tải).
- **Capability per-platform** (tính ở main, gửi kèm event `available`): `canAutoInstall = win || (linux && process.env.APPIMAGE)`.
  - `canAutoInstall = true` → luồng download → restart trong app.
  - `canAutoInstall = false` (mac, .deb) → banner notify-only, nút "Mở trang tải" gọi `openDownloadPage()`.

### Lịch kiểm tra

- **~10s sau khi mở app** (không chặn startup).
- **Mỗi 4h** một lần khi app đang chạy.
- **Khi cửa sổ focus** trở lại (debounce ≥ 30 phút kể từ lần check trước).
- **Thủ công:** nút "Kiểm tra ngay" trong Settings.
- Toàn bộ chỉ chạy khi `app.isPackaged` (dev = no-op) và `settings.autoUpdate.enabled !== false`.

### Edge cases

| Tình huống | Hành vi |
|---|---|
| Offline / GitHub không phản hồi | `error` → log local; **không** banner ồn; nếu do user bấm "Kiểm tra ngay" → toast "Không kiểm tra được cập nhật". |
| Release còn ở **draft** (chưa publish) | Updater không thấy → coi như `not-available`. |
| Phiên bản cài = phiên bản mới nhất | `not-available`; nếu check thủ công → toast "Đang dùng bản mới nhất". |
| Người dùng bấm "Để sau" sau khi tải xong | Banner ẩn; bản đã tải vẫn được cài ở lần thoát app kế tiếp (`autoInstallOnAppQuit`, chỉ nền tảng auto-install). |
| Tải dở rồi mất mạng | electron-updater retry; nếu fail → `error` + banner cho "Thử lại". |
| `quitAndInstall` trong khi Task đang chạy | Trước khi gọi, cảnh báo nếu có task active; `before-quit` vẫn gọi `engine.stop()` để dừng engine sạch ([main.ts:49-51](../../apps/desktop/electron/src/main.ts#L49-L51)). |
| Dev mode | Updater no-op; UI hiện version nhưng nút check báo "Không khả dụng ở chế độ dev". |

## Acceptance Criteria

- **AC1 — Phát hiện (auto-install platform):** *Given* đang chạy bản đã publish cũ hơn trên Windows/AppImage, *When* check chạy, *Then* hiện banner "Có bản mới vX.Y.Z" với nút **Tải xuống** + **Bỏ qua**, **không** tự tải.
- **AC2 — Tải có tiến độ:** *Given* banner "có bản mới", *When* bấm **Tải xuống**, *Then* hiện tiến độ %; tải xong banner đổi thành "Đã tải vX.Y.Z — Khởi động lại để cài" + nút **Khởi động lại ngay** / **Để sau**.
- **AC3 — Cài khi restart:** *Given* đã tải xong, *When* bấm **Khởi động lại ngay**, *Then* app thoát, cài bản mới, mở lại đúng bản mới (engine dừng sạch trước khi thoát).
- **AC4 — Notify-only (mac/.deb):** *Given* mac hoặc .deb có bản mới, *When* check chạy, *Then* banner "Có bản mới vX.Y.Z" với nút **Mở trang tải**; bấm → mở trang Releases trên trình duyệt; **không** có nút tải/restart trong app.
- **AC5 — Settings:** *Given* trang Settings, *Then* thấy version hiện tại, lần check cuối, toggle "Tự động kiểm tra cập nhật", nút "Kiểm tra ngay".
- **AC6 — Tắt auto-check:** *Given* toggle off, *When* tới lịch check, *Then* không check (trừ khi bấm "Kiểm tra ngay").
- **AC7 — Fail-soft:** *Given* offline, *When* check tự động chạy, *Then* không banner lỗi gây phiền; check thủ công thì toast lỗi.
- **AC8 — Dev:** *Given* `pnpm dev`, *Then* không gọi updater thật, không crash.

## Data Model

### Settings (thêm vào [stores/settings.ts](../../apps/desktop/ui/stores/settings.ts))

```ts
autoUpdate: {
  enabled: boolean        // mặc định true; tắt = không auto-check
  lastCheckedAt: string | null  // ISO timestamp
}
```

### Update state (transient, `stores/update.ts` — không persist)

```ts
status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
currentVersion: string        // từ awog.getVersion()
newVersion: string | null
progressPercent: number       // 0..100 khi downloading
canAutoInstall: boolean       // từ event 'available' (main quyết định)
errorMessage: string | null
```

### Event payload (`updater:event`, main → renderer)

```ts
{ type: 'checking' }
{ type: 'available', version: string, canAutoInstall: boolean }
{ type: 'not-available' }
{ type: 'progress', percent: number }
{ type: 'downloaded', version: string }
{ type: 'error', message: string }
```

> Không có field nhạy cảm; không API key, không URL từ UI (invariant #1, #7 — [security.md](../../.claude/rules/security.md)).

## UI/UX Notes

- **UpdateBanner.vue** (mới) — non-blocking, đặt ở [layouts/default.vue](../../apps/desktop/ui/layouts/default.vue) (top bar / dưới TopBar). Theo `useTheme()`, không hardcode hex. Trạng thái:
  - `available` (auto-install): "🔄 Có bản mới **vX.Y.Z**" · [Tải xuống] [Bỏ qua]
  - `available` (notify-only): "🔄 Có bản mới **vX.Y.Z**" · [Mở trang tải] [Bỏ qua]
  - `downloading`: thanh tiến độ + "Đang tải… {percent}%"
  - `downloaded`: "✅ Đã tải **vX.Y.Z** — khởi động lại để cài" · [Khởi động lại ngay] [Để sau]
  - `error`: "⚠️ Không kiểm tra được cập nhật" · [Thử lại]
- **Settings → mục "Cập nhật"** (component mới theo mẫu [SettingsWorkspaceSection.vue](../../apps/desktop/ui/components/settings/SettingsWorkspaceSection.vue), thêm vào sections của [settings/index.vue](../../apps/desktop/ui/pages/settings/index.vue)): version hiện tại (read-only), lần check cuối, toggle auto-check, nút "Kiểm tra ngay", nút **"Open logs"** (reveal file log — bản release không có terminal; log ghi qua `electron-log`, xem đường dẫn ở [release.md §Log](../release.md)).
- Font/badge theo [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md). i18n en/vi.

## Dependencies

- **Runtime:** `electron-updater` (dep mới ở [electron/package.json](../../apps/desktop/electron/package.json)) — xem ADR 0028.
- **Hạ tầng:** GitHub Releases publish ([electron-builder.yml](../../apps/desktop/electron/electron-builder.yml) + [release.yml](../../.github/workflows/release.yml)) — đã có; cần verify sinh `latest.yml`/`latest-linux.yml`/`latest-mac.yml` cho cả 3 OS khi `--publish always`.
- **UI:** [useToasts](../../apps/desktop/ui/composables/useToasts.ts), [BaseModal.vue](../../apps/desktop/ui/components/BaseModal.vue), mẫu subscribe app-lifetime ở [app.vue](../../apps/desktop/ui/app.vue).

## Out of Scope

- Auto-update **macOS** (cần ký số + notarize — revisit khi có Apple Developer cert; ADR 0028 đã chừa đường).
- Delta/differential update tinh chỉnh, rollback bản cũ, kênh beta/stable riêng.
- Tự động cài không hỏi (silent install) — luôn cần người dùng đồng ý restart.
- In-app changelog của bản mới (đã có [WhatsNewModal](../../apps/desktop/ui/components/WhatsNewModal.vue) riêng; có thể link sau).

## Open Questions

- Có nên gộp nút "Xem changelog" vào banner (mở WhatsNewModal của bản mới) không?
- Khi có Task đang chạy mà user bấm restart: chặn hẳn hay chỉ cảnh báo rồi cho phép?
- Chu kỳ 4h có hợp lý, hay để cấu hình được trong Settings?
- Có cần badge "có bản mới" ở tray menu (Electron main) song song banner không?
