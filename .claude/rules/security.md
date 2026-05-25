# Security — Quick scan

8 invariant AWOG **bắt buộc** check khi đụng surface nhạy cảm. Full audit: gọi agent `infosec` + skill [`security-audit`](../skills/security-audit/SKILL.md). Catalog 21 rule tham chiếu [vbsec](https://github.com/tanviet12/vbsec).

## 8 Invariant (HARD BLOCK nếu vi phạm)

1. **API key không rời sidecar.** Không bao giờ xuất hiện trong UI/log/event/trace/IPC payload đi lên UI.
2. **Path sanitize** trước mọi I/O filesystem: resolve absolute, check `startsWith(workspaceRoot)`, reject `..` literal + symlink ra ngoài.
3. **Git scope = workspace.** Mọi git spawn phải có `cwd = workspaceRoot`. Cấm `git -C <path>` từ payload UI.
4. **IPC boundary:** UI **không** `import fs`, `child_process`, model SDK. Đi qua sidecar IPC.
5. **No telemetry** ra ngoài trừ model API (allowlist host).
6. **No port public.** Production: stdio IPC. Dev HTTP chỉ khi `AWOG_DEV_HTTP=1` + dev token, bind localhost.
7. **No SSRF** từ model client / context provider. Allowlist provider host; chặn private IP + redirect không kiểm soát.
8. **No eval / dynamic require** trên payload từ workspace/UI ở sidecar.

## Sink nhạy cảm (input L1 đi vào đây phải validate/escape)

| Sink | Risk | Validate |
|---|---|---|
| `v-html` | XSS | Chỉ source kiểm soát; markdown từ user → renderer AST, không inject HTML |
| `JSON.parse(workspaceFile)` | Insecure deser | Schema (zod) trước khi đưa vào store |
| `path.join(root, userInput)` | Path traversal | `path.resolve` + `startsWith` |
| `execFile('git', [...])` | Cmd injection | arg array (không shell string), allowlist subcommand, validate ký tự |
| `fetch(urlFromUser)` | SSRF | Allowlist host, chặn private IP |
| `store.update({...payload})` | Mass assignment | Explicit pick field cho phép |
| `console.error(err)` | Verbose leak | Sanitize message cho UI; trace chỉ local log |
| Loop gọi model | Cháy tiền | Budget per task: max tokens / calls / wallclock |

## Trust level (rút từ vbsec)

| Level | Nguồn | Cần làm |
|---|---|---|
| **L1** Không tin | User input, file workspace, IPC payload, model response | Validate + escape |
| **L2** Bán tin | Store sau load từ filesystem | Re-validate khi qua sink |
| **L3** Tin | Hardcoded constant, schema cố định | OK |
| **L4** Tin | Env, framework | OK |

## Khi commit thêm dependency

- [ ] Check `npm view <pkg>`: author, weeklyDownloads, repo URL.
- [ ] Có dấu hiệu typo squatting / mới publish / 0 download? → **dừng**, hỏi user.
- [ ] Chạy `pnpm audit` sau install.
- [ ] Thêm dep lớn (UI lib, runtime) → cần ADR.

## Quick-scan grep (chạy trước commit nếu chạm surface)

```bash
cd apps/desktop/ui
rg -i '(sk-[a-z0-9]{20,}|api[_-]?key.*=.*["\047][a-z0-9]{20,})' --type ts --type vue   # hardcoded secret
rg 'v-html' --type vue                                                                  # XSS surface
rg "from ['\"](fs|child_process|@anthropic-ai|openai)" --type ts --type vue            # IPC boundary
rg '\beval\(|new Function\(' --type ts --type vue                                       # insecure
pnpm audit --prod                                                                       # known CVE
```

## Khi nào gọi agent `infosec`

- PR chạm filesystem / network / IPC / exec / parse.
- Thêm/đổi dependency.
- Trước release.
- Theo lịch (weekly).
- Code reviewer thấy red flag.
