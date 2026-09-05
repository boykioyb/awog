# Plan: nâng Claude Agent SDK `0.3.235 → 0.3.260` + đồng bộ reasoning effort hai runtime

> **Trạng thái:** P0 + P1 đang implement trên nhánh `claude/sdk-version-app-effort-qg99pq`. Khảo sát 2026-09-05.
> **Đã chốt:** câu hỏi B-3 → **phương án A** (user, 2026-09-05) — xem [ADR 0078](../decisions/0078-reasoning-effort-parity.md). P2/P3/P4 chưa làm.
> **Liên quan:** [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (runtime chọn theo provider), [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) item 6 (mapping thinking → Pi), [ADR 0071](../decisions/0071-senior-engineer-prompt-core.md) (system prompt append), [dual-sdk-runtime.md](./dual-sdk-runtime.md).

Hai việc độc lập nhưng gộp chung một plan vì cùng chạm lớp runtime, cùng cần **một** vòng QA parity 2 runtime, và cùng ra một release:

- **Track A** — bump `@anthropic-ai/claude-agent-sdk` 19 bản (0.3.235 → 0.3.260).
- **Track B** — sửa mapping reasoning effort của nhánh Pi đang lệch một nấc so với Claude Code và so với chính nhánh Anthropic của AWOG.

---

## 1. Hiện trạng đo được

| Hạng mục | Giá trị |
|---|---|
| Pin hiện tại | `"@anthropic-ai/claude-agent-sdk": "0.3.235"` — [sidecar/package.json:16](../../apps/desktop/sidecar/package.json) (pin **chính xác**, không caret) |
| npm `latest` | `0.3.260` (publish 2026-09-03), `claudeCodeVersion` 2.1.235 → 2.1.260 |
| Bản ở giữa | 19 (`236–243, 245–248, 250–252, 257–260`) |
| File import SDK | 10 file, tất cả trong [sidecar/src/runtime/claude-sdk/](../../apps/desktop/sidecar/src/runtime/claude-sdk/) |
| Pi SDK | `@earendil-works/pi-ai` + `pi-agent-core` pin `^0.84.2` (latest 0.85.0 — **ngoài phạm vi plan này**, xem [pi-sdk-0.80-migration.md](./pi-sdk-0.80-migration.md) về kỷ luật bump Pi) |
| Version app | `0.32.0` ở root + ui-next + sidecar + electron; changelog top = `0.32.0` |

Package **không ship `CHANGELOG.md`**. Toàn bộ nhận định dưới đây rút từ **diff bề mặt type công khai** (`sdk.d.ts`, `sdk-tools.d.ts`, `package.json`) giữa hai tarball đã tải về, không phải từ release notes.

---

## 2. Track A — bump SDK

### A-1. Đánh giá rủi ro breaking (đã verify, không phải phỏng đoán)

| Kiểm tra | Kết quả |
|---|---|
| Export bị **xoá** khỏi `sdk.d.ts` | **0** |
| Export **thêm** | 5 — `PreModelSwitchHookInput/SpecificOutput`, `PostModelSwitchHookInput/SpecificOutput`, `SDKMcpResourceLink` |
| `sdk-tools.d.ts` (schema tool built-in) | **không đổi 1 ký tự** — không tool nào thêm/bớt/đổi shape |
| Đổi kiểu bắt buộc trên `Options` | không có; toàn bộ field mới đều `?:` |
| Rủi ro duy nhất | `import type { ZodRawShape } from 'zod'` → `from 'zod/v3'` |

**Về `zod/v3`:** sidecar đang ở `zod ^3.25.76`; subpath `zod/v3` có trong exports map của zod từ 3.25.0 nên `moduleResolution: NodeNext` resolve được. Thêm nữa [tsconfig.json](../../apps/desktop/sidecar/tsconfig.json) bật **`skipLibCheck: true`** ⇒ lỗi bên trong `.d.ts` của SDK không làm gãy `pnpm typecheck` trừ khi AWOG tham chiếu trực tiếp type đó (không có). Rủi ro thực tế: **thấp**. Vẫn phải verify bằng bước A-2.3.

**Kết luận:** đây là **bump**, không phải migration. Khác hẳn tình huống Pi 0.79→0.80 (6 lỗi/6 file).

### A-2. Các bước

1. Sửa pin trong [sidecar/package.json](../../apps/desktop/sidecar/package.json): `0.3.235` → `0.3.260`. **Giữ pin chính xác** (không `^`): binary native per-platform là optional dep phải khớp version, và bản thân CLI đi kèm quyết định hành vi runtime — không để `pnpm install` tự trôi.
2. `pnpm install` ở repo root → cập nhật `pnpm-lock.yaml` (8 optional dep `claude-agent-sdk-{platform}-{arch}` tự đi theo).
3. `cd apps/desktop/sidecar && pnpm typecheck` — kỳ vọng **0 lỗi**. Nếu đỏ ở `zod/v3`: kiểm tra `node -p "require.resolve('zod/v3')"` trước khi nghĩ tới nâng zod.
4. Smoke chạy dev: 1 session Anthropic (OAuth) + 1 task node → xác nhận stream, tool-call, resume, abort, `/compact` vẫn chạy.
5. Verify packaging: `pnpm --filter @awog/sidecar build` rồi kiểm tra `dist/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude` tồn tại và [binary.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/binary.ts) `resolveClaudeBinary()` trả về đúng path.

### A-3. Rủi ro packaging (mục cần soi kỹ nhất, không phải typecheck)

- Binary native ~**227MB/platform**. `pnpm deploy --prod` kéo cả optional dep; [build.mjs](../../apps/desktop/sidecar/scripts/build.mjs) copy dereference symlink → dung lượng installer nhạy với thay đổi kích thước binary. **Đo lại size `dist/` trước/sau** và ghi vào PR.
- CI [release.yml](../../.github/workflows/release.yml) build **matrix per-OS** (`macos-14`, `ubuntu-22.04`, `windows-latest`, `max-parallel: 1`) chính vì lý do này — mỗi OS chỉ tải binary của nó. Bump không đổi cấu trúc matrix.
- `pruneBundle()` chỉ đụng `.pdb` + `node-pty/prebuilds` + `.bin` — không chạm thư mục SDK. Không cần sửa.
- Bít quyền thực thi: SDK binary phải giữ `+x` sau `cp`. Đã đúng hôm nay; verify lại sau bump trên macOS/Linux (bước A-2.5).

### A-4. Tính năng mới — phân kỳ, **không** ôm hết vào PR bump

PR bump (P0) chỉ đổi version + lockfile, **0 thay đổi hành vi**. Các thứ dưới đây là PR riêng sau khi P0 xanh:

| # | Tính năng SDK mới | Giá trị cho AWOG | Ưu tiên |
|---|---|---|---|
| 1 | **`systemPrompt.snapshot?: boolean`** — ghi system prompt 1 lần cho cả hội thoại, tái dùng nguyên văn ở mọi request + `resume` | **Cao nhất.** AWOG truyền `{ preset: 'claude_code', append }` ở [run-stream.ts:558](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) và [invoke.ts:266](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts). Có `append` ⇒ SDK **mặc định TẮT** ghi snapshot ⇒ mỗi lần đổi `append` (hoặc nâng CLI) là vỡ prompt-cache prefix **và vứt reasoning đã có của extended thinking**. Đúng chỗ đau của [ADR 0071](../decisions/0071-senior-engineer-prompt-core.md) | **P1** |
| 2 | **`McpSdkServerConfig.timeout`** — timeout per-server cho MCP **in-process** (`type: 'sdk'`) | Mới thật: 0.3.235 chỉ có `timeout` cho MCP **external** (AWOG đã dùng). AWOG chạy 5 in-process server (`awog`, `awogssh`, `awogwiki`, `awogmemory`, api sources) hiện **không có** timeout riêng — một handler treo là treo cả turn | **P2** |
| 3 | Usage `thinkingTokens?` + `costBasis?: 'list'\|'managed'\|'unknown'` | Bổ sung cho [event-adapter.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/event-adapter.ts) đang gom `cacheReadTokens`… — hiển thị token thinking tách bạch | **P2** |
| 4 | `user_message_uuid` + `user_message_uuids[]` trên assistant/partial/result | Bind stream trả lời về đúng lần send; hữu ích cho popout window + remote PWA khi nhiều send dồn thành một turn | **P3** |
| 5 | `queued_turn_count?` trên result | Biết còn bao nhiêu send đang xếp hàng → UI composer | **P3** |
| 6 | Hook `PreModelSwitch` / `PostModelSwitch` (+`prompt_cache_warm`, `estimated_cache_write_usd`) | AWOG đổi model **ngoài** SDK (tạo query mới), nên hook này hiện không bắn. Chỉ có nghĩa nếu sau này dùng `set_model` in-session | **P3 — chưa dùng** |
| 7 | `getContextUsage({ detail: 'summary' })` | Rẻ hơn `'full'` (không gọi token-count API từng nhóm). AWOG hiện chưa gọi `getContextUsage` | **P3 — chưa dùng** |
| 8 | `permissionPrompts: 'host' \| 'none'` | AWOG đã `permissionMode: 'bypassPermissions'` + PreToolUse hook riêng ⇒ **gần như no-op**. Đánh giá rồi bỏ qua nếu không đo được khác biệt | **Không làm** |
| 9 | `perTaskStopAffordance` | Cần UI stop từng background task trước đã; chưa có ⇒ giữ mặc định fail-closed | **Không làm** |
| 10 | `default_to_no` trên permission ask | AWOG không dùng permission path của SDK ⇒ không tới UI | **Không làm** |
| 11 | `ambient?` + `resource_links` trên task notification | Chỉ có nghĩa khi AWOG render background-task tray của SDK — chưa có | **Không làm** |
| 12 | `updateSettings('localSettings', …)` control request | Allowlist đúng 1 key `outputStyle`; AWOG quản style riêng | **Không làm** |

---

## 3. Track B — đồng bộ reasoning effort

### B-1. Lệch ở đâu

Danh sách hiển thị **không sai**: [`THINKING_LEVELS`](../../apps/desktop/ui-next/composables/useSessionsData.ts) = `low | medium | high | extra-high | max`, nhãn `common.thinking.*` (en/vi) khớp đúng picker của Claude Code, dùng chung cho cả 3 picker (Settings → Defaults, status-bar chip, per-project LLM defaults).

Lệch nằm ở **mapping runtime**:

| Picker | Claude Code | AWOG → Anthropic ([claude-sdk/shared.ts:145](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts)) | AWOG → provider khác ([runtime/thinking.ts:32](../../apps/desktop/sidecar/src/runtime/thinking.ts)) |
|---|---|---|---|
| Low | `low` | `low` + thinking disabled | **off** |
| Medium | `medium` | `medium` | **`low`** |
| High | `high` | `high` | **`medium`** |
| Extra high | `xhigh` | `xhigh` | **`high`** |
| Max | `max` | `max` | **`xhigh`** |

Nhánh Anthropic 1:1 đúng. Nhánh Pi **dịch xuống đúng một nấc** trên toàn thang.

### B-2. Vì sao đây là bug, không phải thiết kế

Comment đầu [thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts) biện minh bằng "Pi's reasoning scale differs". Không còn đúng: thang của Pi là

```
off | minimal | low | medium | high | xhigh | max      (pi-ai dist/types.d.ts)
```

— **trùng tên với Claude Code ở đúng 5 nấc trên**. Không có lý do kỹ thuật để dịch. Hệ quả cụ thể, đã kiểm bằng catalog model của `pi-ai@0.85.0`:

1. **Mất một nấc trên mọi provider ngoài Anthropic.** OpenAI `gpt-5.x` / o-series khai đủ `low…max` ⇒ chọn "High" thực tế chạy `medium`, chọn "Max" chạy `xhigh`. Nấc `max` của Pi **không bao giờ với tới được**.
2. **Hai nấc trên cùng sập vào nhau trên model không khai `xhigh`/`max`.** `getSupportedThinkingLevels` chỉ nhận `xhigh`/`max` khi model khai tường minh trong `thinkingLevelMap`; không khai thì `clampThinkingLevel` tụt về `high`. Gemini 3.1 Pro chỉ khai `minimal…high` ⇒ "Extra high" → `high`, "Max" → `xhigh` → clamp → `high`: **hai lựa chọn cho ra y hệt nhau**. (OpenAI **không** dính lỗi này — cần nói rõ để không mô tả quá tay.)
3. **Cùng một nhãn, hai hành vi khác nhau tuỳ provider.** Đổi account Anthropic → OpenAI mà giữ nguyên "High": effort thực tụt `high` → `medium`, im lặng, không có gì trên UI báo.
4. **Lệch ngay bên trong một session Anthropic.** Subagent `Task` ([ADR 0030](../decisions/0030-subagent-task-tool.md)) honor provider/model của chính AGENT.md, nên một session Anthropic delegate sang agent ghim OpenAI/Google sẽ chạy nhánh Pi với mapping lệch — cùng một session, hai thang effort khác nhau. (`/compact` **không** dính: `runCompact` gọi `generateSummary` không truyền `reasoning`.)

### B-3. Quyết định — ĐÃ CHỐT: phương án A

Sửa nấc `low` thế nào:

| | Mapping | Được | Mất |
|---|---|---|---|
| **A ✅ CHỌN** | `low→low`, `medium→medium`, `high→high`, `extra-high→xhigh`, `max→max` | Bám Claude Code tuyệt đối | Nhánh Pi có thinking ở Low, nhánh Anthropic thì không (`thinkingFromLevel` trả `{type:'disabled'}`) ⇒ **đẻ ra lệch mới** |
| **B** (đề xuất ban đầu, bị loại) | `low→off`, `medium→medium`, `high→high`, `extra-high→xhigh`, `max→max` | Sửa đúng 4 nấc đang lệch; giữ hợp đồng "Low = tắt thinking" đang dùng chung cả hai runtime | "Low" của AWOG vẫn không hoàn toàn giống "Low" của Claude Code — nhưng đó là lựa chọn **đã có chủ đích** của AWOG, giữ nguyên |

**User chốt A** (2026-09-05), ưu tiên bám picker Claude Code tuyệt đối; chấp nhận điểm lệch mới ở nấc `low` (Anthropic tắt thinking, Pi bật) và ghi lại nó như **known divergence** trong [ADR 0078 §2](../decisions/0078-reasoning-effort-parity.md). Nấc `minimal` của Pi tiếp tục không dùng ở cả hai phương án.

### B-4. Điểm sửa

Một map duy nhất, ba call-site tự hưởng:

```ts
// apps/desktop/sidecar/src/runtime/thinking.ts
const LEVEL_MAP: Record<AwogThinkingLevel, PiReasoning> = {
  low: 'low',            // was: ca đặc biệt trả undefined trước khi tra map
  medium: 'medium',      // was 'low'
  high: 'high',          // was 'medium'
  'extra-high': 'xhigh', // was 'high'
  max: 'max',            // was 'xhigh'
}

// và gỡ early-return `if (level === 'low') return undefined` trong toReasoning()
```

- Call-site (không cần sửa): [runtime/run-stream.ts:483](../../apps/desktop/sidecar/src/runtime/run-stream.ts) (chat Pi), [runtime/invoke.ts:363](../../apps/desktop/sidecar/src/runtime/invoke.ts) (task node + one-shot method của provider ngoài Anthropic), [runtime/tools/task-tool.ts:321](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) (subagent).
- Phần degrade **giữ nguyên**: `model.reasoning === false` → `undefined`; `clampThinkingLevel` + `getSupportedThinkingLevels` vẫn là lưới an toàn cho model không khai `xhigh`/`max` (Gemini sẽ nhận `high` cho cả Extra high lẫn Max — đúng năng lực model, không còn là lỗi mapping).
- **Viết lại khối comment đầu file** — nó đang mô tả sai hiện trạng và là nguồn gốc của bug.
- Không có migration dữ liệu: giá trị persist (`Session.thinkingLevel`, `settings.defaults.thinkingLevel`, `ProjectLlmDefaults.level`) và allowlist `LEVELS` ở [remote-gateway-policy.ts:251](../../apps/desktop/electron/src/remote-gateway-policy.ts) **không đổi**.

### B-5. Hệ quả người dùng (phải nói rõ khi ship)

Cùng một lựa chọn cũ, từ bản này trở đi model **nghĩ sâu hơn một nấc** trên mọi provider ngoài Anthropic ⇒ **chậm hơn và tốn token hơn**. Đây là thay đổi hành vi thấy được, không phải fix thầm lặng:

- Bắt buộc có mục trong [changelog.ts](../../apps/desktop/ui-next/utils/changelog.ts), `kind: 'fixed'`, nói thẳng "tốn token hơn ở cùng một mức".
- Cần **ADR** vì [ADR 0029 item 6](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) ghi tường minh mapping cũ. Đề xuất **ADR 0078 — "Reasoning effort parity giữa hai runtime"** (ngắn), amend item 6 của ADR 0029.

---

## 4. Thứ tự thực thi

Nhánh: `claude/sdk-version-app-effort-qg99pq`. Mỗi phase một commit riêng theo [.claude/rules/git-commit.md](../../.claude/rules/git-commit.md) (không trộn deps với feature).

### P0 — bump SDK, 0 thay đổi hành vi
- [x] `sidecar/package.json`: `0.3.235` → `0.3.260` (giữ pin chính xác)
- [x] `pnpm install` → `pnpm-lock.yaml` đổi **đúng cụm SDK** (specifier + entry + 8 optional dep per-platform), không dep nào khác trôi. Không dính store-dir mismatch
- [x] `pnpm --filter @awog/sidecar typecheck` — exit 0. **`zod/v3` không thành vấn đề**: `require.resolve('zod/v3')` ra `node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/index.cjs`, `zod` giữ nguyên 3.25.76
- [x] `pnpm --filter @awog/sidecar build` + verify binary — xem bảng size dưới
- [ ] Smoke dev: session Anthropic (stream + tool-call + resume + abort) và 1 task node — **CHƯA CHẠY**
- [ ] Commit: `chore(sidecar): bump claude-agent-sdk to 0.3.260`

**Kết quả packaging đo thật (darwin-arm64):** dự đoán ở §A-3 rằng dung lượng có thể phình là **sai hướng** — binary nhỏ đi.

| | 0.3.235 | 0.3.260 |
|---|---|---|
| `du -sh apps/desktop/sidecar/dist` | 444M | **332M** |
| `claude-agent-sdk-darwin-arm64/` | 304M | **192M** |
| binary `claude` | 313.334.608 B | **198.289.440 B** (−37%) |
| quyền | `-rwxr-xr-x` | `-rwxr-xr-x` (giữ `+x`) |

⚠️ Đây **chỉ là darwin-arm64**. CI build matrix per-OS ⇒ size của win/linux chưa đo, đừng suy ra toàn cục.

### P1 — đồng bộ effort (phương án A) ✅
- [x] Sửa `LEVEL_MAP` + gỡ early-return `'low'` + viết lại comment đầu [thinking.ts](../../apps/desktop/sidecar/src/runtime/thinking.ts)
- [x] Sửa 2 khối comment đã thành sai trong [claude-sdk/shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts) (`effortFromLevel` + `thinkingFromLevel`) — **chỉ comment, code không đổi**
- [x] Viết [ADR 0078](../decisions/0078-reasoning-effort-parity.md); ghi amend vào **dòng Trạng thái** của ADR 0029 (không sửa body item 6 — ADR Accepted là bất biến); thêm dòng 0078 + sửa ghi chú số kế tiếp trong [docs/decisions/README.md](../decisions/README.md)
- [x] [CLAUDE.md](../../CLAUDE.md): **không cần sửa** — đã grep, không có câu nào mô tả mapping thinking. [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md) dòng 78 chỉ mô tả nhánh Anthropic ⇒ vẫn đúng
- [x] `pnpm --filter @awog/sidecar typecheck` — exit 0
- [ ] Commit: `fix(runtime): align Pi reasoning effort with the Claude Code scale`

### P2 — `systemPrompt.snapshot` ✅ (nhánh chat; nhánh task cố ý KHÔNG làm)
- [x] Thêm `snapshot: true` ở [claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) (nhánh chat)
- [x] **Câu hỏi mở #2 tự tan khi đọc code.** Lo ngại "sửa `append` không áp ngay cho session đang chạy" **đã là hiện trạng** chứ không phải cái giá mới: SDK vốn đóng băng `append` ở `resume`, và code đã thiết kế quanh đúng ràng buộc đó — style / plan mode / checklist / rules **đều đã rời khỏi append** để ride trên turn prompt; phần còn lại trong `appendParts` là hằng số per-session (khối comment trên `appendParts` nói thẳng điều này). Không cần sửa [ADR 0071](../decisions/0071-senior-engineer-prompt-core.md)
- [x] Dynamic section của preset (**working directory, auto-memory, git status**) bị đóng băng theo — vô hại ở nhánh chat vì `<current_state>` với git snapshot tươi đã được prepend **mỗi turn** ([run-stream.ts:481](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts)), mới hơn và có thẩm quyền hơn bản ghi
- [x] **KHÔNG áp cho [claude-sdk/invoke.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts) (task)** — trái với dự kiến ban đầu của plan. Task node **không** có `<current_state>` trên prompt, nên dynamic section của preset là nguồn định vị git/cwd duy nhất của nó; đóng băng = đổi state sống lấy cache. Xem "còn nợ" dưới
- [ ] QA riêng: đo prompt-cache hit trước/sau trên một session dài, và verify resume qua một lần nâng app (case mà `snapshot` sinh ra để chữa)
- [ ] Commit: `perf(claude-sdk): record the system prompt once per conversation`

**Còn nợ — quyết định cho nhánh task.** Ẩn số: CLI render dynamic section **mỗi request** hay **mỗi lần launch**? `.d.ts` không nói rõ. Nếu mỗi request thì trong một node chạy dài, mỗi lần model sửa file là `git status` đổi ⇒ vỡ prefix cache + vứt reasoning ở **mọi** request sau đó — lúc đó `snapshot: true` cho task là món hời lớn, và cách làm đúng là kèm prepend `<current_state>` vào prompt của node để bù định vị. Nếu mỗi launch thì task one-shot chẳng được gì. **Cần đo trước khi làm**, không đoán.

### P3 — timeout cho MCP in-process (tuỳ chọn)
- [ ] Thêm `timeout` vào 5 in-process SDK MCP server; chọn giá trị mặc định thống nhất với timeout của MCP external
- [ ] Commit: `feat(claude-sdk): per-server timeout for in-process MCP servers`

### P4 — release (chỉ khi user muốn cắt bản)
- [ ] Bump `0.32.0` → `0.33.0` ở **4 nơi**: root, `ui-next`, `sidecar`, `electron` package.json
- [ ] Thêm entry `0.33.0` lên **đầu** `changelog.ts` (song ngữ en/vi) — CI [release.yml](../../.github/workflows/release.yml) có step **"Verify changelog is up to date"** fail build nếu top entry ≠ version, và step "Verify tag matches app version"
- [ ] Tag `v0.33.0`

---

## 5. QA / test plan

Không có test tự động cho lớp runtime ⇒ QA thủ công, chạy **sau P1** (gộp một vòng cho cả hai track).

**Parity effort (trọng tâm P1):** với mỗi provider dưới đây, chạy cùng một prompt ở "High" và ở "Max", đọc log request để xác nhận giá trị effort/reasoning gửi đi:

| Provider | Model | Kỳ vọng High | Kỳ vọng Max |
|---|---|---|---|
| Anthropic (đường Claude SDK) | Sonnet/Opus | `effort: 'high'` — **không đổi** so với trước | `effort: 'max'` — không đổi |
| OpenAI (đường Pi) | `gpt-5.x` | `reasoning: 'high'` (trước: `medium`) | `reasoning: 'max'` (trước: `xhigh`) |
| Google (đường Pi) | Gemini 3.1 Pro | `reasoning: 'high'` (trước: `medium`) | clamp về `high` — **đúng năng lực model**, không phải bug |
| Model không reasoning | Haiku 4.5 / gpt-4.1 | `undefined` — không đổi | `undefined` — không đổi |

**Regression sau bump (P0):** stream + partial message, 4 permission mode, PreToolUse hook, MCP external + 5 in-process server (`awog`/`awogssh`/`awogwiki`/`awogmemory`/api source), resume qua `sdkSessionId`, `/compact`, abort giữa turn, subagent `Task`, git auto-commit per node, token/cost hiển thị không lệch.

**Đóng gói:** build 1 bản `.AppImage` (hoặc `.dmg`) từ nhánh, cài, mở terminal panel (node-pty), chạy 1 session Anthropic để chắc `resolveClaudeBinary()` tìm ra binary trong layout đã đóng gói.

---

## 6. Rollback

- **P0:** revert 2 file (`package.json` + lockfile). Pin chính xác ⇒ không có trạng thái nửa vời.
- **P1:** revert 1 file. Không có dữ liệu persist nào mang mapping ⇒ hạ bản là xong, không cần migration ngược.
- **P2:** bỏ `snapshot` ⇒ trở lại render prompt mỗi request. Lưu ý: session đã có prompt ghi sẵn vẫn dùng bản ghi đó cho tới lúc compact.

---

## 7. Câu hỏi mở

1. ~~**Chốt phương án B-3**~~ — ✅ **đã chốt A** (2026-09-05), xem [ADR 0078](../decisions/0078-reasoning-effort-parity.md).
2. ~~**P2 `snapshot: true`**~~ — ✅ **tự tan**: đó đã là hiện trạng, không phải cái giá mới (xem P2). Câu hỏi CÒN LẠI, hẹp hơn: có bật `snapshot` cho **nhánh task** không — cần đo xem CLI render dynamic section mỗi request hay mỗi launch.
3. Có cắt release `0.33.0` ngay sau P1, hay gom thêm P2/P3 rồi mới cắt?
4. Ngoài phạm vi plan này: `pi-ai` đang `^0.84.2`, latest `0.85.0` — có muốn mở task riêng đánh giá không?
