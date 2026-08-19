# 0070 — Dùng chung `.claude` làm nhà cho skills/agents/commands

- **Trạng thái:** Accepted (2026-08-19)
- **Ngày:** 2026-08-19
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

[ADR 0035](./0035-consolidate-config-tiers-to-awog.md) chốt "`.awog` là nhà duy nhất": 5 loại config-entity (agents, skills, hooks, rules, commands) lưu ở `~/.awog/{kind}` + `{project}/.awog/{kind}`, còn `.claude`/`.agents` hạ xuống **nguồn import một lần**. Đánh đổi đã ghi rõ trong chính ADR đó: *"Mất interop sống với Claude Code — sửa `.claude/agents` ngoài app không tự phản ánh; phải import lại."*

Sau ~2 tháng vận hành, đánh đổi này hỏng trên thực tế:

1. **Duplicate y hệt.** Trên máy user, `~/.awog/skills` và `~/.claude/skills` chứa **cùng 20 skill trùng tên**; `~/.awog/agents` và `~/.claude/agents` chứa **cùng 12 agent**. Chỉ đúng 1 file lệch nội dung (`strict-pr-review/SKILL.md`) — tức bản `.awog` là **bản copy đã cũ**, mỗi lần sửa ở Claude Code lại phải import lại tay.

2. **Skill chết trên nhánh Claude SDK.** [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) set `env.CLAUDE_CONFIG_DIR = ~/.awog/claude-sdk` để transcript của SDK không trộn vào `~/.claude` thật. Nhưng `Skill` tool built-in của SDK quét `$CLAUDE_CONFIG_DIR/skills` — thư mục đó **không tồn tại**. AWOG vẫn bơm catalogue `<available_skills>` vào system prompt, nên model thấy tên skill, gọi `Skill`, và luôn nhận `Unknown skill: <name>`. Skill coi như half-wired trên cả 2 runtime (nhánh Pi không có `Skill` tool nào).

3. **Thực tế sử dụng.** User dùng Claude Code gần như 100% thời gian; `.claude` mới là nơi họ thật sự chỉnh sửa. Giữ `.awog` làm "nhà duy nhất" đang bắt nguồn-sự-thật chạy theo bản sao.

Cùng lúc, bản nâng SDK `0.3.218 → 0.3.235` mang theo một breaking change liên quan: **0.3.233 gỡ TodoWrite/TodoRead khỏi default tool surface** trên opus 4.8 / sonnet 5 / fable 5 / mythos 5 trở lên — sẽ giết session checklist ([ADR 0069](./0069-editable-session-checklist.md)) trên nhánh Claude SDK nếu không opt-in lại.

## Quyết định

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| **D-1** | Nhà của config-entity | **Tách theo loại.** 3 loại Claude Code có layout on-disk native → `.claude`: `global` `<claudeHome>/{skills,agents,commands}` + `project` `{project}/.claude/{...}`. 2 loại còn lại (**hooks, rules**) giữ nguyên `.awog`. | Chỉ những loại Claude Code thật sự đọc mới có "nhà chung" để dùng. Hook của Claude Code nằm trong mảng `settings.json` (khác format), rules không có thư mục tương đương — gộp 2 loại này là dịch format, không phải đổi đường dẫn. |
| **D-2** | `Source` union | **Không đổi** — vẫn `'global' \| 'project'` cho cả 5 loại. Chỉ đổi đường dẫn mà tier trỏ tới. | Giữ nguyên thành quả lớn nhất của ADR 0035; không tái sinh 5-tier union. Refactor gói gọn trong hàm resolve dir. |
| **D-3** | `CLAUDE_CONFIG_DIR` | **Ngừng override** trong `runtime/claude-sdk/shared.ts`. Sidecar kế thừa giá trị ambient; `claudeHome()` đọc **cùng** biến đó nên AWOG và subprocess SDK luôn resolve về một chỗ. | Nguyên nhân gốc của bug "Unknown skill". Kế thừa thay vì hardcode `~/.claude` để user set `CLAUDE_CONFIG_DIR` vẫn hoạt động. |
| **D-4** | SDK session store | Transcript/resume/compaction của SDK chuyển sang `<claudeHome>/projects/` (hệ quả tất yếu của D-3). `sdkStoreDir()` trả `claudeHome()`. | Không tách được khỏi D-3 bằng option nào rẻ (`sessionStore` là `@alpha`, phải tự implement interface). |
| **D-5** | Migration | **Boot migration tự động, MOVE + xoá thư mục cũ** (`migration/claude-home.ts`, chạy trong chuỗi migration ở `index.ts`). Gồm cả `~/.awog/claude-sdk/projects/*` → `<claudeHome>/projects/`, rồi xoá `~/.awog/claude-sdk`. | User chốt "mở app lên là migrate xong, xoá folder cũ". Move giữ resume liền mạch cho session Anthropic cũ. |
| **D-6** | Xử lý trùng tên khi migrate | **Bản `.claude` LUÔN thắng.** Bản `.awog` chỉ bị xoá khi **byte-identical**; nếu khác thì park vào `~/.awog/migrated-conflicts/<kind>/<tier>/<id>` (`<tier>` = `global` hoặc tên folder project — cùng một id thường tồn tại ở nhiều tier, khoá park theo `<kind>/<id>` khiến chỉ tier đầu tiên đáp được). | `.claude` là bản đang sống; nhưng "look before delete" — không bao giờ ghi đè/xoá một bản sửa khác nội dung. |
| **D-7** | Idempotency | **Không done-flag.** Migration xoá thư mục nguồn khi đã rút hết → lần boot sau `readdir` fail và no-op. Entry lỗi giữ nguyên thư mục để lần sau thử lại. | Done-flag có thể lệch với thực tế trên đĩa; sự vắng mặt của nguồn là trạng thái tự mô tả. |
| **D-8** | Import assistant | `.claude` **thôi** làm nguồn import cho agents/skills/commands (giờ nó là store — quét sẽ thành self-import). `.agents` của Craft vẫn là nguồn cho agents/skills. `.claude` vẫn là nguồn cho **rules** (CLAUDE.md + `.claude/rules`) và **hooks** (`settings.json`). Bỏ hẳn `collectCommands`. | Đảo D-3 của ADR 0035 đúng phần đã hết ý nghĩa, giữ phần còn giá trị. |
| **D-9** | Templates | `kindHome(kind, projectPath?)` quyết định root theo loại; install ghi vào `.claude` cho 3 loại chung, `.awog` cho hooks/rules. Guard `isInside` neo theo đúng root đó. | Giữ nguyên invariant #2 (path sanitize) khi root không còn là hằng số. |
| **D-10** | TodoWrite trên nhánh SDK | `buildSdkEnv` set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. | SDK 0.3.233 gỡ todo tool khỏi default surface trên model mới; checklist ADR 0069 dựng trên built-in đó. Filter `allowedTools`/`disallowedTools` của AWOG vẫn quyết định per-agent. |

## Phương án đã cân nhắc

- **Symlink `~/.awog/claude-sdk/skills` → `~/.claude/skills`** — bị từ chối: chỉ vá được tier global, không phủ per-project, và giấu sự thật "có 2 nhà" sau một con symlink (vi phạm Least Astonishment).
- **Giữ store cô lập, implement `SessionStore` custom để tách transcript khỏi config dir** — bị từ chối: API còn `@alpha`, phải tự viết + tự bảo trì một store implementation chỉ để giữ một isolation mà user không còn muốn.
- **Gộp cả 5 loại về `.claude`** — bị từ chối (D-1): hooks/rules không có layout tương đương, sẽ phải dịch format `settings.json` ↔ hook store và CLAUDE.md ↔ rules. Đó là quyết định riêng, không phải hệ quả của ADR này.
- **Clear `sdkSessionId` cũ cho session re-seed từ JSONL thay vì move 701 MB** — bị từ chối bởi user: chấp nhận transcript AWOG nằm chung `~/.claude/projects/` để giữ resume + checkpoint compaction liền mạch.
- **Giữ nguyên ADR 0035, chỉ sửa bug skill** — bị từ chối: không giải quyết duplicate, user vẫn phải import lại mỗi lần sửa skill ngoài app.

## Hệ quả

- **Tích cực:**
  - Một nguồn sự thật cho skills/agents/commands. Sửa ở Claude Code hay ở AWOG đều live ngay bên kia, không còn import lại.
  - `Skill` tool trên nhánh Claude SDK resolve đúng tập skill mà AWOG quảng cáo — sửa bug half-wired.
  - Subagent (`~/.claude/agents`), slash command, plugin, `settings.json`, `CLAUDE.md` của user giờ áp dụng cho session AWOG chạy nhánh Anthropic.
  - Bỏ được ~1 tier duplicate khỏi mental model; watcher bớt 1 lớp.
- **Tiêu cực / Trade-off:**
  - **Transcript AWOG nằm lẫn trong `~/.claude/projects/`** → sẽ hiện trong `claude --resume` của CLI thật. `removeSdkSession` giờ xoá file trong thư mục đó — an toàn vì chỉ khớp `sdkSessionId` do AWOG tạo và persist, nhưng phạm vi tác động đã rộng hơn.
  - **`~/.claude/settings.json` của user giờ áp dụng cho session AWOG**: hook `UserPromptSubmit`, statusline, `effortLevel`, plugins… Hook của chính user, chạy trên máy của user — nhưng là surface mới, cần **infosec review** trước release.
  - **`~/.claude/CLAUDE.md` global được load lại** — đảo một phần D-4 của ADR 0035 (và của [ADR 0033](./0033-rules-system-prompt-injection.md)) trên riêng nhánh Claude SDK. Nhánh Pi không đổi.
  - Xoá thư mục là thao tác một chiều. Giảm thiểu bằng D-6 (park bản lệch) + dry-run sandbox đã verify.
- **Việc cần làm tiếp:** infosec review (settings.json/hook surface + xoá thư mục + path sanitize); cập nhật [config-import-assistant](../features/config-import-assistant.md); QA regression cho session Anthropic cũ (resume sau khi transcript đã move) và cho Templates install.

## Tham chiếu

- Supersede (phần nhà của agents/skills/commands): [0035](./0035-consolidate-config-tiers-to-awog.md) D-1/D-3; ảnh hưởng [0013](./0013-adopt-skill-md-format.md), [0015](./0015-agents-persisted-runtime-systemprompt.md), [0034](./0034-slash-commands-markdown.md), [0036](./0036-project-templates.md)
- Amend: [0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (session store + CLAUDE_CONFIG_DIR), [0033](./0033-rules-system-prompt-injection.md) (CLAUDE.md trên nhánh SDK)
- Liên quan: [0069](./0069-editable-session-checklist.md) (TodoWrite built-in), [0032](./0032-hook-execution-engine-ipc-contract.md) (hooks ở lại `.awog`)
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md)
