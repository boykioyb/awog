---
name: implement-feature
description: Implement one developer task on AWOG end-to-end — read spec/ADR, write/edit code following coding-guide, run lint+typecheck, update affected docs. Used by developer agent.
---

# Skill: Implement Feature (developer workflow)

Workflow chuẩn để **một task** đi từ "to-do" → "done" trên AWOG.

## Khi nào dùng

- Có task cụ thể từ Plan (PM) + Spec (BA) + ADR (TL, nếu cần).
- Bug fix có spec/repro rõ.

## Khi nào KHÔNG dùng

- Chưa có spec → quay lại BA.
- Chưa có quyết định approach → quay lại TL.
- Task XL chưa tách → quay lại PM.

## Quy trình 9 bước

### 1. Đọc context

- Task acceptance từ Plan.
- AC liên quan từ Spec.
- ADR ảnh hưởng.
- Rule quick-scan: [.claude/rules/principles.md](../../rules/principles.md), [typescript.md](../../rules/typescript.md), [nuxt-vue.md](../../rules/nuxt-vue.md), [lint-format.md](../../rules/lint-format.md).

### 2. Khám phá code hiện có

```bash
# Tìm pattern tương tự
grep -r "<keyword>" apps/desktop/ui-next/
# Hoặc Glob theo path
```

- Reuse pattern, đừng tự bịa.
- Đọc file gần nhất sẽ chạm.

### 3. Cập nhật types (nếu shape đổi)

- File: [apps/desktop/ui-next/types/index.ts](../../../apps/desktop/ui-next/types/index.ts)
- Naming: PascalCase, discriminated union khi nhiều biến thể.
- Sau khi sửa: `pnpm typecheck` ngay để catch sớm.

### 4. Code theo layer

| Logic | Đặt ở |
|---|---|
| Hàm thuần (sort, format, calc) | `utils/` |
| Reactive logic chia sẻ | `composables/` |
| State app-wide | `stores/` |
| UI dùng chéo nhiều page | `components/` (PascalCase) |
| Route | `pages/` (kebab-case) |

Nguyên tắc bắt buộc:
- `<script setup lang="ts">` cho mọi `.vue`.
- `defineProps`/`defineEmits` type-only.
- Theme color **luôn qua `useTheme()`**, không hex hardcode.
- Tailwind cho layout, inline `:style` cho theme color.

### 5. Format / lint trong khi code

PostToolUse hook đã tự chạy `prettier --write` sau mỗi Edit/Write. Vẫn nên chạy thủ công cuối task:

```bash
cd apps/desktop/ui
pnpm lint:fix
```

### 6. Type check

```bash
pnpm typecheck
```

**Quy tắc**: lỗi typecheck mới phát sinh từ code của task → **bắt buộc fix**. Lỗi pre-existing trong code khác → **flag**, đừng fix lẫn (tạo task riêng).

### 7. Smoke test thủ công

```bash
pnpm dev
```

- Click qua flow chính của AC.
- Test dark + light theme.
- Test refresh trang.

### 8. Update tài liệu chạm vào

- [docs/architecture/system-overview.md](../../../docs/architecture/system-overview.md) nếu thêm route/component đáng kể.
- [docs/coding/nuxt-frontend.md](../../../docs/coding/nuxt-frontend.md) nếu thêm rule lint mới.
- Spec file: tick AC đã done.

### 9. Báo cáo

```markdown
## Done
- [x] AC1, AC3
- [ ] AC2 — open question, see Q1

## Files changed
- ... +N -M

## Lint / Typecheck
- `pnpm lint`: 0 error
- `pnpm typecheck`: pass cho file mới; pre-existing N error trong <file> (out of scope)

## Follow-up
- Cần QA test edge case ABC.
- Suggest tách task XYZ cho refactor ngoài scope.
```

## Anti-pattern

- ❌ Refactor "tiện tay" code ngoài scope task.
- ❌ Thêm dependency mới mà không hỏi (tech-lead + ADR).
- ❌ Tạo backend service / mở port mạng / database.
- ❌ Mock thay vì wire engine khi spec đòi engine thật.
- ❌ `any`, `// @ts-ignore` thiếu lý do, `console.log` còn sót.
- ❌ Hardcode hex, magic number không tên.
- ❌ Sửa nhiều mục đích trong 1 commit.

## Liên kết với role khác

- **Trước:** PM giao task (skill `decompose-tasks`).
- **Sau:** QA verify (skill `write-test-cases`) → reviewer check code (skill `review-pr`).
