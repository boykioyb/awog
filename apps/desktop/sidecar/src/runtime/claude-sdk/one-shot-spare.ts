// Một tiến trình Claude CLI "dự phòng" (spare) cho one-shot văn bản thuần (ADR 0099).
//
// Cold `query()` trả phí khởi động CLI (~1,5s lần đầu, ~0,55s các lần sau) trước khi
// prompt được gửi. `prewarm()` làm phần đó TRƯỚC, đậu tiến trình ở trạng thái chờ; lượt
// one-shot sau chỉ việc `claim()`. Đo trên haiku, 5 lượt: cold 2838ms → claim 1941ms.
//
// Hợp đồng của SDK: mọi option "host-level" (env gồm token, executable, settingSources,
// tools, systemPrompt, maxTurns, thinking, effort…) bị ĐÓNG BĂNG lúc prewarm; chỉ cwd /
// model / appendSystemPrompt / permissionMode… mới đặt được lúc claim. Vì vậy:
//   - Spare được khoá theo CREDENTIAL (token/api key/baseURL): đổi tài khoản hoặc token
//     được refresh ⇒ spare cũ bị đóng, lượt này chạy cold, spare mới prewarm theo key mới.
//   - Chỉ MỘT spare tại một thời điểm (≈230–260MB khi đậu). Hết `idleMs` không có
//     one-shot nào thì đóng — dùng xong là không tốn gì.
// Pool không biết gì về Options/credential: caller đưa key + options; pool chỉ giữ
// vòng đời. Tiêm `prewarm` để test không cần CLI thật.

import {
  prewarm,
  type Options,
  type SpareProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { log } from "../../util/logger.js";

export const SPARE_IDLE_MS = 10 * 60 * 1000;

export type PrewarmFn = (params: { options: Options }) => Promise<SpareProcess>;

export interface SparePool {
  // Lấy spare khớp `key` (đã/đang khởi động) và rút khỏi pool — spare dùng một lần.
  // Khác key ⇒ đóng spare cũ, trả null. Pool rỗng hoặc prewarm lỗi ⇒ null.
  take(key: string): Promise<SpareProcess | null>;
  // Bảo đảm có một spare cho `key` (prewarm nếu chưa có), và gia hạn đồng hồ nhàn rỗi.
  ensure(key: string, options: Options): void;
  closeAll(reason: string): void;
}

interface Slot {
  key: string;
  ready: Promise<SpareProcess | null>;
}

export function createSparePool(deps: {
  prewarm: PrewarmFn;
  idleMs?: number;
}): SparePool {
  const idleMs = deps.idleMs ?? SPARE_IDLE_MS;
  let slot: Slot | null = null;
  let timer: NodeJS.Timeout | undefined;

  const clearTimer = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  const discard = (s: Slot, reason: string): void => {
    log.info("one-shot spare discarded", { reason });
    void s.ready.then((spare) => spare?.close());
  };

  const armIdle = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      if (slot) {
        discard(slot, "idle");
        slot = null;
      }
    }, idleMs);
    // Timer nhàn rỗi không được giữ sidecar sống.
    timer.unref();
  };

  return {
    async take(key) {
      const s = slot;
      if (!s) return null;
      slot = null;
      clearTimer();
      if (s.key !== key) {
        discard(s, "credential changed");
        return null;
      }
      return s.ready;
    },

    ensure(key, options) {
      if (slot?.key === key) {
        armIdle();
        return;
      }
      if (slot) discard(slot, "credential changed");
      const ready: Promise<SpareProcess | null> = deps
        .prewarm({ options })
        .then(
          (spare) => {
            // Spare chết khi đang đậu ⇒ nhả chỗ để lượt sau prewarm lại thay vì claim xác.
            void spare.exited.then(() => {
              if (slot?.ready === ready) slot = null;
            });
            return spare;
          },
          (err: unknown) => {
            log.warn("one-shot spare prewarm failed", {
              err: err instanceof Error ? err.message : String(err),
            });
            if (slot?.ready === ready) slot = null;
            return null;
          },
        );
      slot = { key, ready };
      armIdle();
    },

    closeAll(reason) {
      clearTimer();
      if (!slot) return;
      discard(slot, reason);
      slot = null;
    },
  };
}

// Pool dùng chung của sidecar. Một tài khoản đang dùng ⇒ một spare.
const oneShotSpares = createSparePool({ prewarm });

export function takeOneShotSpare(key: string): Promise<SpareProcess | null> {
  return oneShotSpares.take(key);
}

export function ensureOneShotSpare(key: string, options: Options): void {
  oneShotSpares.ensure(key, options);
}

// Gọi khi sidecar tắt (index.ts) — và ở afterEach của test.
export function closeAllOneShotSpares(reason: string): void {
  oneShotSpares.closeAll(reason);
}
