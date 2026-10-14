// Trang lỗi cho tab của trình duyệt nhúng khi tải trang hỏng.
//
// Electron không mang trang lỗi của Chrome: tải hỏng ⇒ tab trắng tinh, người dùng không
// biết chuyện gì (gặp thật 2026-10-13: proxy miễn phí reset TLS ⇒ ERR_CONNECTION_RESET
// chỉ hiện trong log). `did-fail-load` của khung chính ⇒ browser.ts bơm HTML này vào
// document lỗi `chrome-error://` bằng `executeJavaScript` — đo trên Electron 33: URL vẫn là
// URL hỏng (thanh địa chỉ + nút tải lại đúng), lịch sử không thêm mục nào.
//
// Module thuần (không import electron) để test được bằng `node --test`.

export type ErrorPageLang = "vi" | "en";

export interface ErrorPageInput {
  /** Mã lỗi mạng Chromium (âm), vd. -101. */
  code: number;
  /** Tên lỗi Chromium, vd. `ERR_CONNECTION_RESET`. */
  desc: string;
  url: string;
  lang: ErrorPageLang;
  /** Hồ sơ của tab đang đi qua proxy ⇒ nói ra, vì lỗi rất có thể nằm ở proxy. */
  proxy?: { type: string; host: string; port: number } | null;
}

type Kind =
  | "dns"
  | "reset"
  | "refused"
  | "timeout"
  | "offline"
  | "proxy"
  | "cert"
  | "other";

function classify(desc: string): Kind {
  if (/^ERR_CERT_|SSL_PROTOCOL_ERROR|ERR_BAD_SSL_CLIENT_AUTH_CERT/.test(desc))
    return "cert";
  if (/PROXY|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION/.test(desc))
    return "proxy";
  if (/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(desc)) return "dns";
  if (
    /CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE|CONNECTION_ABORTED/.test(
      desc,
    )
  ) {
    return "reset";
  }
  if (/CONNECTION_REFUSED/.test(desc)) return "refused";
  if (/TIMED_OUT/.test(desc)) return "timeout";
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(desc))
    return "offline";
  return "other";
}

const STRINGS: Record<
  ErrorPageLang,
  {
    title: string;
    reason: Record<Kind, string>;
    viaProxy: (addr: string) => string;
    retry: string;
  }
> = {
  vi: {
    title: "Không mở được trang",
    reason: {
      dns: "Không tìm thấy địa chỉ máy chủ. Kiểm tra lại URL hoặc kết nối mạng.",
      reset:
        "Kết nối bị cắt giữa chừng. Mạng (hoặc proxy) có thể đang chặn trang này.",
      refused: "Máy chủ từ chối kết nối.",
      timeout: "Máy chủ không phản hồi kịp.",
      offline: "Máy đang mất kết nối mạng.",
      proxy:
        "Không kết nối được qua proxy — proxy có thể đã chết hoặc từ chối.",
      cert: "Chứng chỉ bảo mật của trang không hợp lệ — kết nối có thể đang bị can thiệp.",
      other: "Đã xảy ra lỗi mạng khi tải trang.",
    },
    viaProxy: (addr) =>
      `Hồ sơ trình duyệt này đang đi qua proxy ${addr} — lỗi rất có thể nằm ở proxy (chết, chậm, hoặc mạng của proxy chặn trang). Đổi hay tắt proxy bằng nút quả địa cầu cạnh ô địa chỉ.`,
    retry: "Thử lại",
  },
  en: {
    title: "This page couldn't load",
    reason: {
      dns: "The server's address couldn't be found. Check the URL or your connection.",
      reset:
        "The connection was cut. The network (or proxy) may be blocking this site.",
      refused: "The server refused the connection.",
      timeout: "The server took too long to respond.",
      offline: "You appear to be offline.",
      proxy:
        "Couldn't connect through the proxy — it may be down or refusing connections.",
      cert: "The site's security certificate isn't valid — the connection may be intercepted.",
      other: "A network error occurred while loading the page.",
    },
    viaProxy: (addr) =>
      `This browser profile goes through proxy ${addr} — the proxy is the likely cause (down, slow, or its network blocks the site). Change or turn it off with the globe button next to the address bar.`,
    retry: "Try again",
  },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderErrorPage(input: ErrorPageInput): string {
  const s = STRINGS[input.lang];
  const kind = classify(input.desc);
  // Nút thử lại chỉ cho http(s): link tới scheme khác trong trang lỗi là cửa lạ không cần mở.
  const retryable = /^https?:\/\//i.test(input.url);
  const proxyLine = input.proxy
    ? `<p class="px">${escapeHtml(s.viaProxy(`${input.proxy.type.toUpperCase()} ${input.proxy.host}:${input.proxy.port}`))}</p>`
    : "";
  return `<head><meta charset="utf-8"><title>${escapeHtml(s.title)}</title><style>
:root{color-scheme:light dark}
body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:560px;margin:12vh auto 0;padding:0 24px}
h1{font-size:20px;line-height:28px;margin:0 0 8px}
p{margin:0 0 12px;opacity:.85}
.url{font:12px/18px ui-monospace,Menlo,monospace;word-break:break-all;opacity:.7}
.code{font:12px/18px ui-monospace,Menlo,monospace;opacity:.6}
.px{padding:10px 12px;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 25%,transparent)}
a.btn{display:inline-block;margin-top:8px;padding:6px 14px;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);color:inherit;text-decoration:none}
</style></head><body><main>
<h1>${escapeHtml(s.title)}</h1>
<p>${escapeHtml(s.reason[kind])}</p>
${proxyLine}
<p class="url">${escapeHtml(input.url)}</p>
<p class="code">${escapeHtml(input.desc)} (${input.code})</p>
${retryable ? `<a class="btn" href="${escapeHtml(input.url)}">${escapeHtml(s.retry)}</a>` : ""}
</main></body>`;
}

/** Script bơm trang lỗi vào document hiện tại (giá trị đã JSON-encode, không nối chuỗi thô). */
export function errorPageScript(html: string): string {
  return `document.documentElement.innerHTML = ${JSON.stringify(html)}; true`;
}
