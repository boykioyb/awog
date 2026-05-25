# Git & Commit

- **Commit nhỏ, một mục đích.** Title imperative, ≤ 72 ký tự, **tiếng Anh**.
- Branch:
  - `feature/<slug>` — tính năng mới
  - `fix/<slug>` — bug fix
  - `docs/<slug>` — chỉ tài liệu
  - `chore/<slug>` — config, deps, build
- **Không commit:** `.nuxt/`, `node_modules/`, `dist/`, `.output/`, file API key, `.env*` (trừ `.env.example`).
- **Lockfile luôn commit** (`pnpm-lock.yaml`).
- Không force-push lên nhánh chung. Không sửa lịch sử commit đã push.
- Không skip hooks (`--no-verify`) trừ khi user yêu cầu rõ.
- **Tách commit theo loại**: deps update, refactor, feature — không trộn trong 1 commit.

## Khi user yêu cầu commit

1. `git status`, `git diff`, `git log -5` song song.
2. Nhóm change theo mục đích. Nếu nhiều mục đích → đề xuất nhiều commit.
3. Stage cụ thể từng file (không `git add .` trừ khi đã review).
4. Commit message HEREDOC; **không** thêm trailer `Co-Authored-By` trừ khi user yêu cầu.

Chi tiết: [docs/coding/general.md#git](../../docs/coding/general.md#git).
