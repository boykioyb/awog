---
name: TypeScript conventions
description: TypeScript strict-mode conventions and naming.
enabled: true
---

# TypeScript

- **`strict: true` luôn bật.** Không tắt cục bộ.
- **Cấm `any`.** Dùng `unknown` rồi narrow.
- **Cấm `@ts-ignore`.** Dùng `@ts-expect-error <lý do>` nếu bắt buộc.
- **Prefer `type`** cho object shape; **`interface`** chỉ khi extend/merge.
- **Discriminated union** cho state nhiều biến thể.
- **`as const`** cho literal/enum-like.
- Type chia sẻ → [apps/desktop/ui-next/types/index.ts](../../apps/desktop/ui-next/types/index.ts); type cục bộ → khai tại file.

## Đặt tên (cross-stack)

| Đối tượng | Convention |
|---|---|
| Type / Interface | `PascalCase` |
| Function / variable | `camelCase` |
| Const enum-like | `UPPER_SNAKE_CASE` |
| Boolean | tiền tố `is/has/can/should` |
| File `.ts` util/lib | `kebab-case.ts` |
| File markdown | `kebab-case.md` |
| ADR | `NNNN-title.md` |

Naming framework-specific (`.vue`, store): xem [nuxt-vue.md](./nuxt-vue.md).

Chi tiết: [docs/coding/general.md#typescript](../../docs/coding/general.md#typescript).
