# sprite-cutter

Cắt sprite sheet do AI sinh ra thành **từng frame PNG đã căn khung**, kèm preview GIF,
contact sheet, metadata JSON — và (tuỳ chọn) đóng gói thẳng thành **sheet desktop pet của
AWOG**.

Đây là **build tool**, không phải runtime: nó chạy tay khi đổi asset, không nằm trong
Electron/Nuxt và **không thêm dependency nào vào workspace pnpm**.

## Vì sao không cắt bằng lưới đều

Sheet AI sinh ra gần như không bao giờ nằm trên lưới:

- pitch giữa các frame lệch tới 30% trong cùng một hàng;
- hàng thiếu frame (tấm shiba: 13–19 pose mỗi hàng, không hàng nào bằng hàng nào);
- nhân vật không nằm giữa ô, chân không cùng đường;
- hiệu ứng (bụi, giọt nước, chữ Z, vũng nước) là component rời;
- **cung nhảy của hàng trên thò xuống hàng dưới** ⇒ chiếu ngang (projection) gộp 15 hàng
  của tấm shiba thành 4.

Nên pipeline đi theo *mực trên ảnh*, không theo phép chia.

## Cài + chạy

```bash
cd tools/sprite-cutter
pip install -r requirements.txt

# Dựng lại sheet pet của AWOG (đúng lệnh đã tạo public/pet/*.png)
python3 -m sprite_cutter assets/shiba-sheet.png \
  --config presets/shiba.yaml \
  --out out/shiba \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/shiba.png

python3 -m sprite_cutter assets/dino-sheet.png \
  --config presets/dino.yaml \
  --out out/dino \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/dino.png

python3 -m sprite_cutter assets/miku-sheet.png \
  --config presets/miku.yaml \
  --out out/miku \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/miku.png
```

Cờ hay dùng:

| Cờ | Ý nghĩa |
|---|---|
| `--frames N` | ép mọi hàng về N frame (lấy mẫu đều khắp chu kỳ, không cắt cụt) |
| `--fps N` | tốc độ ghi vào `animations.json` + GIF. **FPS ≠ số frame** |
| `--animation walk` | chỉ xuất một hàng (lặp lại được) |
| `--debug` | ghi `debug_detection.png` — overlay box đã nhận, tô màu theo hàng |
| `--dry-run` | chỉ dò và in kết quả, không ghi file |

Sản phẩm trong `--out`:

```text
out/shiba/
├── idle/000.png … 011.png     # mỗi animation một thư mục
├── walk/ · run/ · jump/ · …
├── animations.json            # frames, fps, loop, canvas, baseline, scale
├── debug_detection.png
└── preview/
    ├── idle.gif · idle_contact.png   # GIF đúng fps + contact sheet đánh số frame
    └── preview_all.gif               # mọi animation chạy cạnh nhau
```

## Pipeline

| Bước | Module | Việc |
|---|---|---|
| 1 | `detector/background.py` | Matte: dùng alpha sẵn có → flood-fill từ mép → color distance. **Không bao giờ** xoá theo màu toàn cục (bụng trắng của con chó cùng màu nền). |
| 2 | `detector/rows.py` | Nhận **caption theo hình dạng** (khối đặc, cao một dòng) rồi lấy làm anchor hàng; fallback là gom cụm tâm Y. |
| 3 | `detector/frames.py` | Gộp mực gần nhau → tách pose/hiệu ứng theo diện tích → đo pitch (tâm pose, hoặc **autocorrelation** khi pose dính nhau) → gắn hiệu ứng vào pose gần nhất → **cắt box nuốt nhiều pose** tại cột rỗng nhất. |
| 4 | `processor/normalize.py` | Chuẩn hoá số frame + tính **một tỉ lệ chung cho cả sheet**. |
| 5 | `processor/align.py` + `crop.py` | Neo ngang theo **trọng tâm mực**, neo dọc theo đường chân của chính hàng đó, dán lên canvas cố định. |
| 6 | `processor/cycle.py` | Quyết định `loop`/`pingpong` và `baseline`/`row`. |
| 7 | `quality.py` | Kiểm sau khi xuất: clipping, frame rỗng, trùng frame, lệch baseline, mối nối loop. |
| 8 | `awog/petsheet.py` | Đóng gói sheet pet AWOG (xem dưới). |

### Ba quyết định đáng nhớ

**Neo ngang = trọng tâm mực, không phải tâm bbox.** Chân duỗi ra làm mép bbox nhảy vài
px trong khi trọng tâm gần như đứng yên — đó đúng là kiểu rung ngang khiến chu kỳ đi bộ
trông như say rượu. Hàng có phần thò dài (PEE) thì khai `align_x: bbox`.

**Chuyển động dọc: giữ hay ép về đất?** Ép hết về baseline thì cú nhảy hết là nhảy; giữ
nguyên thì cả sheet phải co lại cho vừa cung nhảy. `processor/cycle.py` phân biệt bằng ba
điều kiện — hai đầu thấp (loại **dốc**: generator vẽ cả hàng xiên xuống, mọi hàng chạm
đất của tấm shiba lệch 5–22px), đủ lâu (loại **gai**: một frame vẽ cao 50px), và mượt.
Chỉ hàng airborne thật mới được giữ, và độ nâng còn bị **nén vào ngân sách** (`lift_budget`)
để một cú nhảy cao không kéo cả sheet nhỏ lại.

**Sheet nhiều KHỐI thì phải khai vùng.** Tấm dino không phải một cột hàng full-width mà
là bốn cột khối; hai khối cạnh nhau dùng chung dải Y nên không bộ dò hàng nào tách được.
`sections` (mỗi phần tử một `crop: [x, y, w, h]` + danh sách `rows` riêng) là câu trả lời;
toạ độ đọc từ overlay `--debug`. Component không nằm **trọn** trong crop thì thuộc về
section khác — nên hai vùng cạnh nhau chồng mép vài px cũng không sao.

Tấm miku đẩy chuyện này tới hạn: **26 section** cho 33 khối, trong đó có một **grid 4×3**
phải cắt thành ba section — mỗi dòng một cái, vì bộ tách frame sắp theo X nên để nguyên
lưới thì ba dòng xen kẽ nhau.

**`pingpong` phải khai tay.** Nhiều hàng của sheet AI thực ra là **turn-around** (xoay từ
mặt trước ra lưng), kể cả hàng ghi IDLE. Loop thẳng ⇒ giật một nhịp mỗi vòng; chạy tới rồi
lui ⇒ mượt. Tự động dò *không* làm được: trên tấm này, chu kỳ đi bộ thật lại có "mối nối"
lớn hơn hàng turn-around, vì generator vẽ lại nhân vật hơi khác ở từng frame. Xem GIF rồi
bật cờ.

## Config (`presets/*.yaml`)

Config **đè** mọi thứ tự động dò. Danh sách `rows` là **theo vị trí** — phần tử thứ *i* mô
tả hàng thứ *i* từ trên xuống (không khớp theo tên: tấm này đặt PEE ở đúng chỗ mà thứ tự
chuẩn gọi là `attack`).

```yaml
fps: 12
frames: 12          # số frame mỗi hàng sau chuẩn hoá
padding: 3
rows:
  - { name: idle, mode: pingpong }
  - { name: walk }
  - { name: jump, lift_budget: 0.3 }
  - { name: pee, align_x: bbox }
  # Bí kíp cuối: đóng đinh toạ độ frame, bỏ qua toàn bộ detector
  - { name: attack, frame_regions: [[0, 0, 128, 128], [128, 0, 128, 128]] }

# Sheet nhiều khối thì thay `rows` bằng `sections` (mỗi khối một crop + rows riêng):
sections:
  - crop: [0, 0, 850, 730]
    rows: [idle, walk, run]
  - crop: [846, 0, 690, 730]
    rows: [attack, hurt, die]
```

| Khoá | Mặc định | Ghi chú |
|---|---|---|
| `frames` | theo `frames` toàn cục | nhiều hơn → lấy mẫu đều; ít hơn → giữ frame lâu hơn |
| `mode` | `loop` | `pingpong` cho hàng chuyển tiếp một chiều |
| `align_x` | `centroid` | `bbox` cho hàng có phần thò dài |
| `align_y` | tự dò | `baseline` ép về đất, `row` giữ chuyển động dọc |
| `lift_budget` | `0.25` | phần chiều cao canvas dành cho chuyển động dọc |
| `y` + `height` | tự dò | ép dải Y của hàng |
| `frame_regions` | – | `[x, y, w, h]` từng frame, đè hết |
| `skip` | `false` | bỏ hàng |

## Phần riêng của AWOG

`--awog-sheet` đóng gói tiếp thành sheet mà [PetSprite.vue](../../apps/desktop/ui-next/components/pet/PetSprite.vue)
đọc được. Pet của AWOG vẽ **hoàn toàn bằng CSS** (`background-position` + `steps()`, không
JS, không rAF), nên một thư mục PNG là vô dụng — renderer đó áp ba ràng buộc:

- **ô cố định 132×128** (gấp đôi cỡ hiển thị 66×64 để nét trên retina);
- **mọi hàng cùng số cột**, vì `steps(n)` viết một lần cho cả pack;
- **một tỉ lệ + một đường chân cho tất cả hàng** — pet đổi state ngay tại chỗ, nhân vật
  đổi cỡ hay nhảy vị trí khi `idle` thành `working` sẽ đọc ra như lỗi.

Ánh xạ state → animation nằm ở `awog.map` trong preset (quyết định sản phẩm, xem
[docs/features/desktop-pet.md](../../docs/features/desktop-pet.md)):

| Hàng | State | shiba | dino | miku | Vì sao |
|---|---|---|---|---|---|
| 0 | `idle` | `idle` | `idle` | `idle` | đứng yên / xoay người, chậm |
| 1 | `working` | `run` | `run` | `run` | đang bận |
| 2 | `awaiting` | `jump` | `jump` | `jump` | phải đập vào mắt từ xa |
| 3 | `done` | `sit` | `sit` | `sit` | ngồi xuống, xong việc |
| 4 | `offline` | `sleep` | `sleep` | `sleep` | CSS chỉ hiện frame 0 |
| 5 | `working-alt` | `walk` | `walk` | `walk` | đổi cảnh giữa lượt chạy dài |
| 6 | `idle-alt` | `roll` | `turn` | `dance` | đổi cảnh khi rảnh |

Chọn khối theo **độ đồng đều**, không theo cái tên nghe hay nhất: khối `HAPPY` của dino có
tim bay nhưng ba pose nhỏ dần (76px → 46px), mà cả sheet dùng chung một tỉ lệ nên con vật
teo lại giữa animation.

CLI in sẵn các số CSS (background-size, `steps(n)`, offset từng hàng) để không phải tính
tay. Ô nào cũng bị xoá **3px viền trong suốt**: sheet được vẽ qua `background-size` nửa cỡ
rồi qua `transform: scale()` của pet, ở tỉ lệ lẻ bộ lấy mẫu đọc lố qua biên ô và mực sát
mép hiện thành mảnh vụn của frame bên cạnh.

## Test

```bash
python3 -m unittest discover -s tests -t .
```
