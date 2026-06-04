# Quy trình Release & Build bản stable

Tài liệu mô tả gitflow phát hành AWOG và cách CI build bản cài đặt cho **Windows / macOS / Linux**.

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Mô hình nhánh (gitflow gọn)

- **`main`** = nhánh tích hợp, luôn xanh (typecheck + build pass). Mọi bản release cắt từ `main`.
- **`feat/<slug>` / `fix/<slug>` / `chore/<slug>`** = nhánh ngắn cho **một** mục đích → PR vào `main`. Tránh nhánh long-lived gom nhiều feature.
- Không cần nhánh `release/*` riêng cho dự án nhỏ — tag trực tiếp trên `main` là đủ.

## Cắt một bản release

### 1. Đồng bộ version (tất cả phải khớp tag)

Bump cùng một số `X.Y.Z` ở:

| File | Trường |
|---|---|
| [apps/desktop/src-tauri/tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json) | `version` ← **CI kiểm tra trường này khớp tag** |
| [apps/desktop/src-tauri/Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) | `version` |
| `package.json` (root) + `apps/desktop/ui` + `apps/desktop/sidecar` | `version` |
| [apps/desktop/ui/utils/changelog.ts](../apps/desktop/ui/utils/changelog.ts) | thêm entry mới ở **đầu** mảng (drives "What's New" + chấm đỏ NavRail) |

### 2. Commit + tag + push

```bash
git switch main && git pull
# ... đã bump version + cập nhật changelog ...
git commit -am "chore(release): v0.3.1"
git tag v0.3.1            # tag PHẢI dạng vX.Y.Z và khớp tauri.conf.json version
git push origin main --follow-tags
```

### 3. CI tự build

Push tag `v*` kích hoạt [release.yml](../.github/workflows/release.yml):

- Build song song trên 4 runner: **macOS arm64** (`macos-14`), **macOS x64** (`macos-13`), **Linux x64** (`ubuntu-22.04`), **Windows x64** (`windows-latest`).
- Mỗi runner: cài deps → **build sidecar** (externalBin native theo target triple) → `tauri build` (Nuxt generate qua `beforeBuildCommand` + bundle).
- Upload installer vào một **GitHub Release dạng draft** (tên `AWOG v0.3.1`).

Bản cài đặt sinh ra (`bundle.targets: "all"`):

| OS | Định dạng |
|---|---|
| macOS | `.dmg` + `.app` (arm64 và x64 riêng) |
| Windows | `.msi` + `.exe` (NSIS) |
| Linux | `.deb` + `.AppImage` (+ `.rpm`) |

### 4. Publish

Vào tab **Releases** trên GitHub → mở draft → kiểm tra asset đủ 4 nền tảng → **Publish release**.

## Build thử thủ công

`workflow_dispatch` (tab Actions → Release → Run workflow) build thử mà không cần tag — vẫn tạo draft (đặt tên theo nhánh). Khuyến nghị vẫn dùng tag cho bản thật.

## Ký số / Notarization (tùy chọn)

Không bắt buộc; nếu thiếu, app **build unsigned** (người dùng gặp cảnh báo "unidentified developer"). Bật bằng cách đặt các repo secret (Settings → Secrets and variables → Actions):

- **macOS:** `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- **Tauri updater** (nếu sau này bật auto-update): `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **Windows code signing:** cần cấu hình thêm trong `tauri.conf.json` (`bundle.windows.certificateThumbprint` / Azure Trusted Signing) — chưa wire.

## Lưu ý quan trọng

- ⚠️ **App hiện cần Node.js trên máy người dùng.** Sidecar đóng gói là launcher script gọi `node lib/src/index.js` (không phải binary tự đứng — vì `@anthropic-ai/claude-agent-sdk` mang theo Claude CLI + native deps). Bản "stable" vì vậy vẫn phụ thuộc Node runtime. Đóng gói Node nhúng (sea / bun compile) là việc cải thiện riêng nếu muốn cài đặt zero-dependency.
- **Cross-compile không khả dụng** với setup này (sidecar + bundler đều native) → bắt buộc build trên đúng OS, đó là lý do dùng matrix.
- macOS universal binary chưa hỗ trợ (sidecar build sinh đúng một triple theo host) → ship arm64 + x64 riêng.
