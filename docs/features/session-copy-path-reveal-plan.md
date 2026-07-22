# Plan: session-copy-path-reveal

> Spec: [session-copy-path-reveal.md](./session-copy-path-reveal.md)
> Loại: **Bug fix (S)** — Phương án A. Mirror precedent `shell:revealSourceFolder`.

## DAG (dependency ngắn)

```
T1 (name decision, TL)
      │
      ▼
T2 (main IPC handler) ──► T3 (preload + type-def) ──► T4 (useSidecar wrapper)
                                                             │
                                                             ▼
                                              T5 (sửa 2 handler UI + gate AC5)
                                                             │
                                                             ▼
                                              T6 (QA verify AC1–AC5)
T7 (infosec spot-check) song song sau T2
```

## MVP scope

- [ ] **T1. Chốt tên IPC method mới** — S
  - **Role:** tech-lead
  - **Depends on:** none
  - **File chạm:** (quyết định, ghi vào spec Open questions)
  - **Acceptance:** chốt `shell:revealSessionFolder(engineId)` (method riêng, YAGNI) VS `shell:revealAwogHomeFolder(kind, slug)` tổng quát. Ghi 1 dòng lý do. Không tạo ADR mới (tái dùng precedent).

- [ ] **T2. Thêm IPC handler main derive + validate session dir** — S
  - **Role:** developer
  - **Depends on:** T1
  - **File chạm:** `apps/desktop/electron/src/ipc.ts` (mirror `shell:revealSourceFolder` @95-105)
  - **Acceptance:** handler nhận `engineId` (string), validate qua `SOURCE_SLUG_RE` (charset `[a-z0-9-]`), derive `join(homedir(), '.awog', 'sessions', engineId)`, check `startsWith(sessionsDir + sep)`, reject nếu sai; `shell.showItemInFolder(target)`. Comment cross-ref tới `sessions/jsonl.ts:sessionDir` (đồng bộ layout). KHÔNG dùng `resolveInsideWorkspace`, KHÔNG nhận path từ renderer (AC4).
  - **Risk:** phải trùng công thức layout với sidecar `sessionDir` — nếu layout đổi, 2 nơi lệch. Mitigate bằng comment cross-ref.

- [ ] **T3. Expose method qua preload + type-def** — S
  - **Role:** developer
  - **Depends on:** T2
  - **File chạm:** `apps/desktop/electron/src/preload.ts` (@60-61), `apps/desktop/ui-next/types/awog-bridge.d.ts`
  - **Acceptance:** `revealSessionFolder(engineId: string): Promise<void>` thêm vào `contextBridge` + khai type trong bridge d.ts, mirror `revealSourceFolder`. Typecheck pass.

- [ ] **T4. Thêm wrapper trong useSidecar** — S
  - **Role:** developer
  - **Depends on:** T3
  - **File chạm:** `apps/desktop/ui-next/composables/useSidecar.ts` (mirror `revealSourceFolder` @98-100 + return @182)
  - **Acceptance:** `revealSessionFolder(engineId)` gọi `api.revealSessionFolder`, throw `SidecarUnavailableError` khi `!api`, export trong return object.

- [ ] **T5. Sửa 2 handler session menu trỏ session dir + gate AC5** — S
  - **Role:** developer
  - **Depends on:** T4
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionList.vue` (@504-517, template @251/@255)
  - **Acceptance:**
    - `ctxCopyPath`: copy đường dẫn session dir string (build từ `engineId` — theo cách bridge quy ước, hoặc dùng cùng công thức home; xem note dưới) thay vì `projectPath`. Browser-dev vẫn copy được (chỉ `navigator.clipboard`).
    - `ctxOpenFinder`: gọi `sc.revealSessionFolder(engineId)` thay `sc.openPath(projectPath, '.')`; chỉ khi `sc.available`.
    - Gate 2 item: disable/ẩn khi `engineId == null` (AC5); Open in Finder thêm gate `sc.available` (browser-dev ẩn/disable). Copy path khi chưa persist → no-op + toast "Session chưa được lưu".
    - AC3: KHÔNG đụng `SessionTabBar.vue:pOpenFinder` (project menu giữ nguyên).
  - **Risk:** Copy path cần string tuyệt đối ở renderer — renderer KHÔNG được build path tuyệt đối từ `fs`/homedir (invariant #4). Xem Open question dưới: nguồn string path cho clipboard.

- [ ] **T6. QA verify AC1–AC5 + edge cases** — S
  - **Role:** qa-tester
  - **Depends on:** T5
  - **File chạm:** (không code — test manual + case list)
  - **Acceptance:** cover AC1 (copy đúng session dir, không project), AC2 (reveal đúng dir), AC3 (project menu không hồi quy), AC4 (engineId traversal `../` bị reject), AC5 (session chưa persist → disable + toast). Edge: `session.project == null` vẫn hoạt động; browser-dev copy OK / finder disable; clipboard lỗi không crash.

## Song song / cross-cut

- [ ] **T7. Infosec spot-check IPC boundary** — S
  - **Role:** infosec
  - **Depends on:** T2 (chạy song song T3–T5)
  - **Acceptance:** xác nhận invariant #2 (main derive+validate, regex + startsWith), #4 (renderer chỉ gửi `engineId`, không path tuyệt đối qua IPC). Reject traversal, không nới `resolveInsideWorkspace`. Chỉ cần review diff, không full audit.

## Missing from spec
- (Không có task nào thiếu spec — surface khu trú, precedent rõ.)

## Open questions (cho tech-lead)
- **Nguồn string cho "Copy path" ở renderer:** clipboard cần path tuyệt đối `~/.awog/sessions/<engineId>/`, nhưng renderer KHÔNG được tự build từ homedir (invariant #4 — không `import fs`/tự dựng absolute path). Chọn 1: (a) copy path **display-only** thô kiểu `~/.awog/sessions/<engineId>` (dùng `~`, không expand — người dùng paste vào shell vẫn `cd` được); (b) thêm IPC nhỏ `shell:sessionFolderPath(engineId): Promise<string>` để main trả path đã derive rồi renderer copy (đối xứng reveal, đúng invariant nhưng thêm 1 method). Nghiêng (a) cho gọn (KISS/YAGNI). TL chốt.
