# Quy trình Release & Build bản stable

Tài liệu mô tả gitflow phát hành AWOG và cách CI build bản cài đặt cho **macOS / Linux / Windows** bằng **Electron + electron-builder** (xem [ADR 0027](decisions/0027-tauri-vs-electron-revisit.md) + [electron-migration.md](features/electron-migration.md)).

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Mô hình nhánh (gitflow gọn)

- **`main`** = nhánh tích hợp, luôn xanh (typecheck + build pass). Mọi bản release cắt từ `main`.
- **`feat/<slug>` / `fix/<slug>` / `chore/<slug>`** = nhánh ngắn cho **một** mục đích → PR vào `main`.
- Không cần nhánh `release/*` riêng — tag trực tiếp trên `main` là đủ.

## Cắt một bản release

### 1. Đồng bộ version (tất cả phải khớp tag)

Bump cùng một số `X.Y.Z` ở:

| File | Trường |
|---|---|
| `package.json` (root) | `version` ← **CI kiểm tra trường này khớp tag** |
| [apps/desktop/ui/package.json](../apps/desktop/ui/package.json) | `version` |
| [apps/desktop/sidecar/package.json](../apps/desktop/sidecar/package.json) | `version` |
| [apps/desktop/electron/package.json](../apps/desktop/electron/package.json) | `version` ← electron-builder lấy version từ đây cho tên installer |
| [apps/desktop/ui/utils/changelog.ts](../apps/desktop/ui/utils/changelog.ts) | thêm entry mới ở **đầu** mảng (drives "What's New" + chấm đỏ NavRail) |

> Không còn `tauri.conf.json` / `Cargo.toml` (đã gỡ Tauri).

### 2. Commit + tag + push

```bash
git switch main && git pull
# ... đã bump version + cập nhật changelog ...
git commit -am "chore(release): v0.3.5"
git tag v0.3.5            # tag PHẢI dạng vX.Y.Z và khớp version trong package.json (root)
git push origin main --follow-tags
```

### 3. CI tự build

Push tag `v*` kích hoạt [release.yml](../.github/workflows/release.yml):

- Build song song trên 3 runner: **macOS arm64** (`macos-14`), **Linux x64** (`ubuntu-22.04`), **Windows x64** (`windows-latest`). Không cần Rust toolchain, không cần lib GTK/WebKit (đã bỏ Tauri).
- Mỗi runner chạy [`scripts/pack.mjs`](../apps/desktop/electron/scripts/pack.mjs): `nuxt generate` → build engine bundle (`pnpm deploy --config.node-linker=hoisted` → `node_modules` phẳng **kèm binary Claude CLI** của đúng OS) → `electron-rebuild` node-pty (optional) → `tsc` main/preload → `electron-builder --publish always`.
- Upload installer vào một **GitHub Release dạng draft** (tên `vX.Y.Z`).

Bản cài đặt sinh ra:

| OS | Định dạng |
|---|---|
| macOS (arm64) | `.dmg` + `.zip` |
| Windows | `.exe` (NSIS) |
| Linux | `.AppImage` + `.deb` |

> macOS Intel (x64) tạm bỏ (runner `macos-13` xếp hàng lâu) — thêm lại entry matrix hoặc build universal khi cần.

### 4. Publish

Tab **Releases** trên GitHub → mở draft → kiểm tra đủ asset 3 nền tảng → **Publish release**.

## Build thử thủ công

- **Local:** `pnpm pack` (root) → chạy `pack.mjs`, sinh installer ở `apps/desktop/electron/release/`. `pnpm pack -- --dir` để chỉ tạo `.app`/thư mục unpacked (nhanh, không tạo dmg).
- **CI:** `workflow_dispatch` (tab Actions → Release → Run workflow) build thử không cần tag.

## Footprint

- **Bản tải về (dmg/nsis/AppImage) đã nén** ≈ **150–200MB**; bản **cài trên đĩa** ≈ **500–550MB**.
- Phần lớn dung lượng là **binary Claude CLI (~220MB)** do `@anthropic-ai/claude-agent-sdk-<os>-<arch>` mang theo + Electron framework (~233MB) — **cố hữu, không phụ thuộc shell** (xem [ADR 0027](decisions/0027-tauri-vs-electron-revisit.md)).
- `build.mjs` đã strip `.pdb` (debug symbol Windows của node-pty ~64MB) + chỉ giữ prebuild node-pty của host; `electron-builder.yml` chỉ ship locale `en`/`vi`.

## Ký số / Notarization (tùy chọn)

Không bắt buộc; nếu thiếu, app **build unsigned** (người dùng gặp cảnh báo "unidentified developer"; macOS có thể cần `xattr -dr com.apple.quarantine <App>` khi tải về). Bật bằng cách đặt repo secret (Settings → Secrets and variables → Actions) rồi **bỏ** dòng `CSC_IDENTITY_AUTO_DISCOVERY: false` trong [release.yml](../.github/workflows/release.yml):

- **macOS signing + notarize:** `CSC_LINK` (cert .p12 base64), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows code signing:** `CSC_LINK` + `CSC_KEY_PASSWORD` (cert .pfx) hoặc Azure Trusted Signing — cấu hình thêm trong `electron-builder.yml`.

## Lưu ý quan trọng

- ✅ **App tự-chứa, KHÔNG cần Node.js trên máy người dùng** — Electron mang sẵn Node; engine chạy bằng chính binary Electron ở chế độ `ELECTRON_RUN_AS_NODE`. (Khác bản Tauri cũ vốn phải bundle Node riêng.)
- **Native module:** `node-pty` được `electron-rebuild` theo ABI Electron (bước optional trong `pack.mjs` — nếu fail chỉ tắt terminal panel, không chặn release). `@napi-rs/keyring` là N-API nên không cần rebuild.
- **Fuse `runAsNode` phải BẬT** (mặc định) để `ELECTRON_RUN_AS_NODE` hoạt động trong bản đóng gói — đừng tắt fuse này.
- **Cross-compile không khả dụng** (binary CLI theo platform + node-pty rebuild + electron-builder đều native) → bắt buộc build trên đúng OS (matrix).
