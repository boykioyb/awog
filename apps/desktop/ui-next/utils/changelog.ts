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
    version: '0.24.10',
    date: '2026-07-21',
    highlight: {
      en: 'The SSH file browser becomes a full file manager, snippets run right inside the terminal, and math in notes renders reliably everywhere.',
      vi: 'Trình duyệt tệp SSH trở thành một trình quản lý tệp đầy đủ, snippet chạy ngay trong terminal, và công thức toán trong ghi chú hiển thị ổn định ở mọi nơi.',
    },
    items: [
      {
        kind: 'added',
        en: 'The SSH file browser is now a full file manager: right-click for rename, duplicate, copy/move, compress, extract, permissions, change owner, download, and delete — plus choose which columns to show and select multiple files at once.',
        vi: 'Trình duyệt tệp SSH giờ là một trình quản lý tệp đầy đủ: nhấp chuột phải để đổi tên, nhân bản, sao chép/di chuyển, nén, giải nén, đổi quyền, đổi chủ sở hữu, tải xuống và xóa — kèm chọn cột hiển thị và chọn nhiều tệp cùng lúc.',
      },
      {
        kind: 'added',
        en: 'Download remote files through a native "Save as" dialog, and drag files from your computer straight into the panel to upload them.',
        vi: 'Tải tệp từ xa qua hộp thoại "Lưu thành" gốc của hệ điều hành, và kéo tệp từ máy của bạn thẳng vào bảng để tải lên.',
      },
      {
        kind: 'added',
        en: 'A Snippets panel now docks in the SSH terminal so you can run your saved commands straight into the current shell.',
        vi: 'Bảng Snippets giờ gắn ngay trong terminal SSH để bạn chạy các lệnh đã lưu thẳng vào shell hiện tại.',
      },
      {
        kind: 'fixed',
        en: 'Math and LaTeX in your notes now render reliably everywhere, including the tray window — the required fonts are bundled instead of fetched.',
        vi: 'Công thức toán và LaTeX trong ghi chú giờ hiển thị ổn định ở mọi nơi, kể cả cửa sổ khay hệ thống — phông chữ cần thiết được đóng gói sẵn thay vì tải về.',
      },
      {
        kind: 'fixed',
        en: 'New sessions now check the quota of the account they will actually use — a project with its own LLM account is no longer blocked just because your global default account hit its limit.',
        vi: 'Phiên mới giờ kiểm tra hạn mức của đúng tài khoản mà nó sẽ dùng — một dự án có tài khoản LLM riêng không còn bị chặn chỉ vì tài khoản mặc định toàn cục của bạn đã hết hạn mức.',
      },
    ],
  },
  {
    version: '0.24.9',
    date: '2026-07-20',
    highlight: {
      en: 'Fixes duplicated typing when an SSH terminal reconnects, and keeps VPN connections steady so you enter your admin password only once.',
      vi: 'Sửa lỗi gõ bị lặp khi terminal SSH kết nối lại, và giữ kết nối VPN ổn định để bạn chỉ nhập mật khẩu quản trị một lần.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'SSH terminals no longer duplicate your keystrokes after a session reconnects — typing "ll" now sends "ll", not "llll".',
        vi: 'Terminal SSH không còn nhân đôi phím bạn gõ sau khi phiên kết nối lại — gõ "ll" giờ gửi đúng "ll", không phải "llll".',
      },
      {
        kind: 'fixed',
        en: 'VPN connections now recover from brief network drops on their own instead of asking for your admin password again — you enter it just once when you first connect.',
        vi: 'Kết nối VPN giờ tự phục hồi khi mạng chập chờn thay vì hỏi lại mật khẩu quản trị — bạn chỉ cần nhập một lần lúc bắt đầu kết nối.',
      },
      {
        kind: 'improved',
        en: 'VPN tunnels are steadier on flaky networks: a dropped link is detected and re-established automatically, keeping your SSH sessions alive.',
        vi: 'Đường hầm VPN ổn định hơn trên mạng chập chờn: link rớt được phát hiện và tự thiết lập lại, giữ cho phiên SSH của bạn không bị đứt.',
      },
    ],
  },
  {
    version: '0.24.8',
    date: '2026-07-19',
    highlight: {
      en: 'VPN connections now prompt for your multi-factor / one-time code, with a smoother SSH login editor and steadier diagram & math rendering.',
      vi: 'Kết nối VPN giờ hỏi mã xác thực đa yếu tố / mã một lần, kèm trình sửa đăng nhập SSH mượt hơn và render sơ đồ & công thức toán ổn định hơn.',
    },
    items: [
      {
        kind: 'added',
        en: 'VPN connections that need a multi-factor or one-time code now show a prompt during connect — type the code from your authenticator and the tunnel finishes connecting. The code is sent only to the VPN server, never stored or logged.',
        vi: 'Kết nối VPN cần mã xác thực đa yếu tố hoặc mã một lần giờ hiện ô nhập khi đang kết nối — nhập mã từ ứng dụng xác thực của bạn và đường hầm sẽ kết nối xong. Mã chỉ gửi tới máy chủ VPN, không lưu hay ghi log.',
      },
      {
        kind: 'improved',
        en: 'The VPN log now shows a "waiting for output" hint and live connection-state lines, so a slow connect visibly keeps progressing.',
        vi: 'Nhật ký VPN giờ hiện gợi ý "đang chờ output" và các dòng trạng thái kết nối trực tiếp, để một kết nối chậm vẫn thấy đang tiến triển.',
      },
      {
        kind: 'added',
        en: 'The SSH host editor can now reveal a saved password or key passphrase (behind a show/hide toggle) so you can check or update it without retyping.',
        vi: 'Trình sửa host SSH giờ có thể hiển thị mật khẩu hoặc passphrase khoá đã lưu (qua nút hiện/ẩn) để bạn xem lại hoặc cập nhật mà không phải gõ lại.',
      },
      {
        kind: 'improved',
        en: 'The VPN and SSH editors now flag missing or invalid fields (name, host, user, port, config path) before you save.',
        vi: 'Trình sửa VPN và SSH giờ báo các trường thiếu hoặc không hợp lệ (tên, host, user, port, đường dẫn cấu hình) trước khi lưu.',
      },
      {
        kind: 'fixed',
        en: 'Diagrams whose node labels contain brackets, parentheses, or a pipe now render instead of showing a parse error.',
        vi: 'Sơ đồ có nhãn node chứa dấu ngoặc vuông, ngoặc tròn hoặc dấu gạch đứng giờ hiển thị được thay vì báo lỗi phân tích.',
      },
      {
        kind: 'fixed',
        en: 'Ordinary text with dollar signs (like "$5 to $10") is no longer mistaken for a math formula and rendered as garbled symbols.',
        vi: 'Văn bản thường có dấu đô la (như "$5 tới $10") không còn bị nhầm là công thức toán và hiển thị thành ký hiệu lộn xộn.',
      },
    ],
  },
  {
    version: '0.24.7',
    date: '2026-07-17',
    highlight: {
      en: 'The "Prompt" session export now streams as it writes, generates faster, and is editable before you copy or save.',
      vi: 'Xuất session dạng "Prompt" giờ hiện dần khi đang viết, tạo nhanh hơn, và chỉnh sửa được trước khi copy hay lưu.',
    },
    items: [
      {
        kind: 'improved',
        en: 'The "Prompt" export now streams the summary live as it\'s written — with a loading cue on the tab — instead of waiting behind a blank spinner, and it uses a faster model, so the prompt shows up much sooner.',
        vi: 'Xuất "Prompt" giờ hiển thị bản tóm tắt chạy dần khi đang viết — kèm chỉ báo đang tải trên tab — thay vì chờ sau một spinner trống, và dùng model nhanh hơn, nên prompt xuất hiện sớm hơn nhiều.',
      },
      {
        kind: 'added',
        en: 'You can now edit the generated prompt directly in the export dialog before copying or saving it.',
        vi: 'Bạn giờ có thể chỉnh sửa prompt được tạo ngay trong hộp thoại xuất trước khi copy hoặc lưu.',
      },
    ],
  },
  {
    version: '0.24.6',
    date: '2026-07-17',
    highlight: {
      en: 'Export a session as one ready-to-reuse prompt, and a fix that keeps a folder from splitting into two projects.',
      vi: 'Xuất một session thành một prompt sẵn sàng tái sử dụng, và bản sửa để một thư mục không bị tách thành hai project.',
    },
    items: [
      {
        kind: 'added',
        en: 'New "Prompt" export mode: turn a whole session into one self-contained prompt you can paste into a fresh chat to pick up the work — goal, key decisions, current state, and next steps. Copy it or save it as a .prompt.md file.',
        vi: 'Chế độ xuất "Prompt" mới: biến cả một session thành một prompt độc lập để bạn dán vào cuộc trò chuyện mới và tiếp tục công việc — mục tiêu, quyết định chính, trạng thái hiện tại và các bước tiếp theo. Copy hoặc lưu thành file .prompt.md.',
      },
      {
        kind: 'fixed',
        en: 'Re-adding a folder you already have as a project no longer splits it into two same-named projects with the sessions stranded on one of them — the existing project is reused instead.',
        vi: 'Thêm lại một thư mục đã là project không còn tách nó thành hai project trùng tên với các session mắc kẹt ở một bên — project sẵn có được dùng lại.',
      },
    ],
  },
  {
    version: '0.24.5',
    date: '2026-07-17',
    highlight: {
      en: 'Sort your sessions your way, live "last active" times, and an unread badge on the app icon.',
      vi: 'Sắp xếp session theo ý bạn, thời gian "hoạt động gần nhất" cập nhật trực tiếp, và huy hiệu chưa đọc trên icon ứng dụng.',
    },
    items: [
      {
        kind: 'added',
        en: 'Sort your session list by most recently updated, most recently created, or title (A → Z) — your choice is remembered across restarts.',
        vi: 'Sắp xếp danh sách session theo cập nhật gần nhất, mới tạo gần nhất, hoặc tên (A → Z) — lựa chọn được ghi nhớ qua các lần khởi động lại.',
      },
      {
        kind: 'improved',
        en: 'Session times now tick live: a row\'s "3m / 2h / 1d" label advances on its own instead of freezing at whatever it showed when the list loaded.',
        vi: 'Thời gian session giờ cập nhật trực tiếp: nhãn "3m / 2h / 1d" của mỗi dòng tự trôi theo thời gian thay vì đứng yên ở giá trị lúc mở danh sách.',
      },
      {
        kind: 'added',
        en: 'The app icon shows an unread badge — a red count on the Dock/taskbar for sessions that finished while you were away (macOS & Linux).',
        vi: 'Icon ứng dụng hiển thị huy hiệu chưa đọc — số đỏ trên Dock/taskbar cho các session hoàn tất khi bạn vắng mặt (macOS & Linux).',
      },
      {
        kind: 'fixed',
        en: 'Multi-select is easier: the action bar stays visible the whole time you\'re selecting so "Select all" and Exit are always reachable, and "Select all" flips to "Deselect all" once everything is picked.',
        vi: 'Chọn nhiều dễ hơn: thanh thao tác luôn hiển thị suốt lúc chọn nên "Chọn tất cả" và Thoát luôn trong tầm với, và "Chọn tất cả" đổi thành "Bỏ chọn tất cả" khi đã chọn hết.',
      },
      {
        kind: 'improved',
        en: 'Cleaner plans: in plan mode the assistant no longer repeats its plan as a second block of text, and stops after presenting it to wait for your approval.',
        vi: 'Kế hoạch gọn hơn: ở plan mode, trợ lý không còn lặp lại kế hoạch thành một khối chữ thứ hai, và dừng sau khi trình bày để chờ bạn duyệt.',
      },
    ],
  },
  {
    version: '0.24.4',
    date: '2026-07-15',
    highlight: {
      en: 'Polish and fixes for the new SSH tools, smarter notifications, and pages that keep their state as you move around.',
      vi: 'Tinh chỉnh và sửa lỗi cho bộ công cụ SSH mới, thông báo thông minh hơn, và các trang giữ nguyên trạng thái khi bạn chuyển qua lại.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Notifications now open the right thing: clicking a "turn finished", "needs your reply", or "task needs approval" notification jumps straight to that exact session or task, instead of only bringing the window forward.',
        vi: 'Thông báo giờ mở đúng thứ cần: bấm vào thông báo "đã xong lượt", "cần bạn trả lời" hay "task cần duyệt" sẽ nhảy thẳng tới đúng phiên hoặc task đó, thay vì chỉ đưa cửa sổ lên trước.',
      },
      {
        kind: 'improved',
        en: 'Pages keep their state as you navigate: leaving Sessions or SSH and coming back keeps your open terminals, connections, scroll position, and filters exactly as you left them.',
        vi: 'Các trang giữ nguyên trạng thái khi chuyển qua lại: rời Sessions hay SSH rồi quay lại vẫn giữ nguyên terminal đang mở, kết nối, vị trí cuộn và bộ lọc như lúc bạn rời đi.',
      },
      {
        kind: 'changed',
        en: 'SSH co-pilot always runs commands live in view: in co-pilot mode the assistant now runs every command in the terminal you are watching (targeting the exact pane you have focused), so nothing runs out of sight.',
        vi: 'SSH co-pilot luôn chạy lệnh ngay trước mắt bạn: ở chế độ co-pilot, trợ lý giờ chạy mọi lệnh trong terminal bạn đang xem (đúng pane bạn đang focus), nên không có gì chạy ngoài tầm nhìn.',
      },
      {
        kind: 'changed',
        en: 'Response styles: replaced "git log" with a new "Step by Step" style (a numbered, do-this-then-that walkthrough), and refined "Mentor" to use analogies only when they genuinely help.',
        vi: 'Kiểu trả lời: thay "git log" bằng kiểu "Step by Step" mới (hướng dẫn đánh số, làm lần lượt từng bước), và tinh chỉnh "Mentor" để chỉ ví von khi thật sự giúp hiểu.',
      },
      {
        kind: 'fixed',
        en: 'Plan mode works mid-chat: turning on plan mode partway through a conversation now takes effect reliably (previously it could be ignored after the first message).',
        vi: 'Plan mode chạy đúng giữa chừng: bật plan mode giữa cuộc trò chuyện giờ có hiệu lực ổn định (trước đây có thể bị bỏ qua sau tin nhắn đầu).',
      },
      {
        kind: 'fixed',
        en: 'Small display fixes: no more clipped bottom row in the terminal, and chat task-list checkboxes render cleanly like on GitHub.',
        vi: 'Sửa hiển thị nhỏ: terminal không còn bị cắt dòng cuối, và checkbox danh sách công việc trong chat giờ hiển thị gọn như trên GitHub.',
      },
    ],
  },
  {
    version: '0.24.3',
    date: '2026-07-15',
    highlight: {
      en: 'SSH Manager arrives: a full SSH client built in, an assistant that can drive your SSH sessions, one-click PR summaries in Git, and customizable keyboard shortcuts.',
      vi: 'Ra mắt SSH Manager: một trình SSH đầy đủ ngay trong app, trợ lý có thể lái phiên SSH của bạn, tạo tóm tắt PR một chạm trong Git, và phím tắt tùy chỉnh được.',
    },
    items: [
      {
        kind: 'added',
        en: 'SSH Manager (a new SSH section): manage all your servers in one place — organize hosts into folders with tags, open interactive terminals (several panes per host), browse and transfer files over SFTP, set up port forwarding, manage keys and passphrases, and import your existing ~/.ssh/config. Passwords and keys stay in your OS keychain — never written to config files or git.',
        vi: 'SSH Manager (mục SSH mới): quản lý mọi máy chủ ở một nơi — sắp xếp host vào thư mục kèm thẻ, mở terminal tương tác (nhiều pane mỗi host), duyệt và chuyển file qua SFTP, thiết lập chuyển tiếp cổng, quản lý khóa và passphrase, và nhập ~/.ssh/config sẵn có. Mật khẩu và khóa nằm trong OS keychain — không bao giờ ghi vào file cấu hình hay git.',
      },
      {
        kind: 'added',
        en: 'Let the assistant work over SSH: attach a host to a chat session and it can run commands and move files on the server for you; or, inside the SSH screen, dock a chat beside a live terminal and watch it type and run commands there (co-pilot mode).',
        vi: 'Cho trợ lý làm việc qua SSH: gắn một host vào phiên chat để nó chạy lệnh và chuyển file trên máy chủ giúp bạn; hoặc ngay trong màn SSH, ghim một phiên chat cạnh terminal đang chạy và xem nó gõ, chạy lệnh trực tiếp (chế độ co-pilot).',
      },
      {
        kind: 'added',
        en: 'Git — "Create PR summary": right-click a branch to generate a ready-to-paste pull-request title and description — pick the base branch, edit in place, and copy.',
        vi: 'Git — "Create PR summary": chuột phải một nhánh để tạo tiêu đề và mô tả pull request dán được ngay — chọn nhánh gốc, sửa tại chỗ, và sao chép.',
      },
      {
        kind: 'improved',
        en: 'Git branches now sort by most recent commit, so what you are actively working on floats to the top.',
        vi: 'Nhánh Git giờ sắp xếp theo commit gần nhất, nên nhánh bạn đang làm nổi lên trên cùng.',
      },
      {
        kind: 'added',
        en: 'Customizable keyboard shortcuts: rebind the global shortcuts (command palette, toggle terminal, open Git, new session, and more) in Settings → Keyboard, with conflict and reserved-key checks.',
        vi: 'Phím tắt tùy chỉnh: gán lại các phím tắt toàn cục (bảng lệnh, bật/tắt terminal, mở Git, phiên mới, v.v.) trong Cài đặt → Bàn phím, có kiểm tra trùng và phím bị hệ thống giữ.',
      },
      {
        kind: 'changed',
        en: '"Connections" is now called "Sources", with a new activity log that shows tool calls and a clearer secrets panel.',
        vi: '"Connections" nay đổi tên thành "Sources", kèm nhật ký hoạt động hiển thị các lần gọi công cụ và bảng quản lý secret rõ ràng hơn.',
      },
      {
        kind: 'improved',
        en: 'A round of polish to make the app feel more at home on macOS.',
        vi: 'Một đợt tinh chỉnh để app trông tự nhiên hơn trên macOS.',
      },
    ],
  },
  {
    version: '0.24.2',
    date: '2026-07-13',
    highlight: {
      en: 'Response styles now apply reliably, unread sessions stand out in the list, and Mermaid diagrams gain a Fit button plus fixed Shift-scroll zoom.',
      vi: 'Kiểu trả lời giờ áp dụng đáng tin cậy, phiên chưa đọc nổi bật trong danh sách, và sơ đồ Mermaid có nút Vừa khung cùng zoom Shift-cuộn đã sửa.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Response styles (Pirate, Hacker 80s, and the rest) now actually apply — a bug sent the display name instead of the internal id, so the style was silently ignored. Sessions that already had a style set work too.',
        vi: 'Kiểu trả lời (Pirate, Hacker 80s và các kiểu khác) giờ thực sự được áp dụng — một lỗi đã gửi tên hiển thị thay vì id nội bộ nên kiểu bị bỏ qua âm thầm. Các phiên đã đặt kiểu từ trước cũng hoạt động.',
      },
      {
        kind: 'improved',
        en: 'Unread sessions in the list now get a status-colored highlight (done, awaiting input, or failed) so a session that changed while you were away stands out at a glance.',
        vi: 'Phiên chưa đọc trong danh sách giờ được tô nền theo trạng thái (xong, chờ nhập, hoặc lỗi) để phiên thay đổi khi bạn vắng mặt nổi bật ngay từ cái nhìn đầu tiên.',
      },
      {
        kind: 'improved',
        en: 'The running-project dot on session tabs pulses more clearly and is no longer clipped at the edge of the tab strip.',
        vi: 'Chấm báo dự án đang chạy trên các tab phiên nhấp nháy rõ hơn và không còn bị cắt ở mép dải tab.',
      },
      {
        kind: 'added',
        en: 'Mermaid diagrams get a dedicated "Fit to view" button that scales the whole diagram into the frame, separate from "Reset to 100%".',
        vi: 'Sơ đồ Mermaid có thêm nút "Vừa khung" riêng để thu toàn bộ sơ đồ vào khung, tách khỏi nút "Về 100%".',
      },
      {
        kind: 'fixed',
        en: 'Mermaid diagrams: holding Shift while scrolling now zooms both in and out — previously it only ever zoomed out.',
        vi: 'Sơ đồ Mermaid: giữ Shift trong khi cuộn giờ phóng to lẫn thu nhỏ — trước đây chỉ thu nhỏ được.',
      },
    ],
  },
  {
    version: '0.24.1',
    date: '2026-07-13',
    highlight: {
      en: 'Stability fixes for sessions: finished replies always settle, forking a running session opens clean, diagrams no longer hijack scrolling, and a frozen engine now auto-recovers.',
      vi: 'Sửa ổn định cho phiên: câu trả lời xong luôn kết thúc gọn, fork một phiên đang chạy mở ra sạch, sơ đồ không còn nuốt thao tác cuộn, và engine bị treo giờ tự phục hồi.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'A finished reply could stay stuck showing the "working" spinner with the timer still counting — the turn now always settles and the indicator stops.',
        vi: 'Câu trả lời đã xong đôi khi kẹt ở trạng thái "đang chạy" với đồng hồ vẫn đếm — lượt trả lời giờ luôn kết thúc gọn và chỉ báo dừng lại.',
      },
      {
        kind: 'fixed',
        en: 'Forking a session while it was running opened the new session stuck "running" so you could not send messages — the fork now opens as a clean, ready session.',
        vi: 'Fork một phiên khi nó đang chạy khiến phiên mới bị kẹt "đang chạy" và không gửi được tin nhắn — fork giờ mở ra như một phiên sạch, sẵn sàng.',
      },
      {
        kind: 'improved',
        en: 'Diagrams no longer capture your scroll: scrolling over a diagram moves the conversation as expected. Hold Shift while scrolling to zoom a diagram in or out.',
        vi: 'Sơ đồ không còn nuốt thao tác cuộn: cuộn qua sơ đồ sẽ cuộn cuộc trò chuyện như mong đợi. Giữ Shift trong khi cuộn để phóng to/thu nhỏ sơ đồ.',
      },
      {
        kind: 'improved',
        en: 'The app now detects an unresponsive engine and restarts it automatically, instead of leaving a session stuck forever.',
        vi: 'Ứng dụng giờ phát hiện engine không phản hồi và tự khởi động lại, thay vì để một phiên kẹt mãi.',
      },
      {
        kind: 'added',
        en: 'Git: a "Discard all" action in the changes context menu reverts every working-tree change at once.',
        vi: 'Git: thao tác "Discard all" trong menu chuột phải của phần thay đổi hoàn tác mọi thay đổi working tree cùng lúc.',
      },
      {
        kind: 'fixed',
        en: 'Long file paths and URLs in a message now wrap inside the bubble instead of overflowing past its edge.',
        vi: 'Đường dẫn tệp và URL dài trong tin nhắn giờ xuống dòng gọn trong khung thay vì tràn ra ngoài mép.',
      },
    ],
  },
  {
    version: '0.24.0',
    date: '2026-07-12',
    highlight: {
      en: 'Connections is rebuilt as Sources — add MCP, API, or local sources, connect them with one-click OAuth, and turn any REST API into agent tools. Plus faster sessions, in-app merge-conflict resolution, and per-project usage.',
      vi: 'Connections được dựng lại thành Sources — thêm nguồn MCP, API hoặc local, kết nối bằng OAuth một chạm, và biến bất kỳ REST API nào thành công cụ cho agent. Kèm phiên nhanh hơn, giải quyết xung đột merge ngay trong app, và thống kê dùng theo dự án.',
    },
    items: [
      {
        kind: 'added',
        en: 'Connections is now Sources: the page is rebuilt around a Sources model — add MCP, API, or local sources, each with its own folder, an editable guide and permissions, real provider icons, and a live status dot.',
        vi: 'Connections giờ là Sources: trang được dựng lại quanh mô hình Sources — thêm nguồn MCP, API hoặc local, mỗi nguồn có thư mục riêng, guide và permissions chỉnh sửa được, icon nhà cung cấp thật, và chấm trạng thái trực tiếp.',
      },
      {
        kind: 'added',
        en: 'One-click OAuth with automatic token refresh for remote MCP and API sources — sign in once and stay connected.',
        vi: 'OAuth một chạm kèm tự động làm mới token cho nguồn MCP và API từ xa — đăng nhập một lần và luôn giữ kết nối.',
      },
      {
        kind: 'added',
        en: 'Add-source catalog: pick from a catalog of provider presets when adding a new source.',
        vi: 'Danh mục thêm nguồn: chọn từ danh mục preset nhà cung cấp khi thêm một nguồn mới.',
      },
      {
        kind: 'added',
        en: 'Turn any REST API into agent tools: point AWOG at an endpoint and it becomes callable tools for your agents, with per-source permissions and trust.',
        vi: 'Biến bất kỳ REST API nào thành công cụ cho agent: trỏ AWOG tới một endpoint và nó trở thành các công cụ gọi được cho agent, kèm permissions và mức tin cậy theo từng nguồn.',
      },
      {
        kind: 'added',
        en: 'Reveal a source’s folder in Finder and act on it from a row menu, and edit its guide and permissions right in the UI.',
        vi: 'Hiện thư mục của một nguồn trong Finder và thao tác từ menu dòng, và chỉnh guide cùng permissions ngay trong giao diện.',
      },
      {
        kind: 'improved',
        en: 'Sessions load faster and more smoothly, backed by new storage with a warm cache and human-readable session names and links.',
        vi: 'Phiên tải nhanh và mượt hơn, nhờ lưu trữ mới với cache ấm sẵn cùng tên và liên kết phiên dễ đọc.',
      },
      {
        kind: 'changed',
        en: 'Session replies now stream Craft-style — full text in chunky updates with a live processing indicator. Prefer the smooth character-by-character reveal? Turn the typewriter back on in Settings.',
        vi: 'Phản hồi trong phiên giờ chạy kiểu Craft — hiện toàn văn theo từng cụm kèm chỉ báo đang xử lý trực tiếp. Thích kiểu gõ chữ mượt từng ký tự? Bật lại typewriter trong Cài đặt.',
      },
      {
        kind: 'added',
        en: 'See what’s running at a glance: the tray lists sessions that are working right now, and a session’s tab dot pulses in its project color while it runs.',
        vi: 'Nhìn là biết cái gì đang chạy: khay hệ thống liệt kê các phiên đang chạy ngay lúc này, và chấm trên tab của phiên nhấp nháy theo màu dự án khi đang chạy.',
      },
      {
        kind: 'added',
        en: 'Resolve merge conflicts inside AWOG: pick “ours” or “theirs” per conflict, or edit inline, then mark the file resolved.',
        vi: 'Giải quyết xung đột merge ngay trong AWOG: chọn “của mình” hoặc “của họ” cho từng xung đột, hoặc sửa trực tiếp, rồi đánh dấu file đã giải quyết.',
      },
      {
        kind: 'added',
        en: 'Activity can now filter usage by project, so tokens, turns, and cost stay consistent for the project you care about.',
        vi: 'Hoạt động giờ lọc được mức dùng theo dự án, để số token, số lượt và chi phí nhất quán cho đúng dự án bạn quan tâm.',
      },
      {
        kind: 'fixed',
        en: 'The context gauge no longer over-counts after you compact a session, so compacting visibly frees up space.',
        vi: 'Thước ngữ cảnh không còn đếm dư sau khi bạn nén một phiên, nên việc nén thực sự giải phóng chỗ trống thấy rõ.',
      },
    ],
  },
  {
    version: '0.23.4',
    date: '2026-07-08',
    highlight: {
      en: 'See exactly what each session costs over time, and verify a connection actually authenticates — not just that it connects.',
      vi: 'Xem chính xác chi phí của từng phiên theo thời gian, và xác minh một kết nối thực sự xác thực được — không chỉ là kết nối được.',
    },
    items: [
      {
        kind: 'added',
        en: 'Session Cost tab in the workspace panel: see how much a session has cost, broken down by day, with 1d / 7d / 30d / all-time and custom date ranges plus a lifetime total and token and turn counts.',
        vi: 'Tab Chi phí trong bảng làm việc: xem một phiên đã tốn bao nhiêu, chia theo từng ngày, với các khoảng 1 ngày / 7 ngày / 30 ngày / toàn thời gian và khoảng ngày tùy chọn, kèm tổng chi phí trọn đời cùng số token và số lượt.',
      },
      {
        kind: 'added',
        en: 'Activity now has a “By session” breakdown showing tokens, turns, and cost per session, sortable by most or least used.',
        vi: 'Hoạt động giờ có mục “Theo phiên” hiển thị số token, số lượt và chi phí của từng phiên, sắp xếp được theo dùng nhiều nhất hoặc ít nhất.',
      },
      {
        kind: 'improved',
        en: 'Testing a connection now checks authentication, not just connectivity: pick a read-only tool and AWOG confirms your token actually works — a green “Authenticated ✓” or a clear auth-failed message.',
        vi: 'Kiểm tra kết nối giờ xác minh cả xác thực, không chỉ khả năng kết nối: chọn một công cụ chỉ-đọc và AWOG xác nhận token của bạn thực sự hoạt động — hiện “Đã xác thực ✓” hoặc thông báo xác thực thất bại rõ ràng.',
      },
      {
        kind: 'improved',
        en: 'New connections are verified as you create them: AWOG runs a handshake right in the creation flow and shows whether it connected (with tool and resource counts) or failed, instead of only writing a file.',
        vi: 'Kết nối mới được xác minh ngay khi bạn tạo: AWOG chạy một lần bắt tay ngay trong luồng tạo và cho biết đã kết nối (kèm số công cụ và tài nguyên) hay thất bại, thay vì chỉ ghi ra một file.',
      },
      {
        kind: 'added',
        en: 'Exported sessions: reveal the saved file in Finder, open it in VS Code, or copy its path.',
        vi: 'Phiên đã xuất: hiện file đã lưu trong Finder, mở trong VS Code, hoặc sao chép đường dẫn của nó.',
      },
      {
        kind: 'added',
        en: 'Compact a session’s context on demand to free up budget for long chats.',
        vi: 'Nén ngữ cảnh của một phiên theo yêu cầu để giải phóng ngân sách cho các cuộc chat dài.',
      },
      {
        kind: 'added',
        en: '“Send now” for a queued message: stop the current turn and send it immediately.',
        vi: '“Gửi ngay” cho tin nhắn đang xếp hàng: dừng lượt hiện tại và gửi nó ngay lập tức.',
      },
      {
        kind: 'improved',
        en: 'Preview: drag a minimized preview anywhere, hide or show its toolbar, and get a clear retry if the code editor fails to load.',
        vi: 'Xem trước: kéo một bản xem trước đã thu nhỏ tới bất cứ đâu, ẩn hoặc hiện thanh công cụ của nó, và có nút thử lại rõ ràng nếu trình soạn mã không tải được.',
      },
      {
        kind: 'added',
        en: 'Git: cancel a fetch, pull, or push while it is in progress.',
        vi: 'Git: hủy một thao tác fetch, pull hoặc push khi đang chạy.',
      },
    ],
  },
  {
    version: '0.23.3',
    date: '2026-07-06',
    highlight: {
      en: 'Park a running session, file preview, task, or terminal into a small pill in the corner and restore it in one click — plus much faster session switching and smoother long chats.',
      vi: 'Thu nhỏ một phiên đang chạy, bản xem trước file, tác vụ hoặc terminal thành một pill nhỏ ở góc màn hình rồi khôi phục chỉ với một cú nhấp — cùng với chuyển phiên nhanh hơn nhiều và chat dài mượt hơn.',
    },
    items: [
      {
        kind: 'added',
        en: 'Minimize to corner: shrink a file preview, running session, task, or the terminal into a stacked pill in the bottom-right, then click to restore each to exactly where it was — the preview keeps its view and scroll position, and the terminal keeps running in the background.',
        vi: 'Thu nhỏ ra góc: thu một bản xem trước file, phiên đang chạy, tác vụ hoặc terminal thành một pill xếp chồng ở góc dưới bên phải, rồi nhấp để khôi phục về đúng chỗ cũ — bản xem trước giữ nguyên chế độ xem và vị trí cuộn, còn terminal vẫn tiếp tục chạy ở nền.',
      },
      {
        kind: 'improved',
        en: 'Switching between sessions is now instant, and opening a long chat is much smoother — only the most recent turns render up front, with older ones loading as you scroll up (or via jump-to-top).',
        vi: 'Chuyển giữa các phiên giờ tức thì, và mở một cuộc chat dài mượt hơn nhiều — chỉ các lượt gần nhất được hiển thị trước, các lượt cũ hơn tải dần khi bạn cuộn lên (hoặc qua nút nhảy lên đầu).',
      },
      {
        kind: 'improved',
        en: 'Sending a message feels snappier — the short delay before your message appeared is gone.',
        vi: 'Gửi tin nhắn cảm giác nhanh nhạy hơn — độ trễ ngắn trước khi tin nhắn của bạn hiện ra đã được loại bỏ.',
      },
      {
        kind: 'added',
        en: 'The project quick-view now offers the same full set of actions as the Projects page.',
        vi: 'Xem nhanh dự án giờ cung cấp đầy đủ các hành động y như trang Dự án.',
      },
      {
        kind: 'improved',
        en: 'The built-in terminal now opens in the folder of the session you are working in, instead of always your home folder.',
        vi: 'Terminal tích hợp giờ mở trong thư mục của phiên bạn đang làm việc, thay vì luôn là thư mục home.',
      },
      {
        kind: 'added',
        en: 'Git history: right-click a file in a commit to open it, reveal it in your file manager, or copy its path.',
        vi: 'Lịch sử Git: nhấp chuột phải vào một file trong commit để mở, hiện trong trình quản lý file, hoặc sao chép đường dẫn của nó.',
      },
      {
        kind: 'fixed',
        en: 'File references in chat only become clickable when they point to a real file in your project — a filename the model merely suggests stays plain text — and a link now resolves to the file the chat is actually about.',
        vi: 'Tham chiếu file trong chat chỉ trở nên nhấp được khi trỏ tới một file thật trong dự án của bạn — một tên file mà mô hình chỉ gợi ý sẽ giữ nguyên là văn bản thường — và một liên kết giờ trỏ đúng tới file mà cuộc chat đang nói tới.',
      },
      {
        kind: 'improved',
        en: 'Force-push now shows a clear message when the remote branch moved since your last fetch: fetch to review the new commits, then push again.',
        vi: 'Force-push giờ hiển thị thông báo rõ ràng khi branch trên remote đã dịch chuyển kể từ lần fetch gần nhất: hãy fetch để xem các commit mới, rồi push lại.',
      },
      {
        kind: 'fixed',
        en: 'More of the diagrams the model writes now render, thanks to auto-repair of a common Mermaid styling slip.',
        vi: 'Nhiều sơ đồ do mô hình viết giờ hiển thị được hơn, nhờ tự sửa một lỗi tạo kiểu Mermaid thường gặp.',
      },
      {
        kind: 'fixed',
        en: 'A long file name in the diff view no longer overlaps the Stage/Unstage buttons.',
        vi: 'Tên file dài trong khung xem diff không còn đè lên các nút Stage/Unstage.',
      },
      {
        kind: 'fixed',
        en: 'Changing the response style mid-chat now takes effect on the next reply when using the Claude runtime.',
        vi: 'Đổi phong cách trả lời giữa chừng cuộc chat giờ có hiệu lực ở lượt trả lời kế tiếp khi dùng runtime Claude.',
      },
    ],
  },
  {
    version: '0.23.2',
    date: '2026-07-03',
    highlight: {
      en: 'Images and PDFs you attach now reliably reach the model, you can attach whole folders as read-only context, and the app recovers on its own if the engine crashes mid-turn — telling you exactly which turn was interrupted instead of leaving it stuck on “Streaming…”.',
      vi: 'Ảnh và PDF bạn đính kèm giờ đến được mô hình một cách đáng tin cậy, bạn có thể đính kèm cả thư mục làm ngữ cảnh chỉ-đọc, và ứng dụng tự phục hồi nếu engine gặp sự cố giữa lượt — báo rõ lượt nào bị gián đoạn thay vì kẹt mãi ở “Streaming…”.',
    },
    items: [
      {
        kind: 'improved',
        en: 'Images and PDFs attached to a chat now reliably reach the model — sent as native image and document blocks. Other attached files ride along as a reference the model can open with a tool when the file is inside your working folder.',
        vi: 'Ảnh và PDF đính kèm vào chat giờ đến được mô hình một cách đáng tin cậy — gửi dưới dạng khối ảnh và tài liệu gốc. Các file đính kèm khác đi kèm dưới dạng tham chiếu để mô hình mở bằng công cụ khi file nằm trong thư mục làm việc của bạn.',
      },
      {
        kind: 'added',
        en: 'Attach one or more folders to a chat as read-only context — via the new folder button, the multi-select picker, or by dragging them in. Each folder’s layout is shown to the model for orientation, without changing your working directory.',
        vi: 'Đính kèm một hoặc nhiều thư mục vào chat làm ngữ cảnh chỉ-đọc — qua nút thư mục mới, bộ chọn nhiều mục, hoặc kéo-thả vào. Bố cục của mỗi thư mục được hiển thị cho mô hình để định hướng, mà không thay đổi thư mục làm việc của bạn.',
      },
      {
        kind: 'fixed',
        en: 'The app now recovers automatically if the engine crashes mid-turn, and marks the interrupted turn with a clear “retry to continue” message instead of leaving it stuck on “Streaming…” forever.',
        vi: 'Ứng dụng giờ tự phục hồi nếu engine gặp sự cố giữa lượt, và đánh dấu lượt bị gián đoạn bằng thông báo “thử lại để tiếp tục” rõ ràng thay vì kẹt mãi ở “Streaming…”.',
      },
      {
        kind: 'improved',
        en: 'The session list now shows each session’s status — done, waiting for you, or error — right on its row, without needing to open it first.',
        vi: 'Danh sách phiên giờ hiển thị trạng thái của mỗi phiên — xong, đang chờ bạn, hoặc lỗi — ngay trên hàng của nó, mà không cần mở ra trước.',
      },
      {
        kind: 'fixed',
        en: 'You can now send a follow-up made only of quoted text (with no typed message), and quoted replies are kept when you queue a message while a turn is still running.',
        vi: 'Bạn giờ có thể gửi một tin nhắn tiếp theo chỉ gồm văn bản trích dẫn (không cần gõ thêm), và các trích dẫn được giữ lại khi bạn xếp hàng tin nhắn trong lúc một lượt vẫn đang chạy.',
      },
      {
        kind: 'added',
        en: 'Git remotes: “Remove remote” and “Edit URLs…” are now available from a remote’s right-click menu.',
        vi: 'Git remote: “Xóa remote” và “Sửa URL…” giờ có sẵn trong menu chuột phải của một remote.',
      },
      {
        kind: 'fixed',
        en: 'Git fetch, pull, and push with missing credentials now surface a clear sign-in error instead of silently hanging.',
        vi: 'Git fetch, pull và push khi thiếu thông tin đăng nhập giờ hiện lỗi đăng nhập rõ ràng thay vì treo âm thầm.',
      },
      {
        kind: 'added',
        en: 'The session Files panel has a new toolbar: create a file or folder at the root, collapse the whole tree, and reload it.',
        vi: 'Bảng Files trong phiên có thanh công cụ mới: tạo file hoặc thư mục ở gốc, thu gọn toàn bộ cây, và tải lại.',
      },
      {
        kind: 'fixed',
        en: 'Pasted text is no longer duplicated in the workspace terminal.',
        vi: 'Văn bản dán không còn bị nhân đôi trong terminal của workspace.',
      },
      {
        kind: 'fixed',
        en: 'Clicking a file link in a chat message now opens it in the preview — including non-ASCII filenames — instead of failing with “Page not found”.',
        vi: 'Nhấp vào liên kết file trong tin nhắn chat giờ mở nó trong bản xem trước — kể cả tên file không phải ASCII — thay vì báo lỗi “Không tìm thấy trang”.',
      },
    ],
  },
  {
    version: '0.23.1',
    date: '2026-07-03',
    highlight: {
      en: 'Chat now renders LaTeX math and draws Mermaid diagrams live as they stream in, and the /compact command reliably shrinks any conversation — with the context gauge dropping the moment it’s done.',
      vi: 'Cửa sổ chat giờ hiển thị công thức LaTeX và vẽ sơ đồ Mermaid ngay khi nội dung đang truyền về, và lệnh /compact rút gọn hội thoại đáng tin cậy trên mọi nhà cung cấp — với đồng hồ ngữ cảnh giảm ngay lúc nén xong.',
    },
    items: [
      {
        kind: 'added',
        en: 'Chat renders LaTeX math: inline $…$, block $$…$$, and ```latex / ```tex code blocks now show as typeset equations, right in the conversation and the preview. Works fully offline.',
        vi: 'Chat hiển thị công thức LaTeX: $…$ trong dòng, $$…$$ dạng khối, và khối mã ```latex / ```tex giờ hiện dưới dạng phương trình sắp chữ, ngay trong cuộc trò chuyện và bản xem trước. Hoạt động hoàn toàn ngoại tuyến.',
      },
      {
        kind: 'improved',
        en: 'Mermaid diagrams now render live while a reply is streaming: each diagram appears the moment its block finishes, instead of waiting for the whole message — with no more flickering parse errors on a half-typed diagram.',
        vi: 'Sơ đồ Mermaid giờ hiển thị ngay khi câu trả lời đang truyền về: mỗi sơ đồ xuất hiện đúng lúc khối của nó hoàn tất, thay vì chờ cả tin nhắn — và không còn lỗi phân tích nhấp nháy trên sơ đồ mới gõ dở.',
      },
      {
        kind: 'fixed',
        en: 'The /compact command now reliably shrinks the conversation on every provider — it previously often reported “nothing to compact” on Claude. The context gauge drops immediately once compaction lands, and you get clear feedback: compacted, nothing to compact, or failed.',
        vi: 'Lệnh /compact giờ rút gọn hội thoại đáng tin cậy trên mọi nhà cung cấp — trước đây thường báo “không có gì để nén” trên Claude. Đồng hồ ngữ cảnh giảm ngay khi nén xong, và bạn nhận phản hồi rõ ràng: đã nén, không có gì để nén, hoặc thất bại.',
      },
      {
        kind: 'improved',
        en: 'Session list: each session’s status now shows as a colored chip on the right of its row, making it easier to scan running, waiting, done, and error states at a glance.',
        vi: 'Danh sách phiên: trạng thái mỗi phiên giờ hiện dưới dạng chip màu ở bên phải hàng, giúp dễ quét nhanh các trạng thái đang chạy, đang chờ, xong và lỗi.',
      },
    ],
  },
  {
    version: '0.23.0',
    date: '2026-07-02',
    highlight: {
      en: 'Claude (Anthropic) sessions and tasks now run on Anthropic’s first-party agent engine for more dependable tool use — it does the work instead of just describing it — with native plan mode and subagents; other providers are unchanged. Plus a one-click “View file” on file steps, and a steadier usage card that keeps your last readings when the server is busy.',
      vi: 'Phiên và tác vụ dùng Claude (Anthropic) giờ chạy trên engine tác nhân chính hãng của Anthropic để dùng công cụ đáng tin cậy hơn — làm thật thay vì chỉ mô tả — kèm chế độ lập kế hoạch và tác nhân phụ gốc; các nhà cung cấp khác giữ nguyên. Thêm nút “Xem file” một chạm trên các bước thao tác file, và thẻ mức dùng ổn định hơn khi máy chủ bận.',
    },
    items: [
      {
        kind: 'improved',
        en: 'Claude (Anthropic) sessions and tasks now run on Anthropic’s first-party agent engine, giving more reliable tool use — the assistant carries out actions instead of just describing them — along with native plan mode, subagents, and conversation compaction. Sessions on other providers (OpenAI, Google, custom) are unchanged.',
        vi: 'Phiên và tác vụ dùng Claude (Anthropic) giờ chạy trên engine tác nhân chính hãng của Anthropic, giúp dùng công cụ đáng tin cậy hơn — trợ lý thực thi hành động thay vì chỉ mô tả — cùng chế độ lập kế hoạch, tác nhân phụ và nén hội thoại gốc. Phiên trên các nhà cung cấp khác (OpenAI, Google, tùy chỉnh) giữ nguyên.',
      },
      {
        kind: 'added',
        en: 'Sessions: a “View file” button on each file step (read, edit, write, create) opens the file it touched in a full-window preview — without expanding the step or leaving the conversation.',
        vi: 'Phiên: nút “Xem file” trên mỗi bước thao tác file (đọc, sửa, ghi, tạo) mở file đó trong khung xem toàn màn hình — không cần mở rộng bước hay rời khỏi cuộc trò chuyện.',
      },
      {
        kind: 'fixed',
        en: 'Usage: the rate-limit card no longer disappears when the usage service is briefly busy (rate-limited). It keeps showing your last readings with a small note instead of blanking out as if you had no quota.',
        vi: 'Mức dùng: thẻ giới hạn tốc độ không còn biến mất khi dịch vụ mức dùng tạm thời bận (bị giới hạn tốc độ). Nó tiếp tục hiển thị số liệu gần nhất kèm một ghi chú nhỏ, thay vì trống trơn như thể bạn không có hạn mức.',
      },
    ],
  },
  {
    version: '0.22.8',
    date: '2026-06-30',
    highlight: {
      en: 'A terminal you can open from the status bar on any screen — no session required — plus VSCode-style project tabs on the Sessions screen to keep sessions organized by project.',
      vi: 'Một cửa sổ terminal mở được từ thanh trạng thái trên mọi màn hình — không cần phiên nào — cùng các tab dự án kiểu VSCode trên màn hình Phiên để sắp xếp phiên theo dự án.',
    },
    items: [
      {
        kind: 'added',
        en: 'Terminal: open a terminal dock from the status bar on any screen. It works even without an open session, starts in your home folder, and keeps your shell alive as you switch pages or close and reopen the dock. Drag its top edge to resize.',
        vi: 'Terminal: mở khung terminal từ thanh trạng thái trên mọi màn hình. Nó hoạt động ngay cả khi không có phiên nào đang mở, khởi động ở thư mục home của bạn, và giữ shell sống khi bạn chuyển trang hoặc đóng rồi mở lại khung. Kéo mép trên để đổi kích thước.',
      },
      {
        kind: 'added',
        en: 'Sessions: a project tab strip at the top of the Sessions screen — one tab per project — filters the list to that project, and each tab remembers the session you were last viewing.',
        vi: 'Phiên: dải tab dự án ở đầu màn hình Phiên — mỗi dự án một tab — lọc danh sách theo dự án đó, và mỗi tab ghi nhớ phiên bạn xem gần nhất.',
      },
      {
        kind: 'improved',
        en: 'Sessions: right-click a project tab to close it, close others, close tabs to the right, or close all; tabs show a badge when their sessions need your attention.',
        vi: 'Phiên: chuột phải vào tab dự án để đóng tab đó, đóng các tab khác, đóng các tab bên phải, hoặc đóng tất cả; tab hiển thị huy hiệu khi các phiên trong đó cần bạn chú ý.',
      },
    ],
  },
  {
    version: '0.22.7',
    date: '2026-06-30',
    highlight: {
      en: 'Stage individual diff hunks and push with a full-featured dialog (upstream, tags, force-with-lease, clear auth help); sessions gain a live to-do list and no longer get stuck on “Streaming…”; and AWOG can now notify you of new versions and update from inside the app.',
      vi: 'Stage từng hunk trong diff và push với hộp thoại đầy đủ (upstream, tag, force-with-lease, hướng dẫn lỗi xác thực rõ ràng); phiên có thêm danh sách việc cần làm trực tiếp và không còn kẹt ở “Streaming…”; và AWOG giờ có thể báo bạn khi có phiên bản mới và cập nhật ngay trong app.',
    },
    items: [
      {
        kind: 'added',
        en: 'Git: stage or unstage individual hunks straight from the diff viewer, so you can split a file’s changes across commits — with per-hunk and per-file unstage actions.',
        vi: 'Git: stage hoặc unstage từng hunk ngay trong khung xem diff, để tách thay đổi của một file ra nhiều commit — kèm hành động unstage theo từng hunk và từng file.',
      },
      {
        kind: 'added',
        en: 'Git: a new Push dialog lets you choose the target remote and branch, set the upstream on first push, push all tags, and force-push safely (--force-with-lease); a dedicated dialog explains what to do when the remote rejects your credentials.',
        vi: 'Git: hộp thoại Push mới cho phép chọn remote và nhánh đích, đặt upstream ở lần push đầu, push toàn bộ tag, và force-push an toàn (--force-with-lease); một hộp thoại riêng hướng dẫn xử lý khi remote từ chối thông tin đăng nhập.',
      },
      {
        kind: 'added',
        en: 'Git: delete a branch with a confirmation step (and optionally its remote counterpart), and pin the branches you use most to the top of the sidebar.',
        vi: 'Git: xóa nhánh có bước xác nhận (và tùy chọn xóa cả nhánh remote tương ứng), và ghim những nhánh hay dùng lên đầu sidebar.',
      },
      {
        kind: 'added',
        en: 'Sessions: watch the AI’s to-do list update live in a banner while it works, then keep it inline in the transcript once the task is done.',
        vi: 'Phiên: theo dõi danh sách việc cần làm của AI cập nhật trực tiếp trong banner khi đang chạy, rồi giữ lại trong nội dung trò chuyện khi xong việc.',
      },
      {
        kind: 'added',
        en: 'New versions now surface in-app: a banner appears when an update is available, downloads with a progress bar, and prompts a restart to install — plus a “Check now” button in Settings → About.',
        vi: 'Phiên bản mới giờ hiện ngay trong app: banner xuất hiện khi có cập nhật, tải về kèm thanh tiến trình, và nhắc khởi động lại để cài — kèm nút “Check now” trong Settings → About.',
      },
      {
        kind: 'fixed',
        en: 'Fixed chats occasionally getting stuck showing “Streaming…” after a turn had actually finished — AWOG now detects the stall and finalizes the message.',
        vi: 'Sửa lỗi cuộc trò chuyện thỉnh thoảng kẹt ở “Streaming…” dù lượt đã thực sự kết thúc — AWOG giờ phát hiện tình trạng treo và hoàn tất tin nhắn.',
      },
      {
        kind: 'improved',
        en: 'More reliable when delegating: if the AI ends a turn claiming it did work (ran a command, reviewed code, delegated a task) without actually doing it, AWOG nudges it to do the work for real in the same turn instead of fabricating the result.',
        vi: 'Đáng tin cậy hơn khi ủy thác: nếu AI kết thúc lượt mà nói đã làm việc gì đó (chạy lệnh, review code, giao việc) nhưng thực ra chưa làm, AWOG sẽ nhắc nó làm thật ngay trong lượt đó thay vì bịa ra kết quả.',
      },
      {
        kind: 'improved',
        en: 'Pinned-context notes you reuse are now saved as presets with recent history, so you don’t have to retype the same guidance in every session.',
        vi: 'Ghi chú trong ngữ cảnh được ghim mà bạn hay dùng nay được lưu thành preset kèm lịch sử gần đây, nên bạn không phải gõ lại cùng một hướng dẫn ở mỗi phiên.',
      },
    ],
  },
  {
    version: '0.22.6',
    date: '2026-06-29',
    highlight: {
      en: 'Drop a folder into a chat to make it the session’s working directory; Git gains remote management and one-click repository init; the usage quota now tracks your account’s 5-hour limit; and the context meter is fixed to match what the model actually sees.',
      vi: 'Kéo một thư mục vào cuộc trò chuyện để biến nó thành thư mục làm việc của phiên; Git có thêm quản lý remote và khởi tạo kho một chạm; hạn mức sử dụng nay theo giới hạn 5 giờ của tài khoản; và thước đo ngữ cảnh được sửa để khớp đúng những gì model thực sự thấy.',
    },
    items: [
      {
        kind: 'added',
        en: 'Folder as working directory: drag a folder into a chat and the AI reads, explores, and edits files inside it. The choice sticks across restarts and a file tree opens in the preview.',
        vi: 'Thư mục làm thư mục làm việc: kéo một thư mục vào cuộc trò chuyện và AI đọc, khám phá, chỉnh sửa các file bên trong. Lựa chọn này được giữ qua các lần khởi động lại và cây file mở trong khung xem trước.',
      },
      {
        kind: 'added',
        en: 'Git remotes & init: add or edit remote URLs, create a branch (choosing its starting point) or a tag, and initialize a Git repository right from the Git screen — including setting your commit name and email when none exists.',
        vi: 'Git remote & khởi tạo: thêm hoặc sửa URL remote, tạo nhánh (chọn điểm bắt đầu) hoặc tag, và khởi tạo kho Git ngay trong màn Git — kèm đặt tên và email commit khi chưa có.',
      },
      {
        kind: 'improved',
        en: 'Git sync feedback: fetch, pull, and push now show live progress and a clear result ("Pulled 3 commits", "Already up to date"), and the repository picker gains a project search box.',
        vi: 'Phản hồi đồng bộ Git: fetch, pull và push giờ hiện tiến trình trực tiếp và kết quả rõ ràng ("Đã pull 3 commit", "Đã cập nhật"), và bộ chọn kho có thêm ô tìm kiếm dự án.',
      },
      {
        kind: 'changed',
        en: 'Usage quota now tracks your account’s 5-hour usage limit instead of the conversation context window: warn, stop running sessions, or block new sessions and messages as an account nears its limit.',
        vi: 'Hạn mức sử dụng nay theo giới hạn 5 giờ của tài khoản thay vì cửa sổ ngữ cảnh của cuộc trò chuyện: cảnh báo, dừng các phiên đang chạy, hoặc chặn phiên và tin nhắn mới khi tài khoản sắp đạt giới hạn.',
      },
      {
        kind: 'fixed',
        en: 'Context meter accuracy: it now reflects what the model actually sees (like /context), so it no longer overshoots past 100% or shows a phantom "Other" slice — the breakdown adds up to the gauge.',
        vi: 'Độ chính xác thước đo ngữ cảnh: giờ phản ánh đúng những gì model thực sự thấy (như /context), nên không còn vượt quá 100% hay hiện lát "Khác" ảo — bảng chi tiết cộng lại đúng bằng thước đo.',
      },
      {
        kind: 'improved',
        en: 'Faster long lists: Sessions, Library, and Projects load in batches with a "Load more" control instead of rendering everything at once.',
        vi: 'Danh sách dài nhanh hơn: Sessions, Thư viện và Dự án tải theo từng đợt với nút "Tải thêm" thay vì hiển thị tất cả cùng lúc.',
      },
      {
        kind: 'added',
        en: 'Open any chat message full-screen, and a new "Accept Edits" composer mode alongside Ask / Plan / Execute.',
        vi: 'Mở toàn màn hình bất kỳ tin nhắn nào trong cuộc trò chuyện, và chế độ soạn thảo "Accept Edits" mới bên cạnh Ask / Plan / Execute.',
      },
      {
        kind: 'added',
        en: 'Per-project session defaults can preselect which MCP connections new sessions in that project start with.',
        vi: 'Mặc định phiên theo từng dự án có thể chọn sẵn những kết nối MCP mà phiên mới trong dự án đó khởi đầu.',
      },
    ],
  },
  {
    version: '0.22.5',
    date: '2026-06-29',
    highlight: {
      en: 'A guided first run: a quick setup wizard gets you to a working app (connect an account, open a project), then a spotlight tour shows you around the interface — replayable any time from ⌘K or Settings. Plus a Git commit-identity editor and smarter GitHub account handling.',
      vi: 'Lần đầu mở app được dẫn dắt: wizard cài đặt nhanh đưa bạn tới trạng thái dùng được (kết nối tài khoản, mở dự án), rồi tour giao diện chỉ cho bạn từng chỗ — chạy lại bất cứ lúc nào từ ⌘K hoặc Settings. Kèm trình sửa danh tính commit Git và quản lý tài khoản GitHub thông minh hơn.',
    },
    items: [
      {
        kind: 'added',
        en: 'First-run setup wizard: a few skippable steps (connect an account, set theme & language, open your first project) get a fresh install to a usable state — existing setups are detected and never interrupted.',
        vi: 'Wizard cài đặt lần đầu: vài bước có thể bỏ qua (kết nối tài khoản, chọn theme & ngôn ngữ, mở dự án đầu tiên) đưa bản cài mới tới trạng thái dùng được — bản đã cấu hình sẵn được nhận diện và không bị làm phiền.',
      },
      {
        kind: 'added',
        en: 'Interface tour: a spotlight highlights the real UI step by step (navigation, the New button, ⌘K, Settings…). Replay it any time from the Command Palette or Settings → About.',
        vi: 'Tour giao diện: spotlight làm nổi bật UI thật theo từng bước (thanh điều hướng, nút New, ⌘K, Settings…). Chạy lại bất cứ lúc nào từ Command Palette hoặc Settings → About.',
      },
      {
        kind: 'added',
        en: 'Git commit-identity editor: set your commit name and email — globally or for the current repo — from the Git screen, without dropping to the terminal.',
        vi: 'Trình sửa danh tính commit Git: đặt tên và email commit — phạm vi toàn cục hoặc riêng repo hiện tại — ngay trong màn Git, khỏi cần mở terminal.',
      },
      {
        kind: 'added',
        en: 'Default GitHub account in Settings → Git that every project inherits, with a per-project override that shows which account "inherit" resolves to.',
        vi: 'Tài khoản GitHub mặc định trong Settings → Git mà mọi dự án kế thừa, kèm tùy chọn ghi đè theo từng dự án và hiển thị "kế thừa" đang trỏ tới tài khoản nào.',
      },
      {
        kind: 'improved',
        en: 'When the GitHub CLI is missing or not signed in, the Issues/PRs view now guides you: an install button with an OS-specific command, or a one-click copy of `gh auth login` plus a link to the sign-in guide.',
        vi: 'Khi GitHub CLI chưa cài hoặc chưa đăng nhập, màn Issues/PRs giờ hướng dẫn: nút cài kèm lệnh theo từng hệ điều hành, hoặc sao chép một chạm `gh auth login` cùng liên kết tới hướng dẫn đăng nhập.',
      },
      {
        kind: 'improved',
        en: 'Git screen: right-click a folder to stage / unstage / discard / ignore everything under it, switching branches with uncommitted changes offers to stash them first, and failed Git actions now show a clear message instead of failing silently.',
        vi: 'Màn Git: chuột phải vào thư mục để stage / unstage / discard / ignore toàn bộ bên trong, đổi nhánh khi còn thay đổi chưa commit sẽ hỏi stash trước, và thao tác Git lỗi giờ hiện thông báo rõ ràng thay vì lỗi âm thầm.',
      },
    ],
  },
  {
    version: '0.22.4',
    date: '2026-06-28',
    highlight: {
      en: 'A status bar now runs along the bottom of the window: switch git branches, watch your context window and plan usage, open a project, and tweak model · account · reasoning effort · style — all from one fixed spot.',
      vi: 'Thanh trạng thái mới chạy dọc đáy cửa sổ: đổi nhánh git, theo dõi cửa sổ ngữ cảnh và hạn mức gói, mở dự án, và chỉnh model · account · mức suy luận · phong cách — tất cả từ một chỗ cố định.',
    },
    items: [
      {
        kind: 'added',
        en: "Global status bar (VSCode-style footer): the active session's git branch with a quick-switch popover, context-window usage, a project opener, the model / account / reasoning-effort / response-style chips, and Files / Terminal panel toggles.",
        vi: 'Thanh trạng thái toàn cục (footer kiểu VSCode): nhánh git của session đang mở kèm popover đổi nhánh nhanh, mức dùng cửa sổ ngữ cảnh, nút mở dự án, các chip model / account / mức suy luận / phong cách trả lời, và nút bật/tắt panel Files / Terminal.',
      },
      {
        kind: 'added',
        en: 'Plan-usage donuts: a per-account ring on the status bar shows your 5-hour limit at a glance, with a hover tooltip for the full breakdown (weekly, Opus, Sonnet…).',
        vi: 'Donut hạn mức gói: mỗi tài khoản một vòng tròn trên thanh trạng thái hiển thị giới hạn 5 giờ trong nháy mắt, rê chuột để xem chi tiết đầy đủ (tuần, Opus, Sonnet…).',
      },
      {
        kind: 'changed',
        en: 'Context-window usage and the model / account / effort / style selectors moved out of the chat header and composer into the status bar, so the chat area stays focused on the conversation.',
        vi: 'Mức dùng cửa sổ ngữ cảnh và các bộ chọn model / account / mức suy luận / phong cách được chuyển từ header chat và ô soạn xuống thanh trạng thái, để vùng chat tập trung vào hội thoại.',
      },
    ],
  },
  {
    version: '0.22.3',
    date: '2026-06-28',
    highlight: {
      en: 'Color-code your projects: right-click a project group in the chat list to give its dot a color (or reset it to the default).',
      vi: 'Gán màu cho project: chuột phải vào nhóm project trong danh sách chat để chọn màu cho chấm của nó (hoặc đặt lại mặc định).',
    },
    items: [
      {
        kind: 'added',
        en: 'Per-project dot color: right-click a project group in the chat list and pick a color for its dot from the menu — your choice is remembered, and you can reset it to the neutral default any time.',
        vi: 'Màu chấm theo project: chuột phải vào nhóm project trong danh sách chat và chọn màu cho chấm của nó từ menu — lựa chọn được ghi nhớ, và bạn có thể đặt lại về mặc định trung tính bất cứ lúc nào.',
      },
    ],
  },
  {
    version: '0.22.2',
    date: '2026-06-28',
    highlight: {
      en: 'Chat-surface polish: slash commands show as a compact chip, you can insert into a running turn or queue a follow-up, failed turns offer a one-click retry, and subagents show a summary of what they hand back. Plus auto-generate a chat title, a Git changed-files badge, and a one-click import of .claude/.agents config into .awog.',
      vi: 'Trau chuốt khung chat: lệnh slash hiện gọn dạng chip, có thể chèn vào lượt đang chạy hoặc xếp hàng lượt kế, lượt lỗi cho thử lại một chạm, và subagent hiện tóm tắt phần trả về. Cùng với tự tạo tiêu đề chat, badge số file thay đổi trên nút Git, và import cấu hình .claude/.agents vào .awog chỉ một chạm.',
    },
    items: [
      {
        kind: 'added',
        en: 'Slash commands now appear as a compact `/name args` chip in your message instead of the whole expanded template — the full prompt still goes to the model, and you can hover the chip to see it.',
        vi: 'Lệnh slash giờ hiện dạng chip gọn `/name args` trong tin nhắn thay vì cả mẫu prompt bung ra — prompt đầy đủ vẫn gửi tới model, và bạn rê chuột vào chip để xem.',
      },
      {
        kind: 'added',
        en: 'While a turn is running you can Insert a quick nudge into it (steering) or Queue a follow-up to send automatically when it finishes — pick either from the send button.',
        vi: 'Khi một lượt đang chạy, bạn có thể Chèn một nhắc nhanh vào lượt đó (steering) hoặc Xếp hàng một lượt kế để tự gửi khi lượt hiện tại xong — chọn ở nút gửi.',
      },
      {
        kind: 'added',
        en: 'Auto-generate a chat title: right-click a chat → Auto-generate title to summarize the conversation into a concise name.',
        vi: 'Tự tạo tiêu đề chat: chuột phải vào một chat → Tự tạo tiêu đề để tóm tắt cuộc trò chuyện thành một tên ngắn gọn.',
      },
      {
        kind: 'added',
        en: 'Import existing config: a project with `.claude`/`.agents` config now shows a banner to copy those agents, skills, commands, rules, and hooks into `.awog` in one click (non-destructive — existing entries are skipped).',
        vi: 'Import cấu hình sẵn có: project có cấu hình `.claude`/`.agents` giờ hiện banner để copy các agent, skill, command, rule, hook đó vào `.awog` chỉ một chạm (không phá huỷ — bỏ qua mục đã có).',
      },
      {
        kind: 'added',
        en: 'The Git button on a chat shows a badge with the project’s changed-file count; the cost/budget readout moved into the workspace Info tab.',
        vi: 'Nút Git trên một chat hiện badge số file đang thay đổi của project; phần chi phí/ngân sách chuyển vào tab Info của workspace.',
      },
      {
        kind: 'improved',
        en: 'A subagent (delegated task) now shows a Summary of the report it returns to the main agent, under its nested steps.',
        vi: 'Một subagent (việc được uỷ thác) giờ hiện phần Tóm tắt báo cáo mà nó trả về cho agent chính, ngay dưới các bước con.',
      },
      {
        kind: 'fixed',
        en: 'A failed turn now shows the error message with a one-click Retry instead of a silent empty reply.',
        vi: 'Lượt bị lỗi giờ hiện thông báo lỗi kèm nút Thử lại một chạm thay vì một phản hồi trống lặng lẽ.',
      },
      {
        kind: 'fixed',
        en: 'Right-click menus (Git files, sessions) no longer overflow off-screen — they flip up near the bottom edge and scroll when very tall.',
        vi: 'Menu chuột phải (file Git, session) không còn tràn ra ngoài màn hình — tự lật lên khi gần mép dưới và cuộn được khi quá dài.',
      },
      {
        kind: 'fixed',
        en: 'The inline “rename chat” field is now readable in dark mode (was white-on-white).',
        vi: 'Ô “đổi tên chat” inline giờ đọc được ở chế độ tối (trước bị trắng trên trắng).',
      },
    ],
  },
  {
    version: '0.22.1',
    date: '2026-06-28',
    highlight: {
      en: 'Git Manager polish: right-click any commit for branch / tag / cherry-pick / revert / reset actions, browse a commit’s changes in a two-pane file ↔ diff view, and discarding now asks first. Plus the Git Manager opens cleanly from a chat, and assistant replies no longer duplicate around a step.',
      vi: 'Trau chuốt Git Manager: chuột phải vào commit để branch / tag / cherry-pick / revert / reset, xem thay đổi của commit ở khung 2 cột file ↔ diff, và discard giờ hỏi xác nhận trước. Cùng với việc mở Git Manager gọn gàng từ một chat, và phản hồi của trợ lý không còn bị lặp quanh một bước.',
    },
    items: [
      {
        kind: 'added',
        en: 'Right-click a commit in history for a full action menu: checkout, create a branch or tag here, cherry-pick, revert, reset (soft / mixed / hard), save as patch, and copy the SHA or message — destructive actions ask for confirmation first.',
        vi: 'Chuột phải vào một commit trong lịch sử để mở menu thao tác đầy đủ: checkout, tạo nhánh hoặc tag tại đây, cherry-pick, revert, reset (soft / mixed / hard), lưu thành patch, và copy SHA hoặc nội dung — các thao tác phá huỷ sẽ hỏi xác nhận trước.',
      },
      {
        kind: 'improved',
        en: 'A commit’s changes now open in a two-pane view — the changed-file list on the left, the selected file’s diff on the right — instead of one long stacked column.',
        vi: 'Thay đổi của một commit giờ mở ở khung 2 cột — danh sách file bên trái, diff của file đang chọn bên phải — thay vì một cột dài xếp chồng.',
      },
      {
        kind: 'improved',
        en: 'Discarding a file’s changes (or all changes) now asks for confirmation first, so an accidental click can’t wipe your work.',
        vi: 'Huỷ thay đổi của một file (hoặc tất cả) giờ hỏi xác nhận trước, để một cú bấm nhầm không xoá mất công sức của bạn.',
      },
      {
        kind: 'added',
        en: 'Open the Git Manager directly from a chat’s header to stage, commit, and browse history for that chat’s project.',
        vi: 'Mở Git Manager thẳng từ thanh tiêu đề của một chat để stage, commit và xem lịch sử cho dự án của chat đó.',
      },
      {
        kind: 'fixed',
        en: 'The Git Manager opened from a chat no longer overflows its window — the toolbar and panels fit inside the dialog.',
        vi: 'Git Manager mở từ một chat không còn tràn khỏi cửa sổ — thanh công cụ và các panel vừa khít trong hộp thoại.',
      },
      {
        kind: 'fixed',
        en: 'Assistant replies no longer duplicate or merge together around a step or tool card — each part of a multi-step turn keeps its own text.',
        vi: 'Phản hồi của trợ lý không còn bị lặp hay dính vào nhau quanh một bước hoặc thẻ công cụ — mỗi phần của một lượt nhiều bước giữ đúng nội dung của nó.',
      },
    ],
  },
  {
    version: '0.22.0',
    date: '2026-06-27',
    highlight: {
      en: 'Task workflows now fix themselves: when a review or QA step fails, the engine sends the work back, fixes it, and re-runs — up to a limit you set. Plus per-chat cost tracking with budgets, transcript export, pinned context, a styled system tray, and a fork history view.',
      vi: 'Workflow của task giờ tự sửa: khi một bước review hoặc QA phán lỗi, engine tự đưa việc về sửa rồi chạy lại — tới một trần lặp bạn đặt. Cùng với theo dõi chi phí mỗi chat kèm ngân sách, xuất transcript, ghim ngữ cảnh, khay hệ thống có giao diện, và khung xem lịch sử nhánh.',
    },
    items: [
      {
        kind: 'added',
        en: 'Self-correcting task workflows: a review or QA step can now hand back a pass/fail verdict, and on a fail the task automatically loops back to the earlier step to fix the problem and re-runs — repeating up to a loop limit you set, then pausing for your approval instead of burning tokens forever.',
        vi: 'Workflow task tự sửa lỗi: một bước review hoặc QA giờ có thể đưa ra phán quyết đạt/không đạt, và khi không đạt, task tự quay về bước trước để sửa rồi chạy lại — lặp tới một trần bạn đặt, sau đó dừng chờ bạn duyệt thay vì cháy token vô hạn.',
      },
      {
        kind: 'added',
        en: 'See what a chat costs: token usage is now converted to a running US-dollar cost, and you can set a soft budget per chat that warns you before a long session runs up a bill you did not expect.',
        vi: 'Xem một chat tốn bao nhiêu: lượng token giờ được quy ra chi phí USD chạy dồn, và bạn có thể đặt một ngân sách mềm cho mỗi chat để được cảnh báo trước khi một phiên dài đội chi phí ngoài dự kiến.',
      },
      {
        kind: 'added',
        en: 'Export a chat: save a transcript as Markdown or a self-contained HTML file — copy it to the clipboard or write it to disk — to archive a session, share it for review, or drop it into a PR or issue. Everything renders locally, with no network involved.',
        vi: 'Xuất một chat: lưu transcript thành Markdown hoặc file HTML độc lập — sao chép vào clipboard hoặc ghi ra đĩa — để lưu trữ một phiên, gửi đi review, hay chèn vào PR hoặc issue. Mọi thứ render cục bộ, không qua mạng.',
      },
      {
        kind: 'added',
        en: 'Pin context to a chat: pin files or a note and the agent keeps them in mind on every turn — the middle ground between a one-off attachment and a project-wide rule.',
        vi: 'Ghim ngữ cảnh vào một chat: ghim file hoặc một ghi chú và agent sẽ nhớ chúng ở mọi lượt — điểm trung gian giữa một file đính kèm dùng một lần và một quy tắc toàn dự án.',
      },
      {
        kind: 'added',
        en: 'Fork history: a tree view shows how a chat branched into forks, so you can see and jump between the versions you split off.',
        vi: 'Lịch sử nhánh: khung dạng cây cho thấy một chat đã rẽ thành các nhánh ra sao, để bạn xem và nhảy giữa những phiên bản đã tách.',
      },
      {
        kind: 'improved',
        en: 'The system tray now opens a styled status panel — provider rate limits, today’s usage, what is running, and what needs your attention — with a running-count badge on the icon; click any item to jump straight into the app.',
        vi: 'Khay hệ thống giờ mở một bảng trạng thái có giao diện — giới hạn tốc độ của nhà cung cấp, mức dùng hôm nay, những gì đang chạy, và việc cần bạn xử lý — kèm chỉ báo số đang chạy cạnh icon; bấm vào bất kỳ mục nào để nhảy thẳng vào app.',
      },
      {
        kind: 'improved',
        en: 'The GitHub pull-request view now shows a PR’s commits and per-file diffs, and you can write and post a comment or review right from the drawer.',
        vi: 'Khung pull request GitHub giờ hiển thị các commit và diff từng file của một PR, và bạn có thể viết rồi gửi một comment hoặc review ngay trong khung.',
      },
    ],
  },
  {
    version: '0.21.0',
    date: '2026-06-26',
    highlight: {
      en: 'Connect your chats and tasks both ways — kick off a background task from a chat, or open a chat to discuss a task — plus VS Code-quality code highlighting and a richer GitHub issues & PRs view.',
      vi: 'Liên kết hai chiều giữa chat và task — khởi chạy một task chạy nền từ chat, hoặc mở một chat để bàn về một task — cùng tô màu code chất lượng như VS Code và khung xem issue & PR GitHub phong phú hơn.',
    },
    items: [
      {
        kind: 'added',
        en: 'Run a chat as a task: a “Run as task” button in the composer spins up a background task from your conversation — and the agent can start one itself (with your approval) while you keep chatting.',
        vi: 'Chạy một chat thành task: nút “Run as task” trong ô soạn khởi tạo một task chạy nền từ cuộc trò chuyện — và agent cũng có thể tự khởi chạy một task (sau khi bạn cho phép) trong khi bạn tiếp tục trò chuyện.',
      },
      {
        kind: 'added',
        en: 'Discuss a task in a chat: open a session straight from a task to talk through its results — the task’s status and per-phase output stay in the conversation’s context as it runs.',
        vi: 'Bàn về một task trong chat: mở một phiên ngay từ một task để trao đổi về kết quả của nó — trạng thái và output từng phase của task được giữ trong ngữ cảnh hội thoại khi task đang chạy.',
      },
      {
        kind: 'improved',
        en: 'Code blocks now use VS Code-quality syntax highlighting across chat, file previews, the library, and the editor, following the app’s light/dark theme — and shell commands without a language tag are no longer mis-highlighted as SQL.',
        vi: 'Code block giờ dùng tô màu cú pháp chất lượng như VS Code trong chat, khung xem file, thư viện và editor, bám theo theme sáng/tối của app — và lệnh shell không khai báo ngôn ngữ không còn bị tô nhầm thành SQL.',
      },
      {
        kind: 'improved',
        en: 'GitHub issues & PRs: the pull-request drawer now shows changed files and reviews (approved, changes requested, and more), you can start a new session seeded from an issue or PR, expand the drawer to fullscreen, and load more items.',
        vi: 'Issue & PR GitHub: khung pull request giờ hiển thị các file đã đổi và review (approved, changes requested, …), bạn có thể mở một phiên mới với nội dung gợi sẵn từ một issue hoặc PR, phóng khung lên toàn màn hình, và tải thêm mục.',
      },
      {
        kind: 'improved',
        en: 'The session composer tucks mode, model, account, and response style into a single “Config” menu to keep the input bar uncluttered.',
        vi: 'Ô soạn của phiên gom chế độ, model, account và phong cách trả lời vào một menu “Config” duy nhất để thanh nhập gọn gàng hơn.',
      },
      {
        kind: 'improved',
        en: 'The interface now adapts to narrow windows: below a certain width the navigation rail and the list column slide into drawers you toggle from the top bar, giving the chat or detail view the full width.',
        vi: 'Giao diện giờ thích ứng với cửa sổ hẹp: dưới một độ rộng nhất định, thanh điều hướng và cột danh sách thu vào ngăn kéo bật/tắt từ thanh trên, nhường toàn bộ chiều rộng cho khung chat hoặc chi tiết.',
      },
      {
        kind: 'added',
        en: 'Deleting a session — or several selected at once — now asks you to confirm first.',
        vi: 'Xóa một phiên — hoặc nhiều phiên đã chọn cùng lúc — giờ sẽ hỏi xác nhận trước.',
      },
    ],
  },
  {
    version: '0.20.0',
    date: '2026-06-26',
    highlight: {
      en: 'A completely rebuilt interface, a Home dashboard that shows your guild at a glance, a new Activity page with token usage and estimated cost, and a richer file preview with editor themes and one-tap file actions.',
      vi: 'Giao diện được dựng lại hoàn toàn, một Home dashboard nhìn tổng quan cả guild trong một màn, trang Activity mới thống kê token và chi phí ước lượng, cùng khung xem file phong phú hơn với theme editor và thao tác file chỉ một chạm.',
    },
    items: [
      {
        kind: 'changed',
        en: 'Rebuilt interface: the entire desktop app has been rebuilt on a new design — a cleaner, faster layout across every page.',
        vi: 'Giao diện dựng lại: toàn bộ app desktop được dựng lại trên một thiết kế mới — bố cục gọn và nhanh hơn trên mọi trang.',
      },
      {
        kind: 'added',
        en: 'Home dashboard: an at-a-glance control tower showing what needs your attention (replies & approvals), what’s running, today’s token activity, Git status, your agents, connections, and recent sessions — all updating live.',
        vi: 'Home dashboard: một bảng điều khiển nhìn-một-phát hiển thị việc cần bạn xử lý (trả lời & phê duyệt), thứ đang chạy, hoạt động token hôm nay, trạng thái Git, agent, connection và session gần đây — tất cả cập nhật trực tiếp.',
      },
      {
        kind: 'added',
        en: 'Activity page: see your token usage and estimated cost over time (1d / 7d / 30d / 90d / all), broken down by model and by account, alongside a provider rate-limit panel. Set or override model prices in Settings; usage rolls up per day so long ranges stay fast.',
        vi: 'Trang Activity: xem lượng token dùng và chi phí ước lượng theo thời gian (1d / 7d / 30d / 90d / tất cả), bóc tách theo model và theo account, cạnh panel rate-limit của nhà cung cấp. Khai hoặc ghi đè giá model ở Settings; usage được gộp theo ngày nên khoảng thời gian dài vẫn nhanh.',
      },
      {
        kind: 'added',
        en: 'File preview: pick a code-editor theme — “Follow app” or one of ~16 curated themes (Dracula, Nord, Night Owl, Monokai, and more) — and act on the file right from the preview: edit & save, rename, move, delete, copy path, open in Finder or browser, or add it to a chat.',
        vi: 'Khung xem file: chọn theme cho code editor — “Theo app” hoặc một trong ~16 theme tuyển chọn (Dracula, Nord, Night Owl, Monokai…) — và thao tác file ngay trong khung xem: sửa & lưu, đổi tên, di chuyển, xóa, sao chép đường dẫn, mở trong Finder hoặc trình duyệt, hoặc thêm vào một cuộc trò chuyện.',
      },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-06-23',
    highlight: {
      en: 'Work with GitHub issues and PRs inside AWOG, rewrite a prompt in one tap, and an accurate usage panel that pauses before any surprise charge — plus sessions that open faster and stay reliable.',
      vi: 'Làm việc với issue và PR GitHub ngay trong AWOG, viết lại prompt chỉ với một chạm, và bảng usage chính xác tạm dừng trước mọi khoản phí bất ngờ — cùng các phiên mở nhanh hơn và ổn định hơn.',
    },
    items: [
      {
        kind: 'added',
        en: 'GitHub issues & pull requests: list, open, and create a project’s issues and PRs directly inside AWOG (via the gh CLI) without leaving the app.',
        vi: 'Issue & pull request GitHub: xem, mở và tạo issue/PR của một dự án ngay trong AWOG (qua gh CLI) mà không cần rời khỏi app.',
      },
      {
        kind: 'added',
        en: 'Enhance prompt: a one-tap button in the composer rewrites your draft into a clearer, more complete prompt before you send it.',
        vi: 'Tinh chỉnh prompt: một nút trong ô soạn viết lại bản nháp thành prompt rõ ràng, đầy đủ hơn trước khi gửi.',
      },
      {
        kind: 'added',
        en: 'Rules can now be scoped to file globs, so a rule is only added to the conversation when the turn touches a matching path — rules without a glob still always apply.',
        vi: 'Rule giờ có thể giới hạn theo glob đường dẫn, nên chỉ được thêm vào cuộc trò chuyện khi lượt nói chạm tới path khớp — rule không có glob vẫn luôn áp dụng.',
      },
      {
        kind: 'improved',
        en: 'The usage panel now reflects the exact account the next turn will use and itemizes the context window (system / tools / history) like Claude Code. If a turn would spill into paid extra usage, the chat pauses and asks you to confirm first, while headless tasks fail safely instead of silently spending.',
        vi: 'Bảng usage giờ phản ánh đúng tài khoản mà lượt kế tiếp sẽ dùng và bóc tách cửa sổ ngữ cảnh (system / tools / history) như Claude Code. Nếu một lượt sắp dùng tới extra-usage tính phí, chat sẽ tạm dừng và hỏi xác nhận trước, còn task chạy ngầm sẽ dừng an toàn thay vì âm thầm tiêu tiền.',
      },
      {
        kind: 'improved',
        en: 'Sessions load lazily: AWOG no longer pulls every message of every session into memory at startup, so the app opens faster and a session’s transcript loads only when you open it.',
        vi: 'Phiên được nạp lười: AWOG không còn kéo toàn bộ tin nhắn của mọi phiên vào bộ nhớ khi khởi động, nên app mở nhanh hơn và nội dung một phiên chỉ nạp khi bạn mở nó.',
      },
      {
        kind: 'fixed',
        en: 'Fixed a long turn growing a session’s file to gigabytes and making the session vanish from the list — transcripts are now written incrementally and loaded by streaming, so large sessions stay fast and reliable.',
        vi: 'Sửa lỗi một lượt dài làm file phiên phình tới hàng gigabyte và khiến phiên biến mất khỏi danh sách — nội dung giờ được ghi tăng dần và nạp theo luồng, nên phiên lớn vẫn nhanh và ổn định.',
      },
      {
        kind: 'fixed',
        en: 'Stateful MCP servers (like a Playwright browser) now keep their state across tool calls within a session — navigating, then taking a snapshot or clicking, all share the same browser instead of a fresh one each call, and pressing Stop no longer closes it.',
        vi: 'MCP server có trạng thái (như trình duyệt Playwright) giờ giữ nguyên trạng thái qua các lần gọi tool trong cùng phiên — điều hướng rồi chụp snapshot hay click đều dùng chung một trình duyệt thay vì tạo mới mỗi lần, và nhấn Dừng cũng không còn đóng nó.',
      },
      {
        kind: 'fixed',
        en: 'Fixed custom tools whose names start with “mcp_” triggering an “out of extra usage” error on Claude subscription accounts.',
        vi: 'Sửa lỗi các custom tool có tên bắt đầu bằng “mcp_” gây lỗi “out of extra usage” trên tài khoản Claude subscription.',
      },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-06-18',
    highlight: {
      en: 'Open several workspace panels at once and dock them beside the chat, plus a refreshed interface.',
      vi: 'Mở nhiều bảng workspace cùng lúc và ghim cạnh khung chat, cùng giao diện làm mới.',
    },
    items: [
      {
        kind: 'added',
        en: 'Multi-tab workspace panel: open Files, Terminal, Diff, and the other tools side by side and switch between them with a tab strip — opening Terminal no longer closes Files, and each tab stays alive (the terminal keeps running) while hidden.',
        vi: 'Bảng workspace đa tab: mở Files, Terminal, Diff và các công cụ khác cùng lúc rồi chuyển qua lại bằng thanh tab — mở Terminal không còn đóng Files, và mỗi tab vẫn sống (terminal vẫn chạy) khi bị ẩn.',
      },
      {
        kind: 'changed',
        en: 'Session Info is now a tab in the same workspace panel instead of a separate floating panel, so it can sit alongside Files, Terminal, and the rest.',
        vi: 'Session Info giờ là một tab trong cùng bảng workspace thay vì panel nổi riêng, nên có thể mở cạnh Files, Terminal và các tab khác.',
      },
      {
        kind: 'changed',
        en: 'The workspace panel is now a split pane that docks beside the chat and pushes it aside (right, left, or bottom) instead of floating on top — the chat always keeps a readable minimum width.',
        vi: 'Bảng workspace giờ là split pane ghim cạnh khung chat và đẩy chat sang bên (phải, trái hoặc dưới) thay vì nổi đè lên — chat luôn giữ một độ rộng tối thiểu để đọc được.',
      },
      {
        kind: 'improved',
        en: 'When the chat column is narrow, the session header and the model chip shrink to an ellipsis instead of wrapping onto extra lines.',
        vi: 'Khi cột chat hẹp, header của phiên và chip model co lại bằng dấu “…” thay vì xuống thêm dòng.',
      },
      {
        kind: 'changed',
        en: "The agent's todo checklist is now a single panel pinned above the composer instead of inline in each reply — it stays visible while you scroll a long reply, keeps updating across cancel/resume, and hides itself when there are no todos or all are done.",
        vi: 'Checklist todo của agent giờ là một panel ghim trên ô soạn thay vì nằm trong từng câu trả lời — luôn thấy khi cuộn câu trả lời dài, vẫn cập nhật sau khi hủy rồi tiếp tục, và tự ẩn khi không có todo hoặc đã xong hết.',
      },
      {
        kind: 'changed',
        en: 'Refreshed interface for Git, modals, and drawers, rebuilt on a new shadcn-style component set (cards, badges, inputs, menus) with the Geist typeface.',
        vi: 'Giao diện làm mới cho Git, modal và drawer, dựng lại trên bộ component kiểu shadcn (card, badge, input, menu) cùng phông chữ Geist.',
      },
      {
        kind: 'fixed',
        en: 'Staging or unstaging many files at once (stage-all, a folder) is now a single batched operation, so it no longer intermittently fails with a “workspace busy” / index.lock error.',
        vi: 'Stage hoặc unstage nhiều file cùng lúc (stage-all, theo thư mục) giờ gộp thành một thao tác, nên không còn thỉnh thoảng lỗi “workspace busy” / index.lock.',
      },
    ],
  },
  {
    version: '0.17.0',
    date: '2026-06-18',
    highlight: {
      en: 'Sessions auto-compact before they run out of context, /compact now really frees up context with a summary you can read, response styles, and per-project model defaults.',
      vi: 'Phiên tự động tóm tắt trước khi cạn ngữ cảnh, /compact giờ thực sự giải phóng ngữ cảnh kèm bản tóm tắt xem được, thêm phong cách trả lời, và mặc định model theo từng dự án.',
    },
    items: [
      {
        kind: 'added',
        en: 'Auto-compact: when a session nears its context limit, AWOG summarizes the older turns before the next message so the chat keeps working. Toggle it in Settings → Sessions.',
        vi: 'Tự động tóm tắt: khi một phiên sắp đầy ngữ cảnh, AWOG tóm tắt các lượt cũ trước tin nhắn kế tiếp để cuộc trò chuyện chạy tiếp. Bật/tắt ở Settings → Sessions.',
      },
      {
        kind: 'fixed',
        en: '/compact now actually reduces the context: it summarizes older turns and shows a readable summary marker in the transcript (with a running state and Stop), instead of just printing a note while the context stayed full.',
        vi: '/compact giờ thực sự giảm ngữ cảnh: tóm tắt các lượt cũ và hiện một thẻ tóm tắt xem được trong khung chat (kèm trạng thái đang chạy và nút Dừng), thay vì chỉ in một dòng thông báo mà ngữ cảnh vẫn đầy.',
      },
      {
        kind: 'fixed',
        en: 'The 1M context window no longer collapses to 200k after the first reply — the indicator follows the model you selected.',
        vi: 'Cửa sổ ngữ cảnh 1M không còn tụt về 200k sau câu trả lời đầu tiên — chỉ báo bám theo đúng model bạn chọn.',
      },
      {
        kind: 'added',
        en: 'Response styles for a session: pick a tone/format (or plain text) from the composer chip or with /style — applied to every reply until you change it.',
        vi: 'Phong cách trả lời cho phiên: chọn giọng văn/định dạng (hoặc văn bản thuần) từ chip ở khung soạn hoặc bằng /style — áp dụng cho mọi câu trả lời tới khi bạn đổi.',
      },
      {
        kind: 'added',
        en: 'Per-project LLM defaults: set the default provider/model for a project so new sessions start with the right model.',
        vi: 'Mặc định LLM theo dự án: đặt provider/model mặc định cho một dự án để phiên mới khởi tạo đúng model.',
      },
    ],
  },
  {
    version: '0.16.1',
    date: '2026-06-17',
    highlight: {
      en: 'The Git diff is readable again — syntax-highlighted code instead of same-hue text on tint — and new files now show their contents.',
      vi: 'Diff trong Git đọc được trở lại — code có tô màu cú pháp thay vì chữ trùng tông với nền — và file mới giờ hiển thị đầy đủ nội dung.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Git diff colors: code lines were colored text over a same-hue tint (green-on-green, red-on-red) and hard to read. Code now uses the normal foreground with syntax highlighting; only the +/- markers carry the add/delete color.',
        vi: 'Màu diff trong Git: dòng code trước đây là chữ màu trên nền cùng tông (xanh trên xanh, đỏ trên đỏ) nên khó đọc. Code giờ dùng màu chữ thường kèm tô màu cú pháp; chỉ dấu +/- mang màu thêm/xóa.',
      },
      {
        kind: 'fixed',
        en: 'New (untracked) files showed “No changes” in the diff view; they now render their full contents as added lines.',
        vi: 'File mới (chưa theo dõi) trước đây hiện “No changes” ở khung diff; giờ hiển thị toàn bộ nội dung dưới dạng dòng được thêm.',
      },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-06-17',
    highlight: {
      en: 'Settings now save to a file and survive restarts, a tidier Settings layout, a plan-usage warning, and optional co-authored commits.',
      vi: 'Cài đặt giờ được lưu ra file và giữ qua khởi động lại, bố cục Settings gọn hơn, cảnh báo mức dùng gói, và tùy chọn commit ghi đồng tác giả.',
    },
    items: [
      {
        kind: 'added',
        en: 'Settings persist to a file (~/.awog/settings.json): theme mode, session defaults, and every preference now survive a reload and an app restart — and the file can be inspected or backed up.',
        vi: 'Cài đặt được lưu ra file (~/.awog/settings.json): chế độ theme, mặc định phiên và mọi tùy chọn giờ giữ nguyên qua reload và khởi động lại — file có thể xem hoặc sao lưu.',
      },
      {
        kind: 'changed',
        en: 'Settings reorganized: the crowded Workspace section is split into clear Workspace, Git, and Sessions sections.',
        vi: 'Sắp xếp lại Settings: mục Workspace lộn xộn được tách thành Workspace, Git và Sessions rõ ràng.',
      },
      {
        kind: 'added',
        en: 'Plan-usage warning: a banner and notification when your provider plan crosses a usage threshold, with optional auto-stop of running sessions and blocking of new ones.',
        vi: 'Cảnh báo mức dùng gói: banner và thông báo khi gói nhà cung cấp vượt ngưỡng sử dụng, kèm tùy chọn tự dừng phiên đang chạy và chặn tạo phiên mới.',
      },
      {
        kind: 'added',
        en: 'Co-authored commits: an optional “Co-Authored-By: AWOG” trailer on commits AWOG makes (toggle in Settings → Git).',
        vi: 'Commit ghi đồng tác giả: tùy chọn thêm trailer “Co-Authored-By: AWOG” vào commit do AWOG tạo (bật ở Settings → Git).',
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-06-17',
    highlight: {
      en: 'A redesigned interface, an embedded browser tool, parallel subagents, and clearer error handling.',
      vi: 'Giao diện được thiết kế lại, công cụ trình duyệt nhúng, subagent chạy song song, và xử lý lỗi rõ ràng hơn.',
    },
    items: [
      {
        kind: 'changed',
        en: 'Refreshed interface: a new design system with an emerald theme and a floating-card layout.',
        vi: 'Giao diện làm mới: hệ design system mới với theme emerald và bố cục thẻ nổi.',
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
        kind: 'improved',
        en: 'Parallel subagents: multiple Task subagents spawned in one turn now run concurrently instead of one after another.',
        vi: 'Subagent song song: nhiều subagent Task được tạo trong cùng một lượt giờ chạy đồng thời thay vì lần lượt.',
      },
      {
        kind: 'improved',
        en: 'Edit step details now show the change as a git-style diff (split or unified), with a toggle to view the full file content — the same viewer used for reads/writes.',
        vi: 'Chi tiết bước Edit giờ hiện thay đổi dưới dạng diff kiểu git (split hoặc unified), kèm nút chuyển sang xem toàn bộ nội dung file — cùng trình xem dùng cho đọc/ghi.',
      },
      {
        kind: 'added',
        en: 'Failed responses now show a clear error alert with the cause and a Retry button — instead of an empty or finished-looking reply.',
        vi: 'Phản hồi lỗi giờ hiện cảnh báo rõ ràng kèm nguyên nhân và nút Thử lại — thay vì một câu trả lời trống hoặc trông như đã xong.',
      },
      {
        kind: 'added',
        en: 'Full-screen markdown preview gets a content-width toggle (comfortable, wide, or full) so wide diagrams and tables can use the whole screen.',
        vi: 'Xem markdown toàn màn hình có thêm nút chỉnh độ rộng (vừa, rộng, hoặc full) để sơ đồ và bảng lớn dùng được cả màn hình.',
      },
      {
        kind: 'fixed',
        en: 'File links opened from chat that over-qualify the path now still open, and a failed file read shows the cause instead of a blank pane.',
        vi: 'Link file mở từ chat bị dư đường dẫn giờ vẫn mở được, và lỗi đọc file hiện nguyên nhân thay vì pane trống.',
      },
      {
        kind: 'fixed',
        en: 'Git auto-commit is serialized per workspace and recovers automatically from a stale lock file.',
        vi: 'Git auto-commit được tuần tự hoá theo workspace và tự phục hồi khi gặp file khoá cũ.',
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-06-16',
    highlight: {
      en: 'Steer a running response or queue messages, plus Git branch operations — merge, rebase, and open pull requests.',
      vi: 'Chèn vào phản hồi đang chạy hoặc xếp hàng tin nhắn, cùng thao tác nhánh Git — merge, rebase và mở pull request.',
    },
    items: [
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
