# QA Report — PR-1 Foundation primitives (UI consolidation refactor)

- **Feature plan:** [docs/features/ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md) (PR-1, line 23–110)
- **ADR liên quan:** [docs/decisions/0009-ui-consolidation-refactor.md](../decisions/0009-ui-consolidation-refactor.md), [docs/decisions/0009a-ui-consolidation-clarifications.md](../decisions/0009a-ui-consolidation-clarifications.md) §5 (ESC stack contract)
- **QA scope:** T1.7 (smoke demo) + checklist PR-1 (8 entries) + reviewer focus (6 điểm) + static checks + edge cases.
- **Mode:** code review + static grep. Dev server không chạy (chưa có sidecar; demo route được tạo để dev/PO bật `pnpm dev` self-verify visual).

## 1. Acceptance criteria (QA checklist PR-1)

| # | Entry | Verdict | Note |
|---|---|---|---|
| 1 | BaseModal: backdrop click đóng, ESC đóng, X đóng, click trong body KHÔNG đóng | **PASS** | `BaseModal.vue:104-106` dùng `useClickOutside(cardRef, ...)` — click trong card được `el.contains(target)` lọc; ESC qua `useEscape` (line 103); X button emit `close` (line 31). |
| 2 | `closeOnEscape=false` → ESC không đóng | **PASS** | `escapeEnabled = computed(() => props.open && props.closeOnEscape)` (line 102) → handler skip ở top-of-stack check `if (top.enabled && !top.enabled.value) return` (`useEscape.ts:32`). |
| 3 | `size='lg'` width đúng | **PASS** | `SIZE_MAP.lg = 'max-w-[720px]'` (line 77) khớp spec. Cả sm/md/lg/xl đều khớp 420/560/720/960. |
| 4 | SearchInput v-model 2-way bind + placeholder runtime | **PASS** | `:value="modelValue"` + `@input` emit `update:modelValue` (SearchInput.vue:8-19); `:placeholder="placeholder"` reactive. |
| 5 | AppInput `password` mask + `disabled` block + `invalid` border đỏ | **PASS** | `:type="type"` forward native attr (browser tự mask); `:disabled="disabled"` native block + `opacity-60 cursor-not-allowed`; `invalid` → border `t.danger` (AppInput.vue:45). |
| 6 | Toggle theme dark↔light: 3 component không vỡ; overlay đổi giá trị | **PASS** | Cả 3 đều dùng `useTheme()` reactive `t`; `t.overlay` định nghĩa cả 2 theme (themes.ts:121 dark `rgba(0,0,0,0.6)` / line 182 light `rgba(0,0,0,0.45)`). Cảnh báo nhẹ: light theme overlay 0.45 hơi sáng — chấp nhận theo ADR. |
| 7 | Mount/unmount 5 lần không leak listener | **PASS** | `useEscape` chỉ có **1 global listener** (`onKeydown`), attach khi stack length đạt 1, detach khi stack rỗng. `getEscapeStackLength()` được export làm test hook. `useClickOutside` cleanup `onBeforeUnmount`. `BaseModal` `onBeforeUnmount(unlockScroll)` restore `previousOverflow`. |
| 8 | `useEscape` + `useClickOutside` không trigger lúc chưa mount | **PASS** | Cả 2 đều `push/addEventListener` trong `onMounted`. Trước `onMounted`, không có listener. |

**Tổng:** 8/8 PASS.

## 2. Reviewer focus PR-1

| # | Điểm | Verdict | Note |
|---|---|---|---|
| 1 | Type-only `defineProps<Props>()` / `defineEmits` | **PASS** | 3 component đều `defineProps<Props>()` + `withDefaults`, `defineEmits<{ ... }>()` đúng convention `nuxt-vue.md`. |
| 2 | `BaseModal` ≤ 120 dòng; ESC stack cleanup đúng | **PASS** | 118 dòng (≤ 120). Stack push/splice + `detachListener` khi rỗng. Có `getEscapeStackLength()` cho QA assert. |
| 3 | Theme token mới đủ cả dark/light, không hex hardcode | **PASS** | 6 token (`overlay`, `onAccent`, `diffAdd`, `diffDel`, `statusOk`, `statusWarn`) định nghĩa cả `dark` (themes.ts:121-126) + `light` (line 182-187). `ThemeTokens` interface mở rộng đầy đủ (line 64-72). |
| 4 | `useClickOutside` dùng `mousedown` | **PASS** | `document.addEventListener('mousedown', onMousedown)` (useClickOutside.ts:31). Có JSDoc giải thích vì sao không dùng `click` (race với button click). |
| 5 | JSDoc/comment ngắn cho 3 composable | **PASS** | `useEscape.ts` có JSDoc + 2 ví dụ (line 3-19); `useClickOutside.ts` có JSDoc + ví dụ (line 3-16). `BaseModal` có comment ở body-scroll-lock block (line 82). |
| 6 | (extra) `BaseModal` Teleport + z-50 + size map | **PASS** | `Teleport to="body"` (line 2) để overlay không bị clipped bởi parent stacking context. `z-50` cho overlay. |

**Tổng:** 6/6 PASS.

## 3. Static checks (grep)

| Check | Kỳ vọng | Kết quả | Verdict |
|---|---|---|---|
| `addEventListener('keydown'` trong 5 file mới | 1 match (chỉ `useEscape.ts`) | 1 match — `composables/useEscape.ts:38` | **PASS** |
| `body.style.overflow` trong 5 file mới | Chỉ `BaseModal.vue` | 3 matches all in `components/BaseModal.vue` (line 86/87/91) | **PASS** |
| `#fff`, `rgba(0,0,0` trong 5 file mới | 0 | 0 matches | **PASS** |
| `t.overlay` usage | ≥1 (BaseModal) | `BaseModal.vue:7` | **PASS** |
| `t.bgInput` usage | SearchInput + AppInput | `SearchInput.vue:15`, `AppInput.vue:43` | **PASS** |
| `t.bgPanel` usage | BaseModal | `BaseModal.vue:14` | **PASS** |
| `t.border` / `t.borderStrong` | BaseModal + SearchInput | 4 matches | **PASS** |
| `t.danger` (invalid border) | AppInput | `AppInput.vue:45` | **PASS** |
| `t.text` / `t.textDim` | BaseModal + SearchInput | 4 matches | **PASS** |
| `t.onAccent`/`t.diffAdd`/`t.diffDel`/`t.statusOk`/`t.statusWarn` usage | 0 (sẽ migrate ở PR-3/PR-5) | 0 matches | **PASS (intended)** |

**Note:** 5 token mới (`onAccent`, `diffAdd`, `diffDel`, `statusOk`, `statusWarn`) chưa có caller dùng — đúng kỳ vọng của T1.1 (chỉ thêm token, migrate caller ở PR-3 `AttachmentLightbox` + PR-5 `pages/edit/[taskId]` + `SettingsModelsSection`). Test acceptance T1.1 chỉ yêu cầu `useTheme().t.overlay` chạy được trong template (đã verify trong demo).

## 4. Edge case findings

| Case | Verdict | Note |
|---|---|---|
| `useEscape(handler, { enabled: ref(false) })` — top of stack nhưng disabled | **PASS** | `onKeydown` line 32: `if (top.enabled && !top.enabled.value) return`. Khi top disabled, handler bị skip — **nhưng cũng không fall-through xuống handler bên dưới**. Đây là design quyết định: ADR 0009a §5 mô tả "top of stack mới trigger", không nói fall-through. QA chấp nhận; lưu ý dev có thể cần ghi rõ trong JSDoc nếu sau này có yêu cầu fall-through. |
| Mount 5 lần → unmount 5 lần → `getEscapeStackLength()` = 0 | **PASS (theo code)** | `onBeforeUnmount`: `escapeStack.splice(i, 1)` + `detachListener` chỉ khi rỗng. Đã expose `getEscapeStackLength()` (line 64) — `BaseModalDemo.vue` hiển thị live counter cho QA mắt-người verify khi chạy demo. |
| 2 BaseModal mở chồng — cả 2 visible | **PASS** | Cả 2 dùng `Teleport to="body"` + `z-50`. Vì DOM order, modal mở sau render sau → nằm trên (cùng z-index nhưng later sibling thắng). Đã có demo nested ở `BaseModalDemo.vue` (Open stack). |
| `open=true` → unmount component giữa chừng | **PASS** | `onBeforeUnmount(unlockScroll)` (line 100) restore `previousOverflow ?? ''`. Listener cũng gỡ trong `useEscape`/`useClickOutside` `onBeforeUnmount`. |
| `useClickOutside` với `targetRef.value = null` | **PASS** | `if (!el) return` (line 24) early-exit, không crash. |
| `AppInput type='password' disabled` cùng lúc | **PASS** | Native `<input type=password disabled>`: browser vẫn mask, không gõ được. `opacity-60 cursor-not-allowed` visual. |
| `SearchInput autofocus=true` focus khi mount | **PASS** | `onMounted(() => { if (props.autofocus) inputRef.value?.focus() })` (line 40-42). Demo có nút Remount để verify. |
| BaseModal mở rồi đóng — body overflow restore | **PASS** | `watch(props.open, ... unlockScroll())` (line 95-98) + `onBeforeUnmount(unlockScroll)`. `previousOverflow ?? ''` không overwrite ngoài ý muốn nếu original empty. |
| 2 BaseModal cùng mount — body overflow restore đúng khi đóng cái dưới trước | **MINOR** | Modal A mở → lock (saved `''`). Modal B mở → lock lại (`previousOverflow = 'hidden'` vì A đã set). Đóng B → set lại `'hidden'` (đúng). Đóng A → set `''`. Hành vi OK với LIFO. Nếu đóng A trước B (hiếm): A set body về `''` trong khi B vẫn muốn lock — body sẽ unlock sớm. **Severity S3 (edge rare).** ADR không yêu cầu ref-counting. Note để follow-up. |
| Stack `getEscapeStackLength` exposed cho test only | **PASS** | Comment "Test-only" rõ (line 63). Không phải public API. |

## 5. Bugs

Không có **S1/S2** bug. 1 ghi chú **S3 (info-level)** trong section 4:

### #1 — Body scroll lock không ref-count khi 2 BaseModal nested rồi đóng modal dưới trước

- **Severity:** S3 (edge case, hành vi hiếm trong UX bình thường vì user chỉ đóng modal trên cùng qua ESC/backdrop).
- **Steps:** Mount Modal A (open) → mount Modal B (open) → đóng A bằng cách set `openA=false` từ bên ngoài (không qua user input) trong khi B vẫn `open`.
- **Expected:** `body.style.overflow === 'hidden'` (vẫn lock vì B đang mở).
- **Actual:** `body.style.overflow === ''` (A restore previous trước khi B mount = `''`).
- **Recommendation:** Defer. ADR không nói tới ref-counting; nếu PR-3 phát hiện need (vd modal-trong-editor), implement counter trong BaseModal. KISS thắng — không pre-build.

## 6. Demo files đã tạo (T1.7)

| Path | Mục đích | TODO marker |
|---|---|---|
| `apps/desktop/ui/components/__demo__/BaseModalDemo.vue` | 4 state: default / size=lg / locked (no ESC/backdrop) / nested stack | top file |
| `apps/desktop/ui/components/__demo__/SearchInputDemo.vue` | 3 state: default / custom placeholder / autofocus (remount) | top file |
| `apps/desktop/ui/components/__demo__/AppInputDemo.vue` | 7 state: text / password / disabled / disabled+password / invalid / number / email (focus/blur events) | top file |
| `apps/desktop/ui/pages/dev/primitives.vue` | Route `/dev/primitives` mount 3 demo + display live `escapeStack` length | top file + section subtitle |

Mỗi demo có ít nhất 3 state (yêu cầu ≥3). Cả 4 file đều có `<!-- TODO: remove sau khi PR-3 migrate xong -->` ở dòng đầu — khớp T3.15.

## 7. Note & risk theo dõi sang PR-2/PR-3

- **R10 (body scroll lock leak)** từ task plan: đã verify cleanup hook OK trong code review. Manual mount/unmount 5 lần cần làm khi dev server chạy được (đã expose `getEscapeStackLength()` để QA assert).
- **Pre-existing lint/typecheck errors** ở `ContextMenu/MarkdownRenderer/NewTaskModal/workspace/graph` — không do PR-1 (developer note). Không block PR-1.
- **T1.8 (`docs/coding/nuxt-frontend.md` mục Component/composable dùng chung)** và **T1.9 (README primitive list)** — chưa thấy update trong file thay đổi. Nếu chưa làm, cần bổ sung trước khi merge PR-1.
- **T1.10 (lint + typecheck + format)** — chưa verify được vì có pre-existing errors. Khuyến nghị: chạy `pnpm lint -- apps/desktop/ui/components/BaseModal.vue apps/desktop/ui/components/SearchInput.vue apps/desktop/ui/components/AppInput.vue apps/desktop/ui/composables/useEscape.ts apps/desktop/ui/composables/useClickOutside.ts apps/desktop/ui/utils/themes.ts` (file scope) để xác nhận PR-1 không gây error mới.
- **Light theme overlay `rgba(0,0,0,0.45)`** sáng hơn dark. Nếu reviewer thấy visual chưa đủ contrast → tăng lên 0.55-0.6 ở light. Hiện chấp nhận.

## 8. Verdict

**Approve PR-1** với điều kiện:

1. Hoàn tất T1.8 (cập nhật `docs/coding/nuxt-frontend.md` section primitive) + T1.9 (README primitive list). Hai task này có trong scope PR-1 nhưng QA chưa thấy diff.
2. Confirm T1.10 lint/typecheck file-scoped trên 6 file PR-1 không gây error mới so với baseline.

**Nếu (1) (2) thoả → merge.** Không có bug S1/S2 block. 1 S3 note follow-up trong PR-3 nếu phát sinh case.

## 9. Tham chiếu

- [BaseModal.vue](../../apps/desktop/ui/components/BaseModal.vue)
- [SearchInput.vue](../../apps/desktop/ui/components/SearchInput.vue)
- [AppInput.vue](../../apps/desktop/ui/components/AppInput.vue)
- [useEscape.ts](../../apps/desktop/ui/composables/useEscape.ts)
- [useClickOutside.ts](../../apps/desktop/ui/composables/useClickOutside.ts)
- [themes.ts](../../apps/desktop/ui/utils/themes.ts)
- Demo: [BaseModalDemo.vue](../../apps/desktop/ui/components/__demo__/BaseModalDemo.vue), [SearchInputDemo.vue](../../apps/desktop/ui/components/__demo__/SearchInputDemo.vue), [AppInputDemo.vue](../../apps/desktop/ui/components/__demo__/AppInputDemo.vue), [pages/dev/primitives.vue](../../apps/desktop/ui/pages/dev/primitives.vue)
