---
description: Cut a release — commit work, update changelog, bump version, push main + tag
argument-hint: "[patch|minor|major|X.Y.Z] (default: patch)"
---

# /release — phát hành một phiên bản AWOG

Thực hiện trọn quy trình release của repo AWOG. Tham số `$ARGUMENTS` quyết định mức bump:
`patch` (mặc định nếu để trống), `minor`, `major`, hoặc một version tường minh dạng `X.Y.Z`.

Commit message + tag = **tiếng Anh**; changelog song ngữ **en + vi**. Commit trên nhánh `main` (repo release thẳng từ main).

## 0. Tiền kiểm (BẮT BUỘC trước khi đụng git)

1. `git rev-parse --abbrev-ref HEAD` → phải là `main`. Nếu không, **dừng** và báo user.
2. Đọc version hiện tại từ `package.json` (root) → tính version mới:
   - `patch`: tăng số cuối (0.22.3 → 0.22.4)
   - `minor`: 0.22.3 → 0.23.0
   - `major`: 0.22.3 → 1.0.0
   - `X.Y.Z` tường minh: dùng nguyên.
3. **Gate build** — chạy song song, cả hai phải EXIT 0, nếu không thì **dừng** (đừng push code hỏng):
   - `cd apps/desktop/ui-next && pnpm typecheck`
   - `cd apps/desktop/sidecar && pnpm typecheck`
   - Lint chỉ là tham khảo: `stores/git.ts` có thể còn lỗi lint do WIP — **KHÔNG** chặn release vì lint.
4. `git status --porcelain` để xem toàn bộ thay đổi sẽ commit.

## 1. Commit toàn bộ work

1. `git add -A`.
2. **Quét secret** trên staged diff, dừng nếu khớp:
   `git diff --staged | rg -n "sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY"`
3. Xác nhận không lẫn `node_modules` / `dist` / `.output` / `.env` trong `git diff --staged --name-only`.
4. Commit với message mô tả thực chất thay đổi (HEREDOC, title imperative ≤72 ký tự, `feat/fix/refactor(scope): …`). **KHÔNG** thêm trailer `Co-Authored-By` (quy ước repo).

## 2. Soạn changelog → xác nhận với user

Dựa trên diff vừa commit, soạn 1 entry release mới rồi **trình cho user duyệt version + nội dung trước khi push** (push/tag là thao tác outward-facing, khó undo).

- Thêm vào **ĐẦU** mảng `CHANGELOG` ở file (giữ đồng bộ y như các release trước):
  - @apps/desktop/ui-next/utils/changelog.ts
- Cấu trúc 1 entry (xem các entry hiện có để khớp format):
  ```ts
  {
    version: 'X.Y.Z',          // không có chữ "v"
    date: 'YYYY-MM-DD',        // ngày hôm nay (chạy `date +%F`)
    highlight: { en: '…', vi: '…' },   // 1 dòng tóm tắt (tùy chọn nhưng nên có)
    items: [
      { kind: 'added' | 'improved' | 'changed' | 'fixed', en: '…', vi: '…' },
      …
    ],
  },
  ```
- Viết theo góc nhìn **người dùng cuối** (đây là nội dung panel "What's New"), song ngữ tự nhiên, không thuật ngữ nội bộ.
- Commit: `docs(changelog): add vX.Y.Z release notes` (chỉ stage file changelog.ts).

## 3. Bump version

Sửa field `"version"` từ giá trị cũ sang version mới ở **đúng 4 file** (mỗi file 1 dòng):

- `package.json`
- `apps/desktop/electron/package.json`
- `apps/desktop/sidecar/package.json`
- `apps/desktop/ui-next/package.json`

Cách an toàn (grep xác nhận mỗi file chỉ có 1 chỗ khớp trước khi thay):
```bash
for f in package.json apps/desktop/electron/package.json apps/desktop/sidecar/package.json apps/desktop/ui-next/package.json; do
  perl -i -pe 's/"version": "OLD"/"version": "NEW"/' "$f"
done
```
Commit: `chore(release): vX.Y.Z` (stage đúng 4 file đó).

## 4. Tag + push

1. Tạo **annotated tag** (khớp kiểu tag cũ): `git tag -a vX.Y.Z -m "vX.Y.Z"`.
2. `git push origin main`
3. `git push origin vX.Y.Z`
   - Lưu ý auth: push cần account **boykioyb** (osxkeychain mặc định). Nếu 403, báo user thay vì thử workaround mù.

## 5. Báo cáo

Xác nhận: working tree clean, `origin/main` đồng bộ (`git rev-list --left-right --count origin/main...HEAD` = `0 0`), tag có trên remote (`git ls-remote --tags origin vX.Y.Z`). Liệt kê 3 commit (work → changelog → release) + version + tag.

## Thứ tự commit cuối cùng (mới → cũ)
```
chore(release): vX.Y.Z
docs(changelog): add vX.Y.Z release notes
<work commit>
```
