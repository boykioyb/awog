import { describe, expect, it, vi } from "vitest";
import { log } from "../logger.js";

// Host chết ⇒ stderr EPIPE. Không có listener thì `emit('error')` ném thành
// uncaughtException, handler EPIPE của index.ts lại `log.warn` ⇒ ghi stderr ⇒ EPIPE…
// vòng vô hạn từng làm sidecar mồ côi đứng 100% CPU (2026-10-13).
describe("logger on a broken stderr", () => {
  it("absorbs the EPIPE and stops writing", () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(() => process.stderr.emit("error", epipe)).not.toThrow();

    const write = vi.spyOn(process.stderr, "write");
    log.warn("after the pipe broke");
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
