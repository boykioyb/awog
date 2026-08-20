# Desktop pet — nguồn artwork

| Sheet         | Pack                              | Tác giả                            | Nguồn                                                                                                                       | License                                                                                         |
| ------------- | --------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `girl.png`    | Cute Girl - Free Sprites          | pzUH                               | https://opengameart.org/content/cute-girl-free-sprites                                                                      | **CC0 1.0**                                                                                     |
| `chicken.png` | Chicken action set (labelled)     | sinh bằng AI, do chủ repo đặt hàng | tấm gốc `14_23_39 12 thg 8, 2026.png` (một PNG 1536×1024)                                                                   | **Tự tạo** — không ràng buộc phát tán, nên đây là sheet duy nhất _commit được_ ngoài `girl.png` |
| `shiba.png`   | Shiba 15-animation set (labelled) | sinh bằng AI, do chủ repo đặt hàng | [tools/sprite-cutter/assets/shiba-sheet.png](../../../../../tools/sprite-cutter/assets/shiba-sheet.png) (một PNG 1536×1024) | **Tự tạo** — commit được, tấm gốc cũng nằm trong repo nên dựng lại được bằng một lệnh           |
| `dino.png`    | Dino 25-animation set (labelled)  | sinh bằng AI, do chủ repo đặt hàng | [tools/sprite-cutter/assets/dino-sheet.png](../../../../../tools/sprite-cutter/assets/dino-sheet.png) (một PNG 1536×1024)   | **Tự tạo** — thay hẳn pack sticker CraftPix cũ (pack đó cấm phát tán)                           |
| `miku.png`    | Miku 33-animation set (labelled)  | sinh bằng AI, do chủ repo đặt hàng | [tools/sprite-cutter/assets/miku-sheet.png](../../../../../tools/sprite-cutter/assets/miku-sheet.png) (một PNG 1254×1254)   | **Tự tạo** — pet duy nhất không phải con vật                                                    |

Các pack cat/dog/robot/knight **đã gỡ theo yêu cầu**; pack dino sticker (CraftPix, kèm
lớp lửa) thay bằng sheet AI ở bảng trên.
Pack **shiba emote (itch)** và **shibasticker** cũng đã gỡ: `shiba.png` bây giờ là sheet
AI ở trên, và hai pet shiba song song trong gallery là trùng lặp.

> 🚫 **`bichon.png` nằm trong `.gitignore` — cố ý.** License của pack:
> _"can be edited and used in commercial or non-commercial projects, but cannot be resold
> or **distributed to others**"_. Tức là **dùng thì hoàn toàn hợp lệ**, chỉ không được
> phát tán lại file art. Repo này public ⇒ commit PNG lên = phát tán. Nên sheet nằm
> lại trên máy build, không vào git.
>
> Hệ quả cần biết: máy khác clone repo sẽ **không có** pet đó (chọn nó ở Settings
> thì store tự clamp về pet đầu tiên — không vỡ UI). Muốn ship kèm bản release thì
> phải xin phép tác giả trước.

`bichon.png` là **pixel art**: sheet dựng **1:1, không resample** (mọi phép scale không
nguyên đều làm nát lưới pixel) và renderer đặt `image-rendering: pixelated` cho riêng
class đó. Tư thế idle 87×84 vốn đã lọt ô 132×128 nên chỉ cần crop, không cần phóng.

`shiba.png` + `dino.png` + `miku.png` là ba sheet **không cùng số cột** với phần còn lại
(12 frame/hàng thay vì 10/8) và là ba sheet được cắt bằng **công cụ có trong repo** —
[tools/sprite-cutter](../../../../../tools/sprite-cutter/README.md). Renderer nhận chúng
qua class `sheet12` trong [PetSprite.vue](../../components/pet/PetSprite.vue), không phải
qua rule riêng từng pack.

Ghi công ở đây là **tự nguyện**: CC0 không yêu cầu, nhưng repo AWOG là public nên
asset đi kèm source — cần ghi rõ nguồn + license để người đọc repo biết file này
redistribute được (khác với các pack "free" kiểu CraftPix: cấm phát tán file art).

Pack gốc dạng **PNG sequence** vài trăm px mỗi frame. AWOG chỉ dùng 4 state, và số
frame mỗi state **rất khác nhau giữa các pack** (Idle: mèo 10, cô gái 16; Jump: dino 8,
cô gái 30, hiệp sĩ **2**) nên script không hardcode mà xử lý cả ba trường hợp.

## Hai loại pack, hai adapter

| Loại               | Ví dụ                      | Layout nguồn                                                                                                                                                     |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sequence**       | pzUH (girl)                | `Idle (1).png`, `Run (1).png`… mỗi frame một file, cùng canvas                                                                                                   |
| **Labelled sheet** | chicken, shiba, dino, miku | 1 PNG chia **khối có nhãn** (IDLE / CHẠY / NHẢY / NGỦ…), mỗi khối một hàng frame — nguồn tốt nhất cho chuyển động mượt                                           |
| **Sticker sheet**  | (đã gỡ)                    | 1 PNG **nền kem đặc**, ~50 pose rời rạc không thẳng hàng                                                                                                         |
| **Layered kit**    | chibi                      | một PSD, **không có frame chuyển động nào** — chỉ 1 tư thế đứng, nhưng có 11 layer biểu cảm. Đổi mặt theo state; chuyển động do CSS transform tạo (`.is-static`) |
| **Grid**           | bichon                     | một PNG, animation chạy **liên tục theo hàng**, hàng cuối mỗi animation lấp không đầy → phải cắt theo bảng occupancy chứ không giả định hàng đầy                 |

### Labelled sheet — `shiba.png`, cắt bằng tools/sprite-cutter

Sheet duy nhất **không dựng bằng script dùng một lần**: tấm gốc (1536×1024, 15 hàng có
caption, 13–19 pose mỗi hàng) đi qua [tools/sprite-cutter](../../../../../tools/sprite-cutter/README.md),
và cả tool lẫn tấm gốc đều nằm trong repo nên dựng lại là **một lệnh**:

```bash
cd tools/sprite-cutter && python3 -m sprite_cutter assets/shiba-sheet.png \
  --config presets/shiba.yaml --out out/shiba \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/shiba.png
```

| Hàng | State         | Khối nguồn | Vì sao                                      |
| ---- | ------------- | ---------- | ------------------------------------------- |
| 0    | `idle`        | `IDLE`     | xoay người qua lại, chậm                    |
| 1    | `working`     | `RUN`      | đang bận                                    |
| 2    | `awaiting`    | `JUMP`     | nhảy = đập vào mắt từ xa                    |
| 3    | `done`        | `SIT`      | ngồi xuống, xong việc                       |
| 4    | `offline`     | `SLEEP`    | CSS không animate hàng này → chỉ hiện cột 0 |
| 5    | `working-alt` | `WALK`     | cảnh phụ của chạy                           |
| 6    | `idle-alt`    | `ROLL`     | cảnh phụ lúc rảnh                           |

Bốn thứ tấm này dạy ra, đều nằm trong tool nên sheet sau không phải học lại:

1. **Chiếu ngang không tách được hàng.** Cung nhảy của hàng trên thò xuống hàng dưới ⇒
   không có dòng trống nào ở giữa: chiếu cả tấm gộp 15 hàng thành 4. Cách chạy được là
   lấy **thanh caption bên trái làm anchor** (nhận theo _cột các khối cùng chiều cao_,
   không OCR) rồi gán mỗi pose về anchor gần nhất theo tâm Y.
2. **Hiệu ứng phải theo pose, không theo tâm của chính nó.** Giọt nước của hàng SHAKE
   rơi thấp hơn tâm hàng ⇒ gán theo tâm là chúng rơi xuống hàng ROLL và hiện ra thành
   rác lơ lửng. Gán component nhỏ **theo pose gần nhất**, không theo anchor.
3. **Cả 15 hàng đều xiên xuống 5–22px** (generator vẽ hàng hơi chéo). Giữ nguyên độ lệch
   đó là con chó chìm dần rồi bật lại ở mối nối. Chỉ hàng airborne _thật_ mới được giữ
   chuyển động dọc — phân biệt bằng "hai đầu thấp + đủ lâu + mượt", xem `processor/cycle.py`.
4. **Hàng ghi IDLE thực ra là turn-around** (xoay từ mặt trước ra lưng). Loop thẳng là
   giật một nhịp mỗi vòng, nên hàng đó chạy **ping-pong** (tới rồi lui), khai tay trong
   preset — thử tự động dò và không đáng tin trên art AI.

### Labelled sheet — `miku.png`, tấm chia khối dày nhất

33 khối trên một tấm 1254×1254: hai cột dài, **ba dải khối nhỏ** (mỗi dải 3–4 khối nằm
cạnh nhau), một **grid biểu cảm 4×3**, một hàng đạo cụ và một hàng hiệu ứng. Cắt bằng
cùng công cụ, chỉ khác ở chỗ preset có **26 section**:

```bash
cd tools/sprite-cutter && python3 -m sprite_cutter assets/miku-sheet.png \
  --config presets/miku.yaml --out out/miku \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/miku.png
```

| Hàng | State         | Khối nguồn | Vì sao                                      |
| ---- | ------------- | ---------- | ------------------------------------------- |
| 0    | `idle`        | `IDLE`     | đứng thở                                    |
| 1    | `working`     | `RUN`      | đang bận                                    |
| 2    | `awaiting`    | `JUMP`     | nhảy = đập vào mắt từ xa                    |
| 3    | `done`        | `SIT`      | ngồi xuống, xong việc                       |
| 4    | `offline`     | `SLEEP`    | CSS không animate hàng này → chỉ hiện cột 0 |
| 5    | `working-alt` | `WALK`     | cảnh phụ của chạy                           |
| 6    | `idle-alt`    | `DANCE`    | rảnh thì nhảy — có tim bay                  |

Ba thứ tấm này dạy thêm:

1. **Grid không phải hàng.** Khối `EXPRESSIONS` là lưới 4×3 chân dung. Cắt cả lưới trong
   một section là hỏng: bộ tách frame sắp theo X nên ba dòng xen kẽ nhau thành một chuỗi
   vô nghĩa. Mỗi dòng một section.
2. **Caption dính hiệu ứng thì không dò được** — 4/33 caption (`SING`, `SPECIAL`, `ANGRY`,
   `WAVE`) dính vào chính ánh sáng/tia của nó nên không còn là khối đặc. Không cần sửa gì:
   khối một hàng cắt riêng section, không có chip thì rơi về gom cụm theo Y.
3. **Cắt lặp lại trên mảnh vừa cắt.** Khối `DANCE` có ba pose dính liền; khe sạch nhất
   trong đó **không** nằm giữa, nên nhát đầu tách ra 1 + 2 rồi dừng. Cho vòng lặp cắt tiếp
   trên từng mảnh còn quá rộng thì mới đủ 6 frame — và đó cũng là thứ quyết định tỉ lệ cả
   sheet: một ô rộng gấp đôi ép cả pet nhỏ đi 25%.

`WAVE`/`CHEER` hợp vai `idle-alt` hơn `DANCE` về mặt ngữ nghĩa nhưng mỗi khối chỉ có 1–2
pose, phóng lên 12 frame thì đứng hình.

### Labelled sheet — `chicken.png`, tấm duy nhất mọi hàng là animation thật

Tấm gà là **artwork đặt riêng cho pet**: 25 khối có caption, trong đó 9 khối đầu
(IDLE / WALK / RUN / JUMP / FALL / LAND / ATTACK (PECK) / HURT / DIE) là chu kỳ 4–7
frame vẽ đúng thứ tự. Nhờ vậy nó **không phải map ngữ nghĩa gượng** như pack sticker —
nhưng vẫn map theo _hành vi của con gà_, không theo tên animation:

| Hàng | State         | Khối nguồn                | Vì sao                                                        |
| ---- | ------------- | ------------------------- | ------------------------------------------------------------- |
| 0    | `idle`        | `IDLE` (6 → 10 frame)     | thở, đứng yên                                                 |
| 1    | `working`     | `RUN` (6 → 8)             | đang chạy việc                                                |
| 2    | `awaiting`    | `JUMP` (6 → 8)            | nhảy = đập vào mắt, đúng vai trò "cần bạn"                    |
| 3    | `done`        | `SKILL – LAY EGG` (5 → 8) | **đẻ ra quả trứng** = vừa xong một lượt; ăn mừng đúng chất gà |
| 4    | `offline`     | `HURT` frame cuối         | gà nằm bẹp, đọc ra "đang ngủ" ở 45% opacity                   |
| 5    | `working-alt` | `WALK` (7 → 8)            | cảnh phụ của chạy                                             |
| 6    | `idle-alt`    | `ATTACK (PECK)` (5 → 8)   | mổ đất — hành vi rảnh rỗi kinh điển của gà                    |

Bốn thứ phải làm đúng, cả bốn đều đã cắn một lần:

1. **Caption đè lên chính khối của nó.** Cắt từ _dưới_ thanh caption là chặt đúng ngang
   mào con gà ở hàng JUMP (gà bay lên cao hơn baseline caption). Cách đúng: **xoá pixel
   caption khỏi bản làm việc** rồi cho khối bắt đầu từ **mép trên** thanh caption.
2. **Đường chân là bàn chân, không phải mực thấp nhất.** Bóng đổ + bụi vẽ _dưới_ chân
   nên lấy đáy bbox là mỗi hàng một cốt khác nhau → đổi state là gà nhảy vị trí. Lấy
   **đáy của khối mực đặc lớn nhất** (= con gà) làm đường chân và **cắt sạch mọi thứ
   dưới nó** — renderer tự vẽ bóng cho mọi pet, giữ bóng vẽ nữa là bóng đôi.
   Cả khối dùng **một khoảng y chung** nên cú nhảy vẫn nhấc lên thật.
3. **Ranh giới frame phải nằm ở cột trống**, không phải trung điểm giữa hai con gà:
   trung điểm chặt đôi quả trứng nằm giữa, mỗi nửa dính sang một frame. Snap ranh giới
   về **khe không mực gần trung điểm nhất**.
4. **Con gà không bao giờ được cắt; prop thì cắt cả cục hoặc không cắt.** Thứ tự ưu
   tiên là: chốt cửa sổ x sao cho **bbox gà nằm trọn trong ô**, rồi mới dịch ≤14px để
   kéo prop vào; prop nào vẫn không lọt thì **xoá hẳn cùng vầng mờ của nó** (dilate).
   Làm ngược lại (fit cả mực rồi kẹp dịch) đã ăn mất 18px đuôi gà ở hàng `done`.
   Prop phải tách trên **mực đặc (alpha > 200)**: ở ngưỡng thấp, viền mềm của quả trứng
   dính vào viền gà thành một khối, không tách nổi.

**Một tỉ lệ cho toàn sheet** (không phải cho từng hàng như pack sticker cũ): tỉ lệ = min của
ràng buộc "gà nằm trọn ô" trên mọi hàng động → `1.20`. Gà to bằng nhau ở mọi state, vì
pet phình ra lúc bắt đầu chạy thì đọc như bug. Riêng `offline` được **tỉ lệ riêng**
(`1.12`): gà nằm rộng 112px so với 86px lúc đứng, ép cả sheet theo nó là mất ~25% kích
thước gà ở mọi hàng còn lại — mà đó lại là một frame tĩnh ở tư thế riêng, chỗ duy nhất
tỉ lệ lệch không ai thấy.

### Labelled sheet — `dino.png`, sheet nhiều KHỐI chứ không phải nhiều hàng

Cùng công cụ với `shiba.png` nhưng khó hơn ở đúng một điểm: tấm này **không phải một cột
hàng full-width**. Nó là **bốn cột khối** — 8 hàng dài bên trái, 7 khối nữa bên cạnh, ba
khối ở giữa dưới, và bảy khối nhỏ (EAT / HAPPY / CRY / ROAR / SAD / PEE / POOP) lát kín
góc phải dưới. Hai khối nằm cạnh nhau thì **dùng chung dải Y**, nên mọi bộ dò hàng đều
đọc chúng thành một hàng.

Cách giải: `sections` trong [presets/dino.yaml](../../../../../tools/sprite-cutter/presets/dino.yaml)
— mỗi khối một hình chữ nhật, cắt độc lập. Toạ độ lấy từ overlay `--debug`.

```bash
cd tools/sprite-cutter && python3 -m sprite_cutter assets/dino-sheet.png \
  --config presets/dino.yaml --out out/dino \
  --awog-sheet ../../apps/desktop/ui-next/public/pet/dino.png
```

| Hàng | State         | Khối nguồn | Vì sao                                      |
| ---- | ------------- | ---------- | ------------------------------------------- |
| 0    | `idle`        | `IDLE`     | đứng thở                                    |
| 1    | `working`     | `RUN`      | đang bận                                    |
| 2    | `awaiting`    | `JUMP`     | nhảy = đập vào mắt từ xa                    |
| 3    | `done`        | `SIT`      | ngồi xuống, xong việc                       |
| 4    | `offline`     | `SLEEP`    | CSS không animate hàng này → chỉ hiện cột 0 |
| 5    | `working-alt` | `WALK`     | cảnh phụ của chạy                           |
| 6    | `idle-alt`    | `TURN`     | ngó quanh                                   |

Ba thứ tấm này dạy thêm:

1. **Caption đè lên frame đầu của chính nó.** Cắt caption bằng gutter (như tấm shiba) là
   chặt đôi con dino đầu hàng. Nên caption nhận theo **hình dạng** — khối đặc, cao đúng
   một dòng chữ, `area/bbox ≥ 0.85` — chứ không theo vị trí. Nghệ thuật không bao giờ lấp
   đầy bounding box của nó, nên ngưỡng này tách sạch: 15/15 chip ở tấm shiba, 27/28 ở tấm
   dino (cái trượt là `ROAR`, dính vào tia hiệu ứng của chính nó).
2. **Pose xếp cách nhau 2–5px.** Ngưỡng gộp mực 6px (đủ để nối lại cái tai bị tách) nuốt
   trọn cả hàng 12 frame thành **một** component. Hạ xuống 3px là đúng cho cả hai tấm.
3. **Khối dính nhau thật thì cắt theo chu kỳ.** Khi pose chạm nhau (0px), không còn tâm
   nào để đo pitch — lấy **autocorrelation của profile cột**: hàng gồm các pose giống nhau
   là tín hiệu tuần hoàn, độ trễ khớp nhất chính là pitch. Rồi thử số phần lân cận và
   chọn cái có **nhát cắt tệ nhất là nông nhất** — cắt sai thì kiểu gì cũng phải xuyên qua
   một con vật.

**Không dùng `HAPPY` cho `done`** dù khối đó có tim bay: generator vẽ ba pose nhỏ dần
(76px → 46px), mà cả sheet dùng chung một tỉ lệ nên con dino teo lại giữa animation.
Tương tự `SHAKE` không làm `idle-alt`: nước bắn làm khung phình gấp rưỡi.

> Pack **dino sticker (CraftPix)** trước đây đã gỡ. Hai bài học từ nó vẫn còn giá trị nếu
> gặp lại loại sheet đó: nền kem đặc phải **flood-fill từ mép** (thay màu toàn cục là
> thủng bụng con vật, vì bụng nó cũng gần trắng), và **một tỉ lệ cho cả hàng** thay vì ép
> từng frame vừa ô — frame phun lửa dài gấp đôi mà ép riêng thì nhân vật nhấp nháy to nhỏ.

### Bắt buộc: chừa dải trong suốt quanh mỗi ô

Sheet được vẽ qua `background-size` ở nửa kích thước, **rồi** qua `transform: scale()`
của chính pet (100/125/150%). Ở tỉ lệ lẻ, bộ lấy mẫu đọc lố một phần pixel **qua khỏi
biên ô** — ink nằm sát mép sẽ hiện ra thành mảnh vụn của frame bên cạnh, đồng thời
frame hiện tại trông như bị cắt cụt. Đây đúng là lỗi "hiển thị thừa/thiếu".

Nên sau khi dựng **bất kỳ** sheet nào, phải xoá 3px viền mỗi ô. Kiểm bằng cách đếm ô có
bbox chạm mép — phải bằng 0. Trước khi sửa: girl 20 ô, pack sticker cũ 29 ô. `sprite-cutter` làm
việc này sẵn (`processor/alpha.py`), và quan trọng hơn: nó **giữ chỗ cho viền trước khi
chọn tỉ lệ**, chứ không xoá sau — xoá sau là cắt mất mực.

## Cách sinh lại các sheet

Sheet trong thư mục này **không** phải file gốc — chúng được ghép lại:

- **Layout**: 1 hàng = 1 animation, frame trái → phải. Sheet `1320×768`, cell
  `132×128`, 10 cột × **6 hàng**.
  | Hàng | State AWOG | Lấy từ | Frame |
  |---|---|---|---|
  | 0 | `idle` (và `done` — cùng tư thế, đứng yên) | `Idle` | 10 |
  | 1 | `working` | `Run` | 8 |
  | 2 | `awaiting` | `Jump` | 8 |
  | 3 | `offline` | `Dead` (frame cuối — tư thế nằm) | 1 |
  | 4 | `working` **cảnh phụ** | `Walk` → `Slide` → `Run` | 8 |
  | 5 | `idle` **cảnh phụ** | `Walk` → `Slide` → `Jump` | 8 |

  Hai hàng cuối là để **đổi cảnh**: một lượt chạy dài mà lặp mãi một animation thì
  nhìn như treo. Mỗi hàng khai báo **danh sách ưu tiên nguồn** — pack nào không có
  animation đó thì rơi xuống lựa chọn kế; hết lựa chọn thì lặp lại animation chính
  (hàng trùng, không bao giờ để hàng trống).

- **Căn khung**: mọi frame được dán lên **một canvas chung, neo đáy-giữa** (giữ đường
  chân đế cố định) rồi cắt theo **một bounding box hợp nhất dùng chung cho tất cả
  state** — nếu cắt riêng từng state, con vật sẽ nhảy vị trí mỗi lần đổi trạng thái.
- **Chọn frame** — số frame CSS mong đợi mỗi hàng là cố định (`steps(10)` / `steps(8)`):
  | Nguồn có | Xử lý |
  |---|---|
  | đúng bằng số cần | lấy nguyên |
  | **nhiều hơn** (Jump 30 frame) | **lấy mẫu đều khắp chu kỳ** — cắt 8 frame đầu là nửa cú nhảy rồi giật ngược |
  | **ít hơn** (Jump của hiệp sĩ: 2 frame) | **kéo giãn, giữ mỗi frame vài ô** — bỏ trống ô sẽ nháy hình trắng |
- **Kích thước**: cell cao 128px = 2× kích thước hiển thị (~64px) để nét trên màn
  retina; cell rộng cố định 132px để **mọi sheet dùng chung một bộ số CSS** trong
  [PetSprite.vue](../../components/pet/PetSprite.vue).
- **Hướng**: chỉ lấy biến thể **quay phải** (pack của hiệp sĩ có cả trái/phải) — CSS lật
  gương từ mốc đó khi pet đứng ở nửa phải màn hình.
- **Golden Knight** cần một bước chuẩn hoá riêng trước khi chạy script: pack tách thành
  4 zip, thư mục lồng nhau và tên file khác hẳn (`golden knight animation idle
breathing_00001.png`), nên phải copy sang `Idle (n).png` / `Run (n).png` /
  `Jump (n).png` / `Dead (n).png`. Nguồn dùng: idle breathing (12), `Golden Knight walk`
  (18), 2 frame JUMP+FALL, và `died face right with sword` (33 → lấy frame cuối).

Script ghép cho các pack cũ (Python + Pillow) là công cụ dùng một lần, không commit vào
repo — công thức ở trên đủ để dựng lại. **Sheet mới thì dùng
[tools/sprite-cutter](../../../../../tools/sprite-cutter/README.md)**: nó có trong repo,
có test, và tự in ra các số CSS cần dán vào `PetSprite.vue`.

Đổi asset khác chỉ cần giữ đúng ô `132×128` và thứ tự hàng; số cột thì được phép khác
(`shiba.png` dùng 12, các sheet còn lại 10/8) — đổi lại là pack đó phải khai riêng một
khối timing trong `PetSprite.vue`. Không file nào ngoài `PetSprite.vue` biết về hình.
