# Data Model

Các entity cốt lõi và quan hệ giữa chúng. Chi tiết field mang tính minh họa; schema cuối cùng đi cùng feature spec.

## Sơ đồ quan hệ

```
Project ──┬─< Task ──┬─< Phase ──< Run
          │          └──> Workflow ──< Node
          │                            │
          │                            ├──> Agent ──< Skill
          │                            └──> Skill
          └────────────────────────────┘
```

- **Project** là codebase local người dùng đăng ký.
- **Workflow** là template DAG of node.
- **Task** là instance, gắn với 1 Project, dùng 1 Workflow.
- **Phase** là instance của một Node trong một Task cụ thể.
- **Phase** có lịch sử **Run** (v1, v2, … có thể bị `superseded` khi rerun).

## Entity

### Project

```
{
  id: string                    // slug duy nhất
  name: string                  // ví dụ "loyalty-service"
  path: string                  // ví dụ "~/code/acme/loyalty-service"
  description: string
  gitRemote: string             // ví dụ "git@github.com:acme/loyalty-service.git"
  gitBranch: string
  language: string              // Python | Go | TypeScript | ...
  createdAt: timestamp
}
```

### Agent

```
{
  id: string
  name: string
  role: string                  // BA, SA, DEV, REVIEW, QA, DevOps, Security, ...
  model: enum                   // claude-opus-4-7, claude-sonnet-4-6, gpt-5, o3, codex-1, gemini-2-5-pro, llama-3-3-70b, ...
  systemPrompt: string
  skillIds: string[]
  context: string[]             // artifacts | gitnexus | filesystem | notion | jira | slack
}
```

### Skill

```
{
  id: string
  name: string                  // snake_case, ví dụ design_architecture
  category: enum                // Analysis | Design | Development | Quality
  description: string
  inputs:  string[]             // ví dụ ["requirement.md", "existing_codebase"]
  outputs: string[]             // ví dụ ["architecture.md", "component_diagram.mmd"]
  promptTemplate: string
  tags: string[]                // ví dụ ["planning", "code", "review"]
}
```

### Workflow

```
{
  id: string
  name: string
  description: string
  nodes: Node[]
  edges: Edge[]
}

Node = {
  id: string
  agentId: string
  skillId: string
  x: number                     // canvas position
  y: number
  outputs: string[]             // tên artifact node sản xuất
  approval: boolean             // có approval gate sau node này không
}

Edge = { from: nodeId, to: nodeId }
```

### Task

```
{
  id: string                    // ví dụ "tsk-001"
  title: string
  projectId: string             // bắt buộc — task luôn gắn project
  source: Source                // github | jira | manual
  description: string
  workflowId: string
  status: queued | running | waiting_approval | completed | failed
  currentNodeId: string | null
  waitingApproval: nodeId | null
  createdAt: timestamp
  phases: Record<nodeId, Phase>
}

Source =
  | { type: 'github', repo, issueNumber, url }
  | { type: 'jira',   key }
  | { type: 'manual' }
```

### Phase

Phase là instance của một Node trong context một Task.

```
{
  nodeId: string
  status: pending | running | waiting_approval | completed | failed
  skillName: string             // denormalize để hiển thị nhanh
  runs: Run[]                   // lịch sử run, mới nhất ở cuối
}
```

### Run

Mỗi lần Phase được thực thi tạo ra một Run. Rerun-from-here đẩy run cũ thành `superseded` và tạo run mới với version tăng.

```
{
  version: number               // 1, 2, 3, ...
  status: running | waiting_approval | completed | superseded | failed
  output: string                // nội dung artifact (hoặc reference tới file)
  trace: TraceNode[]
  messages: Message[]           // discussion với agent ở phase này
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: timestamp
  triggeredBy?: 'rerun'         // có nếu được tạo bởi rerun-from-here
}

Message = { role: 'user' | 'agent', text: string, at: timestamp }
```

### TraceNode (trong Run)

```
{
  id: string
  type: 'agent' | 'subagent' | 'tool' | 'thinking'
  // agent / subagent
  name?: string
  model?: string
  purpose?: string              // chỉ cho subagent
  // tool
  tool?: string                 // ví dụ "gitnexus.semantic_search"
  input?: string
  result?: string
  // thinking
  text?: string
  // chung
  duration: string | null
  startedAt?: string
  status?: 'running'            // có khi đang chạy
  children?: TraceNode[]
}
```

### Artifact

Một file thuần trên đĩa dưới `artifacts/`. Định dạng được hỗ trợ:

- `.md` — markdown, render kèm mermaid diagram
- `.diff` / `.patch` — diff viewer chuyên dụng
- `.yaml` / `.yml` — editor thường
- `.mmd` — mermaid source

Metadata suy ra từ Git (history, author, timestamp).

### Trace Event (persisted)

Khác với `TraceNode` (in-memory cấu trúc cây), trace event là dòng JSON Lines lưu trên đĩa:

```
{
  timestamp
  taskId
  phaseId
  runVersion
  type: 'tool_call' | 'sub_agent' | 'context_read' |
        'artifact_read' | 'artifact_write' | 'approval' | 'error'
  payload: object
}
```

Lưu tại `tasks/<id>/events.log`.

### Session

State per-agent — message history, cache định nghĩa tool. Lưu tại `sessions/<agent>.json`.
