# Office preview — xem `.docx` / `.xlsx` trong PreviewModal

> Trạng thái: Implemented (ui-next). Mở rộng [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue)
> thêm 2 kind mới: **`doc`** (Word `.docx`) và **`sheet`** (Excel `.xlsx`).
> Liên quan: [preview-modal-actions](preview-modal-actions.md) (theme picker + 9 file action),
> [workspace-panel](workspace-panel.md) (nguồn preview file: tab Files/Diff), [minimize-dock](minimize-dock.md).

## Bối cảnh

Repo/project thực tế có tài liệu `.docx` (spec, brief khách gửi) và `.xlsx` (bảng số
liệu, checklist). Trước đây mở chúng trong AWOG rơi vào nhánh `fs.readFile` → cờ
`isBinary` → placeholder *"Binary file — open externally to view"*. Người dùng phải
rời app để đọc một file mà cả session đang bàn về nó.

Yêu cầu: đọc được nội dung **ngay trong app** (một modal preview dùng chung — xem
[memory rule "1 modal preview file chung"]), giữ nguyên các file action đã có, và
cho phép đẩy nội dung vào chat làm context.

## Quyết định: parser tự viết, KHÔNG thêm dependency

`.docx`/`.xlsx` đều là **ZIP chứa các part XML** (OOXML). Chromium trong Electron đã
cấp đủ nguyên liệu:

- `DecompressionStream('deflate-raw')` → inflate (ZIP chỉ dùng method 0 = stored và
  8 = deflate cho OOXML).
- `DOMParser` → parse XML part (không resolve external entity ⇒ không XXE, không
  thực thi script).

Nên không cần `jszip`/`mammoth`/`SheetJS`. Điều này tôn trọng rule *"không thêm
dependency mới khi chưa có ADR"* trong [CLAUDE.md](../../CLAUDE.md), và tránh kéo một
thư viện office (vài trăm KB) vào bundle renderer chỉ để đọc file.

**Đánh đổi (có ý thức):** đây là **model để ĐỌC**, không phải render đúng layout.
Không có: phân trang, header/footer, footnote, text box (`w:txbxContent`), ảnh trong
ô table, chart, conditional format, màu cell, pivot, `.doc`/`.xls` nhị phân cũ, file
có mật khẩu. Với các trường hợp đó, đường đi đúng-đắn-tuyệt-đối vẫn là
**"Open in browser / Reveal"** (mở bằng Word/Excel/Numbers).

## Kiến trúc

| File | Vai trò |
|---|---|
| [utils/office-zip.ts](../../apps/desktop/ui-next/utils/office-zip.ts) | ZIP reader tối thiểu: đọc central directory 1 lần, inflate từng part **lazy** (workbook 40 sheet chỉ giải nén sheet đang xem). Hỗ trợ ZIP64. `base64ToBytes` / `bytesToBase64`. |
| [utils/office-xml.ts](../../apps/desktop/ui-next/utils/office-xml.ts) | Helper XML **bỏ qua prefix namespace** (WordprocessingML dùng `w:p`, SpreadsheetML dùng `row` không prefix; producer tự chọn prefix) → mọi lookup đi qua `localName`. Parse `_rels/*.rels`, resolve part path. |
| [utils/office-docx.ts](../../apps/desktop/ui-next/utils/office-docx.ts) | `parseDocx(bytes) → DocxDoc`: heading (qua `styles.xml`, có đi theo `basedOn`), bold/italic/underline/strike/sup/sub/mono, hyperlink external, list (marker từ `numbering.xml`: decimal/letter/roman/bullet + counter theo level), table (`gridSpan`), ảnh nhúng (DrawingML + VML) → data URL. `docxPlainText()` cho copy/add-to-chat. |
| [utils/office-xlsx.ts](../../apps/desktop/ui-next/utils/office-xlsx.ts) | `parseXlsx(bytes) → XlsxBook`: nhiều sheet, `sharedStrings` (bỏ `rPh` phonetic), inline string, boolean/error, **number format** đủ để date serial không hiện ra `45000` và percent không hiện `0.42`, merge cell, độ rộng cột. `sheetToTsv()` cho copy/add-to-chat. |
| [composables/useOfficePreview.ts](../../apps/desktop/ui-next/composables/useOfficePreview.ts) | State office: model đã parse, sheet đang chọn, cửa sổ dòng đang vẽ, span của merge, projection text. Không IPC — nhận bytes từ caller. |
| [components/common/OfficeDocView.vue](../../apps/desktop/ui-next/components/common/OfficeDocView.vue) + [OfficeDocPara.vue](../../apps/desktop/ui-next/components/common/OfficeDocPara.vue) | Render block model thành cột đọc (max 880px, cùng cảm giác với markdown render). |
| [components/common/OfficeSheetView.vue](../../apps/desktop/ui-next/components/common/OfficeSheetView.vue) | Grid: header cột A/B/C + số dòng **sticky**, ô số canh phải, merge qua `rowspan`/`colspan`, tab sheet ở đáy. |

`usePreviewModal` chỉ thêm 1 nhánh load (đọc base64 → `office.parse`) + 3 cờ view
(`showOfficeDoc` / `showOfficeSheet` / `officeEmpty`); toàn bộ state office nằm ở
composable riêng để controller không phình thêm.

**SoC / bảo mật:** model là **dữ liệu có cấu trúc**, render bằng template Vue thường
→ **không `v-html`**, không cần sanitizer trong đường đi. Bytes vẫn đi qua sidecar
`fs.readFileBase64` (gate `assertInsideWorkspace` — invariant #2), UI không `import fs`.

## Hành vi

### Nhận diện kind

`previewKindFromPath()` (single source of truth): `.docx|.docm|.dotx` → `doc`;
`.xlsx|.xlsm|.xltx` → `sheet`. `.doc`/`.xls` nhị phân cũ **cố ý** không map — chúng
tiếp tục rơi vào placeholder "binary → open externally" vì không parse được.

### Nguồn bytes

| Nguồn | Đường đi |
|---|---|
| File trong workspace (tab Files, tab Diff, link file trong chat, project code workspace) | `fs.readFileBase64` (mặc định cap 10 MB) → parse |
| SFTP (SSH Manager) | `ssh.sftp.read` → data URL → `fetch` → parse |
| Attachment kéo-thả vào composer | **Ngoài phạm vi**: file office kéo vào chat đi theo `path` reference (không nạp bytes vào renderer), nên chip của nó vẫn là "no inline preview". Khi nào có `src` thì nhánh in-memory đã sẵn sàng dùng. |

### Toolbar + action

- Toàn bộ 9 file action cũ (reveal / open in browser / copy path / rename / move /
  delete) hoạt động nguyên vẹn vì chỉ phụ thuộc `hasWorkspaceFile`.
- **Copy**: `doc` → copy text đã trích; `sheet` → copy sheet đang xem dạng **TSV**
  (dán trực tiếp vào Excel/Sheets được).
- **Add to chat**: đẩy cùng projection text đó vào composer (cắt theo
  `ATTACHMENT_TEXT_MAX`) — đây là cách đưa một `.docx` spec vào ngữ cảnh model.
- Không có nhánh edit/save: office là **read-only** (ghi lại OOXML là việc khác hoàn toàn).

### Giới hạn (fail-safe, có báo cho người dùng)

| Giới hạn | Giá trị | Khi vượt |
|---|---|---|
| Kích thước file | 10 MB (`fs.readFileBase64`) | `sessions.preview.tooLarge` |
| Block trong docx | 6.000 | banner `common.preview.officeTruncated` |
| Ảnh nhúng docx | 60 ảnh, 4 MB/ảnh | ảnh vượt bị bỏ qua |
| Sheet / dòng / cột | 30 / 5.000 / 200 | banner `officeTruncated` |
| Dòng vẽ mỗi lần | 200 (+200 mỗi lần bấm) | nút "Show more rows" |

Parse thất bại (file hỏng, có mật khẩu, `.doc` đổi tên thành `.docx`) → status
`officeError` + **giữ toolbar** để "open externally" vẫn trong 1 cú click.

## Kiểm chứng

`pnpm typecheck` + `pnpm lint` sạch. Logic parser được chạy qua harness (dựng ZIP
docx/xlsx thật, cả entry stored và deflate) kiểm: heading/format inline/hyperlink,
marker list lồng (`1.` → `a.`), `w:ins` được nhận và `w:del` bị bỏ, table `gridSpan`,
ảnh → data URL + width từ EMU, sharedStrings + rich text, date serial `45000` →
`2023-03-15`, percent `0.4237` → `42.37%`, dòng thưa, merge span, TSV, và từ chối
input không phải ZIP.

## Việc còn để mở

- Outline (TOC) cho `.docx` theo heading, dùng lại pattern của markdown render.
- `.pptx` (cùng cơ chế ZIP + XML, khác part) nếu có nhu cầu thật.
- Attachment kéo-thả: nạp bytes cho file office nếu muốn preview trước khi gửi
  (cân nhắc cost persist base64 vào JSONL).
