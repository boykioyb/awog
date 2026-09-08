# Danh mục template (gói #37) — bản mẫu để xuất bản

[`catalog.json`](./catalog.json) trong thư mục này **không được AWOG đọc**. Nó là bản mẫu để đẩy
sang **repo danh mục**, là nơi duy nhất app đi lấy.

Toàn bộ đường đi đã có sẵn trong code (`templates/marketplace.ts` + 3 RPC `templates.marketplace*` +
`TemplateDiscoverDialog.vue`/`TemplateConsentPanel.vue`). Thứ duy nhất còn thiếu là **file
`catalog.json` trên repo đó** — chưa có thì màn hình "Khám phá" hiện rỗng kèm dòng
`catalog not published yet`.

## Địa chỉ cố định

Owner/repo/ref/path là **hằng số biên dịch** ([`marketplace.ts:76-80`](../../apps/desktop/sidecar/src/templates/marketplace.ts)) —
không setting nào, không payload UI nào đổi được:

| Hằng | Giá trị |
| --- | --- |
| `CATALOG_HOST` | `raw.githubusercontent.com` |
| `CATALOG_OWNER` | `boykioyb` |
| `CATALOG_REPO` | `awog-templates` |
| `CATALOG_REF` | `main` |
| `CATALOG_FILE` | `catalog.json` |

```
https://raw.githubusercontent.com/boykioyb/awog-templates/main/catalog.json
```

Đổi bất kỳ ô nào trong bảng ⇒ phải sửa code và phát hành lại app. Đổi **nội dung** danh mục thì
không — đó chính là lý do danh mục nằm ở một file trên repo chứ không phải trong bản build.

## Xuất bản

```bash
# 1. Tạo repo PUBLIC tên đúng `awog-templates` dưới tài khoản `boykioyb`
gh repo create boykioyb/awog-templates --public --description 'AWOG template catalog'

# 2. Đẩy catalog.json lên GỐC repo, nhánh `main`
git clone https://github.com/boykioyb/awog-templates.git
cp docs/marketplace-catalog/catalog.json awog-templates/catalog.json   # từ gốc repo awog
cd awog-templates && git add catalog.json && git commit -m 'Publish template catalog' && git push

# 3. Kiểm — phải trả 200, không phải 404
curl -sI https://raw.githubusercontent.com/boykioyb/awog-templates/main/catalog.json | head -1
```

Trong app: Templates → **Khám phá**. Bản mới có thể chậm tối đa **24 giờ** mới thấy vì cache trên
đĩa (`~/.awog/template-catalog-cache.json`, TTL 24h); bấm **Làm mới** để bỏ qua cache.

## Hình dạng file

Top-level ([`CatalogSchema`](../../apps/desktop/sidecar/src/templates/marketplace.ts)):

```jsonc
{
  "version": 1,        // number nguyên, TUỲ CHỌN — hiện chưa dùng để phân nhánh
  "templates": [ ... ] // bắt buộc, tối đa 600 phần tử thô; giữ lại tối đa 300 entry hợp lệ
}
```

Mỗi phần tử của `templates` ([`EntrySchema`](../../apps/desktop/sidecar/src/templates/marketplace.ts)):

| Field | Bắt buộc | Kiểu / trần | Ghi chú |
| --- | --- | --- | --- |
| `id` | ✅ | string 1–120 | Khoá trong danh mục. Trùng id ⇒ **giữ bản đầu**, bản sau bị bỏ im lặng |
| `name` | ✅ | string 1–200 | Tên hiển thị |
| `url` | ✅ | string 1–2048 | **https + host đúng `github.com`**, và phải là link `/tree/<branch>/<folder>` |
| `description` | — | string ≤2000 | Thiếu ⇒ `''` |
| `author` | — | string ≤200 | Thiếu ⇒ `''` |
| `version` | — | string ≤120 | Nhãn hiển thị thuần |
| `kinds` | — | mảng ≤5 của `agent`/`skill`/`hook`/`rule`/`command` | Loại entity **listing khai** |
| `tags` | — | mảng ≤20, mỗi phần tử ≤60 ký tự | Dùng cho ô tìm cục bộ |
| `homepage` | — | string ≤2048 | **Bắt buộc https** (+ qua `ssrfCheck`: không loopback/IP nội bộ). Hiện thành link bấm được ở màn hình đồng ý; sai luật ⇒ **rụng riêng field**, entry vẫn sống |

Toàn file phải **≤ 512 KB** (`MAX_CATALOG_BYTES`). Ngoài ra:

- **Trường lạ bị bỏ qua**, không làm hỏng entry.
- **Entry hỏng bị LOẠI, không giết cả danh mục.** Sai một field bắt buộc, `kinds` có giá trị lạ, hay
  `url` rời `github.com` ⇒ entry đó biến mất khỏi danh sách **mà không có thông báo nào**. Đây là lý
  do phải có test — xem dưới.
- `url` trỏ **thư mục bundle** (nơi có `template.json`), không phải gốc repo và không phải link
  `/blob/`. Thiếu `/tree/<branch>` thì lúc cài installer phải hỏi thêm api.github.com nhánh mặc định.

## Thêm một entry

1. Đẩy bundle lên một repo GitHub **public**, layout theo [`templates/README.md`](../../templates/README.md)
   (thư mục có `template.json` + `agents/ skills/ hooks/ rules/ commands/`).
2. Thêm một object vào `templates[]` của [`catalog.json`](./catalog.json).
3. `kinds` phải **khai đủ** những loại bundle thật sự chứa. Khai thiếu không giấu được gì: màn hình
   đồng ý đọc `template.json` thật rồi liệt kê phần chênh vào mục "không khai" (`undisclosedKinds`),
   nên khai thiếu chỉ làm entry của bạn trông đáng ngờ. Khai rỗng ⇒ **mọi** loại bị đánh dấu.
4. Chạy test (nó nạp chính file này):
   ```bash
   cd apps/desktop/sidecar && npx vitest@2 run src/templates/__tests__/marketplace-catalog-seed.test.ts
   ```
5. Đẩy lại `catalog.json` sang repo danh mục.

## Hệ quả tin cậy

Repo danh mục là **một điểm tin cậy**: ai ghi được vào nó thì quyết định được người dùng AWOG *nhìn
thấy* gì. Nhưng danh mục **không bao giờ quyết định được thứ gì chạy** — đã đối chiếu code:

- Entry chỉ mang **metadata + một URL**. `name`/`description`/`kinds` là **lời khai của listing**,
  không phải sự thật: sự thật đọc từ `template.json` của chính bundle ở bước `inspect`
  (`marketplace.ts` → `planSingleBundle`). Kể cả `id` của template sau khi cài cũng lấy từ manifest
  của bundle, không phải từ `id` trong danh mục.
- URL bị siết bằng **đúng một bộ luật**: `parseCatalog` cho url chạy qua chính `parseGithubUrl` của
  lớp cài (`tryParseGithubUrl` — biến thể không-ném), nên entry nào cài không được thì **không bao
  giờ hiện ra** trong danh sách; url rụng thì có log kèm `entry` + `reason`. Danh mục chỉ thêm một
  điều kiện riêng của mình là **https** (`parseGithubUrl` còn nhận `http`). Lúc bấm Cài,
  `planSingleBundle` parse lại bằng cùng hàm đó. Trước 2026-09-08 lớp danh mục chỉ so **host**, nên
  một url `/blob/main/…` đi lọt rồi mới chết ở nút Cài với `expected a /tree/<branch>/<folder> link`.
- Cài **bắt buộc kèm `token`** — băm của kế hoạch (danh sách entity + từng file + blob sha) mà
  người dùng vừa đọc. Nguồn tráo nội dung giữa lúc đọc và lúc bấm Cài ⇒ token lệch ⇒ engine **không
  ghi gì** và hỏi lại. Ràng buộc nằm ở engine, không ở UI.
- Cài = **ghi bundle vào `~/.awog/templates/<id>`**. Không entity nào vào project, **không hook nào
  chạy**. Hook chỉ tới được trạng thái chạy được sau `templates.install` (ghi vào tier project ⇒
  untrusted) và một lần người dùng duyệt trust riêng ([ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md) D-8).

Danh mục là **được tuyển**, không phải marketplace mở: chỉ người giữ repo đó thêm được entry. Ai
muốn phát hành ngoài danh mục vẫn dùng "Lấy từ GitHub" ([ADR 0037](../decisions/0037-remote-template-fetch-github.md))
— đường đó không mất đi.
