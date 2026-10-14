// Hình học của giả lập thiết bị (mobile/tablet/viewport tuỳ ý) trong khung nhúng.
//
// Thuần hàm, không import electron — để test được bằng `node --test`.
//
// VÌ SAO CẦN: `Emulation.setDeviceMetricsOverride` ĐẶT KÍCH THƯỚC VISIBLE của
// renderer = width×height của thiết bị giả (390×844 cho iPhone) bất kể view native
// đang to bao nhiêu. Chromium không cắt vẽ theo bounds của `WebContentsView` nên
// trang vẽ lố ra ngoài rect: cột 390px dính góc trên-trái, cao 844px đè lên dock/
// terminal bên dưới, phần còn lại của rect để trắng (đo trên Electron thật, xem
// docs/features/session-browser-panel.md mục "Giả lập thiết bị").
//
// CÁCH SỬA: cho view CHÍNH LÀ thiết bị — bounds = kích thước thiết bị co lại vừa
// khung (như device-mode của DevTools), đặt giữa khung — và bảo Chromium đừng đổi
// visible size (`dontSetVisibleSize`) mà chỉ co hình bằng `scale`. Phần letterbox
// là DOM của renderer (viewport element có nền theme) lộ ra sau view.

export interface EmuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmuFit {
  // Bounds native của view: nằm TRỌN trong `slot`, căn giữa.
  bounds: EmuRect;
  // Hệ số co của `Emulation.setDeviceMetricsOverride.scale` (≤ 1, không phóng to).
  scale: number;
}

// `slot` = rect renderer cấp; (width, height) = kích thước CSS của thiết bị giả.
// Không phóng to: thiết bị nhỏ hơn khung thì giữ 1:1 và để letterbox. Slot rỗng
// (chưa layout) trả nguyên slot + scale 1 — không có gì để vừa vào.
export function fitEmulation(
  slot: EmuRect,
  width: number,
  height: number,
): EmuFit {
  if (slot.width < 1 || slot.height < 1 || width < 1 || height < 1) {
    return { bounds: { ...slot }, scale: 1 };
  }
  const s = Math.min(1, slot.width / width, slot.height / height);
  const w = Math.max(1, Math.floor(width * s));
  const h = Math.max(1, Math.floor(height * s));
  return {
    bounds: {
      x: slot.x + Math.floor((slot.width - w) / 2),
      y: slot.y + Math.floor((slot.height - h) / 2),
      width: w,
      height: h,
    },
    // Giữ hệ số CHÍNH XÁC (không tính lại từ bounds đã làm tròn xuống): tính lại
    // làm nội dung ngắn hơn view tới ~1px ở trục giới hạn → lộ một vạch trắng ở
    // đáy. Đổi lại trục kia dư < 1px, nằm trong phần letterbox.
    scale: s,
  };
}
