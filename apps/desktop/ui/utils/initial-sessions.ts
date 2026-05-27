import type { Session } from '~/types'
import { placeholderImage } from './placeholder-image'

export const MOCK_SESSIONS: Session[] = [
  {
    id: 'ses-research-cache',
    title: 'Caching strategy brainstorm',
    projectId: 'prj1',
    createdAt: '2 hours ago',
    updatedAt: '15 min ago',
    pinned: true,
    invitedAgentIds: ['ag2', 'ag7'],
    pendingAgentIds: [],
    settings: {
      provider: 'anthropic',
      modelId: 'claude-opus-4-7',
      level: 'extra-high',
      mode: 'ask',
    },
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Loyalty API p99 đang ~480ms. Mình muốn brainstorm caching options trước khi quyết kiến trúc — chưa cần ai cụ thể.',
        at: '2 hours ago',
      },
      {
        id: 'm2',
        role: 'user',
        text: '$solution-architect helo, cho mình góc nhìn trade-off Redis vs in-memory LRU vs CDN edge nhé.',
        at: '2 hours ago',
        mentions: [
          { kind: 'agent', targetId: 'ag2', raw: '$solution-architect', start: 0, end: 20 },
        ],
      },
      {
        id: 'm3',
        role: 'system',
        text: 'Solution Architect joined',
        at: '2 hours ago',
      },
      {
        id: 'm4',
        role: 'agent',
        agentId: 'ag2',
        text: 'Hi. Trước khi so sánh cần xác nhận: (1) read:write ratio, (2) TTL chấp nhận được, (3) consistency model — đọc stale có OK không khi user vừa earn point?',
        at: '2 hours ago',
      },
      {
        id: 'm5',
        role: 'user',
        text: 'Read:write ~ 95:5. TTL 60s OK. Stale read trong 60s chấp nhận được vì UI có badge "updated 1 min ago".',
        at: '1 hour ago',
      },
      {
        id: 'm6',
        role: 'agent',
        agentId: 'ag2',
        text: 'OK, profile đó thì in-memory LRU per-instance cheap nhưng miss rate cao khi scale horizontal. Redis cluster + 60s TTL là sweet spot. CDN edge phù hợp nếu key derive thuần từ user_id và không vary theo session.',
        at: '1 hour ago',
        artifacts: [
          {
            name: 'cache-comparison.md',
            preview:
              '# Caching options\n\n| Option | p99 | Infra cost | Stale risk |\n|---|---|---|---|\n| In-memory LRU | ~5ms | $0 | High |\n| Redis cluster | ~12ms | $$ | Low |\n| CDN edge | ~3ms | $ | Med |',
          },
        ],
      },
      {
        id: 'm7',
        role: 'user',
        text: 'Wait $security-specialist nếu cache loyalty balance ở CDN edge có concern PII / data residency gì không?',
        at: '20 min ago',
        mentions: [
          { kind: 'agent', targetId: 'ag7', raw: '$security-specialist', start: 5, end: 26 },
        ],
      },
      {
        id: 'm8',
        role: 'system',
        text: 'Security Specialist joined',
        at: '20 min ago',
      },
      {
        id: 'm9',
        role: 'agent',
        agentId: 'ag7',
        text: 'Có. Loyalty balance gắn user_id và có thể correlate với purchase history → PII theo GDPR/CCPA. Edge cache cross-region sẽ vi phạm data residency của EU customer. Khuyến nghị: nếu chọn CDN, restrict POP theo region; Redis trong VPC an toàn hơn về compliance.',
        at: '15 min ago',
      },
      {
        id: 'm10',
        role: 'user',
        text: 'OK chốt Redis. $senior-developer check @src/loyalty/balance_service.py xem chỗ nào lookup loyalty balance, viết draft cache wrapper.',
        at: '5 min ago',
        mentions: [
          { kind: 'agent', targetId: 'ag3', raw: '$senior-developer', start: 15, end: 32 },
          {
            kind: 'file',
            targetId: 'src/loyalty/balance_service.py',
            raw: '@src/loyalty/balance_service.py',
            start: 39,
            end: 70,
          },
        ],
      },
      {
        id: 'm11',
        role: 'agent',
        agentId: 'ag3',
        text: '',
        at: '4 min ago',
        steps: [
          {
            id: 's-g1',
            kind: 'group',
            label: 'Scan codebase for loyalty balance lookup',
            children: [
              {
                id: 's1',
                kind: 'tool',
                tool: 'search',
                label: 'Search',
                target: 'loyalty.balance',
                description: 'Find call sites of balance lookup',
                pathHint: 'src/loyalty/**/*.py',
                status: 'done',
                detail: {
                  kind: 'list',
                  items: [
                    {
                      label: 'BalanceService.get_balance',
                      path: 'src/loyalty/balance_service.py:42',
                      snippet:
                        '    def get_balance(self, user_id: str) -> int:\n        row = self.db.fetch_one("SELECT balance FROM loyalty WHERE user_id = ?", user_id)\n        return row.balance if row else 0',
                    },
                    {
                      label: 'LoyaltyAPI.balance_endpoint',
                      path: 'src/loyalty/api.py:87',
                      snippet:
                        '@router.get("/loyalty/balance/{user_id}")\nasync def balance_endpoint(user_id: str):\n    return {"balance": svc.get_balance(user_id)}',
                    },
                    {
                      label: 'ReportJob.snapshot_balances',
                      path: 'jobs/report.py:128',
                      snippet:
                        '    for user_id in active_users:\n        bal = svc.get_balance(user_id)\n        rows.append((user_id, bal, now()))',
                    },
                  ],
                },
              },
              {
                id: 's2',
                kind: 'tool',
                tool: 'read',
                label: 'Read',
                target: 'balance_service.py',
                description: 'Inspect current lookup implementation',
                pathHint: 'src/loyalty/balance_service.py',
                status: 'done',
                detail: {
                  kind: 'file',
                  path: 'src/loyalty/balance_service.py',
                  language: 'python',
                  content: `from typing import Optional
from src.infra.db import Database


class BalanceService:
    def __init__(self, db: Database):
        self.db = db

    def get_balance(self, user_id: str) -> int:
        row = self.db.fetch_one(
            "SELECT balance FROM loyalty WHERE user_id = ?", user_id
        )
        return row.balance if row else 0

    def update_balance(self, user_id: str, delta: int) -> int:
        new_bal = self.get_balance(user_id) + delta
        self.db.execute(
            "UPDATE loyalty SET balance = ? WHERE user_id = ?", new_bal, user_id
        )
        return new_bal`,
                },
              },
              {
                id: 's3',
                kind: 'tool',
                tool: 'read',
                label: 'Read',
                target: 'redis_client.py',
                description: 'Check existing Redis helper',
                pathHint: 'src/infra/redis_client.py',
                status: 'done',
                detail: {
                  kind: 'file',
                  path: 'src/infra/redis_client.py',
                  language: 'python',
                  content: `import redis
from src.config import settings


_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client`,
                },
              },
              {
                id: 's4',
                kind: 'tool',
                tool: 'find-files',
                label: 'Find Files',
                description: 'Cache wrapper conventions',
                pathHint: 'src/infra/**/cache*',
                status: 'done',
                detail: {
                  kind: 'list',
                  items: [
                    { label: 'src/infra/cache_helpers.py', path: '142 lines' },
                    { label: 'src/infra/redis_client.py', path: '18 lines' },
                    { label: 'tests/infra/test_cache_helpers.py', path: '210 lines' },
                  ],
                },
              },
            ],
          },
          {
            id: 's-note',
            kind: 'note',
            label:
              '3 call sites, không có cache layer. Mình viết wrapper theo pattern infra/redis_client.',
          },
          {
            id: 's-g2',
            kind: 'group',
            label: 'Draft cache wrapper',
            children: [
              {
                id: 's5',
                kind: 'tool',
                tool: 'write',
                label: 'Write',
                target: 'loyalty_balance_cache.py',
                description: 'New cache wrapper with 60s TTL',
                additions: 84,
                pathHint: 'src/loyalty/loyalty_balance_cache.py',
                status: 'done',
                detail: {
                  kind: 'diff',
                  path: 'src/loyalty/loyalty_balance_cache.py',
                  content: `diff --git a/src/loyalty/loyalty_balance_cache.py b/src/loyalty/loyalty_balance_cache.py
new file mode 100644
--- /dev/null
+++ b/src/loyalty/loyalty_balance_cache.py
@@ -0,0 +1,28 @@
+from typing import Callable
+from src.infra.redis_client import get_redis
+
+CACHE_TTL_SECONDS = 60
+CACHE_KEY = "loyalty:balance:{user_id}"
+
+
+class LoyaltyBalanceCache:
+    """Thin wrapper around Redis for loyalty balance reads.
+
+    Stale tolerated up to CACHE_TTL_SECONDS. Caller must call
+    invalidate(user_id) on write to keep cache consistent.
+    """
+
+    def __init__(self, loader: Callable[[str], int]):
+        self._loader = loader
+        self._redis = get_redis()
+
+    def get(self, user_id: str) -> int:
+        key = CACHE_KEY.format(user_id=user_id)
+        hit = self._redis.get(key)
+        if hit is not None:
+            return int(hit)
+        value = self._loader(user_id)
+        self._redis.setex(key, CACHE_TTL_SECONDS, value)
+        return value
+
+    def invalidate(self, user_id: str) -> None:
+        self._redis.delete(CACHE_KEY.format(user_id=user_id))`,
                },
              },
              {
                id: 's6',
                kind: 'tool',
                tool: 'edit',
                label: 'Edit',
                target: 'balance_service.py',
                description: 'Wire cache wrapper into lookup path',
                additions: 12,
                deletions: 4,
                pathHint: 'src/loyalty/balance_service.py',
                status: 'done',
                detail: {
                  kind: 'diff',
                  path: 'src/loyalty/balance_service.py',
                  content: `diff --git a/src/loyalty/balance_service.py b/src/loyalty/balance_service.py
--- a/src/loyalty/balance_service.py
+++ b/src/loyalty/balance_service.py
@@ -1,18 +1,26 @@
 from typing import Optional
 from src.infra.db import Database
+from src.loyalty.loyalty_balance_cache import LoyaltyBalanceCache


 class BalanceService:
     def __init__(self, db: Database):
         self.db = db
+        self._cache = LoyaltyBalanceCache(loader=self._fetch_balance)

-    def get_balance(self, user_id: str) -> int:
+    def _fetch_balance(self, user_id: str) -> int:
         row = self.db.fetch_one(
             "SELECT balance FROM loyalty WHERE user_id = ?", user_id
         )
         return row.balance if row else 0

+    def get_balance(self, user_id: str) -> int:
+        return self._cache.get(user_id)
+
     def update_balance(self, user_id: str, delta: int) -> int:
         new_bal = self.get_balance(user_id) + delta
         self.db.execute(
             "UPDATE loyalty SET balance = ? WHERE user_id = ?", new_bal, user_id
         )
         return new_bal`,
                },
              },
              {
                id: 's7',
                kind: 'thinking',
                label: 'Cân nhắc cache invalidation khi user earn point — cần publish event',
              },
              {
                id: 's8',
                kind: 'tool',
                tool: 'edit',
                label: 'Edit',
                target: 'balance_service.py',
                description: 'Invalidate cache on balance mutation',
                additions: 6,
                pathHint: 'src/loyalty/balance_service.py',
                status: 'running',
                detail: {
                  kind: 'diff',
                  path: 'src/loyalty/balance_service.py',
                  content: `diff --git a/src/loyalty/balance_service.py b/src/loyalty/balance_service.py
--- a/src/loyalty/balance_service.py
+++ b/src/loyalty/balance_service.py
@@ -22,6 +22,8 @@
     def update_balance(self, user_id: str, delta: int) -> int:
         new_bal = self.get_balance(user_id) + delta
         self.db.execute(
             "UPDATE loyalty SET balance = ? WHERE user_id = ?", new_bal, user_id
         )
+        self._cache.invalidate(user_id)
+        # TODO: publish loyalty.balance.updated event for cross-instance cache busting
         return new_bal`,
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ses-debug-flake',
    title: 'Why is the payment retry test flaky?',
    projectId: 'prj2',
    createdAt: 'Yesterday',
    updatedAt: 'Yesterday',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'claude-opus-4-7', level: 'high', mode: 'ask' },
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'test_payment_retry_idempotency flake ~3/10 lần local. Mình suspect timing nhưng chưa rõ. Ghi lại notes ở đây để mai pair với $senior-developer.',
        at: 'Yesterday',
        mentions: [
          { kind: 'agent', targetId: 'ag3', raw: '$senior-developer', start: 124, end: 141 },
        ],
      },
      {
        id: 'm2',
        role: 'system',
        text: 'Senior Developer joined',
        at: 'Yesterday',
      },
      {
        id: 'm3',
        role: 'agent',
        agentId: 'ag3',
        text: 'Để mai đào kỹ. Bạn paste stacktrace lần fail gần nhất giúp mình nhé — đoán là race với clock mock.',
        at: 'Yesterday',
      },
    ],
  },
  {
    id: 'ses-scratch',
    title: 'Untitled scratch pad',
    projectId: null,
    createdAt: '3 days ago',
    updatedAt: '3 days ago',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'claude-opus-4-7', level: 'high', mode: 'ask' },
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Random thought — viết workflow template cho release notes auto-summary từ git log + Jira closed tickets. Quay lại sau.',
        at: '3 days ago',
      },
    ],
  },
  {
    id: 'ses-mode-demo',
    title: 'Demo · 4 agent modes',
    projectId: 'prj1',
    createdAt: '1 day ago',
    updatedAt: '20 min ago',
    pinned: true,
    invitedAgentIds: ['ag3'],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'claude-opus-4-7', level: 'high', mode: 'ask' },
    messages: [
      {
        id: 'd1',
        role: 'system',
        text: '── Ask mode ──',
        at: '1 day ago',
      },
      {
        id: 'd2',
        role: 'user',
        text: '$senior-developer giải thích đoạn cache TTL trong @src/loyalty/loyalty_balance_cache.py.',
        at: '1 day ago',
        modeAtSend: 'ask',
        mentions: [
          { kind: 'agent', targetId: 'ag3', raw: '$senior-developer', start: 0, end: 17 },
          {
            kind: 'file',
            targetId: 'src/loyalty/loyalty_balance_cache.py',
            raw: '@src/loyalty/loyalty_balance_cache.py',
            start: 41,
            end: 78,
          },
        ],
      },
      {
        id: 'd3',
        role: 'agent',
        agentId: 'ag3',
        text: 'Cache TTL = 60s (`CACHE_TTL_SECONDS`). Key format `loyalty:balance:{user_id}`. Khi miss, gọi `_loader` (hiện tại = `BalanceService._fetch_balance`) rồi `setex` với TTL. Khi user earn point, `update_balance` cần `invalidate(user_id)` để bust cache — đoạn này hiện đang được wire (xem session brainstorm trước).\n\nMình KHÔNG sửa file ở Ask mode — bạn cần thêm gì cứ chuyển sang Plan/Execute.',
        at: '1 day ago',
      },
      {
        id: 'd4',
        role: 'system',
        text: '── Plan mode ──',
        at: '12 hours ago',
      },
      {
        id: 'd5',
        role: 'user',
        text: 'Lên plan cho việc thêm metric Prometheus cho cache hit/miss. Đừng sửa code, chỉ plan.',
        at: '12 hours ago',
        modeAtSend: 'plan',
      },
      {
        id: 'd6',
        role: 'agent',
        agentId: 'ag3',
        text: 'OK, mình đã đọc loyalty_balance_cache.py và infra hiện tại. Đây là plan đề xuất, chưa sửa file nào — bạn approve thì mình mới execute.',
        at: '12 hours ago',
        steps: [
          {
            id: 'plan-prom',
            kind: 'plan',
            label: 'Instrument cache hit/miss với Prometheus counter',
            planStatus: 'pending',
            planItems: [
              'Thêm import `prometheus_client.Counter` vào `loyalty_balance_cache.py` (dep đã có trong requirements, không cần install thêm).',
              'Khai báo 2 counter ở module-level: `loyalty_cache_hit_total`, `loyalty_cache_miss_total` — không label vì cardinality thấp.',
              'Trong `LoyaltyBalanceCache.get()`: `CACHE_HIT.inc()` ở nhánh `hit is not None`, `CACHE_MISS.inc()` ở nhánh miss trước khi gọi loader.',
              'Expose qua `/metrics` endpoint hiện hữu (FastAPI app đã mount prometheus middleware) — không cần thay đổi infra.',
              'Viết 2 test trong `tests/loyalty/test_loyalty_balance_cache.py`: assert counter tăng đúng nhánh khi gọi `get(user_id)` lần 1 (miss) và lần 2 (hit).',
              'Cập nhật Grafana dashboard "Loyalty / Cache" — thêm panel hit-rate ratio (`rate(hit) / (rate(hit) + rate(miss))`).',
            ],
            planRationale:
              'Tổng impact: +~14 LOC ở cache wrapper, +~30 LOC test, 0 thay đổi infra. Rollback an toàn vì counter là read-only ở observability layer. Ước lượng ~25 phút coding + 10 phút verify.',
          },
        ],
      },
      {
        id: 'd7',
        role: 'system',
        text: '── Accept Edits mode ──',
        at: '2 hours ago',
      },
      {
        id: 'd8',
        role: 'user',
        text: 'OK theo plan đi, tự apply edit luôn không cần hỏi.',
        at: '2 hours ago',
        modeAtSend: 'accept-edits',
      },
      {
        id: 'd9',
        role: 'agent',
        agentId: 'ag3',
        text: '',
        at: '2 hours ago',
        steps: [
          {
            id: 'a1',
            kind: 'tool',
            tool: 'edit',
            label: 'Edit',
            target: 'loyalty_balance_cache.py',
            description: 'Thêm 2 prometheus counter + inc trong get()',
            additions: 14,
            deletions: 0,
            pathHint: 'src/loyalty/loyalty_balance_cache.py',
            status: 'done',
            detail: {
              kind: 'diff',
              path: 'src/loyalty/loyalty_balance_cache.py',
              content: `diff --git a/src/loyalty/loyalty_balance_cache.py b/src/loyalty/loyalty_balance_cache.py
--- a/src/loyalty/loyalty_balance_cache.py
+++ b/src/loyalty/loyalty_balance_cache.py
@@ -1,5 +1,7 @@
 from typing import Callable
+from prometheus_client import Counter
 from src.infra.redis_client import get_redis

+CACHE_HIT = Counter("loyalty_cache_hit_total", "Loyalty balance cache hits")
+CACHE_MISS = Counter("loyalty_cache_miss_total", "Loyalty balance cache misses")
 CACHE_TTL_SECONDS = 60
@@ -16,8 +18,11 @@ class LoyaltyBalanceCache:
     def get(self, user_id: str) -> int:
         key = CACHE_KEY.format(user_id=user_id)
         hit = self._redis.get(key)
         if hit is not None:
+            CACHE_HIT.inc()
             return int(hit)
+        CACHE_MISS.inc()
         value = self._loader(user_id)
         self._redis.setex(key, CACHE_TTL_SECONDS, value)
         return value`,
            },
          },
          {
            id: 'a2',
            kind: 'tool',
            tool: 'write',
            label: 'Write',
            target: 'test_loyalty_balance_cache.py',
            description: 'Test counter tăng đúng nhánh',
            additions: 32,
            pathHint: 'tests/loyalty/test_loyalty_balance_cache.py',
            status: 'done',
          },
          {
            id: 'a3',
            kind: 'note',
            label: 'Đã apply 2 edit. Tổng +46 / -0. Không hỏi confirm vì mode = Accept Edits.',
          },
        ],
      },
      {
        id: 'd10',
        role: 'system',
        text: '── Execute mode ──',
        at: '25 min ago',
      },
      {
        id: 'd11',
        role: 'user',
        text: 'Chạy pytest cho file test mới rồi commit.',
        at: '25 min ago',
        modeAtSend: 'execute',
      },
      {
        id: 'd12',
        role: 'agent',
        agentId: 'ag3',
        text: '',
        at: '20 min ago',
        steps: [
          {
            id: 'e1',
            kind: 'tool',
            tool: 'terminal',
            label: 'Run',
            target: 'pytest',
            description: 'tests/loyalty/test_loyalty_balance_cache.py -v',
            pathHint: 'workspace root',
            status: 'done',
            detail: {
              kind: 'terminal',
              command: 'pytest tests/loyalty/test_loyalty_balance_cache.py -v',
              exitCode: 0,
              output: `============================= test session starts ==============================
collected 3 items

tests/loyalty/test_loyalty_balance_cache.py::test_hit_increments_counter PASSED
tests/loyalty/test_loyalty_balance_cache.py::test_miss_increments_counter PASSED
tests/loyalty/test_loyalty_balance_cache.py::test_ttl_expires PASSED

============================== 3 passed in 0.42s ==============================`,
            },
          },
          {
            id: 'e2',
            kind: 'tool',
            tool: 'terminal',
            label: 'Run',
            target: 'git',
            description: 'commit changes',
            status: 'done',
            detail: {
              kind: 'terminal',
              command:
                'git add src/loyalty/loyalty_balance_cache.py tests/loyalty/test_loyalty_balance_cache.py && git commit -m "feat(loyalty): instrument cache hit/miss counters"',
              exitCode: 0,
              output: `[feat/loyalty-cache 4f3a91c] feat(loyalty): instrument cache hit/miss counters
 2 files changed, 46 insertions(+)
 create mode 100644 tests/loyalty/test_loyalty_balance_cache.py`,
            },
          },
          {
            id: 'e3',
            kind: 'note',
            label: '3/3 tests pass. Commit 4f3a91c. Branch feat/loyalty-cache sẵn sàng push.',
          },
        ],
      },
    ],
  },
  {
    id: 'ses-attachment-demo',
    title: 'Demo · attachments',
    projectId: 'prj1',
    createdAt: '6 hours ago',
    updatedAt: '5 hours ago',
    pinned: true,
    invitedAgentIds: ['ag3'],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'claude-opus-4-7', level: 'high', mode: 'ask' },
    messages: [
      {
        id: 'att1',
        role: 'user',
        text: 'Đính kèm 1 file log, xem giúp lỗi.',
        at: '6 hours ago',
        modeAtSend: 'ask',
        attachments: [
          {
            id: 'a1',
            name: 'app-error-2026-05-25.log',
            type: 'file',
            size: '124KB',
            mime: 'text/plain',
            preview: `2026-05-25T14:23:01.412Z INFO  worker started pid=12 host=ip-10-0-1-42
2026-05-25T14:23:09.108Z INFO  redis connected url=redis://cache.internal:6379
2026-05-25T14:23:42.917Z DEBUG balance lookup user_id=u_8821 hit=false
2026-05-25T14:23:43.001Z DEBUG balance lookup user_id=u_7104 hit=true latency_ms=4
2026-05-25T14:23:58.336Z INFO  health-check ok
2026-05-25T14:24:02.847Z ERROR redis connection lost  retry=1
  redis.exceptions.ConnectionError: Connection refused
    at Connection._connect (redis/connection.py:617)
    at Connection.connect (redis/connection.py:582)
    at ConnectionPool.get_connection (redis/connection.py:1234)
    at Redis.get (redis/client.py:1830)
    at LoyaltyBalanceCache.get (src/loyalty/loyalty_balance_cache.py:24)
2026-05-25T14:24:03.412Z ERROR redis connection lost  retry=2
  redis.exceptions.ConnectionError: Connection refused
2026-05-25T14:24:04.991Z ERROR redis connection lost  retry=3
  redis.exceptions.ConnectionError: Connection refused
2026-05-25T14:24:06.115Z WARN  giving up after 3 retries, falling back to DB
2026-05-25T14:24:06.118Z ERROR balance lookup degraded user_id=u_8821 path=db_fallback
... [47 occurrences of RedisConnectionError between 14:23:09 and 14:25:42] ...
2026-05-25T14:25:43.220Z INFO  redis reconnected after 154 seconds
2026-05-25T14:25:43.221Z INFO  cache warm-up started keys=1284
2026-05-25T14:25:51.847Z INFO  cache warm-up complete
2026-05-25T14:25:52.001Z INFO  health-check ok
`,
          },
        ],
      },
      {
        id: 'att2',
        role: 'agent',
        agentId: 'ag3',
        text: 'Đọc log rồi. Có 1 traceback `RedisConnectionError: Connection refused` lặp lại 47 lần lúc 14:23–14:25. Trùng cửa sổ Redis bị restart từ infra. Recommend: thêm retry + backoff cho `redis_client.get_redis()`.',
        at: '6 hours ago',
      },
      {
        id: 'att3',
        role: 'user',
        text: 'Đính kèm 1 ảnh screenshot UI bị lệch.',
        at: '5 hours ago',
        modeAtSend: 'ask',
        attachments: [
          {
            id: 'a2',
            name: 'screenshot-misalign.png',
            type: 'image',
            size: '218KB',
            mime: 'image/png',
            width: 1280,
            height: 720,
            url: placeholderImage({
              label: 'screenshot-misalign',
              sublabel: '1280 × 720 · UI misalignment',
              width: 1280,
              height: 720,
              background: '#1f2937',
            }),
          },
        ],
      },
      {
        id: 'att4',
        role: 'agent',
        agentId: 'ag3',
        text: 'Thấy rồi — sidebar bị overflow theo chiều ngang vì panel detail không tôn trọng flex grow. Cần `min-w-0` ở parent + `overflow: hidden` ở scroll container.',
        at: '5 hours ago',
      },
      {
        id: 'att5',
        role: 'user',
        text: 'Gửi luôn nhiều file để bạn review compose: code + spec + 2 screenshot.',
        at: '5 hours ago',
        modeAtSend: 'ask',
        attachments: [
          {
            id: 'a3',
            name: 'cache_wrapper.py',
            type: 'file',
            size: '2.4KB',
            mime: 'text/x-python',
            preview: `from typing import Callable
from prometheus_client import Counter
from src.infra.redis_client import get_redis

CACHE_HIT = Counter("loyalty_cache_hit_total", "Loyalty balance cache hits")
CACHE_MISS = Counter("loyalty_cache_miss_total", "Loyalty balance cache misses")
CACHE_TTL_SECONDS = 60
CACHE_KEY = "loyalty:balance:{user_id}"


class LoyaltyBalanceCache:
    """Thin wrapper around Redis for loyalty balance reads.

    Stale tolerated up to CACHE_TTL_SECONDS. Caller must call
    invalidate(user_id) on write to keep cache consistent.
    """

    def __init__(self, loader: Callable[[str], int]):
        self._loader = loader
        self._redis = get_redis()

    def get(self, user_id: str) -> int:
        key = CACHE_KEY.format(user_id=user_id)
        hit = self._redis.get(key)
        if hit is not None:
            CACHE_HIT.inc()
            return int(hit)
        CACHE_MISS.inc()
        value = self._loader(user_id)
        self._redis.setex(key, CACHE_TTL_SECONDS, value)
        return value

    def invalidate(self, user_id: str) -> None:
        self._redis.delete(CACHE_KEY.format(user_id=user_id))
`,
          },
          {
            id: 'a4',
            name: 'caching-spec.md',
            type: 'file',
            size: '8.1KB',
            mime: 'text/markdown',
            preview: `# Loyalty balance caching · spec

## Context
Endpoint \`GET /loyalty/balance/{user_id}\` p99 ≈ 480ms khi load tăng, do mỗi request đều round-trip Postgres. Read:write ratio ~95:5, stale ≤ 60s chấp nhận được vì UI đã hiển thị "updated 1 min ago".

## Goals
- Giảm p99 endpoint balance xuống **< 100ms** ở P95 traffic.
- Không thay đổi hợp đồng API.
- Compliance: không lưu balance ngoài VPC (GDPR, EU customer).

## Decision
**Redis cluster + 60s TTL**, wrapped trong class \`LoyaltyBalanceCache\`.

Lý do loại các option khác:
- *In-memory LRU per-instance*: miss rate cao khi scale horizontal (8 pod).
- *CDN edge*: vi phạm data residency cho EU customer, restrict POP phức tạp.

## Cache key
\`loyalty:balance:{user_id}\` — flat namespace, không version để rollback an toàn.

## Invalidation
Mỗi \`update_balance(user_id, delta)\` phải gọi \`cache.invalidate(user_id)\` ngay sau khi commit DB. Cross-instance bust qua event \`loyalty.balance.updated\` (Redis Pub/Sub).

## Observability
- \`loyalty_cache_hit_total\` / \`loyalty_cache_miss_total\` (Prometheus Counter).
- Grafana panel "Loyalty / Cache" hiển thị hit-rate = \`rate(hit) / (rate(hit) + rate(miss))\`.
- Alert: hit-rate < 70% trong 10 phút.

## Rollout
1. Deploy wrapper, default disabled qua feature flag \`loyalty.cache.enabled\`.
2. Bật canary 1 pod, theo dõi 24h.
3. Rollout 100%.
`,
          },
          {
            id: 'a5',
            name: 'dashboard-before.png',
            type: 'image',
            size: '312KB',
            mime: 'image/png',
            width: 1440,
            height: 900,
            url: placeholderImage({
              label: 'dashboard-before',
              sublabel: 'p99 ≈ 480ms · 1440 × 900',
              width: 1440,
              height: 900,
              background: '#7c2d12',
            }),
          },
          {
            id: 'a6',
            name: 'dashboard-after.png',
            type: 'image',
            size: '298KB',
            mime: 'image/png',
            width: 1440,
            height: 900,
            url: placeholderImage({
              label: 'dashboard-after',
              sublabel: 'p99 ≈ 95ms · 1440 × 900',
              width: 1440,
              height: 900,
              background: '#14532d',
            }),
          },
        ],
      },
      {
        id: 'att6',
        role: 'agent',
        agentId: 'ag3',
        text: 'OK đã load 4 attachments. Tóm tắt: code khớp với spec, screenshot trước/sau cho thấy p99 giảm từ 480ms → 95ms. Mình viết PR description luôn nhé?',
        at: '5 hours ago',
      },
    ],
  },
]
