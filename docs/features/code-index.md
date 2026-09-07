# Chỉ mục mã nguồn (code index)

> Trạng thái: **đã code** (sidecar). Module: [apps/desktop/sidecar/src/codeindex/](../../apps/desktop/sidecar/src/codeindex/) · Tool: [`code_index`](../../apps/desktop/sidecar/src/runtime/tools/code-index-tool.ts) · RPC: `code.index`, `code.query`.

## Vấn đề

Model chỉ có `Grep` (ripgrep) + `Glob`. Với câu hỏi **quan hệ** — "hàm này được gọi từ đâu", "sửa chỗ này thì vỡ những gì", "cái này còn ai dùng không" — grep là công cụ sai:

- Nó khớp **chuỗi**, không khớp **symbol**: `useTheme(` trong repo này khớp 12 file, nhưng 2 trong số đó chỉ nhắc tên trong **chú thích**. Model đọc 12 rồi tự lọc bằng mắt, tốn token và vẫn sai.
- Nó **không lần được cạnh import**: repo dùng NodeNext nên import viết `./store.js` còn file là `store.ts`; ui-next dùng alias `~/`, `@/`; Nuxt **auto-import** thì không có câu lệnh import nào để tìm.
- Nó **im lặng khi sai**. Một byte NUL làm ripgrep coi cả file là nhị phân rồi bỏ qua **không báo gì**: tìm `unwrapMcpToolCall` trả về 0 kết quả dù hàm nằm ngay đó. Grep sai mà im lặng là chế độ hỏng tệ nhất — model kết luận "không ai gọi" rồi xoá.

## Giải pháp

Một chỉ mục nhẹ, dựng **tăng dần**, trả lời đúng ba câu hỏi và không ôm thêm gì:

| Action | Câu hỏi | Trả về |
|---|---|---|
| `define` | Symbol này khai báo ở đâu? | `path:line` + kind + exported + 1 dòng trích |
| `refs` | Ai gọi / dùng nó? | Danh sách `path:line` + 1 dòng trích, kèm nơi khai báo |
| `blast` | Sửa file này thì vỡ gì? | File import trực tiếp · qua nhiều chặng · dùng qua auto-import |
| `status` | Chỉ mục phủ tới đâu? | Số file/khai báo/cạnh, cách liệt kê, độ tươi, dung lượng |

Kết quả **luôn là `path:line` + một dòng ngữ cảnh**, không bao giờ là cả file. Đoạn trích được **đọc lại từ đĩa lúc truy vấn**, không lưu trong chỉ mục — chỉ mục nhỏ đi nhiều lần và đoạn trích không bao giờ cũ hơn file thật.

## Kiến trúc

```
codeindex/
  types.ts     — shape + toàn bộ trần cứng + CODE_INDEX_SCHEMA_VERSION
  mask.ts      — che chuỗi/chú thích/regex, GIỮ NGUYÊN độ dài và số dòng
  parser.ts    — khai báo / import / tham chiếu cho TS · JS · Vue SFC
  resolver.ts  — specifier → file thật (.js→.ts, index/, alias ~ và @)
  build.ts     — liệt kê file, dựng tăng dần theo mtime, ngân sách thời gian
  store.ts     — ~/.awog/codeindex/<repo>-<hash>.json, ghi atomic, validate zod
  query.ts     — define / refs / blast + đọc đoạn trích
```

**Nhà của chỉ mục là `~/.awog/codeindex/`** (ADR 0070: đây là dữ liệu AWOG tự sinh, không phải cấu hình dùng chung với Claude Code CLI). Cố ý **không** nằm trong repo người dùng: chỉ mục là cache dựng lại được, không đáng làm bẩn `git status` của họ. Tên file gồm tên thư mục gốc + băm SHA-1 của đường dẫn tuyệt đối, nên hai repo trùng tên không giẫm lên nhau.

`CODE_INDEX_SCHEMA_VERSION` lệch ⇒ **vứt và dựng lại**, không bao giờ vá tạm. Một chỉ mục nửa hợp lệ trả toạ độ sai mà không ai biết.

### Liệt kê file — tôn trọng `.gitignore`

Dùng đúng cách của [`context/repo-scan.ts`](../../apps/desktop/sidecar/src/context/repo-scan.ts): `git ls-files --cached --others --exclude-standard -z`. Ngoài repo git thì đi bộ có chặn với `SKIP_DIRS` dùng chung, **không theo symlink**, và câu trả lời phải nói rõ ".gitignore was not applied".

### Tăng dần

So `mtimeMs` + `size` với bản ghi cũ. File không đổi ⇒ tái dùng nguyên bản ghi; chỉ file đổi mới bị parse lại. Trên repo AWOG: **881 ms** lần đầu, **106 ms** khi không có gì đổi (xem số đo bên dưới). Hai lời gọi tool cùng lúc trên một root chia nhau **một** lần dựng (`inFlight`), và bản trong RAM sống 10 s (`MEMO_TTL_MS`) trước khi stat lại cả cây.

## Parser — làm được gì, KHÔNG làm được gì

**Cố ý không dùng TypeScript compiler API.** `typescript` có trong devDependencies nhưng kéo nó vào runtime sidecar là quyết định nặng (bundle + một API khổng lồ trên đường nóng của mọi lượt chat) và cần ADR. Đổi lại: che chuỗi/chú thích + regex + đếm ngoặc có giới hạn.

Bước **che** ([mask.ts](../../apps/desktop/sidecar/src/codeindex/mask.ts)) là nền móng. Repo này chứa prompt dài viết bằng template literal, bên trong có ví dụ mã; quét thẳng thì mỗi ví dụ đẻ ra một khai báo ma. Hợp đồng của nó: **chuỗi trả về dài y hệt đầu vào và giữ nguyên mọi `\n`**, nên mọi offset khớp được quy ra đúng `path:line`. Biểu thức `${...}` trong template **không** bị che — đó là mã thật.

### Làm được

- `function` · `class` · `interface` · `type` · `enum` · `const/let/var` ở mọi cấp, kèm cờ `exported` (cả `export { x }` viết rời).
- `const x = () => …` được xếp kind `function` — đó là thứ người ta đi tìm.
- **Phương thức trong class** (kể cả thuộc tính arrow) kèm tên class chứa nó, nhận diện bằng đếm ngoặc ⇒ `if (…)` lồng bên trong không bị nhận nhầm.
- Import mọi dạng: named · default · namespace · side-effect · `import type` · `export … from` · `export *` · `import()` động · `require()`.
- Resolve `./x.js` → `x.ts`, thư mục → `index.ts`, `.vue`, alias `~/` `@/` `~~/` `@@/` bằng **khớp đuôi**; đuôi khớp nhiều file ⇒ **trả null, không đoán** (một cạnh sai tệ hơn một cạnh thiếu).
- **Vue SFC**: chỉ đọc khối `<script>` nhưng giữ đúng số dòng của cả file; thẻ `<PascalCase>` trong `<template>` được ghi làm tham chiếu — đường **duy nhất** thấy được component Nuxt auto-import.
- Tham chiếu = lời gọi `name(` · `new Name(` · thẻ component. Dòng khai báo của chính nó **không** tính là nơi gọi.

### KHÔNG làm được (giới hạn đã biết, nói thẳng trong description của tool)

| Chỗ mù | Hệ quả |
|---|---|
| `const { a, b } = x` (destructuring) | `a`, `b` không có khai báo trong chỉ mục |
| Phương thức của object literal (`{ run() {} }`) | Không thấy — trong đó có handler đăng ký kiểu `register('x', …)` |
| Trùng tên | Hai `handle()` khác nhau bị gộp; chỉ mục **không** phân biệt được |
| Gọi gián tiếp (`fns[k]()`, `obj[name]()`), symbol sinh lúc chạy | Không thấy |
| JSX/TSX | Không hiểu cú pháp thẻ; repo hiện chỉ có 1 file `.tsx` ngoài scope build |
| `tsconfig` `paths` tuỳ biến | Không đọc; alias giải bằng khớp đuôi |
| Tên bị stoplist ở **vị trí thành viên** (`x.map(`, `x.get(`) | Không ghi tham chiếu — nguồn nhiễu lớn nhất, bỏ đi cắt phần lớn dung lượng |

Vì vậy **"refs không thấy gì" nghĩa là "chỉ mục không có bản ghi", KHÔNG phải "không ai gọi"**. Tool nói đúng câu đó trong kết quả và nhắc model xác nhận lại bằng `Grep` trước khi xoá. Đây là điểm thiết kế, không phải lời xin lỗi: một chỉ mục biết mình mù ở đâu thì dùng được, một chỉ mục giả vờ chính xác thì nguy hiểm hơn không có gì.

## Trần cứng

Tất cả khai ở [types.ts](../../apps/desktop/sidecar/src/codeindex/types.ts) — repo lớn không được làm treo sidecar.

| Trần | Giá trị | Vì sao |
|---|---|---|
| `MAX_INDEXED_FILES` | 6 000 | Vượt ⇒ `truncated`, và mọi câu trả lời phải nói rõ chưa phủ hết |
| `MAX_FILE_BYTES` | 512 KB | Nguồn viết tay lớn hơn thế là bất thường |
| `BUILD_DEADLINE_MS` | 20 000 | Chạm ⇒ giữ phần đã làm, lần gọi sau đi tiếp |
| `MAX_REF_NAMES_PER_FILE` | 800 | File sinh tự động có hàng nghìn tên, giá trị không tăng theo |
| `MAX_REF_LINES_PER_NAME` | 40 | Gọi 40 lần trong cùng file thì đã đủ để mở file ra xem |
| `MAX_DECLS_PER_FILE` | 2 000 | |
| `MAX_INDEX_BYTES` (đọc) | 64 MB | Từ chối nạp file chỉ mục hỏng/độc vào heap |
| `MAX_DEF_HITS` / `MAX_REF_HITS` | 30 / 60 | |
| `MAX_BLAST_FILES` / `MAX_BLAST_DEPTH` | 200 / 4 | |
| Ngân sách text trả model | 24 KB (`clampForLlm`) | Thứ làm hỏng một lượt không phải câu hỏi sai mà là câu trả lời quá dài |

**Từ chối lập chỉ mục thư mục nhà.** Session không gắn project chạy với `cwd = homedir`; ở đó "toàn bộ mã nguồn" là hàng trăm nghìn file của mọi repo người dùng từng clone. `ensureIndex` ném lỗi có nội dung dẫn người dùng mở project trước.

## Bảo mật

- Mọi lần đọc đi qua `assertInsideWorkspace` (invariant #2), kể cả lúc đọc đoạn trích trong `query.ts`. Đi bộ **không bao giờ theo symlink**.
- Nội dung file là **L1**. Module chỉ **trích toạ độ** (path/line/tên), không thực thi, không `eval`.
- File chỉ mục đọc lại từ đĩa cũng là **L1** (có thể hỏng, bị sửa tay, hoặc thuộc schema cũ) ⇒ qua **zod** trước khi dùng; bản không hợp lệ bị vứt và dựng lại.
- Ghi **atomic** (tmp + rename) để một lần crash giữa chừng không để lại chỉ mục cụt.
- Không thêm dependency nào.

## Số đo thật trên repo AWOG

Đo ngày 2026-09-07 trên chính repo này (macOS, `HOME` trỏ vào thư mục tạm để không đụng `~/.awog` thật):

```
COLD  881 ms   parsed=1148 reused=0 skipped=8 deadlineHit=false source=git truncated=false
WARM  106 ms   parsed=0    reused=1148
STATS files=1148 decls=24978 refNames=14525 imports=5004
      internalEdges=3645 unresolvedInternal=40 disk=2.68 MB
```

Vài truy vấn mẫu:

| Truy vấn | Kết quả |
|---|---|
| `define unwrapMcpToolCall` | `runtime/tools/mcp-tools.ts:952` — **đúng cái symbol ripgrep bỏ qua im lặng vì byte NUL** |
| `refs unwrapMcpToolCall` | 4 nơi gọi / 2 file (`sessions/step-mapper.ts`, `tasks/trace-mapper.ts`) |
| `define createAwogToolDefinitions` | `runtime/tools/index.ts:177`, 2 nơi gọi |
| `refs assertInsideWorkspace` | 52 nơi gọi / 32 file |
| `refs useTheme` | 10 nơi gọi / 10 file — **chính xác hơn `rg -l "useTheme("`** (12 file), vì 2 file kia chỉ nhắc tên trong chú thích |
| `blast git/path-sanitize.ts` (depth 2) | 32 file import trực tiếp, 17 file qua một chặng nữa |
| `blast composables/useTheme.ts` | 0 cạnh import — nhưng **10 file dùng qua Nuxt auto-import**, thứ đồ thị import không thể thấy |

`unresolvedInternal=40` (≈1 % số import) là các specifier nội bộ không nối được về file — phần lớn là module ảo của Nuxt (`#imports`, `#app`) và alias trỏ ra ngoài tập đã lập chỉ mục.

## Bề mặt

- **Tool `code_index`** — gắn vô điều kiện vào bộ tool built-in ([runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts)), cạnh `Grep`/`Glob`. Chỉ **đọc**, không qua permission hook. Chỉ mục dựng **lười** ở lần gọi đầu tiên, nên model không dùng thì không tốn gì ngoài schema. Vẫn chịu `allowedTools`/`disabledTools` như mọi tool khác.
- **RPC `code.index`** `{ workspaceRoot, force? }` → thống kê. Cho UI/người dùng chủ động làm mới.
- **RPC `code.query`** `{ workspaceRoot, action, symbol?, path?, depth? }` → **dữ liệu có cấu trúc** (không phải text đã render), để UI dựng danh sách bấm được. Việc diễn đạt cho model nằm riêng ở tool.

## Còn thiếu / có thể làm tiếp

- Chưa có UI. Hai RPC đã sẵn sàng cho một panel "Ai gọi cái này" trong Workspace Panel.
- Chưa gắn watcher: chỉ mục làm mới theo mtime lúc truy vấn, không phản ứng tức thì với `*.fs-changed`. Đủ dùng vì lần làm mới chỉ tốn ~100 ms.
- Chưa phân biệt symbol trùng tên. Muốn làm đàng hoàng thì cần scope/resolve kiểu thật ⇒ cần TypeScript compiler API ⇒ **cần ADR**, không làm lén trong task này.
- Chưa index Python/Go/Rust. Cấu trúc `parser.ts` cho phép thêm, nhưng YAGNI cho tới khi có nhu cầu thật.
