// Bài kiểm lõi bắt request: map CDP → entry, redirect, ExtraInfo trước/sau, timing, ring,
// ngân sách body, WebSocket, HAR.
//
//   npx tsc -p tsconfig.json --outDir /tmp/cap && node --test /tmp/cap/__tests__/browser-capture-core.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BodyBudget,
  buildHar,
  CaptureStore,
  makeBody,
  WS_MAX_FRAMES,
  WS_PAYLOAD_CAP,
} from "../browser-capture-core";

const newStore = (budget?: BodyBudget, max?: number): CaptureStore => {
  const s = new CaptureStore("tab-1", budget, max);
  s.recording = true;
  return s;
};

const willSend = (
  requestId: string,
  url: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  requestId,
  loaderId: requestId,
  timestamp: 100,
  wallTime: 1_700_000_000,
  type: "XHR",
  frameId: "F1",
  request: { url, method: "GET", headers: { Accept: "*/*" } },
  initiator: {
    type: "script",
    stack: {
      callFrames: [{ functionName: "go", url: "http://a/x.js", lineNumber: 7 }],
    },
  },
  ...extra,
});

test("request → response → finished fills summary, timing and effect", () => {
  const s = newStore();
  assert.deepEqual(
    s.handle(
      "Network.requestWillBeSent",
      willSend("r1", "https://a.test/api?q=1"),
    ),
    [],
  );
  s.handle("Network.responseReceived", {
    requestId: "r1",
    type: "XHR",
    response: {
      url: "https://a.test/api?q=1",
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      headers: { "Content-Type": "application/json" },
      protocol: "h2",
      remoteIPAddress: "1.2.3.4",
      remotePort: 443,
      timing: {
        requestTime: 100.01,
        dnsStart: 0,
        dnsEnd: 5,
        connectStart: 5,
        connectEnd: 25,
        sslStart: 12,
        sslEnd: 25,
        sendStart: 25.5,
        sendEnd: 26,
        receiveHeadersEnd: 80,
      },
      securityDetails: {
        protocol: "TLS 1.3",
        cipher: "AES_128_GCM",
        keyExchange: "",
        keyExchangeGroup: "X25519",
        subjectName: "a.test",
        issuer: "CA",
        validFrom: 1000,
        validTo: 2000,
        sanList: ["a.test"],
        certificateTransparencyCompliance: "compliant",
      },
    },
  });
  const fx = s.handle("Network.loadingFinished", {
    requestId: "r1",
    timestamp: 100.2,
    encodedDataLength: 321,
  });
  assert.deepEqual(fx, [{ kind: "responseBody", id: "r1", requestId: "r1" }]);
  const e = s.get("r1")!;
  assert.equal(e.host, "a.test");
  assert.equal(e.path, "/api?q=1");
  assert.equal(e.scheme, "https");
  assert.equal(e.status, 200);
  assert.equal(e.state, "done");
  assert.equal(e.encodedBytes, 321);
  assert.equal(e.httpVersion, "h2");
  assert.equal(e.startedAt, 1_700_000_000_000);
  assert.deepEqual(e.initiator?.stack, ["go @ http://a/x.js:7"]);
  assert.equal(e.security?.keyExchange, "X25519");
  assert.equal(e.security?.validFrom, 1_000_000);
  assert.equal(e.security?.certificateTransparency, "compliant");
  const t = e.timing!;
  assert.equal(t.totalMs, 200);
  assert.equal(t.dnsMs, 5);
  assert.equal(t.connectMs, 20);
  assert.equal(t.sslMs, 13);
  assert.equal(t.sendMs, 0.5);
  assert.equal(t.waitMs, 54);
  // receive = (finished − requestTime)·1000 − receiveHeadersEnd = 190 − 80
  assert.equal(t.receiveMs, 110);
  assert.equal(t.blockedMs, 10);
  assert.equal(e.durationMs, 200);
  s.setResponseBody("r1", '{"ok":true}', false);
  assert.equal(s.get("r1")!.hasResponseBody, true);
  assert.equal(s.state().bodyBytes, 11);
});

test("redirect closes previous hop and opens a #n hop", () => {
  const s = newStore();
  s.handle("Network.requestWillBeSent", willSend("r", "http://a.test/a"));
  s.handle(
    "Network.requestWillBeSent",
    willSend("r", "http://a.test/b", {
      timestamp: 100.1,
      redirectResponse: {
        status: 302,
        statusText: "Found",
        headers: { Location: "/b" },
      },
    }),
  );
  s.handle("Network.responseReceived", {
    requestId: "r",
    response: { status: 200, headers: {}, mimeType: "text/html" },
  });
  s.handle("Network.loadingFinished", {
    requestId: "r",
    timestamp: 100.3,
    encodedDataLength: 5,
  });
  const list = s.list();
  assert.deepEqual(
    list.map((x) => [x.id, x.status, x.state, x.redirectedTo]),
    [
      ["r", 302, "done", "http://a.test/b"],
      ["r#1", 200, "done", undefined],
    ],
  );
  assert.equal(s.get("r")!.timing!.totalMs, 100);
  assert.ok(list[0]!.seq < list[1]!.seq);
  // body chỉ lấy cho hop cuối
  assert.equal(
    s.get("r")!.responseHeaders.find(([n]) => n === "Location")?.[1],
    "/b",
  );
});

test("ExtraInfo merges before and after the base events; Set-Cookie split into lines", () => {
  const s = newStore();
  // trước: cả hai ExtraInfo tới trước requestWillBeSent
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "e1",
    headers: { ":authority": "a", Cookie: "sid=1; t=2", Accept: "*/*" },
    associatedCookies: [
      { blockedReasons: ["SameSiteLax"], cookie: { name: "lax" } },
      { blockedReasons: [], cookie: { name: "ok" } },
    ],
  });
  s.handle("Network.responseReceivedExtraInfo", {
    requestId: "e1",
    statusCode: 200,
    headers: { "Set-Cookie": "a=1; HttpOnly\nb=2; Secure" },
    headersText: "HTTP/1.1 200 OK\r\nSet-Cookie: a=1\r\n\r\n",
    blockedCookies: [
      { blockedReasons: ["SecureOnly"], cookieLine: "c=3; Domain=x" },
    ],
  });
  s.handle("Network.requestWillBeSent", willSend("e1", "https://a.test/"));
  s.handle("Network.responseReceived", {
    requestId: "e1",
    response: {
      status: 200,
      headers: { "set-cookie": "a=1" },
      requestHeaders: { Accept: "*/*" },
    },
  });
  let e = s.get("e1")!;
  assert.deepEqual(e.requestHeaders, [
    ["Cookie", "sid=1; t=2"],
    ["Accept", "*/*"],
  ]);
  assert.deepEqual(e.responseHeaders, [
    ["Set-Cookie", "a=1; HttpOnly"],
    ["Set-Cookie", "b=2; Secure"],
  ]);
  assert.match(e.responseHeadersText ?? "", /Set-Cookie: a=1/);
  assert.deepEqual(e.blockedCookies, [
    { name: "lax", reasons: ["SameSiteLax"] },
    { name: "c", reasons: ["SecureOnly"] },
  ]);

  // sau: ExtraInfo tới SAU sự kiện gốc, base headers bị thay bằng raw
  s.handle("Network.requestWillBeSent", willSend("e2", "https://a.test/2"));
  s.handle("Network.responseReceived", {
    requestId: "e2",
    response: { status: 200, headers: { "set-cookie": "a=1" } },
  });
  e = s.get("e2")!;
  assert.deepEqual(e.responseHeaders, [["set-cookie", "a=1"]]);
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "e2",
    headers: { Cookie: "x=y" },
  });
  s.handle("Network.responseReceivedExtraInfo", {
    requestId: "e2",
    headers: { "Set-Cookie": "a=1\nb=2" },
  });
  e = s.get("e2")!;
  assert.deepEqual(e.requestHeaders, [["Cookie", "x=y"]]);
  assert.equal(e.responseHeaders.length, 2);
});

test("ExtraInfo of a redirect chain lands on the right hop", () => {
  const s = newStore();
  s.handle("Network.requestWillBeSent", willSend("c", "http://a.test/1"));
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "c",
    headers: { Cookie: "h=1" },
  });
  s.handle(
    "Network.requestWillBeSent",
    willSend("c", "http://a.test/2", {
      redirectResponse: { status: 301, headers: {} },
    }),
  );
  // ExtraInfo của hop 1 tới SAU khi hop 2 đã mở
  s.handle("Network.responseReceivedExtraInfo", {
    requestId: "c",
    headers: { Location: "/2" },
  });
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "c",
    headers: { Cookie: "h=2" },
  });
  assert.deepEqual(s.get("c")!.requestHeaders, [["Cookie", "h=1"]]);
  assert.deepEqual(s.get("c")!.responseHeaders, [["Location", "/2"]]);
  assert.deepEqual(s.get("c#1")!.requestHeaders, [["Cookie", "h=2"]]);
});

test("request body: inline postData and deferred getRequestPostData effect", () => {
  const s = newStore();
  s.handle(
    "Network.requestWillBeSent",
    willSend("p1", "http://a.test/p", {
      request: {
        url: "http://a.test/p",
        method: "POST",
        headers: {},
        postData: '{"a":1}',
        hasPostData: true,
      },
    }),
  );
  assert.deepEqual(s.get("p1")!.requestBody, {
    text: '{"a":1}',
    base64: false,
    truncated: false,
    size: 7,
  });
  const fx = s.handle(
    "Network.requestWillBeSent",
    willSend("p2", "http://a.test/p", {
      request: {
        url: "http://a.test/p",
        method: "POST",
        headers: {},
        hasPostData: true,
      },
    }),
  );
  assert.deepEqual(fx, [{ kind: "postData", id: "p2", requestId: "p2" }]);
  s.setRequestBody("p2", "AAEC", true);
  assert.equal(s.get("p2")!.requestBody!.size, 3);
  assert.equal(s.get("p2")!.hasRequestBody, true);
});

test("makeBody truncates by original byte size", () => {
  assert.deepEqual(makeBody("héllo", false, 100), {
    text: "héllo",
    base64: false,
    truncated: false,
    size: 6,
  });
  const big = makeBody("a".repeat(50), false, 10);
  assert.equal(big.text.length, 10);
  assert.equal(big.truncated, true);
  assert.equal(big.size, 50);
  const b64 = makeBody(Buffer.alloc(30, 1).toString("base64"), true, 9);
  assert.equal(Buffer.from(b64.text, "base64").length, 9);
  assert.equal(b64.size, 30);
});

test("failed requests, blocked reason and cache flag", () => {
  const s = newStore();
  s.handle("Network.requestWillBeSent", willSend("f", "http://a.test/x"));
  s.handle("Network.requestServedFromCache", { requestId: "f" });
  assert.deepEqual(
    s.handle("Network.loadingFailed", {
      requestId: "f",
      timestamp: 100.5,
      errorText: "net::ERR_BLOCKED_BY_CLIENT",
      blockedReason: "inspector",
    }),
    [],
  );
  const e = s.get("f")!;
  assert.equal(e.state, "failed");
  assert.equal(e.error, "net::ERR_BLOCKED_BY_CLIENT");
  assert.equal(e.blockedReason, "inspector");
  assert.equal(e.fromCache, true);
  assert.equal(e.timing!.totalMs, 500);
});

test("isNavigation uses main frame when known", () => {
  const s = newStore();
  s.setMainFrame("MAIN");
  s.handle(
    "Network.requestWillBeSent",
    willSend("d1", "http://a.test/", { type: "Document", frameId: "MAIN" }),
  );
  s.handle(
    "Network.requestWillBeSent",
    willSend("d2", "http://a.test/f", { type: "Document", frameId: "SUB" }),
  );
  assert.equal(s.get("d1")!.isNavigation, true);
  assert.equal(s.get("d2")!.isNavigation, false);
});

test("recording off ignores events; clear resets; ring drops oldest", () => {
  const s = new CaptureStore("t", undefined, 3);
  assert.deepEqual(
    s.handle("Network.requestWillBeSent", willSend("x", "http://a/")),
    [],
  );
  assert.equal(s.state().count, 0);
  s.recording = true;
  for (const id of ["a", "b", "c", "d", "e"])
    s.handle("Network.requestWillBeSent", willSend(id, `http://h/${id}`));
  assert.deepEqual(
    s.list().map((x) => x.id),
    ["c", "d", "e"],
  );
  assert.equal(s.state().dropped, 2);
  assert.equal(s.get("a"), null);
  assert.deepEqual(
    s.list(4).map((x) => x.id),
    ["e"],
  );
  s.clear();
  assert.deepEqual(s.state(), {
    tabId: "t",
    recording: true,
    count: 0,
    dropped: 0,
    bodyBytes: 0,
  });
});

test("dirty set is drained once", () => {
  const s = newStore();
  s.handle("Network.requestWillBeSent", willSend("a", "http://h/a"));
  assert.equal(s.drainDirty().length, 1);
  assert.equal(s.drainDirty().length, 0);
  s.handle("Network.loadingFinished", {
    requestId: "a",
    timestamp: 101,
    encodedDataLength: 1,
  });
  assert.equal(s.drainDirty()[0]!.state, "done");
});

test("body budget evicts oldest bodies across stores, keeps entries", () => {
  const budget = new BodyBudget(20);
  const s1 = new CaptureStore("t1", budget);
  const s2 = new CaptureStore("t2", budget);
  s1.recording = s2.recording = true;
  s1.handle("Network.requestWillBeSent", willSend("a", "http://h/a"));
  s2.handle("Network.requestWillBeSent", willSend("b", "http://h/b"));
  s1.handle("Network.requestWillBeSent", willSend("c", "http://h/c"));
  s1.setResponseBody("a", "x".repeat(10), false);
  s2.setResponseBody("b", "y".repeat(10), false);
  assert.equal(budget.used, 20);
  s1.setResponseBody("c", "z".repeat(10), false); // vượt 20 ⇒ đẩy body của `a` ra
  assert.equal(s1.get("a")!.responseBody, undefined);
  assert.equal(s1.get("a")!.bodyEvicted, true);
  assert.equal(s1.get("a")!.hasResponseBody, false);
  assert.ok(s2.get("b")!.responseBody);
  assert.equal(budget.used, 20);
  assert.equal(s1.state().bodyBytes, 10);
  s1.clear();
  assert.equal(budget.used, 10);
});

test("dropping a ring entry releases its body bytes", () => {
  const budget = new BodyBudget(1000);
  const s = new CaptureStore("t", budget, 1);
  s.recording = true;
  s.handle("Network.requestWillBeSent", willSend("a", "http://h/a"));
  s.setResponseBody("a", "x".repeat(50), false);
  s.handle("Network.requestWillBeSent", willSend("b", "http://h/b"));
  assert.equal(budget.used, 0);
  assert.equal(s.state().bodyBytes, 0);
});

test("websocket: created → handshake → frames → closed", () => {
  const s = newStore();
  s.handle("Network.webSocketCreated", {
    requestId: "w",
    url: "ws://a.test/sock",
  });
  s.handle("Network.webSocketWillSendHandshakeRequest", {
    requestId: "w",
    timestamp: 50,
    wallTime: 1_700_000_100,
    request: { headers: { Upgrade: "websocket" } },
  });
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "w",
    headers: { Cookie: "k=v" },
  });
  s.handle("Network.webSocketHandshakeResponseReceived", {
    requestId: "w",
    timestamp: 50.1,
    response: {
      status: 101,
      statusText: "Switching Protocols",
      headers: { Upgrade: "websocket" },
    },
  });
  s.handle("Network.webSocketFrameSent", {
    requestId: "w",
    timestamp: 50.2,
    response: { opcode: 1, mask: true, payloadData: "hi" },
  });
  s.handle("Network.webSocketFrameReceived", {
    requestId: "w",
    timestamp: 50.3,
    response: { opcode: 2, mask: false, payloadData: "AAE=" },
  });
  s.handle("Network.webSocketClosed", { requestId: "w", timestamp: 51 });
  const e = s.get("w")!;
  assert.equal(e.resourceType, "WebSocket");
  assert.equal(e.scheme, "ws");
  assert.equal(e.status, 101);
  assert.equal(e.state, "done");
  assert.equal(e.durationMs, 1000);
  assert.equal(e.startedAt, 1_700_000_100_000);
  assert.deepEqual(e.requestHeaders, [["Cookie", "k=v"]]);
  assert.equal(e.wsFrameCount, 2);
  assert.deepEqual(
    e.wsFrames!.map((f) => [f.dir, f.opcode, f.payload, f.truncated]),
    [
      ["sent", 1, "hi", false],
      ["received", 2, "AAE=", false],
    ],
  );
  assert.equal(e.wsFrames![0]!.ts, 1_700_000_100_200);
});

test("websocket frame ring and payload caps", () => {
  const s = newStore();
  s.handle("Network.webSocketCreated", {
    requestId: "w",
    url: "wss://a.test/",
  });
  for (let i = 0; i < WS_MAX_FRAMES + 20; i++) {
    s.handle("Network.webSocketFrameReceived", {
      requestId: "w",
      timestamp: 1,
      response: { opcode: 1, payloadData: String(i) },
    });
  }
  s.handle("Network.webSocketFrameSent", {
    requestId: "w",
    timestamp: 1,
    response: { opcode: 1, payloadData: "q".repeat(WS_PAYLOAD_CAP + 5) },
  });
  const e = s.get("w")!;
  assert.equal(e.wsFrames!.length, WS_MAX_FRAMES);
  assert.equal(e.wsFrameCount, WS_MAX_FRAMES + 21);
  const last = e.wsFrames![e.wsFrames!.length - 1]!;
  assert.equal(last.payload.length, WS_PAYLOAD_CAP);
  assert.equal(last.truncated, true);
});

test("HAR 1.2 shape", () => {
  const s = newStore();
  s.handle(
    "Network.requestWillBeSent",
    willSend("h", "https://a.test/p?x=1&y=%20z", {
      request: {
        url: "https://a.test/p?x=1&y=%20z",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        postData: '{"a":1}',
      },
    }),
  );
  s.handle("Network.requestWillBeSentExtraInfo", {
    requestId: "h",
    headers: { "Content-Type": "application/json", Cookie: "sid=abc; t=2" },
  });
  s.handle("Network.responseReceived", {
    requestId: "h",
    response: {
      status: 200,
      statusText: "OK",
      mimeType: "image/png",
      protocol: "h2",
      remoteIPAddress: "9.9.9.9",
      headers: {},
      timing: {
        requestTime: 100,
        dnsStart: -1,
        dnsEnd: -1,
        connectStart: -1,
        connectEnd: -1,
        sslStart: -1,
        sslEnd: -1,
        sendStart: 1,
        sendEnd: 2,
        receiveHeadersEnd: 30,
      },
    },
  });
  s.handle("Network.responseReceivedExtraInfo", {
    requestId: "h",
    headers: {
      "Set-Cookie":
        "a=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60\nb=2",
    },
  });
  s.handle("Network.loadingFinished", {
    requestId: "h",
    timestamp: 100.05,
    encodedDataLength: 9,
  });
  s.setResponseBody("h", "AAEC", true);
  s.handle("Network.webSocketCreated", { requestId: "w", url: "ws://a.test/" });
  s.handle("Network.webSocketFrameSent", {
    requestId: "w",
    timestamp: 1,
    response: { opcode: 1, payloadData: "hey" },
  });

  const har = buildHar(s.all(), { name: "AWOG", version: "1" });
  assert.equal(har.log.version, "1.2");
  assert.equal(har.log.entries.length, 2);
  const e = har.log.entries[0];
  const d = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (o, k) => (o as Record<string, unknown> | undefined)?.[k],
        e,
      );
  assert.equal(d("startedDateTime"), "2023-11-14T22:13:20.000Z");
  assert.equal(d("request.method"), "POST");
  assert.deepEqual(d("request.queryString"), [
    { name: "x", value: "1" },
    { name: "y", value: " z" },
  ]);
  assert.deepEqual(d("request.cookies"), [
    { name: "sid", value: "abc" },
    { name: "t", value: "2" },
  ]);
  assert.equal(d("request.postData.text"), '{"a":1}');
  assert.equal(d("request.postData.mimeType"), "application/json");
  assert.equal(d("request.httpVersion"), "HTTP/2.0");
  assert.equal(d("response.cookies.length"), 2);
  assert.equal(d("response.cookies.0.httpOnly"), true);
  assert.equal(d("response.cookies.0.secure"), true);
  assert.equal(d("response.cookies.0.path"), "/");
  assert.equal(d("response.cookies.0._sameSite"), "Lax");
  assert.ok(d("response.cookies.0.expires"));
  assert.equal(d("response.content.encoding"), "base64");
  assert.equal(d("response.content.text"), "AAEC");
  assert.equal(d("response.content.size"), 3);
  assert.equal(d("response.bodySize"), 9);
  assert.equal(d("serverIPAddress"), "9.9.9.9");
  assert.equal(d("timings.send"), 1);
  assert.equal(d("timings.wait"), 28);
  assert.equal(d("timings.receive"), 20);
  assert.equal(d("timings.ssl"), -1);
  const t = (k: string): number => d(`timings.${k}`) as number;
  assert.equal(d("time"), t("blocked") + t("send") + t("wait") + t("receive"));
  const msgs = har.log.entries[1]?._webSocketMessages as {
    type: string;
    data: string;
  }[];
  assert.deepEqual(
    msgs.map((m) => [m.type, m.data]),
    [["send", "hey"]],
  );
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(har)));
});
