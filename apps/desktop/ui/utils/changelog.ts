// Changelog — static, bundled release notes powering the "What's New" panel.
// Local-first: AWOG ships its changelog with the build, never fetches it (no
// SSRF surface, works fully offline). Each item is bilingual (en/vi) so the
// content matches the active UI locale like the rest of the i18n'd interface.
//
// Maintaining this file:
//   • Add the newest release at the TOP of `CHANGELOG` (the array is ordered
//     newest → oldest). `CURRENT_VERSION` derives from the first entry and
//     drives the NavRail "unseen" dot (see `useWhatsNew`).
//   • Keep `version` in sync with `package.json` when you cut a real release.
//   • `kind` groups the change for the colored badge in the modal.

export type ChangeKind = 'added' | 'improved' | 'changed' | 'fixed'

export type LocalizedText = {
  en: string
  vi: string
}

export type ChangeItem = LocalizedText & {
  kind: ChangeKind
}

export type Release = {
  version: string // semver without the leading "v"
  date: string // ISO date `YYYY-MM-DD`
  highlight?: LocalizedText // optional one-line summary shown under the version
  items: ChangeItem[]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.14.0',
    date: '2026-06-16',
    highlight: {
      en: 'Steer a running response or queue messages, plus Git branch operations — merge, rebase, and open pull requests.',
      vi: 'Chèn vào phản hồi đang chạy hoặc xếp hàng tin nhắn, cùng thao tác nhánh Git — merge, rebase và mở pull request.',
    },
    items: [
      {
        kind: 'improved',
        en: 'Edit step details now show the change as a git-style diff (split or unified), with a toggle to view the full file content — the same viewer used for reads/writes.',
        vi: 'Chi tiết bước Edit giờ hiện thay đổi dưới dạng diff kiểu git (split hoặc unified), kèm nút chuyển sang xem toàn bộ nội dung file — cùng trình xem dùng cho đọc/ghi.',
      },
      {
        kind: 'added',
        en: 'Browser tool: the agent can drive an embedded Chromium browser — open a URL, click, fill forms, extract text, and take screenshots. Private/loopback addresses are blocked. Toggle the window from the tray.',
        vi: 'Công cụ trình duyệt: agent điều khiển được một Chromium nhúng — mở URL, click, điền form, trích text và chụp màn hình. Địa chỉ nội bộ/loopback bị chặn. Bật/tắt cửa sổ từ khay hệ thống.',
      },
      {
        kind: 'added',
        en: 'More built-in tools: MultiEdit (several edits to one file in one step) and Jupyter notebook read/edit.',
        vi: 'Thêm công cụ built-in: MultiEdit (sửa nhiều chỗ trong một file ở một bước) và đọc/sửa notebook Jupyter.',
      },
      {
        kind: 'added',
        en: 'Steer a running response: while the agent is working, type a message and Insert it into the current turn — the agent picks it up at its next step.',
        vi: 'Chèn vào phản hồi đang chạy: trong khi agent làm việc, gõ một tin nhắn và Chèn vào lượt hiện tại — agent tiếp nhận ở bước kế tiếp.',
      },
      {
        kind: 'added',
        en: 'Queue messages: send a message to a queue while a turn is streaming and it auto-sends as a new turn once the current one finishes. The queue shows above the input.',
        vi: 'Xếp hàng tin nhắn: đẩy tin nhắn vào hàng đợi khi một lượt đang chạy, nó tự gửi thành lượt mới khi lượt hiện tại kết thúc. Hàng đợi hiện ngay trên ô nhập.',
      },
      {
        kind: 'added',
        en: 'Git: merge and rebase branches (with continue/abort), and open a GitHub pull request straight from AWOG.',
        vi: 'Git: merge và rebase nhánh (kèm continue/abort), và mở pull request GitHub ngay trong AWOG.',
      },
      {
        kind: 'improved',
        en: 'Git: a richer branch right-click menu for branch, remote, and history actions.',
        vi: 'Git: menu chuột phải trên nhánh phong phú hơn cho các thao tác nhánh, remote và lịch sử.',
      },
      {
        kind: 'improved',
        en: 'When the agent is waiting on your answer or a permission, the session shows a “waiting” state instead of a ticking timer, notifies you if the window isn’t focused, and excludes the wait from the turn’s elapsed time.',
        vi: 'Khi agent chờ bạn trả lời hoặc cấp quyền, session hiện trạng thái “đang chờ” thay vì đồng hồ chạy, báo cho bạn nếu cửa sổ không focus, và không tính thời gian chờ vào thời lượng của lượt.',
      },
      {
        kind: 'fixed',
        en: 'Session list keeps project groups in a stable order — only the sessions inside each project are sorted by recency.',
        vi: 'Danh sách session giữ thứ tự nhóm project cố định — chỉ các session bên trong mỗi project mới sắp theo thời gian gần nhất.',
      },
      {
        kind: 'improved',
        en: 'Session replies group the agent’s tool steps into collapsible runs with a one-line summary (“ran 3 commands · read 2 files”), so a long turn reads as a clean document you can expand.',
        vi: 'Phản hồi trong session gom các bước công cụ của agent thành cụm thu gọn được, kèm tóm tắt một dòng (“chạy 3 lệnh · đọc 2 file”), nên một lượt dài đọc gọn như tài liệu và mở ra khi cần.',
      },
      {
        kind: 'fixed',
        en: 'Stop now reliably ends a running session even when an earlier turn got stuck — it cancels every in-flight turn for that session instead of only the latest message.',
        vi: 'Nút Stop giờ kết thúc đáng tin cậy một session đang chạy ngay cả khi một lượt trước đó bị treo — nó hủy mọi lượt đang chạy của session thay vì chỉ tin nhắn mới nhất.',
      },
      {
        kind: 'fixed',
        en: 'Hook run history, enable, and rename now target the right hook when two projects share an imported hook id.',
        vi: 'Lịch sử chạy, bật/tắt và đổi tên hook giờ nhắm đúng hook khi hai project trùng id hook nhập vào.',
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-06-15',
    highlight: {
      en: 'Rewind conversations, search and branch sessions, an in-session Git panel, and file attachments.',
      vi: 'Tua lại hội thoại, tìm kiếm & rẽ nhánh session, bảng Git ngay trong session, và đính kèm file.',
    },
    items: [
      {
        kind: 'added',
        en: 'Rewind a conversation to an earlier message — your files are restored to that point too.',
        vi: 'Tua hội thoại về một tin nhắn trước đó — file cũng được khôi phục về đúng thời điểm đó.',
      },
      {
        kind: 'added',
        en: 'Search across all your sessions from a quick palette.',
        vi: 'Tìm kiếm xuyên suốt mọi session bằng bảng lệnh nhanh.',
      },
      {
        kind: 'added',
        en: 'Branch a session to explore a different direction without losing the original.',
        vi: 'Rẽ nhánh một session để thử hướng khác mà không mất bản gốc.',
      },
      {
        kind: 'added',
        en: 'Stage, commit, and push straight from a Git panel inside the session.',
        vi: 'Stage, commit và push ngay từ bảng Git trong session.',
      },
      {
        kind: 'added',
        en: 'Attach files to a message, and paste large text as a file to keep the input clean.',
        vi: 'Đính kèm file vào tin nhắn, và dán văn bản dài thành file để giữ ô nhập gọn.',
      },
      {
        kind: 'improved',
        en: 'Sessions get an auto-generated title, and you can retry a message with different settings.',
        vi: 'Session tự sinh tiêu đề, và bạn có thể thử lại một tin nhắn với cấu hình khác.',
      },
      {
        kind: 'improved',
        en: 'MCP connections recover more gracefully when a server fails to load.',
        vi: 'Kết nối MCP phục hồi mượt hơn khi một server tải lỗi.',
      },
      {
        kind: 'changed',
        en: 'Removed the experimental token-proxy (RTK).',
        vi: 'Gỡ bộ token-proxy thử nghiệm (RTK).',
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-06-15',
    highlight: {
      en: 'Settings in a modal, per-project session defaults, and image attachments in chat.',
      vi: 'Settings trong modal, mặc định session theo từng project, và đính kèm ảnh vào hội thoại.',
    },
    items: [
      {
        kind: 'added',
        en: 'Attach images to a chat message and the model can see them — they stay in context across the rest of the conversation.',
        vi: 'Đính kèm ảnh vào tin nhắn và model nhìn thấy được — ảnh sống trong ngữ cảnh suốt phần còn lại của hội thoại.',
      },
      {
        kind: 'added',
        en: 'Each project can set its own default LLM provider, model, and account for new sessions.',
        vi: 'Mỗi project đặt được provider, model và account LLM mặc định riêng cho session mới.',
      },
      {
        kind: 'added',
        en: 'Choose whether Enter or Cmd/Ctrl+Enter sends a message in the composer.',
        vi: 'Chọn phím gửi tin nhắn là Enter hay Cmd/Ctrl+Enter trong khung soạn.',
      },
      {
        kind: 'changed',
        en: 'Settings now open in a modal overlay instead of a separate page, so you keep your place in the app.',
        vi: 'Settings giờ mở trong modal nổi thay vì trang riêng, nên bạn giữ nguyên chỗ đang làm trong app.',
      },
      {
        kind: 'improved',
        en: 'When creating an agent, skill, command, rule, or hook, pick where to save it — globally or in a project’s .awog folder.',
        vi: 'Khi tạo agent, skill, command, rule hay hook, chọn nơi lưu — toàn cục hay trong thư mục .awog của project.',
      },
      {
        kind: 'improved',
        en: 'Project templates can now be fetched directly from a GitHub folder.',
        vi: 'Project template giờ tải được trực tiếp từ một thư mục GitHub.',
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-06-12',
    highlight: {
      en: 'Project templates and a config import assistant — scaffold projects and bring your Claude Code config in.',
      vi: 'Project template và trợ lý nhập cấu hình — tạo project từ mẫu và mang cấu hình Claude Code vào.',
    },
    items: [
      {
        kind: 'added',
        en: 'Project templates: scaffold a new project from a reusable bundle of agents, skills, commands, rules, and hooks.',
        vi: 'Project template: tạo project mới từ một bộ mẫu tái dùng gồm agent, skill, command, rule và hook.',
      },
      {
        kind: 'added',
        en: 'Config import assistant: bring your existing Claude Code configuration into AWOG, with the config tiers consolidated under a single .awog folder.',
        vi: 'Trợ lý nhập cấu hình: mang cấu hình Claude Code sẵn có vào AWOG, gom các tầng cấu hình về một thư mục .awog duy nhất.',
      },
      {
        kind: 'added',
        en: 'Preview workspace files in fullscreen, with web pages rendered in an embedded frame.',
        vi: 'Xem trước file workspace ở chế độ toàn màn hình, trang web hiển thị trong khung nhúng.',
      },
      {
        kind: 'improved',
        en: 'Sessions show a redesigned, Claude-Code-style step timeline that’s easier to follow.',
        vi: 'Session hiển thị step timeline thiết kế lại theo kiểu Claude Code, dễ theo dõi hơn.',
      },
      {
        kind: 'fixed',
        en: 'Restored the “Always allow” button on permission prompts.',
        vi: 'Khôi phục nút “Always allow” trên hộp xin quyền.',
      },
      {
        kind: 'fixed',
        en: 'Mermaid diagram labels are now readable in dark mode.',
        vi: 'Nhãn sơ đồ Mermaid giờ đọc được trong chế độ tối.',
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-06-11',
    highlight: {
      en: 'Slash commands, workspace Rules, and real lifecycle Hooks — all importable from your Claude Code config, with AI-assisted authoring.',
      vi: 'Slash command, Rules cho workspace, và Hooks vòng đời thật — đều nhập được từ cấu hình Claude Code, kèm soạn thảo có AI hỗ trợ.',
    },
    items: [
      {
        kind: 'added',
        en: 'Slash commands: save reusable prompt templates and run them by typing "/name" in the composer — "$ARGUMENTS" / "$1" are filled from what you type. Your Claude Code ".claude/commands" are imported too.',
        vi: 'Slash command: lưu prompt template tái dùng và chạy bằng cách gõ "/tên" trong khung soạn — "$ARGUMENTS" / "$1" được điền từ phần bạn gõ. Tự nhập luôn ".claude/commands" của Claude Code.',
      },
      {
        kind: 'added',
        en: 'Rules: workspace instruction files (the AWOG analog of CLAUDE.md) are auto-injected into the agent system prompt for every session and task — and your CLAUDE.md / .claude/rules are imported and prioritised.',
        vi: 'Rules: file hướng dẫn workspace (bản AWOG của CLAUDE.md) tự được chèn vào system prompt của agent ở mọi session và task — và CLAUDE.md / .claude/rules của bạn được nhập và ưu tiên.',
      },
      {
        kind: 'added',
        en: 'Hooks: run real shell commands on lifecycle events (tool calls, file writes, task/phase completion). Your Claude Code hooks are imported (run read-only, trust-gated so a cloned repo can’t auto-run code).',
        vi: 'Hooks: chạy lệnh shell thật theo sự kiện vòng đời (tool call, ghi file, hoàn thành task/phase). Hook của Claude Code được nhập (chạy read-only, có cổng tin cậy để repo lạ không tự chạy code).',
      },
      {
        kind: 'added',
        en: 'Agents can ask you a question mid-task and wait for your choice before continuing.',
        vi: 'Agent có thể hỏi bạn một câu giữa chừng và chờ bạn chọn trước khi tiếp tục.',
      },
      {
        kind: 'improved',
        en: 'Create and edit commands, rules, and hooks with AI; all three list pages group items by project with collapsible sections.',
        vi: 'Tạo và sửa command, rule, hook bằng AI; cả ba trang danh sách đều gom theo project với mục có thể thu gọn.',
      },
      {
        kind: 'added',
        en: 'Code workspace: preview Markdown files and copy a file’s path straight from the explorer.',
        vi: 'Code workspace: xem trước file Markdown và sao chép đường dẫn file ngay từ explorer.',
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-06-10',
    highlight: {
      en: 'Quick Open & command palette in the code workspace, plus agent-to-agent task delegation.',
      vi: 'Quick Open & bảng lệnh trong code workspace, cùng khả năng agent giao việc cho agent.',
    },
    items: [
      {
        kind: 'added',
        en: 'Project code workspace: press Cmd/Ctrl+P to fuzzy-find and open any file, and Cmd/Ctrl+Shift+P (or type ">") for a command palette of actions.',
        vi: 'Code workspace của project: nhấn Cmd/Ctrl+P để fuzzy tìm và mở bất kỳ file nào, và Cmd/Ctrl+Shift+P (hoặc gõ ">") để mở bảng lệnh các hành động.',
      },
      {
        kind: 'added',
        en: 'The code workspace terminal is now multi-tab and resizable, and you can open a terminal straight from a project’s detail page — each project keeps its own terminal session when you switch projects and come back.',
        vi: 'Terminal trong code workspace giờ hỗ trợ nhiều tab và kéo chỉnh chiều cao, và có thể mở terminal ngay từ trang chi tiết của project — mỗi project giữ phiên terminal riêng khi bạn chuyển project rồi quay lại.',
      },
      {
        kind: 'improved',
        en: 'Find-in-files updates live as you type, highlights matches, groups results per file, and takes include/exclude file globs; searches in non-Git folders no longer return node_modules clutter.',
        vi: 'Tìm-trong-file cập nhật trực tiếp khi gõ, tô đậm đoạn khớp, gom kết quả theo file và nhận glob include/exclude; tìm trong thư mục không phải Git không còn trả về rác node_modules.',
      },
      {
        kind: 'added',
        en: 'Agents can delegate to other AWOG agents through a built-in Task tool — each subagent runs with its own provider, model, and account.',
        vi: 'Agent có thể giao việc cho agent AWOG khác qua công cụ Task tích hợp — mỗi subagent chạy với provider, model và account của chính nó.',
      },
      {
        kind: 'added',
        en: 'A live to-do list shows the agent’s plan and progress as it works.',
        vi: 'Danh sách to-do trực tiếp hiển thị kế hoạch và tiến độ của agent khi đang làm.',
      },
      {
        kind: 'added',
        en: 'Sessions stream the model’s extended thinking live in the step list.',
        vi: 'Session hiển thị quá trình suy luận mở rộng của model trực tiếp trong danh sách bước.',
      },
      {
        kind: 'added',
        en: 'Git: discard every change in a section or folder at once, and stage a whole folder with a single checkbox.',
        vi: 'Git: bỏ mọi thay đổi trong một mục hoặc thư mục cùng lúc, và stage cả thư mục bằng một ô tích.',
      },
      {
        kind: 'improved',
        en: 'The project code workspace is now fully localized (English / Vietnamese).',
        vi: 'Code workspace của project giờ đã được bản địa hoá đầy đủ (Anh / Việt).',
      },
      {
        kind: 'fixed',
        en: 'Settings dialogs now render above the rest of the app instead of being clipped inside the panel.',
        vi: 'Các hộp thoại Settings giờ hiển thị nổi trên phần còn lại của app thay vì bị cắt trong panel.',
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-06-10',
    highlight: {
      en: 'Claude Fable 5 — Anthropic’s most capable model, with a 1M-token option.',
      vi: 'Claude Fable 5 — model mạnh nhất của Anthropic, có tùy chọn ngữ cảnh 1M token.',
    },
    items: [
      {
        kind: 'added',
        en: 'Added Claude Fable 5 (claude-fable-5) to the model picker for Anthropic accounts — the new top tier above Opus. A separate "Fable 5 (1M context)" entry enables the 1M-token context window via the context-1m beta, mirroring the Opus 4.8 1M option.',
        vi: 'Thêm Claude Fable 5 (claude-fable-5) vào bộ chọn model cho tài khoản Anthropic — tier cao nhất mới, trên Opus. Mục riêng "Fable 5 (1M context)" bật ngữ cảnh 1M token qua beta context-1m, tương tự tùy chọn 1M của Opus 4.8.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-06-09',
    highlight: {
      en: 'Tabbed workspace + Liquid Glass — switch sections without losing your place.',
      vi: 'Workspace dạng tab + Liquid Glass — đổi mục mà không mất ngữ cảnh đang làm.',
    },
    items: [
      {
        kind: 'changed',
        en: 'Navigation moved from the left sidebar to a tab bar in the header. Sections now stay alive when you switch tabs — scroll position, selections and in-progress work persist, and background tasks/sessions keep running. Tabs show live badges (running tasks, streaming sessions, Git status).',
        vi: 'Điều hướng chuyển từ sidebar trái sang thanh tab trên header. Các mục giữ nguyên trạng thái khi đổi tab — vị trí cuộn, lựa chọn và việc đang làm được giữ lại, task/session vẫn chạy nền. Tab hiển thị badge sống (task đang chạy, session đang stream, trạng thái Git).',
      },
      {
        kind: 'added',
        en: 'Liquid Glass: a translucent, frosted macOS-style interface across the whole app. Toggle it in Settings → Appearance (on by default).',
        vi: 'Liquid Glass: giao diện kính mờ phong cách macOS trên toàn app. Bật/tắt ở Settings → Appearance (mặc định bật).',
      },
      {
        kind: 'improved',
        en: 'Git: the branch picker now groups branches into folders with search and scrolling, and the sidebar gained a branch search covering both local and remote branches.',
        vi: 'Git: bộ chọn branch giờ gom branch theo thư mục, có tìm kiếm và cuộn; sidebar thêm ô tìm branch cho cả local lẫn remote.',
      },
      {
        kind: 'fixed',
        en: 'Git history no longer shows a phase badge on every commit in non-AWOG repos — it appears only when a commit links to a real AWOG task phase.',
        vi: 'Lịch sử Git không còn gắn badge phase lên mọi commit ở repo ngoài — chỉ hiện khi commit liên kết tới một phase task AWOG thật.',
      },
      {
        kind: 'fixed',
        en: 'Fixed the Sessions view where the message list could not scroll and the composer was cut off.',
        vi: 'Sửa lỗi màn Sessions không cuộn được danh sách tin nhắn và bị che mất ô soạn tin.',
      },
    ],
  },
  {
    version: '0.5.2',
    date: '2026-06-05',
    highlight: {
      en: 'Windows stability: fixes a crash when opening Sessions.',
      vi: 'Ổn định trên Windows: sửa lỗi crash khi mở Sessions.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Fixed a renderer crash that occurred when opening Sessions on Windows: the code editor (Monaco/terminal) is now loaded only when a session is open, and all locale resources are shipped.',
        vi: 'Sửa lỗi crash renderer khi mở Sessions trên Windows: trình soạn code (Monaco/terminal) giờ chỉ nạp khi mở một session, và đóng gói đầy đủ locale.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-06-05',
    highlight: {
      en: 'Auto-update — AWOG now tells you when a new version is out.',
      vi: 'Tự cập nhật — AWOG báo cho bạn khi có phiên bản mới.',
    },
    items: [
      {
        kind: 'added',
        en: 'Auto-update: AWOG checks for new versions and, on Windows & Linux (AppImage), lets you download and restart to install. macOS and .deb builds show a notice with a link to the download page.',
        vi: 'Tự cập nhật: AWOG kiểm tra phiên bản mới và, trên Windows & Linux (AppImage), cho phép tải rồi khởi động lại để cài. Bản macOS và .deb hiển thị thông báo kèm liên kết tới trang tải.',
      },
      {
        kind: 'added',
        en: 'Update settings: a new "Updates" section shows your current version, lets you toggle automatic checks, and check for updates on demand.',
        vi: 'Cài đặt cập nhật: mục "Updates" mới hiển thị phiên bản hiện tại, cho bật/tắt tự kiểm tra và kiểm tra cập nhật theo yêu cầu.',
      },
      {
        kind: 'added',
        en: 'Diagnostics: AWOG now writes a log file (update activity, engine output, and errors). Open it any time from Settings → Updates → Open logs.',
        vi: 'Chẩn đoán: AWOG ghi file log (hoạt động cập nhật, output engine và lỗi). Mở bất cứ lúc nào ở Settings → Updates → Open logs.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-06-05',
    highlight: {
      en: 'Rebuilt on Electron — consistent rendering and a reliable, self-contained build.',
      vi: 'Dựng lại trên Electron — render nhất quán và bản đóng gói tự-chứa, ổn định.',
    },
    items: [
      {
        kind: 'changed',
        en: 'Desktop shell migrated from Tauri to Electron, for consistent Chromium rendering on every platform.',
        vi: 'Chuyển shell desktop từ Tauri sang Electron, render Chromium nhất quán trên mọi nền tảng.',
      },
      {
        kind: 'fixed',
        en: 'The bundled Claude CLI binary now ships correctly, fixing the "native CLI binary not found" startup failure.',
        vi: 'Đóng gói đúng binary Claude CLI, sửa lỗi khởi động "native CLI binary not found".',
      },
      {
        kind: 'improved',
        en: 'Slimmer install: trimmed ~65MB of unused native build artifacts; the macOS download stays around 170MB.',
        vi: 'Bản cài gọn hơn: cắt ~65MB build artifact thừa; bản tải macOS ~170MB.',
      },
    ],
  },
  {
    version: '0.3.4',
    date: '2026-06-04',
    highlight: {
      en: 'The desktop app is now self-contained — no system Node.js required.',
      vi: 'App desktop giờ tự chứa runtime — không cần cài Node.js trên máy.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Bundle the Node runtime so the app starts on machines without Node installed (fixes "sidecar writer channel closed").',
        vi: 'Đóng gói sẵn Node runtime để app chạy được trên máy chưa cài Node (sửa lỗi "sidecar writer channel closed").',
      },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-06-04',
    highlight: {
      en: 'Custom colors with hex input and a Theme tint-strength control.',
      vi: 'Tùy chỉnh màu bằng mã hex và điều chỉnh độ đậm tint cho Theme.',
    },
    items: [
      {
        kind: 'added',
        en: 'Theme color and Accent color now accept an exact hex code and stack into a roomier two-line layout.',
        vi: 'Theme color và Accent color giờ nhập được mã hex chính xác và xuống hai dòng cho thoáng hơn.',
      },
      {
        kind: 'added',
        en: 'A new Tint strength slider controls how strongly the Theme color tints app surfaces.',
        vi: 'Thanh Tint strength mới điều chỉnh độ đậm khi Theme color nhuộm lên các bề mặt của app.',
      },
      {
        kind: 'fixed',
        en: "The task trace now shows each tool's real arguments instead of empty parentheses.",
        vi: 'Trace của task giờ hiển thị tham số thật của mỗi tool thay vì dấu ngoặc trống.',
      },
      {
        kind: 'improved',
        en: 'Dropdowns across editors and settings now share a single consistent style.',
        vi: 'Các dropdown trong editor và settings giờ dùng chung một kiểu hiển thị nhất quán.',
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-06-04',
    highlight: {
      en: 'Task artifact editor fixes and tidier session replies.',
      vi: 'Sửa trình soạn artifact của Task và gọn lại phần trả lời trong Session.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Opening a task artifact in the editor now shows the real generated output instead of placeholder text.',
        vi: 'Mở artifact của task trong editor giờ hiển thị nội dung thật thay vì văn bản mẫu.',
      },
      {
        kind: 'fixed',
        en: '"Back to task" from the editor no longer 404s, and the task detail keeps its expanded step, active tab, and scroll position.',
        vi: 'Nút "Back to task" trong editor không còn lỗi 404, và phần chi tiết task giữ nguyên bước đang mở, tab và vị trí cuộn.',
      },
      {
        kind: 'fixed',
        en: 'Session replies no longer duplicate their tail when streaming finishes, and long tool lists, URLs, and paths wrap instead of overflowing the chat column.',
        vi: 'Câu trả lời trong Session không còn lặp đuôi khi stream xong, và danh sách tool, URL, đường dẫn dài tự xuống dòng thay vì tràn cột chat.',
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-06-04',
    highlight: {
      en: 'First stable cross-platform builds — native installers for Windows, macOS, and Linux.',
      vi: 'Bản stable đa nền tảng đầu tiên — installer cho Windows, macOS và Linux.',
    },
    items: [
      {
        kind: 'added',
        en: 'Native installers built by CI: Windows (.msi/.exe), macOS (.dmg, Apple Silicon + Intel), Linux (.deb/.AppImage).',
        vi: 'Installer dựng bởi CI: Windows (.msi/.exe), macOS (.dmg, Apple Silicon + Intel), Linux (.deb/.AppImage).',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-04',
    highlight: {
      en: 'The Task & Workflow engine, a Monaco code workspace, Connections, and multi-provider agents.',
      vi: 'Engine Task & Workflow, code workspace Monaco, Connections, và agent đa provider.',
    },
    items: [
      {
        kind: 'added',
        en: 'Task & Workflow execution engine: design agent pipelines as a DAG and run them with approval gates.',
        vi: 'Engine chạy Task & Workflow: thiết kế pipeline agent dạng DAG và chạy với cổng phê duyệt.',
      },
      {
        kind: 'added',
        en: 'Project code workspace with a multi-tab Monaco editor.',
        vi: 'Code workspace cho project với Monaco editor đa tab.',
      },
      {
        kind: 'added',
        en: 'Connections (formerly MCP Servers) for stdio/HTTP tools, with secrets in the OS keychain.',
        vi: 'Connections (trước là MCP Servers) cho tool stdio/HTTP, secret lưu trong keychain hệ điều hành.',
      },
      {
        kind: 'added',
        en: 'Per-agent LLM provider and account picker — Anthropic today, OpenAI and Google coming next.',
        vi: 'Chọn LLM provider và account cho từng agent — hiện Anthropic, OpenAI và Google sắp tới.',
      },
      {
        kind: 'added',
        en: 'Session resume and compaction for long-running conversations.',
        vi: 'Resume session và nén ngữ cảnh cho hội thoại dài.',
      },
      {
        kind: 'changed',
        en: 'Agents are now defined purely by their system prompt; skills are applied per step in Workflows.',
        vi: 'Agent giờ chỉ định nghĩa bằng system prompt; skills áp dụng theo từng bước trong Workflows.',
      },
      {
        kind: 'improved',
        en: 'Git Manager discovers multiple repositories inside a single project.',
        vi: 'Git Manager tự phát hiện nhiều repo trong cùng một project.',
      },
      {
        kind: 'added',
        en: 'Background-base theme presets: GitHub Dark and Subtle Purple.',
        vi: 'Theme preset theo nền: GitHub Dark và Subtle Purple.',
      },
      {
        kind: 'added',
        en: 'Claude Opus 4.8 model with 1M-token context.',
        vi: 'Model Claude Opus 4.8 với context 1M token.',
      },
      {
        kind: 'improved',
        en: 'Icon-only "New" button across list pages and borderless session chips.',
        vi: 'Nút "New" chỉ icon trên các trang danh sách và chip session bỏ viền.',
      },
      {
        kind: 'improved',
        en: 'Copy and expand actions on code blocks inside replies.',
        vi: 'Thêm nút sao chép và phóng to cho code block trong câu trả lời.',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-12',
    highlight: {
      en: 'Full Git Manager and the Session Workspace Panel land.',
      vi: 'Ra mắt Git Manager đầy đủ và Workspace Panel cho Session.',
    },
    items: [
      {
        kind: 'added',
        en: 'Git Manager (Sublime Merge-style): stage, commit, branch, stash, remotes, and tags.',
        vi: 'Git Manager (kiểu Sublime Merge): stage, commit, branch, stash, remote và tag.',
      },
      {
        kind: 'added',
        en: 'Session Workspace Panel with Diff, Files, Plan, Terminal, Tasks, and Preview tabs.',
        vi: 'Workspace Panel cho Session với tab Diff, Files, Plan, Terminal, Tasks và Preview.',
      },
      {
        kind: 'added',
        en: 'Integrated PTY terminal running in the sidecar.',
        vi: 'Terminal PTY tích hợp chạy trong sidecar.',
      },
      {
        kind: 'improved',
        en: 'Filesystem watcher auto-refreshes the UI when workspace files change outside the app.',
        vi: 'Filesystem watcher tự động làm mới UI khi file workspace đổi bên ngoài app.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-08',
    highlight: {
      en: 'The first foundation: Agents, Skills, MCP Servers, and sign-in.',
      vi: 'Nền tảng đầu tiên: Agents, Skills, MCP Servers và đăng nhập.',
    },
    items: [
      {
        kind: 'added',
        en: 'Agents (AGENT.md) with runtime system prompt, tools, skills, and MCP injection.',
        vi: 'Agents (AGENT.md) với system prompt, tools, skills và MCP inject lúc chạy.',
      },
      {
        kind: 'added',
        en: 'Skills (SKILL.md) with chat-driven creation.',
        vi: 'Skills (SKILL.md) với khả năng tạo qua hội thoại.',
      },
      {
        kind: 'added',
        en: 'MCP Servers over stdio and HTTP, with secrets stored in the OS keychain.',
        vi: 'MCP Servers qua stdio và HTTP, lưu secret trong keychain hệ điều hành.',
      },
      {
        kind: 'added',
        en: 'OAuth sign-in and persistent Sessions.',
        vi: 'Đăng nhập OAuth và Sessions lưu bền.',
      },
    ],
  },
]

export const CURRENT_VERSION: string = CHANGELOG[0]?.version ?? '0.0.0'
