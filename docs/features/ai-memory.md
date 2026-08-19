# Feature: AI Memory (Bộ nhớ AI)

**Trạng thái:** v1 implemented (2026-08-19) — contract: [ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) phần B

## Đã ship / chưa ship

| | Trạng thái |
|---|---|
| Store 2 tier (`~/.awog/memory`, `{project}/.awog/memory`) + 5 RPC `memory.*` + watcher `memory.fs-changed` | ✅ |
| Nạp `<memory>` mỗi turn (Sessions + Tasks), nhóm theo `type`, ngân sách 4k — vượt thì bỏ phần đuôi và **nói rõ bỏ mấy cái** | ✅ |
| Tool `memory_remember` / `memory_forget` / `memory_read` trên **cả** Pi và Claude SDK | ✅ |
| Agent tự ghi = **opt-in, mặc định TẮT**; cờ đi qua IPC theo từng turn (`contextConfig.memoryAutoWrite`) | ✅ |
| Settings → Bộ nhớ: 3 công tắc + bộ đếm ngân sách + danh sách nhóm theo loại + sửa/xoá/toggle + "Xóa hết bộ nhớ" | ✅ |
| Tasks: **đọc** memory nhưng KHÔNG ghi (unattended, không ai sửa được fact sai) | ✅ theo thiết kế |
| Nhãn transcript `Remember` / `Forget` / `Memory` cho cả 2 dạng tên tool | ✅ |
| Approval gate trước khi persist từng fact | ❌ để ngỏ (xem Open Questions) |
| Memory tier project trong UI (tạo fact scope project từ Settings) | ⚠️ store + RPC hỗ trợ, UI mới tạo được fact global |

## Overview

**Memory** là các mẩu tri thức ngắn agent tích luỹ và người dùng quản lý được: sở thích, quy ước đã sửa lưng, ràng buộc project, con trỏ tới tài nguyên ngoài. Một fact = một file `.md`. Prompt mỗi turn nhận **mục lục một-dòng-một-fact** (đủ để agent biết), body chi tiết đọc theo yêu cầu. Agent tự ghi được (`memory_remember`/`memory_forget`) nhưng **mặc định TẮT** — người dùng bật ở Settings.

Khác [rules](./rules.md): rule là **chính sách người dùng viết, luôn áp**. Memory là **fact tích luỹ theo thời gian**, có thể do agent ghi, và người dùng sửa/xoá được từng cái.
Khác [wiki](./wiki.md): wiki là **trang tài liệu để tra**; memory là **fact ngắn cần biết trước**.

## User Stories

- Là người dùng, tôi nói một lần "chat trả lời tiếng Việt, code tiếng Anh" và không phải nhắc lại ở session sau.
- Là người dùng, tôi muốn xem **toàn bộ** những gì AI đang nhớ về tôi, sửa câu nào sai, xoá câu nào lỗi thời.
- Là người dùng, tôi muốn fact riêng của một project (ví dụ "push cần account boykioyb") đi theo project đó, không rò sang project khác.
- Là người dùng, tôi muốn tắt hẳn việc agent tự ghi nhớ nếu tôi thấy nó ghi bừa.
- Là người dùng, tôi muốn biết memory đang ăn bao nhiêu context (usage panel).

## Functional Behavior

- **2 tier:** `global` = `~/.awog/memory/<slug>.md` (áp mọi nơi), `project` = `{project}/.awog/memory/<slug>.md` (chỉ session/task của project).
- **Inject mỗi turn:** một dòng cho mỗi memory **enabled** trong scope — `- <name>: <description>` — bọc trong `<memory>`, cap 4.000 ký tự (vượt thì cắt + ghi rõ). `description` **chính là fact ở dạng một dòng**, nên index-only vẫn giao được nội dung; body chỉ là chi tiết mở rộng.
- **Đọc chi tiết:** `memory_read({ name })` — chỉ được thêm khi có memory nào có body dài hơn description.
- **Agent ghi (opt-in, mặc định TẮT):**
  - `memory_remember({ name, description, body?, type, scope })` — upsert. Slug hoá `name` qua `sanitizeChild`; ghi đè memory cùng slug (idempotent).
  - `memory_forget({ name, scope? })` — xoá.
  - Ghi **chỉ** vào `~/.awog/memory` hoặc `{project}/.awog/memory`; model không truyền được path.
  - Cờ bật đi theo **từng turn qua IPC** (`memory.autoWrite` trong `sessions.sendMessage` / `tasks.create`), nguồn là Settings — không phải chỉ localStorage ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-11).
  - Mỗi lần agent ghi → một step trong transcript (`memory_remember: git-push-auth`) để người dùng thấy ngay, và một toast tuỳ setting.
- **Người dùng quản lý:** thêm/sửa/xoá/toggle từng memory, đổi scope, xoá tất cả (có confirm). Sửa của người dùng **không bị agent ghi đè** trừ khi agent gọi `memory_remember` đúng slug đó — mỗi lần ghi đều hiện trong transcript nên có audit.
- **`type`** dùng để nhóm trong UI và sắp thứ tự inject: `user` (người dùng là ai) → `feedback` (đã sửa lưng) → `project` (ràng buộc việc đang làm) → `reference` (link ngoài).
- **Live:** `memory.fs-changed` → UI re-hydrate + invalidate cache inject.
- **Không phải chỉ thị:** block `<memory>` có câu framing; memory do model ghi là L1 không tin (một memory bị "đầu độc" qua tài liệu độc là surface prompt-injection — [ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-9).

## Data Model

```
~/.awog/memory/git-push-auth.md
{project}/.awog/memory/deploy-window.md
```

```markdown
---
name: git-push-auth
description: Push cần account boykioyb; gh=sora-hoa bị 403
type: reference
enabled: true
---
`git credential fill` để kiểm tra account đang dùng. Chi tiết xem docs/…
```

**Không có `MEMORY.md` index trên đĩa** — index inject derive từ frontmatter ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-10).

**RPC:** `memory.list`, `memory.upsert`, `memory.delete`, `memory.toggle`, `memory.clear`.

**Type:**

```ts
export type MemorySource = 'global' | 'project'
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryFact {
  id: string            // slug = tên file, không đuôi
  source: MemorySource
  projectId?: string
  name: string
  description: string   // fact một dòng — cái được inject
  body: string          // chi tiết, đọc qua memory_read
  type: MemoryType
  enabled: boolean
  updatedAt: number     // mtime — để sort "mới nhất"
}
```

`ContextChars` thêm `memory` + `memoryList` để usage panel báo đúng.

## UI/UX Notes

**Settings → Bộ nhớ AI** (section `memory`):

- **Đầu pane:** toggle `Cho phép agent tự ghi nhớ` (mặc định TẮT) + hint một câu về rủi ro; nút `Xoá tất cả` (destructive, confirm).
- **Danh sách** nhóm theo `type`, mỗi dòng: `name` + `description` (truncate 1 dòng) + badge tier + toggle + icon-only Sửa/Xoá; sort trong nhóm theo `updatedAt` giảm dần.
- **Editor** (inline trong pane): name, description (bắt buộc — đây là thứ được inject), body (textarea `resize-y`), type (AppSelect). *Scope picker chưa có: UI v1 tạo fact ở tier global; fact tier project do agent ghi (`scope: 'project'`) hoặc sửa file trực tiếp.*
- **Bộ đếm ngân sách:** `12 fact · ~1.2k ký tự` để người dùng thấy giá mỗi lượt.
- Text qua i18n `en`/`vi` (`settings.memory.*`).

## Dependencies

- [ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) — contract.
- [wiki](./wiki.md) — dùng chung lớp inject mục lục + gating tool.
- [rules](./rules.md), [ADR 0071](../decisions/0071-senior-engineer-prompt-core.md) — hai lớp ngữ cảnh đang có (rule người dùng viết; CLAUDE.md/AGENTS.md), memory là lớp thứ ba.
- [hooks](./hooks.md) — `memory_remember`/`memory_forget` đi qua anchor `tool.*` như mọi tool.

## Out of Scope (v1)

- **Relevance / recall theo ngữ cảnh** (chỉ surface memory liên quan tới turn) — v1 inject toàn bộ index enabled.
- **Auto-dedupe / merge** memory trùng ý — agent được dặn kiểm tra trước khi ghi, không có máy dò trùng.
- **Approval gate trước khi ghi** (park chờ người dùng duyệt từng fact) — cân nhắc nếu thực tế agent ghi bừa.
- **Memory chia sẻ giữa nhiều máy** — tier project + git.
- **Memory theo từng agent** — chung cho agent chính.
- **Nhớ từ ảnh/attachment** — chỉ text.

## Open Questions

- Có cần **approval trước khi persist** (như [AskUserQuestion park](./ask-user-question.md)) thay vì ghi thẳng rồi cho sửa sau?
- Khi memory index vượt cap, ưu tiên giữ theo `type` hay theo `updatedAt`?
- Memory tier project nên **commit vào repo** (chia sẻ cả team) hay `.gitignore` mặc định (riêng tư)?
- Có nên tự đề nghị "lưu vào memory?" khi người dùng sửa lưng agent (phát hiện qua pattern) không?
