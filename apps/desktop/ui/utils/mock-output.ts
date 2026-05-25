import type { TraceNode } from '~/types'

export function mockPatch(): string {
  return `diff --git a/src/loyalty/reward_service.py b/src/loyalty/reward_service.py
index a1b2c3d..e4f5g6h 100644
--- a/src/loyalty/reward_service.py
+++ b/src/loyalty/reward_service.py
@@ -1,8 +1,12 @@
 from datetime import datetime, timedelta
+from .partitioning import shard_for_user
+from .audit import ExpirationAuditLog

 class RewardService:
-    def expire_points(self, user_id: str) -> None:
-        # Old: single-threaded scan
-        pass
+    def expire_points(self, user_id: str) -> None:
+        shard = shard_for_user(user_id)
+        with self.lock(f"expire:{shard}"):
+            self._do_expire(user_id, shard)
+            ExpirationAuditLog.record(user_id, shard, datetime.utcnow())
diff --git a/src/loyalty/partitioning.py b/src/loyalty/partitioning.py
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/loyalty/partitioning.py
@@ -0,0 +1,12 @@
+import hashlib
+
+NUM_SHARDS = 8
+
+def shard_for_user(user_id: str) -> int:
+    h = hashlib.md5(user_id.encode()).hexdigest()
+    return int(h, 16) % NUM_SHARDS
`
}

export function mockOutput(skillName: string): string {
  const outputs: Record<string, string> = {
    gather_requirements: `# Loyalty Point Expiration — Requirements v1

## Context
Users accumulate loyalty points with no expiration, creating an unbounded liability on the balance sheet. Finance has flagged this as a Q4 priority.

## User Stories
- As a customer, I want visibility into when my points expire
- As finance, I want points to expire after 12 months of inactivity
- As marketing, I want to notify users 30 days before expiration

## Acceptance Criteria
- Points expire 12 months after the last earning event
- Email + push notification sent 30 days prior
- Expired points are archived, not deleted
- Audit log records all expiration events

## Out of Scope
- Manual override of expiration dates
- Partial point expiration

## Open Questions
- Should B2B accounts be excluded?
- What is the customer-facing copy for the notification?`,

    design_architecture: `# Architecture v2 (revised)

## Components
- **LoyaltyExpirationScheduler** — 8 partitioned workers, sharded by hash(user_id) % 8 to prevent backpressure
- **ExpirationCalculator** — pure function, fully testable
- **NotificationDispatcher** — reuses existing notification channel
- **ExpirationAuditLog** — append-only, partition-scoped run_id

## Data Flow
\`\`\`mermaid
graph TB
  S[Scheduler 0..7] --> C[Calculator]
  C --> D[Dispatcher]
  C --> A[Archiver]
  D --> L[AuditLog]
  A --> L
\`\`\`

## Key Decisions
- Partitioned workers solve the "scheduler falling behind" concern raised in review
- Per-partition run_id prevents cross-shard double-processing
- Soft-archive for 90 days before purge

## Risks
- Hot shards if user activity is skewed — mitigation: monitor per-shard lag
- Notification dispatcher rate limits — mitigation: token bucket per shard

## Dependencies
- Redis for distributed locks
- Existing job runner (BullMQ)
- Analytics service for downstream consumption`,

    design_api: `openapi: 3.0.3
info:
  title: Loyalty Expiration API
  version: 1.0.0
paths:
  /loyalty/expiration/{user_id}:
    get:
      summary: Get expiration schedule for a user
      parameters:
        - name: user_id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Expiration data
`,

    fix_bug: `// payment_retry.py — patched
# Acquire distributed lock before processing retry
with redis_lock(f"payment:retry:{payment_id}", ttl=30):
    if self.repo.is_already_processed(payment_id):
        return  # webhook already handled it
    self._process_retry(payment_id)`,

    review_code: `# Code Review v1

## Strengths
- Distributed lock correctly scoped to payment_id
- Idempotency check after lock acquisition prevents TOCTOU
- TTL of 30s is reasonable for retry timeout

## Issues Found
1. **[MEDIUM]** Lock acquisition has no timeout — could block worker indefinitely if Redis is slow
2. **[LOW]** Missing structured log for lock contention events

## Recommendation
Approve with minor revisions. Block merge until #1 is addressed.`,
  }

  return outputs[skillName] || `# ${skillName} output\nMock content generated.`
}

export function mockArtifactContent(skillName: string, fileName: string): string {
  if (skillName === 'design_architecture') {
    if (fileName === 'architecture.md') return mockOutput('design_architecture')
    if (fileName === 'api.yaml') return mockOutput('design_api')
  }
  if (skillName === 'implement_feature' || skillName === 'fix_bug') {
    if (fileName.endsWith('.diff') || fileName.endsWith('.patch')) return mockPatch()
  }
  return mockOutput(skillName)
}

export function makeTrace(
  agentId: string,
  kind: 'requirements' | 'architecture' | 'fix' | 'review',
): TraceNode[] {
  if (kind === 'requirements') {
    return [
      {
        id: 't1',
        type: 'agent',
        agentId,
        name: 'Business Analyst',
        model: 'claude-opus-4-7',
        startedAt: '0.0s',
        duration: '24s',
        children: [
          {
            id: 't2',
            type: 'tool',
            tool: 'notion.search',
            input: 'loyalty program docs',
            duration: '1.2s',
            result: '4 documents found',
          },
          {
            id: 't3',
            type: 'tool',
            tool: 'jira.fetch',
            input: 'PLAT-1284',
            duration: '0.4s',
            result: 'Ticket fetched',
          },
          {
            id: 't4',
            type: 'thinking',
            text: 'Synthesizing requirements from stakeholder docs and existing tickets...',
            duration: '8.1s',
          },
          {
            id: 't5',
            type: 'tool',
            tool: 'artifact.write',
            input: 'requirement.md',
            duration: '0.2s',
            result: 'Created v1',
          },
        ],
      },
    ]
  }
  if (kind === 'architecture') {
    return [
      {
        id: 't1',
        type: 'agent',
        agentId,
        name: 'Solution Architect',
        model: 'claude-opus-4-7',
        startedAt: '0.0s',
        duration: '42s',
        children: [
          {
            id: 't2',
            type: 'tool',
            tool: 'artifact.read',
            input: 'requirement.md',
            duration: '0.1s',
            result: 'Loaded v1',
          },
          {
            id: 't3',
            type: 'subagent',
            agentName: 'Code Explorer',
            model: 'claude-sonnet-4-6',
            purpose: 'Analyze existing scheduler patterns',
            duration: '14s',
            children: [
              {
                id: 't3a',
                type: 'tool',
                tool: 'gitnexus.semantic_search',
                input: 'scheduler cron job worker',
                duration: '1.8s',
                result: '12 candidates',
              },
              {
                id: 't3b',
                type: 'tool',
                tool: 'gitnexus.read',
                input: 'src/jobs/scheduler.py',
                duration: '0.3s',
                result: '247 LOC',
              },
              {
                id: 't3c',
                type: 'thinking',
                text: 'Existing pattern uses BullMQ with Redis.',
                duration: '4.2s',
              },
            ],
          },
          {
            id: 't4',
            type: 'subagent',
            agentName: 'Dependency Analyzer',
            model: 'claude-sonnet-4-6',
            purpose: 'Check downstream consumers',
            duration: '8s',
            children: [
              {
                id: 't4a',
                type: 'tool',
                tool: 'gitnexus.find_callers',
                input: 'LoyaltyEvent',
                duration: '2.1s',
                result: '6 callers found',
              },
            ],
          },
          {
            id: 't5',
            type: 'thinking',
            text: 'Designing partitioned scheduler...',
            duration: '12s',
          },
          {
            id: 't6',
            type: 'tool',
            tool: 'artifact.write',
            input: 'architecture.md',
            duration: '0.3s',
            result: 'Created v2',
          },
        ],
      },
    ]
  }
  if (kind === 'fix') {
    return [
      {
        id: 't1',
        type: 'agent',
        agentId,
        name: 'Senior Developer',
        model: 'claude-sonnet-4-6',
        startedAt: '0.0s',
        duration: '52s',
        children: [
          {
            id: 't2',
            type: 'tool',
            tool: 'github.fetch_issue',
            input: 'acme/payment-service#891',
            duration: '0.6s',
            result: 'Issue loaded',
          },
          {
            id: 't3',
            type: 'subagent',
            agentName: 'Bug Reproducer',
            model: 'claude-sonnet-4-6',
            purpose: 'Reproduce race condition locally',
            duration: '18s',
            children: [
              {
                id: 't3a',
                type: 'tool',
                tool: 'gitnexus.semantic_search',
                input: 'payment retry handler',
                duration: '1.4s',
                result: '3 files',
              },
              {
                id: 't3b',
                type: 'tool',
                tool: 'shell.run',
                input: 'pytest tests/test_retry_race.py -x',
                duration: '8.4s',
                result: '1 failed (reproduced)',
              },
            ],
          },
          {
            id: 't4',
            type: 'tool',
            tool: 'filesystem.edit',
            input: 'src/payments/retry.py',
            duration: '0.4s',
            result: 'Patched',
          },
          {
            id: 't5',
            type: 'tool',
            tool: 'shell.run',
            input: 'pytest tests/test_retry_race.py',
            duration: '7.2s',
            result: '1 passed',
          },
        ],
      },
    ]
  }
  if (kind === 'review') {
    return [
      {
        id: 't1',
        type: 'agent',
        agentId,
        name: 'Code Reviewer',
        model: 'codex-1',
        startedAt: '0.0s',
        duration: '31s',
        children: [
          {
            id: 't2',
            type: 'tool',
            tool: 'artifact.read',
            input: 'patch.diff',
            duration: '0.1s',
            result: 'Loaded',
          },
          {
            id: 't3',
            type: 'subagent',
            agentName: 'Security Scanner',
            model: 'codex-1',
            purpose: 'Audit lock usage',
            duration: '9s',
            children: [
              {
                id: 't3a',
                type: 'tool',
                tool: 'gitnexus.semantic_search',
                input: 'redis_lock distributed lock',
                duration: '1.2s',
                result: '8 usages',
              },
            ],
          },
          {
            id: 't4',
            type: 'tool',
            tool: 'artifact.write',
            input: 'review.md',
            duration: '0.2s',
            result: 'Created v1',
          },
        ],
      },
    ]
  }
  return []
}

export function makeLiveTrace(agentId: string): TraceNode[] {
  return [
    {
      id: 't1',
      type: 'agent',
      agentId,
      name: 'Senior Developer',
      model: 'claude-sonnet-4-6',
      startedAt: '0.0s',
      duration: null,
      status: 'running',
      children: [
        {
          id: 't2',
          type: 'tool',
          tool: 'artifact.read',
          input: 'architecture.md',
          duration: '0.2s',
          result: 'Loaded v2',
        },
        {
          id: 't3',
          type: 'subagent',
          agentName: 'Code Explorer',
          model: 'claude-sonnet-4-6',
          purpose: 'Find files to modify',
          duration: null,
          status: 'running',
          children: [
            {
              id: 't3a',
              type: 'tool',
              tool: 'gitnexus.semantic_search',
              input: 'loyalty scheduler',
              duration: '1.6s',
              result: '7 candidates',
            },
            {
              id: 't3b',
              type: 'tool',
              tool: 'gitnexus.read',
              input: 'src/loyalty/scheduler.py',
              duration: null,
              status: 'running',
            },
          ],
        },
      ],
    },
  ]
}

export function countTraceItems(trace: TraceNode[]): number {
  let count = 0
  const walk = (items: TraceNode[] | undefined) => {
    if (!items) return
    items.forEach((item) => {
      count++
      if (item.children) walk(item.children)
    })
  }
  walk(trace)
  return count
}
