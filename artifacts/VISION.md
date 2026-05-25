# AWOG

Artifact Workflow Orchestrate Guild

Build AI Teams, Not AI Chats.

---

## Product Vision

AWOG is a local-first AI Team Operating System that enables users to design, orchestrate, and execute specialized AI teams through workflows, artifacts, skills, and context providers.

Instead of interacting with a single AI agent, users create reusable AI guilds composed of multiple agents collaborating through artifacts and workflows.

The system is designed to work across software development, marketing, legal, finance, research, and any knowledge-based process.

---

## Core Philosophy

Artifacts are the source of truth.

Agents collaborate through artifacts, not chat history.

Workflows define how work moves between agents.

Skills define capabilities.

Context providers dynamically supply knowledge.

Humans remain in control through approval checkpoints.

---

## Technology Stack (MVP)

Frontend:
- Nuxt 4
- Vue 3
- TypeScript
- Pinia
- VueFlow
- TailwindCSS
- Monaco Editor

Storage:
- Local Filesystem
- JSON/YAML files
- Git for versioning

Runtime:
- Nuxt Server API
- Anthropic SDK
- OpenAI SDK

Deployment:
- Local Web Application
- No backend service
- No database initially

---

## Workspace Structure

workspace/

├── agents/
├── skills/
├── workflows/
├── tasks/
├── artifacts/
├── sessions/
└── .git/

Git automatically tracks all artifact changes.

---

# Core Modules

## 1. Agent Builder

Users can create custom agents.

Agent properties:

- Name
- Role
- Description
- Model
- System Prompt
- Skills
- Context Providers

Examples:

- Business Analyst
- Solution Architect
- Developer
- QA Engineer
- Security Specialist
- SEO Expert
- Tax Consultant

Supported Models:

- Claude Opus
- Claude Sonnet
- GPT-5
- Codex
- Gemini
- Local Models

---

## 2. Skill Builder

Skills represent reusable capabilities.

Examples:

- Gather Requirements
- Design Architecture
- Design API
- Implement Feature
- Refactor Code
- Fix Bug
- Code Review
- Security Audit
- Run QA

Skill structure:

- Inputs
- Outputs
- Prompt Template
- Description

---

## 3. Workflow Builder

Visual drag-and-drop workflow editor.

Built with VueFlow.

Example:

Business Analyst
      ↓
Solution Architect
      ↓
Developer
      ↓
Code Review
      ↓
QA

Features:

- DAG workflow
- Agent assignment
- Skill assignment
- Output mapping
- Approval gates
- Workflow versioning

---

## 4. Artifact System

Artifacts are the shared memory between agents.

Examples:

- requirement.md
- architecture.md
- api.yaml
- patch.diff
- review.md
- test-report.md

Features:

- Markdown support
- Version history
- Diff viewer
- Artifact explorer
- Git integration

Artifacts are the primary collaboration mechanism.

---

## 5. Task Execution Engine

Tasks execute workflows.

Sources:

- Manual task
- GitHub Issue
- Jira Ticket
- Local Request

Execution:

Task
↓
Workflow
↓
Agent
↓
Skill
↓
Artifact
↓
Next Agent

Statuses:

- Queued
- Running
- Waiting Approval
- Failed
- Completed
- Superseded

---

## 6. Human Approval System

Humans remain part of the workflow.

Actions:

- Approve
- Reject
- Comment
- Request Changes
- Rerun

Example:

Architecture v1
↓
Feedback
↓
Architecture v2
↓
Continue Workflow

---

## 7. Session System

Each agent has an isolated session.

sessions/

├── ba.json
├── architect.json
├── developer.json
└── reviewer.json

Benefits:

- Reduced context pollution
- Independent memory
- Better specialization

---

## 8. Context Provider System

Agents can access external knowledge sources.

Initial Providers:

- Artifacts
- Filesystem

Future Providers:

- GitNexus
- GitHub
- Jira
- Notion
- Confluence
- Slack
- Databases

Each agent chooses which providers it can access.

---

## 9. Agent Trace & Observability

Users can inspect exactly how agents work.

Trace Example:

Architect
 ├── Read requirement.md
 ├── Search codebase
 ├── Spawn sub-agent
 ├── Generate architecture.md
 └── Write artifact

Visible Events:

- Tool Calls
- Sub Agents
- Context Retrieval
- Artifact Read/Write
- Execution Timeline

---

# MVP Scope (First Release)

Included:

✅ Agent Builder
✅ Skill Builder
✅ Workflow Builder
✅ Task Runner
✅ Artifact Viewer
✅ Human Approval
✅ Agent Trace
✅ Local Filesystem Storage
✅ Git Versioning

Excluded:

❌ Database
❌ Cloud Sync
❌ Multi-user
❌ Authentication
❌ GitNexus
❌ RAG
❌ Jira Integration
❌ Slack Integration
❌ Marketplace

---

# Product Positioning

AWOG is not:

- Claude Desktop
- Codex App
- Cursor
- Cline
- Roo Code

Those tools focus on individual AI agents.

AWOG focuses on AI teams.

Claude, Codex, GPT, and Gemini are workers inside a larger workflow system.

---

# Mission

Create an operating system for AI teams where users can design reusable workflows, define specialized agents, manage artifact-driven collaboration, and orchestrate complex work across multiple AI roles while maintaining human oversight.
