# Lint & Format

Frontend (`apps/desktop/ui/`) dùng **ESLint (Airbnb base) + Prettier**. Cấu hình: [`.eslintrc.cjs`](../../apps/desktop/ui/.eslintrc.cjs), [`.prettierrc`](../../apps/desktop/ui/.prettierrc).

## Trước khi báo task xong

```bash
cd apps/desktop/ui
pnpm lint:fix && pnpm format
pnpm lint     # phải 0 error
```

## Style chính

- **No semicolons** (`;`) — Prettier `semi: false`.
- Single quote, trailing comma `all`, printWidth 100, tab 2.
- Theme color → **bắt buộc** đi qua `useTheme()`, không hardcode.

## Tự fix vs sửa tay

- **Tự fix bằng `lint:fix`**: format, import order, unused vars (báo cáo), prefer-const, no-var.
- **Phải sửa tay**: nested ternary, explicit `any`, missing radix, unused vars/imports.

## Override khác Airbnb gốc (đã ghi sẵn)

- `semi: 'never'`, `no-plusplus`/`no-continue` off, `no-param-reassign` `props: false`, Nuxt aliases unresolved off, `vue/multi-word-component-names` off.

**Đừng tự thêm rule mới** mà không cập nhật [docs/coding/nuxt-frontend.md#lint--format](../../docs/coding/nuxt-frontend.md#lint--format) (bảng "Khác biệt với Airbnb").

## Hook tự động

Sau mỗi `Edit`/`Write` vào file trong `apps/desktop/ui/`, [.claude/hooks/format-after-edit.sh](../hooks/format-after-edit.sh) sẽ chạy `prettier --write` trên file đó. Nếu muốn tắt: gỡ hook khỏi [.claude/settings.json](../settings.json).
