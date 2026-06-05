# 0028 — Auto-update: electron-updater + GitHub Releases

- **Trạng thái:** Accepted — **Option A (electron-updater)** + chiến lược per-platform (user/PO chốt 2026-06-05)
- **Ngày:** 2026-06-05
- **Người quyết định:** Tech Lead + user/PO
- **Liên quan:** [0027](./0027-tauri-vs-electron-revisit.md) (migrate Electron), [electron-migration](../features/electron-migration.md), [release.md](../release.md), [auto-update](../features/auto-update.md)

## Bối cảnh

Sau khi migrate sang Electron ([ADR 0027](./0027-tauri-vs-electron-revisit.md)), app đóng gói bằng `electron-builder` và publish lên **GitHub Releases** (`provider: github`, hiện `releaseType: draft` — xem [electron-builder.yml](../../apps/desktop/electron/electron-builder.yml)). CI ([release.yml](../../.github/workflows/release.yml)) build 3 OS với `--publish always`; metadata `latest-mac.yml`/`latest.yml`/`latest-linux.yml` đã được electron-builder sinh ra. Người dùng **chưa có** cơ chế biết khi có bản mới — phải tự vào trang Releases tải lại tay.

Nhu cầu: **thông báo trong app khi có bản mới, cho phép tải + khởi động lại để cài.**

### Ràng buộc nền tảng (định hình quyết định)

1. **macOS bắt buộc ký số để auto-install.** electron-updater dùng Squirrel.Mac, **từ chối** cài bản update không có chữ ký Apple hợp lệ. App hiện build **unsigned** ([release.md §Ký số](../release.md)). Bật ký cần Apple Developer Program ($99/năm) + cert/notarize.
2. **`.deb` không auto-update qua electron-updater** (do apt quản lý). **AppImage** thì update được (electron-updater set `process.env.APPIMAGE`).
3. **Windows (NSIS) auto-update không cần ký** (chỉ cảnh báo SmartScreen).
4. **Updater chỉ thấy release đã publish, không thấy draft.** Quy trình draft + publish tay ([release.md §4](../release.md)) **tương thích** — bước "Publish release" là cổng kiểm soát bật/tắt update cho client.
5. **App hiện không có runtime node_modules** (mọi dep của shell là devDependency — xem comment [electron-builder.yml](../../apps/desktop/electron/electron-builder.yml)). `electron-updater` là **dep runtime** → phải gói vào asar.

## Quyết định

> **Dùng `electron-updater` + GitHub provider** (khóa cứng `owner/repo` của chính app, không nhận URL từ UI). **`autoDownload = false`** — hỏi người dùng trước khi tải. **Chiến lược per-platform:**
>
> | Nền tảng | Cơ chế |
> |---|---|
> | **Windows (NSIS)** | Auto-update đầy đủ: check → hỏi tải → tải nền → restart cài |
> | **Linux AppImage** | Auto-update đầy đủ (chỉ khi `process.env.APPIMAGE` có) |
> | **Linux `.deb`** | **Notify-only** — thông báo + mở trang Releases, người dùng tự cài |
> | **macOS** | **Notify-only** (unsigned) — thông báo + mở trang Releases |

- **`electron-updater`** thêm vào `dependencies` của [electron/package.json](../../apps/desktop/electron/package.json) (dep runtime **đầu tiên** của shell); electron-builder tự gói prod-deps vào asar.
- **Guard `app.isPackaged`** — updater no-op khi dev (tránh lỗi "not packaged").
- **Capability detect ở main:** `canAutoInstall = win || (linux && APPIMAGE)`. Nền tảng còn lại (mac, .deb) chạy check để **phát hiện** bản mới rồi **notify-only** (không download/install).
- **Chu kỳ check:** ~10s sau khi mở app + mỗi 4h + khi window focus (debounce). Tắt được qua Settings.
- **Không đổi quy trình release** — vẫn draft + publish tay; bổ sung tài liệu nêu rõ "publish = bật update".

### IPC contract (main ↔ renderer)

Thêm vào [preload.ts](../../apps/desktop/electron/src/preload.ts) + [ipc.ts](../../apps/desktop/electron/src/ipc.ts) — kênh riêng cho updater (tách khỏi `engine:event` của sidecar):

| Bridge (`window.awog`) | IPC channel | Vai trò |
|---|---|---|
| `getVersion()` | `app:version` (invoke) | Version hiện tại (`app.getVersion()`) |
| `checkForUpdates()` | `updater:check` (invoke) | Trigger check thủ công |
| `downloadUpdate()` | `updater:download` (invoke) | Bắt đầu tải (vì `autoDownload=false`) |
| `installUpdate()` | `updater:install` (invoke) | `autoUpdater.quitAndInstall()` |
| `openDownloadPage()` | `updater:openReleases` (invoke) | `shell.openExternal` tới **URL Releases cố định** (notify-only) |
| `onUpdateEvent(handler)` | `updater:event` (send) | Stream: `checking`/`available`/`progress`/`downloaded`/`not-available`/`error` |

> `updater:openReleases` mở URL **hard-coded** (repo releases page), **không** nhận URL từ UI → giữ allowlist `shell:openExternal` hiện tại (chỉ `claude.ai/oauth`) không bị nới lỏng (invariant #7).

## Phương án đã cân nhắc

### Option A — `electron-updater` + GitHub provider (KHUYẾN NGHỊ — chọn)
- **Pros:** cùng hệ electron-builder; tận dụng metadata `latest*.yml` đã sinh; provider khóa repo (an toàn); delta/full download, retry, signature verify sẵn.
- **Cons:** dep runtime đầu tiên (gói vào asar); mac/.deb không tự cài được (giới hạn nền tảng, không phải của lib).

### Option B — Electron `autoUpdater` built-in + Squirrel/feed server riêng
- **Loại:** cần dựng update server (Nuts/Hazel) hoặc Squirrel.Windows riêng → thêm hạ tầng, trái local-first/no-infra. GitHub Releases đã đủ.

### Option C — Notify-only mọi nền tảng (chỉ check version, mở trang tải)
- **Loại một phần:** đơn giản nhất, không cần dep runtime; **nhưng** UX yếu trên Win/Linux nơi auto-install hoàn toàn khả thi. → Chỉ dùng làm fallback cho mac/.deb.

### Option D — Không làm (status quo, tải tay)
- **Loại:** chính là vấn đề cần giải.

## Hệ quả

- **Việc cần làm:** xem [docs/features/auto-update.md](../features/auto-update.md) (spec + AC) và phân rã task.
  1. Shell: thêm dep + `updater.ts` + wire `main.ts` + IPC + preload + types.
  2. UI: `stores/update.ts` (state machine) + subscribe app-lifetime + `UpdateBanner.vue` + Settings section.
  3. Pipeline: verify publish sinh đủ `latest*.yml` 3 OS; cập nhật [release.md](../release.md).
- **Bundle:** `electron-updater` + `electron-log` (ghi log updater/engine/crash ra file — bản release không có terminal; xem [release.md §Log](../release.md) cho đường dẫn) + transitive (`builder-util-runtime`, `lazy-val`, `js-yaml`, …) lọt vào asar (~vài trăm KB) — chấp nhận; cần verify build sau khi thêm. `autoUpdater.logger = log` để mọi lỗi update (kể cả chữ ký) đều có vết.
- **Bảo mật (infosec gate):** provider khóa `owner/repo`; chữ ký verify bởi electron-updater; không URL từ UI; chỉ thêm host `github.com`/`objects.githubusercontent.com` vào allowlist network. `quitAndInstall` an toàn vì `engine.stop()` đã có ở `before-quit` ([main.ts:49-51](../../apps/desktop/electron/src/main.ts#L49-L51)).
- **macOS đầy đủ về sau:** khi có Apple cert → đổi `canAutoInstall` cho mac + bật CSC_*/notarize trong CI → mac auto-update không cần sửa UI (cùng state machine). Ghi nhận là **revisit** tương lai.
- **Cập nhật tài liệu:** [tech-stack](../architecture/tech-stack.md) (thêm electron-updater), [release.md](../release.md), CLAUDE.md (bảng stack).

## Tham chiếu

- [0027](./0027-tauri-vs-electron-revisit.md) — migrate Electron (nền tảng cho ADR này).
- [electron-migration](../features/electron-migration.md) — chi tiết shell/IPC/đóng gói.
- [release.md](../release.md) — quy trình build/publish hiện tại.
- [auto-update](../features/auto-update.md) — feature spec + acceptance criteria.
- electron-updater docs (GitHub provider, code signing requirements).
