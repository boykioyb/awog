# Creator Scope Selector — ô "Save to" cho LLM creators

## Vấn đề

Các luồng tạo-bằng-LLM (Agents, Skills, Rules, Commands, Hooks) không cho người
dùng chọn **lưu cấu hình vào đâu**. Hậu quả:

- **Agents**: form không gửi scope → mọi agent luôn ghi vào global `~/.awog/agents`,
  không thể tạo agent gắn theo project.
- **Skills**: gửi cả danh sách `projectIds` để **LLM tự đoán** chỗ ghi.
- **Rules / Commands / Hooks**: handler save **hardcode `source: 'global'`**.

Hạ tầng tier `{project}/.awog/<type>` (scan + `*.upsert` nhận `source`/`projectId`)
đã sẵn từ [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) nhưng UI chưa
phơi ra lựa chọn.

## Giải pháp

Thêm ô **"Save to"** (component dùng chung
[`CreatorScopePicker.vue`](../../apps/desktop/ui/components/CreatorScopePicker.vue))
vào mọi creator. Giá trị `scope` là chuỗi:

- `'global'` → tier global (`~/.awog/<type>`), nhãn **"User & Global"**.
- `<projectId>` → tier project (`{project}/.awog/<type>`).

Mặc định `'global'`. Danh sách project lấy từ `ws.projects` — khớp đúng các nhóm
mà trang list đang hiển thị. Đây là pattern đã có sẵn ở
[`WorkflowPromptCreator.vue`](../../apps/desktop/ui/components/workflows/WorkflowPromptCreator.vue)
(nay cũng dùng chung component này).

### Hai pattern khác nhau

| Nhóm | Cơ chế | Thay đổi |
|---|---|---|
| **Agents, Skills** | *author* — LLM tự ghi file qua tool Write; systemPrompt quyết path | BE + FE |
| **Rules, Commands, Hooks** | *generate* — trả draft, UI bấm Save → `*.upsert` (đã nhận `source`/`projectId`) | chỉ FE |

### Author flow (Agents / Skills) — BE

`agents.author` / `skills.author` nhận `scope: string` (thay mảng `projectIds` cũ),
rồi resolve **đúng 1 thư mục đích + `cwd`**:

- global → `cwd = awogHome()`, dir `~/.awog/{agents|skills}`
- project → `cwd = {project}.path`, dir `{project}/.awog/{agents|skills}`

`systemPrompt` chỉ định **đúng một path** (bỏ list legacy `.claude`/`.agents`,
khớp ADR 0035 D-1/D-3). `cwd` được truyền vào `authorPi` — **bắt buộc** vì tool
`Write` gọi `assertInsideWorkspace(cwd, …)`: nếu `cwd` không chứa path đích thì
Write bị từ chối (đây cũng là bug fragile cũ khi `cwd` mặc định là `process.cwd()`).

> Liên quan: author flow chỉ được cấp tool `Write/Read/Edit` (xem
> [complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts)) — không có Bash
> để tránh model "thăm dò shell" rồi báo *"shell không khả dụng"*.

### Generate flow (Rules / Commands / Hooks) — chỉ FE

`{Rule,Command,Hook}PromptCreator.vue` thêm prop `projects` + state `scope`, đặt
`<CreatorScopePicker>` vào slot `#controls`, đổi emit `save: [draft, scope]`.
Trang tương ứng map `scope` → `source`/`projectId` trước khi `*.upsert`:

```ts
source: scope === 'global' ? 'global' : 'project',
...(scope !== 'global' ? { projectId: scope } : {}),
```

Không sửa backend (generate chỉ trả text; upsert đã scope sẵn).

## File chạm

- Mới: `components/CreatorScopePicker.vue`, i18n key `creator.save_to` (en+vi).
- BE: `methods/agents.author.ts`, `methods/skills.author.ts`.
- FE creator: `agent/AgentPromptCreator.vue`, `skill/SkillPromptCreator.vue`,
  `rule/RulePromptCreator.vue`, `command/CommandPromptCreator.vue`,
  `hook/HookPromptCreator.vue`, `workflows/WorkflowPromptCreator.vue` (migrate).
- FE page: `pages/rules`, `pages/commands`, `pages/hooks` (map scope khi save).

## Không làm (out of scope)

- Không phơi lựa chọn định dạng thư mục (`.claude` / `.agents`) — chỉ `.awog`.
- Rules/Commands/Hooks `*.generate` vẫn trả text (không tự ghi file) như cũ.
