// Userscript trong trình duyệt nhúng (kiểu Tampermonkey `@grant none`): chạy ở PAGE
// WORLD trên trang khớp @match/@include. Sidecar giữ kho + parse (global, mọi
// profile) và đẩy tập đã biên dịch sang đây qua `browser.setUserscripts`.
//
// Đường chính: CDP `Page.addScriptToEvaluateOnNewDocument` — mỗi script một đăng ký
// riêng (lỗi cú pháp của một script không kéo theo script khác), chạy trước script
// của trang ⇒ `document-start` đúng nghĩa. Đăng ký lại khi tập đổi hoặc debugger
// attach lại (DevTools đóng). Đường lùi khi debugger không có: `executeJavaScript`
// ở `dom-ready` cho trang khớp (document-start không còn đúng nghĩa).
//
// Tài liệu: docs/features/browser-userscripts.md

import { randomBytes } from "node:crypto";
import type { WebContents } from "electron";
import {
  buildWrapper,
  isReportMessage,
  matchesRules,
  parseHostScripts,
  parseReport,
  syntaxProblem,
  type HostUserscript,
} from "./browser-userscript-core";
import { engine } from "./engine";
import { log } from "./logger";

const MAX_RAN_PER_TAB = 200;

export type UserscriptTabState = {
  ran: { id: string; name: string; error?: string }[];
  matching: { id: string; name: string; enabled: boolean }[];
};

type TabState = {
  wc: WebContents;
  // Script đã chạy trên trang hiện tại (reset khi điều hướng khác document).
  ran: Map<string, { name: string; error?: string }>;
  // Debugger của ta đang attach trên tab này.
  dbg: boolean;
  // Đăng ký CDP thất bại ⇒ cho đường lùi chạy.
  cdpFailed: boolean;
  cdpIds: string[];
  // Đăng ký CDP đã xong và còn hiệu lực. Nó chỉ áp vào document tạo SAU đó.
  cdpReady: boolean;
  // Document đang tải có được CDP phủ không (chụp lúc điều hướng bắt đầu).
  docCovered: boolean;
  // Vòng đăng ký đang chạy / có thay đổi cần chạy lại sau vòng hiện tại.
  syncing: boolean;
  dirty: boolean;
};

class UserscriptHost {
  // Tag báo cáo ngẫu nhiên theo tiến trình: trang vẫn đọc được (nó thấy console)
  // nên chỉ chống báo cáo giả NGẪU NHIÊN, không phải tường lửa — kết quả chỉ để hiển thị.
  readonly tag = `__awog_userscript_${randomBytes(6).toString("hex")}__`;
  private scripts: HostUserscript[] = [];
  // Lỗi cú pháp theo id: script không đăng ký được, UI cần thấy lý do.
  private syntaxErrors = new Map<string, string>();
  private tabs = new Map<string, TabState>();

  // Thay nguyên tập (sidecar đẩy `browser.setUserscripts` hoặc ta kéo `snapshot`).
  setScripts(raw: unknown): void {
    this.scripts = parseHostScripts(raw);
    this.syntaxErrors.clear();
    for (const s of this.scripts) {
      if (!s.enabled) continue;
      const problem = syntaxProblem(buildWrapper(s, this.tag));
      if (problem) this.syntaxErrors.set(s.id, problem);
    }
    for (const state of this.tabs.values()) this.queueSync(state);
  }

  // Kéo tập từ sidecar: lúc app mở và mỗi lần sidecar khởi động lại (nó có thể đã
  // đẩy hụt khi main chưa sẵn sàng).
  async refresh(): Promise<void> {
    try {
      this.setScripts(await engine.request("userscripts.snapshot", null));
    } catch (err) {
      log.warn("userscripts: snapshot pull failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Vòng đời tab ───────────────────────────────────────────────────────────

  attachTab(tabId: string, wc: WebContents): void {
    const state: TabState = {
      wc,
      ran: new Map(),
      dbg: false,
      cdpFailed: false,
      cdpIds: [],
      cdpReady: false,
      docCovered: false,
      syncing: false,
      dirty: false,
    };
    this.tabs.set(tabId, state);
    wc.once("destroyed", () => this.tabs.delete(tabId));
    wc.debugger.on("detach", () => this.onDebuggerDetached(tabId));
    wc.on("console-message", (_event, _level, message) => {
      const report = parseReport(message, this.tag);
      if (!report || state.ran.size >= MAX_RAN_PER_TAB) return;
      const prev = state.ran.get(report.id);
      if (report.ev === "error")
        state.ran.set(report.id, { name: report.name, error: report.msg });
      else
        state.ran.set(report.id, {
          name: report.name,
          ...(prev?.error ? { error: prev.error } : {}),
        });
    });
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      state.ran.clear();
      // Đăng ký CDP chỉ áp vào document tạo SAU khi nó xong: trang đầu của tab mới
      // (lệnh CDP chỉ được xử lý khi điều hướng đầu đã bắt đầu — đo trên Electron 33)
      // sẽ không được phủ, và phải đi đường lùi.
      state.docCovered = state.dbg && state.cdpReady && !state.cdpFailed;
    });
    wc.on("dom-ready", () => {
      if (state.docCovered) return;
      void this.injectFallback(state);
    });
  }

  // `console-message` của browser.ts phải bỏ qua báo cáo; debugger (re)attach thì đăng ký lại.
  onDebuggerAttached(tabId: string): void {
    const state = this.tabs.get(tabId);
    if (!state) return;
    state.dbg = true;
    state.cdpFailed = false;
    this.queueSync(state);
  }

  // Phiên CDP mất ⇒ các đăng ký của nó mất theo.
  onDebuggerDetached(tabId: string): void {
    const state = this.tabs.get(tabId);
    if (!state) return;
    state.dbg = false;
    state.cdpIds = [];
    state.cdpReady = false;
  }

  // `console-message` của browser.ts phải bỏ qua báo cáo để chúng không lọt vào
  // ring console mà agent đọc.
  isReport(message: string): boolean {
    return isReportMessage(message, this.tag);
  }

  // ── Truy vấn cho menu ⋮ ────────────────────────────────────────────────────

  forTab(tabId: string, url: string): UserscriptTabState {
    const state = this.tabs.get(tabId);
    const ran: UserscriptTabState["ran"] = [];
    const seen = new Set<string>();
    for (const [id, r] of state?.ran ?? []) {
      seen.add(id);
      ran.push({ id, name: r.name, ...(r.error ? { error: r.error } : {}) });
    }
    const matching: UserscriptTabState["matching"] = [];
    for (const s of this.scripts) {
      if (!matchesRules(s.rules, url)) continue;
      matching.push({ id: s.id, name: s.meta.name, enabled: s.enabled });
      const syntax = this.syntaxErrors.get(s.id);
      if (syntax && s.enabled && !seen.has(s.id))
        ran.push({ id: s.id, name: s.meta.name, error: syntax });
    }
    return { ran, matching };
  }

  // ── Đăng ký ────────────────────────────────────────────────────────────────

  private enabledScripts(): HostUserscript[] {
    return this.scripts.filter(
      (s) => s.enabled && s.source !== "" && !this.syntaxErrors.has(s.id),
    );
  }

  // Chạy NGAY (đồng bộ tới `await` đầu tiên) khi không có vòng nào đang chạy.
  private queueSync(state: TabState): void {
    state.dirty = true;
    if (state.syncing) return;
    state.syncing = true;
    void this.drain(state);
  }

  private async drain(state: TabState): Promise<void> {
    try {
      while (state.dirty) {
        state.dirty = false;
        await this.sync(state);
      }
    } catch (err) {
      log.warn("userscripts: sync failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      state.syncing = false;
    }
  }

  // Mọi lệnh được gửi trong MỘT loạt đồng bộ (CDP xử lý theo thứ tự) rồi mới chờ:
  // chờ từng lệnh một nhân độ trễ lên N lần và để các script cuối chưa kịp đăng ký
  // khi trang đầu tiên đã bắt đầu tải.
  private async sync(state: TabState): Promise<void> {
    if (!state.dbg || state.wc.isDestroyed()) return;
    const dbg = state.wc.debugger;
    const stale = state.cdpIds;
    state.cdpIds = [];
    state.cdpReady = false;
    try {
      // `addScriptToEvaluateOnNewDocument` chỉ có hiệu lực khi domain Page đã bật (đo trên Electron 33).
      const enable = dbg.sendCommand("Page.enable");
      const removals = stale.map((identifier) =>
        dbg
          .sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
            identifier,
          })
          .catch(() => undefined),
      );
      const adds = this.enabledScripts().map((s) =>
        dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
          source: buildWrapper(s, this.tag),
        }),
      );
      const [, , ...results] = (await Promise.all([
        enable,
        Promise.all(removals),
        ...adds,
      ])) as [unknown, unknown, ...{ identifier?: unknown }[]];
      for (const res of results)
        if (typeof res.identifier === "string")
          state.cdpIds.push(res.identifier);
      state.cdpFailed = false;
      state.cdpReady = true;
    } catch (err) {
      // Tab chết giữa chừng không phải lỗi; còn lại thì rơi về đường lùi.
      if (state.wc.isDestroyed()) return;
      state.cdpFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      // "target closed" khi webContents vẫn còn = tab đang bị đóng đúng lúc đăng ký (cùng
      // ca với Network.enable trong browser.ts) ⇒ debug, không phải cảnh báo.
      const level = /target closed|not attached/i.test(message) ? "debug" : "warn";
      log[level]("userscripts: CDP registration failed, using fallback injection", {
        err: message,
      });
    }
  }

  private async injectFallback(state: TabState): Promise<void> {
    const wc = state.wc;
    if (wc.isDestroyed()) return;
    const url = wc.getURL();
    await Promise.all(
      this.enabledScripts()
        .filter((s) => !state.ran.has(s.id) && matchesRules(s.rules, url))
        .map((s) =>
          wc
            .executeJavaScript(buildWrapper(s, this.tag))
            .catch((err: unknown) => {
              log.warn("userscripts: fallback injection failed", {
                id: s.id,
                err: err instanceof Error ? err.message : String(err),
              });
            }),
        ),
    );
  }
}

export const userscripts = new UserscriptHost();
