# `.claude/rules/`

Rule **ngắn gọn, ưu tiên cao** mà Claude Code quét trước khi sinh code trên repo AWOG. Không thay thế [docs/coding/](../../docs/coding/) — chỉ rút trích thành checklist ngắn cho hiệu năng tham chiếu.

Nguyên tắc: mỗi rule file ngắn (< ~80 dòng), tập trung một chủ đề, link tới docs/coding/ cho chi tiết.

## File

| File | Phạm vi | Tham chiếu đầy đủ |
|---|---|---|
| [principles.md](./principles.md) | DRY/KISS/YAGNI/SRP/SoC… | [docs/coding/general.md](../../docs/coding/general.md#nguyên-tắc) |
| [typescript.md](./typescript.md) | Strict mode, naming, type vs interface | [docs/coding/general.md#typescript](../../docs/coding/general.md#typescript) |
| [nuxt-vue.md](./nuxt-vue.md) | Component, store, theme | [docs/coding/nuxt-frontend.md](../../docs/coding/nuxt-frontend.md) |
| [lint-format.md](./lint-format.md) | Lệnh lint/format bắt buộc trước commit | [docs/coding/nuxt-frontend.md#lint--format](../../docs/coding/nuxt-frontend.md#lint--format) |
| [git-commit.md](./git-commit.md) | Convention commit/branch | [docs/coding/general.md#git](../../docs/coding/general.md#git) |
| [security.md](./security.md) | 8 invariant + sink/source nhạy cảm | [.claude/agents/infosec.md](../agents/infosec.md), [.claude/skills/security-audit/](../skills/security-audit/SKILL.md) |
