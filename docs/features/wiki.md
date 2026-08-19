# Feature: Wiki

**Trạng thái:** v1 implemented (P0–P2, 2026-08-19) — contract: [ADR 0073](../decisions/0073-wiki-as-llm-context-source.md)

## Đã ship / chưa ship

| | Trạng thái |
|---|---|
| Store 2 tier + 9 RPC `wiki.*` + watcher `wiki.fs-changed` | ✅ |
| Nạp `<wiki_index>` mỗi turn (Sessions + Tasks) + `ContextChars.wiki` | ✅ |
| Tool `wiki_search`/`wiki_read` trên **cả** Pi và Claude SDK | ✅ |
| Trang `/wiki`: cây space→trang, reader (mermaid/KaTeX/shiki), outline, backlinks, search, `[[wikilink]]` + tạo trang từ link chết | ✅ |
| Import `.md` (dialog nhiều file / cả thư mục / kéo-thả), copy-in, báo cáo bỏ qua | ✅ |
| Toggle `Cho agent đọc` từng trang (`context: false`) | ✅ |
| Editor: **Monaco** (markdown) + ⌘S | ✅ |
| Settings → Wiki (công tắc nạp LLM + ngân sách ký tự, đi qua IPC theo từng turn) | ✅ |
| Context menu chuột phải trên cây (mở / đổi tên / ẩn-hiện với agent / copy path / xoá) | ✅ |
| Sidebar resize được (200–480px, nhớ trong localStorage) | ✅ |

## Overview

**Wiki** là trang tài liệu nội bộ của AWOG: người dùng import/soạn các trang Markdown (architecture, pattern, docs, quy ước, domain glossary), duyệt theo cây, liên kết chéo bằng `[[slug]]`, search toàn văn. Cùng lúc, wiki là **nguồn context của LLM**: mỗi turn prompt nhận một **mục lục gọn** (space → trang → mô tả một dòng), model tự gọi `wiki_search`/`wiki_read` khi cần nội dung — nên kho tài liệu lớn tới đâu cũng không đốt token mỗi lượt.

Wiki khác [rules](./rules.md): rule là **chỉ thị luôn được inject**, wiki là **tài liệu để tra**. Khác [skills](./skill-builder.md): skill là *cách làm một việc*, wiki là *tri thức về hệ thống*.

## User Stories

- Là người dùng, tôi import 20 file `.md` tài liệu architecture một lần, rồi mọi agent ở mọi session hiểu boundary hệ thống mà tôi không phải dán lại.
- Là người dùng, tôi mở `/wiki` để **tự đọc** tài liệu ngay trong app (render mermaid, code highlight), không phải mở editor ngoài.
- Là người dùng, tôi muốn liên kết trang này sang trang khác bằng `[[data-flow]]` và thấy trang nào đang trỏ tới trang hiện tại.
- Là người dùng, tôi muốn wiki riêng cho một project (commit vào repo, đi theo team) và wiki chung cho mọi project.
- Là người dùng, tôi muốn một số trang là ghi chú riêng của tôi — **không** cho LLM đọc.
- Là người dùng, tôi muốn biết wiki đang ăn bao nhiêu context và agent thực sự đã đọc trang nào.

## Functional Behavior

### Cấu trúc

- **2 tier:** `global` = `~/.awog/wiki/`, `project` = `{project}/.awog/wiki/`. Cả hai cùng hiện trong cây, phân biệt bằng badge tier.
- **Space** = folder cấp 1 (`architecture/`, `patterns/`, `docs/`). Metadata space đặt trong `_index.md` (tuỳ chọn): `title`, `description`.
- **Trang** = file `.md`, cây con tuỳ ý (cap 5 cấp). Slug = đường dẫn tương đối không đuôi (`architecture/system-overview`).
- **Liên kết wiki:** `[[slug]]` và `[[slug|nhãn]]`. Resolve trong space hiện tại trước, rồi toàn wiki cùng scope, rồi tier còn lại. Link chết render dashed + click để tạo trang. **Backlinks** derive bằng scan (không persist index).
- **TOC** derive từ heading của trang.

### Nạp cho LLM

- Mỗi turn inject `<wiki_index>`: space (title + description + số trang) → trang (title + description một dòng). Trang có `context: false` **không** xuất hiện và **không** search được từ LLM.
- Ngân sách **4.000 ký tự** (chỉnh được ở Settings). Vượt ngân sách thì **giảm cấp**: chỉ còn dòng space + số trang + câu "dùng `wiki_search` để tra" — không im lặng cắt.
- **Tool** (chỉ có khi wiki có ≥1 trang `context: true`) — **cùng handler, wire cả 2 runtime** ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-7):
  - `wiki_search({ query, space? })` → `space/đường-dẫn.md:line` + snippet, cap số hit.
  - `wiki_read({ path, offset?, limit? })` → nội dung trang, cap output, resolve được cả `[[slug]]`.
  - Trên nhánh Claude SDK tên là `mcp__awogwiki__wiki_search` / `mcp__awogwiki__wiki_read` (tiền lệ `ssh_*`); mọi matcher nhận cả hai dạng.
- Nội dung wiki là **data, không phải chỉ thị** — block inject và output tool đều có câu framing ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-9).
- Trang agent đã đọc trong turn hiện lên transcript như step (`wiki_read: architecture/system-overview`) để người dùng thấy agent thực sự tra gì.

### Import & soạn

- **Import `.md`** (`.md`/`.mdx`/`.markdown`/`.txt`):
  - từ máy: OS dialog (`bridge.pickFile`/`pickFolder`) hoặc **kéo-thả** vào cây (`getPathForFile`) → copy vào wiki, **giữ nguyên cây thư mục**.
  - từ project đang mở: chọn theo cây file (`docs/**/*.md`), đi đường `fs.*` sẵn có.
  - Cap 1 MB/trang, 2.000 trang/wiki. Trùng tên → hỏi ghi đè / đổi tên. File sai đuôi → bỏ qua, báo trong toast kết quả (`đã nhập 18/21 file`).
  - Frontmatter thiếu `title` → suy từ heading `#` đầu tiên, không có thì lấy tên file.
- **Soạn/sửa** trong `WikiEditor.vue`: các field frontmatter (title / description / tags / `Cho agent đọc`) + body Markdown trong [`MonacoEditor`](../../apps/desktop/ui-next/components/common/MonacoEditor.vue) full-pane, ⌘S lưu. Model key có tiền tố `wiki:` để một trang wiki và một file workspace trùng tên không dùng chung undo stack. Lưu atomic (tmp + rename + chmod 600) như các store khác.
- **Tạo** trang: nút `Trang mới` (nhập đường dẫn) hoặc click một `[[link]]` chết → hỏi tạo. **Xoá / đổi tên / ẩn-hiện với agent / copy path**: context menu chuột phải trên cây, hoặc header reader. Đổi tên **cảnh báo trước** số backlink sẽ chết (v1 không tự sửa `[[slug]]`).
- **Live:** `wiki.fs-changed` → cây re-hydrate. Cache mục lục invalidate ở **cả** hai chỗ: mọi RPC mutation *và* watcher — một wiki bị sửa ngoài app (editor riêng, `git pull`) là chuyện bình thường, khác các kind config phẳng.

## Data Model

```
~/.awog/wiki/
├── architecture/
│   ├── _index.md              # metadata space (tuỳ chọn)
│   ├── system-overview.md
│   ├── data-flow.md
│   └── adr/
│       └── why-sidecar.md
└── patterns/
    └── page-controller.md
```

Trang — YAML frontmatter + body:

```markdown
---
title: System overview
description: 3 process, ai gọi ai, vì sao stdio JSON-RPC
tags: [architecture, ipc]
context: true
---
# System overview

UI (Nuxt) ↔ Electron main ↔ sidecar. Chi tiết đường đi một turn: [[data-flow]].
```

`source`/`projectId` suy ra từ vị trí file, **không** ghi vào file ([ADR 0033](../decisions/0033-rules-system-prompt-injection.md) — wiki commit vào repo không hardcode project id của máy).

**Type** (`types/shared.ts` + `ui-next/types/index.ts`):

```ts
export type WikiSource = 'global' | 'project'

export interface WikiPage {
  path: string          // slug tương đối, không đuôi: 'architecture/system-overview'
  source: WikiSource
  projectId?: string
  title: string
  description: string
  tags: string[]
  context: boolean      // false = ẩn khỏi LLM (ghi chú riêng của người dùng)
  bytes: number
  updatedAt: number
}

export interface WikiSpace {
  id: string            // folder cấp 1
  source: WikiSource
  projectId?: string
  title: string
  description: string
  pageCount: number
}
```

**RPC:** `wiki.tree`, `wiki.readPage`, `wiki.savePage`, `wiki.createPage`, `wiki.deletePage`, `wiki.movePage`, `wiki.import`, `wiki.search`, `wiki.backlinks`, `wiki.spaceUpsert`.

`ContextChars` thêm `wiki` + `wikiList` để usage panel báo đúng.

## UI/UX Notes

Trang riêng **`/wiki`** trong NavRail (nhóm Library, cạnh `rules`/`templates`) — không nhét vào Settings ([ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) D-1). Icon: thêm `i-book` vào [`IconSprite.vue`](../../apps/desktop/ui-next/components/IconSprite.vue) (sprite hiện chưa có icon sách).

- **Layout 3 vùng** (mirror [git-manager](./git-manager.md)): sidebar cây resizable/collapsible | reader | rail phải (TOC + backlinks, collapse được).
- **Sidebar** ([`WikiSidebar.vue`](../../apps/desktop/ui-next/components/wiki/WikiSidebar.vue)): cây space → trang (component riêng, KHÔNG dùng `EditorFileTree` — cái đó neo vào workspace file thật, wiki thì neo vào slug); badge tier `project`; icon `eye-off` cho trang `context: false`; footer hiện ngân sách mục lục.
- **Toolbar:** search (toàn văn, highlight hit), `Trang mới`, `Nhập .md`, scope filter global/project.
- **Reader** ([`WikiReader.vue`](../../apps/desktop/ui-next/components/wiki/WikiReader.vue)): render qua [`useMarkdown`](../../apps/desktop/ui-next/composables/useMarkdown.ts) — có sẵn mermaid ([`MermaidView`](../../apps/desktop/ui-next/components/common/MermaidView.vue)), KaTeX, shiki; breadcrumb `space / folder / trang`; nút icon-only Sửa / Xoá / Copy path theo [UI pattern](../../.claude/rules/nuxt-vue.md#ui-patterns); toggle `Cho LLM đọc` ngay trên header trang.
- **Vùng kéo-thả** `.md` phủ cả sidebar và reader: viền dashed + accent khi hover-drag.
- **Empty state:** 2 CTA `Nhập file .md` + `Tạo trang đầu tiên`, kèm một dòng giải thích wiki dùng để làm gì.
- **Ngân sách:** dòng hint dưới toolbar — `42 trang · mục lục ~1.8k ký tự (~450 token)`; đỏ khi vượt cap.
- **Settings → Wiki**: công tắc bật/tắt nạp vào LLM + ngân sách ký tự + bộ đếm chi phí hiện tại + nút mở trang wiki. Hai giá trị này đi **qua IPC theo từng turn** (`contextConfig` trong `sessions.sendMessage`) vì sidecar coi `settings.json` là blob mờ ([ADR 0045](../decisions/0045-settings-json-file-persistence.md)) — đúng đường mà `responseStyle` / `sshApprovalMode` đã đi. Điều khiển theo từng trang vẫn là `context: false` trong frontmatter.
- Text qua i18n `en`/`vi` (`wiki.*`, `settings.wiki.*`); màu qua `useTheme()`; body `text-[1em]`, badge `text-[12px]`.

## Dependencies

- [ADR 0073](../decisions/0073-wiki-as-llm-context-source.md) — contract storage + inject + tool.
- [markdown-editor](./markdown-editor.md), [project-workspace](./project-workspace.md) — Monaco + cây file tái dùng.
- [rules](./rules.md) — cùng lớp 2-tier + frontmatter parser, khác chiến lược inject.
- [ai-memory](./ai-memory.md) — anh em cùng ADR, dùng chung lớp inject mục lục + gating tool.
- [settings](./settings.md) — nơi đặt công tắc global.

## Out of Scope (v1)

- **Vector search / embedding** — `wiki_search` là grep; truy vấn ngữ nghĩa sẽ trượt.
- **Agent ghi wiki** (`wiki_write`) — v1 model chỉ đọc; cân nhắc opt-in ở P5.
- **Version history / diff trong app** — tier project dựa vào git; tier global chưa có.
- **Đổi tên trang tự sửa `[[slug]]`** — `wiki.movePage` có sẵn nhưng UI v1 chưa gọi (P3, cùng context menu).
- **Import PDF/docx/HTML** — chỉ Markdown/text.
- **Đa người dùng / comment / review** — local-first, một người.
- **`@wiki:<slug>` trong composer** để ghim trang vào turn — P5.
- **Whitelist wiki theo agent** — nạp cho agent chính; `agent.skillIds` đã bị gỡ vì đúng hướng này.

## Open Questions

- Trang wiki nên **copy** vào `.awog/wiki` hay cho phép **trỏ tới file trong repo** (`docs/architecture/*.md`)? Trỏ thì luôn tươi và không trôi lệch với `docs/` của repo, nhưng thêm một chế độ + một đường đọc lúc chạy.
- `wiki_search` nên dùng `git grep` (như [`fs-tools.ts`](../../apps/desktop/sidecar/src/runtime/tools/fs-tools.ts), ReDoS-safe nhưng cần repo) hay `ripgrep`/scan tay cho thư mục không phải repo?
- Mục lục nên **luôn đầy đủ** (mọi trang) hay chỉ **space + trang cấp 1**, để trang sâu chỉ tìm thấy qua `wiki_search`?
- Wiki tier project nên commit vào repo (chia sẻ cả team) hay `.gitignore` mặc định?
- Có cần một trang chủ wiki (`index.md`) người dùng tự soạn làm cửa vào, hay cây là đủ?
