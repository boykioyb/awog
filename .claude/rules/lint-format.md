# Lint & Format

Frontend (`apps/desktop/ui-next/`) dùng **ESLint 9 flat config (`@nuxt/eslint`) + Prettier**. Cấu hình: [`eslint.config.mjs`](../../apps/desktop/ui-next/eslint.config.mjs), [`.prettierrc`](../../apps/desktop/ui-next/.prettierrc). Base rule do `@nuxt/eslint` cấp (typescript-eslint + eslint-plugin-vue + Nuxt auto-import); **Prettier giữ vai trò format** (`stylistic: false` trong `nuxt.config.ts`).

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

- **Tự fix bằng `lint:fix`**: format (Prettier), prefer-const, no-var, gỡ `eslint-disable` thừa.
- **Phải sửa tay**: nested ternary, explicit `any`, unused vars/imports, type-import không nhất quán.

## Rule dự án (thêm/override trên `@nuxt/eslint` base)

Khai trong [`eslint.config.mjs`](../../apps/desktop/ui-next/eslint.config.mjs):

- **Bật chặt hơn:** `@typescript-eslint/no-explicit-any` = error, `consistent-type-imports` = error (`prefer: type-imports`), `no-unused-vars` (ignore `^_`), `vue/component-name-in-template-casing` = PascalCase, `vue/block-order` (template→script→style), `vue/html-self-closing`.
- **Tắt (idiomatic Vue / pattern dự án):** `vue/multi-word-component-names`, `vue/no-multiple-template-root` (Vue 3 fragment), `@typescript-eslint/no-dynamic-delete` (`delete record[key]` cho cache per-project), `@typescript-eslint/unified-signatures` (giữ 1 call-signature / event trong `defineEmits`).
- Format (semi, quote, printWidth…) **do Prettier lo**, không khai rule style trong ESLint.

**Đừng tự thêm/đổi rule** mà không cập nhật [docs/coding/nuxt-frontend.md#lint--format](../../docs/coding/nuxt-frontend.md#lint--format).

## Hook tự động

Sau mỗi `Edit`/`Write` vào file trong `apps/desktop/ui-next/`, [.claude/hooks/format-after-edit.sh](../hooks/format-after-edit.sh) sẽ chạy `prettier --write` trên file đó. Nếu muốn tắt: gỡ hook khỏi [.claude/settings.json](../settings.json).
