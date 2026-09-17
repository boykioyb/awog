// Gộp dòng lỗi thô thành thứ đọc được — phần "5 phút qua có lỗi gì" của màn Giám sát.
//
// VÌ SAO PHẢI GỘP. Một service hỏng không sinh ra ba dòng lỗi, nó sinh ra năm trăm
// dòng CÙNG MỘT lỗi. Đổ thẳng chúng lên màn thì ba lỗi KHÁC — thứ đáng đọc nhất —
// bị đẩy khỏi tầm mắt bởi cái lỗi ồn nhất. Đúng cái bẫy mà dải cảnh báo cũ đã mắc
// với 100 chip alarm, chỉ đổi nguồn.
//
// KHOÁ GỘP BỎ ĐI PHẦN THAY ĐỔI GIỮA CÁC LẦN. Hai dòng chỉ khác nhau ở request-id,
// timestamp hay số mili-giây là MỘT lỗi. Chuẩn hoá đi đúng những thứ đó rồi so
// phần còn lại — không phải so nguyên văn (không bao giờ trùng) cũng không phải so
// tiền tố mù (gộp nhầm hai lỗi khác nhau cùng mở đầu bằng tên logger).

/** Một dòng log thô — đúng hình dạng `infra.logs-tail` trả về. */
export type ErrorLine = {
  timestamp: number
  message: string
  logStreamName: string
  eventId: string
}

export type ErrorGroup = {
  /** Khoá gộp (thông điệp đã chuẩn hoá). Dùng làm `:key`, không để hiện ra. */
  key: string
  /** Nguyên văn dòng MỚI NHẤT của nhóm — cái người ta thật sự đọc. */
  sample: string
  count: number
  firstMs: number
  lastMs: number
  /**
   * Số stream khác nhau đã phát lỗi này. Với ECS đây là câu trả lời cho "một task
   * hỏng hay cả cụm hỏng" — và đó là hai sự cố hoàn toàn khác nhau.
   */
  streams: number
}

/** Cắt khoá ở đây: đuôi stack trace đổi theo từng lần, phần đầu mới định danh lỗi. */
const KEY_CHARS = 200

/**
 * Mức log KHÔNG phải lỗi. Khai theo chiều "bình thường" chứ không theo chiều "lỗi":
 * gặp một mức lạ (`SEVERE`, `EMERG`, một chữ tiếng Nhật) thì GIỮ dòng lại. Sai theo
 * hướng hiện thừa còn chữa được bằng mắt; sai theo hướng hiện thiếu thì đọc ra
 * thành "hệ thống khoẻ", và đó là kết luận sai đắt nhất một màn giám sát đưa ra.
 */
const CALM_LEVELS = new Set([
  'INFO',
  'DEBUG',
  'TRACE',
  'NOTICE',
  'VERBOSE',
  'FINE',
  'FINER',
  'FINEST',
])

/** Khoá thường gặp mang mức log trong một dòng JSON. */
const LEVEL_KEYS = ['level', 'severity', 'levelname', 'loglevel', 'log_level'] as const

/**
 * Mức log của một dòng, hoặc `null` khi dòng không tự khai mức.
 *
 * Hai định dạng, và log thật TRỘN CẢ HAI trong cùng một nhóm — đo trên
 * `/ecs/pwpf-dev-apne1-api` 2026-09-17: 502 dòng JSON có `level` nằm lẫn với 498
 * dòng chữ thuần `INFO:     10.x.x.x - "GET /api/v1/health HTTP/1.1" 200 OK`.
 */
export function logLevelOf(message: string): string | null {
  const trimmed = message.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        const bag = parsed as Record<string, unknown>
        for (const key of LEVEL_KEYS) {
          const value = bag[key]
          if (typeof value === 'string' && value) return value.toUpperCase()
        }
      }
    } catch {
      // JSON hỏng (dòng bị cắt giữa chừng) ⇒ thử tiếp nhánh chữ bên dưới.
    }
  }
  // `INFO:`, `[WARN]`, `ERROR -`, `DEBUG |`. Dấu phân cách là BẮT BUỘC: không có nó
  // thì `Traceback (most recent call last):` sẽ bị đọc thành mức `Traceback`.
  const m = /^\[?([A-Za-z]{3,9})\]?\s*[:\-|]/.exec(trimmed)
  return m?.[1] ? m[1].toUpperCase() : null
}

/**
 * Dòng này có thật sự là lỗi không?
 *
 * ⚠ VÌ SAO CẦN, VÀ ĐÂY LÀ LỖI ĐO ĐƯỢC TRÊN DỮ LIỆU THẬT (2026-09-17). Bộ lọc của
 * `filter-log-events` chỉ so CHUỖI CON, nên nó bắt cả những dòng `"level": "INFO"`
 * chỉ vì trong JSON có `"component": "app.exceptions"`. Trên log thật của người
 * dùng, 5/5 dòng khớp đều là INFO — tức là 100% nhiễu. Một danh sách "lỗi gần đây"
 * toàn dòng INFO còn tệ hơn một danh sách rỗng: nó làm người ta đi tìm sự cố không
 * có thật.
 *
 * Lọc Ở ĐÂY chứ không siết bộ lọc gửi lên AWS: `filter-log-events` nhận một pattern
 * duy nhất mỗi lượt, mà log thật trộn JSON với chữ thuần — không pattern nào phủ
 * đúng cả hai. Lọc rộng rồi loại ở nhà là đường duy nhất KHÔNG bỏ sót.
 */
export function isLikelyError(message: string): boolean {
  const level = logLevelOf(message)
  return level === null || !CALM_LEVELS.has(level)
}

/**
 * Bỏ đi những mảnh đổi theo từng lần xảy ra, giữ lại hình dạng của lỗi.
 *
 * Thứ tự CÓ Ý NGHĨA: timestamp và UUID phải đi trước luật số chung, vì sau khi số
 * bị thay thì `2026-09-17T11:30:00` và `a1b2-c3d4` không còn nhận ra được nữa.
 */
export function normalizeErrorMessage(message: string): string {
  return (
    message
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ts>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
      // Chuỗi hex dài = request id, trace id, mã container. Ngưỡng 8 để không nuốt
      // những từ thường gặp viết toàn chữ a–f (`deadbeef` thì đúng là id, `face` thì
      // không), và lookahead ĐÒI ít nhất một chữ a–f để một dãy toàn số dài không rơi
      // vào đây: nếu không thì `12345678` ra `<id>` còn `1234567` ra `<n>`, hai chỗ
      // giữ cùng một loại giá trị mà sinh hai khoá khác nhau.
      .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<id>')
      // KHÔNG có `\b` ở hai đầu — bỏ sót đó là một lỗi THẬT, đo được 2026-09-17:
      // trong `30000ms` không hề có ranh giới từ giữa `0` và `m`, nên luật cũ không
      // khớp gì và mọi dòng "timeout after <số>ms" thành một nhóm riêng, tức là
      // không gộp được gì cả. Hệ quả của việc bỏ `\b`: số dính trong định danh
      // (`s3`, `utf8`) cũng bị thay — vô hại, vì chúng là hằng số nên bị thay giống
      // hệt nhau ở mọi dòng.
      //
      // ⚠ ĐÁNH ĐỔI ĐÃ BIẾT: `HTTP 500` và `HTTP 404` gộp làm một nếu phần còn lại
      // của dòng giống hệt. Chấp nhận, vì hướng sai kia tệ hơn nhiều — giữ nguyên số
      // thì mỗi giá trị độ trễ đẻ ra một nhóm và danh sách trở lại thành log thô.
      .replace(/\d+(?:\.\d+)?/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, KEY_CHARS)
  )
}

/**
 * Gộp và sắp xếp.
 *
 * SẮP THEO LẦN CUỐI XẢY RA, KHÔNG THEO SỐ LƯỢNG. Câu hỏi là "5 phút qua có lỗi gì",
 * nên thứ vừa xảy ra đứng trước; một lỗi ồn nhưng đã dứt từ bốn phút trước không
 * được che mất lỗi vừa nổ ra. Số lượng vẫn hiện ra ngay cạnh để đọc được độ nặng.
 */
export function groupErrorLines(lines: readonly ErrorLine[]): {
  groups: ErrorGroup[]
  /** Số dòng khớp bộ lọc nhưng TỰ KHAI mức bình thường — xem `isLikelyError`. */
  dropped: number
} {
  const byKey = new Map<string, { group: ErrorGroup; streams: Set<string> }>()
  let dropped = 0

  for (const line of lines) {
    if (!isLikelyError(line.message)) {
      dropped += 1
      continue
    }
    const key = normalizeErrorMessage(line.message)
    if (!key) continue
    const found = byKey.get(key)
    if (!found) {
      byKey.set(key, {
        group: {
          key,
          sample: line.message,
          count: 1,
          firstMs: line.timestamp,
          lastMs: line.timestamp,
          streams: 1,
        },
        streams: new Set([line.logStreamName]),
      })
      continue
    }
    found.group.count += 1
    found.streams.add(line.logStreamName)
    found.group.streams = found.streams.size
    if (line.timestamp < found.group.firstMs) found.group.firstMs = line.timestamp
    // Mẫu hiện ra phải là dòng MỚI NHẤT: `filter-log-events` trả mới-nhất-trước,
    // nhưng nhiều nhóm log gộp lại thì thứ tự đó không còn giữ được.
    if (line.timestamp > found.group.lastMs) {
      found.group.lastMs = line.timestamp
      found.group.sample = line.message
    }
  }

  return {
    groups: [...byKey.values()].map((v) => v.group).sort((a, b) => b.lastMs - a.lastMs),
    dropped,
  }
}
