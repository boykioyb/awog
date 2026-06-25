<template>
  <div class="flex-1 min-h-0 overflow-y-auto">
    <div class="max-w-[1100px] mx-auto px-5 py-6">
      <!-- Greeting -->
      <div class="mb-5">
        <h1 class="text-[1.6em] font-semibold leading-tight" :style="{ color: t.text }">
          {{ tr('home.greeting') }}
        </h1>
        <p class="text-[1em] mt-1" :style="{ color: t.textDim }">{{ tr('home.subtitle') }}</p>
      </div>

      <!-- Bento grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(140px,auto)] gap-3">
        <!-- Needs attention — wide -->
        <HomeTile
          :icon="Inbox"
          :title="tr('home.needs_attention.title')"
          :badge="attentionCount || undefined"
          :tone="attentionCount ? 'warning' : 'default'"
          :to="attentionTo"
          class="col-span-2 row-span-2"
        >
          <div v-if="attentionCount" class="flex flex-col gap-0.5 mt-1">
            <HomeListRow
              v-for="s in awaitingSessions"
              :key="s.id"
              :label="s.title"
              :meta="tr('home.needs_attention.question')"
              dot
              tone="warning"
              interactive
              @select="openSession(s.id)"
            />
            <HomeListRow
              v-for="task in awaitingTasks"
              :key="task.id"
              :label="task.title"
              :meta="tr('home.needs_attention.approval')"
              dot
              tone="warning"
              interactive
              @select="openTask(task.id)"
            />
          </div>
          <EmptyView
            v-else
            :icon="CheckCircle2"
            :title="tr('home.needs_attention.empty_title')"
            :description="tr('home.needs_attention.empty_desc')"
          />
        </HomeTile>

        <!-- Running — wide -->
        <HomeTile
          :icon="Loader"
          :title="tr('home.running.title')"
          :badge="runningCount || undefined"
          :tone="runningCount ? 'accent' : 'default'"
          :to="runningTo"
          class="col-span-2 row-span-2"
        >
          <div v-if="runningCount" class="flex flex-col gap-0.5 mt-1">
            <HomeListRow
              v-for="s in streamingSessions"
              :key="s.id"
              :label="s.title"
              :meta="tr('home.running.session')"
              dot
              pulse
              tone="accent"
              interactive
              @select="openSession(s.id)"
            />
            <HomeListRow
              v-for="task in runningTasks"
              :key="task.id"
              :label="task.title"
              :meta="tr('home.running.task')"
              dot
              pulse
              tone="accent"
              interactive
              @select="openTask(task.id)"
            />
          </div>
          <EmptyView
            v-else
            :icon="Moon"
            :title="tr('home.running.empty_title')"
            :description="tr('home.running.empty_desc')"
          />
        </HomeTile>

        <!-- Git -->
        <HomeTile :icon="GitBranch" :title="tr('home.git.title')" to="/git">
          <div v-if="git.currentRepoPath" class="flex flex-col gap-1.5 mt-1">
            <div class="flex items-center gap-1.5 text-[1em] truncate" :style="{ color: t.text }">
              <GitBranch :size="12" :style="{ color: t.textDim }" />
              <span class="truncate font-mono">{{ git.currentBranch }}</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="px-1.5 h-[18px] inline-flex items-center rounded-full text-[12px] font-mono leading-none"
                :style="
                  dirtyCount
                    ? { background: t.warning, color: t.bg }
                    : { background: t.bgSubtle, color: t.textMuted }
                "
              >
                {{ dirtyCount }} {{ tr('home.git.changed') }}
              </span>
              <span
                v-if="git.ahead"
                class="text-[12px] font-mono leading-none"
                :style="{ color: t.textDim }"
              >
                ↑{{ git.ahead }}
              </span>
              <span
                v-if="git.behind"
                class="text-[12px] font-mono leading-none"
                :style="{ color: t.textDim }"
              >
                ↓{{ git.behind }}
              </span>
            </div>
          </div>
          <p v-else class="text-[1em] mt-1" :style="{ color: t.textFaint }">
            {{ tr('home.git.no_repo') }}
          </p>
        </HomeTile>

        <!-- Agents -->
        <HomeTile
          :icon="Users"
          :title="tr('home.agents.title')"
          :badge="workspace.agents.length"
          to="/agents"
        >
          <div v-if="workspace.agents.length" class="flex flex-col gap-0.5 mt-1">
            <HomeListRow v-for="a in topAgents" :key="a.id" :label="a.name" />
          </div>
          <p v-else class="text-[1em] mt-1" :style="{ color: t.textFaint }">
            {{ tr('home.agents.empty') }}
          </p>
        </HomeTile>

        <!-- Connections -->
        <HomeTile
          :icon="Plug"
          :title="tr('home.connections.title')"
          :badge="workspace.mcpServers.length"
          to="/connections"
        >
          <p class="text-[1em] mt-1" :style="{ color: t.textFaint }">
            {{
              workspace.mcpServers.length
                ? tr('home.connections.summary', { n: workspace.mcpServers.length })
                : tr('home.connections.empty')
            }}
          </p>
        </HomeTile>

        <!-- Activity 24h -->
        <HomeTile :icon="Activity" :title="tr('home.activity.title')">
          <div v-if="recentCommits.length" class="flex flex-col gap-0.5 mt-1">
            <HomeListRow
              v-for="c in recentCommits"
              :key="c.hash"
              :label="c.subject"
              :meta="timeAgo(c.date)"
            />
          </div>
          <EmptyView
            v-else
            :icon="Activity"
            :title="tr('home.activity.empty_title')"
            :description="tr('home.activity.empty_desc')"
          />
        </HomeTile>

        <!-- Recent sessions — wide -->
        <HomeTile
          :icon="MessageSquare"
          :title="tr('home.recent_sessions.title')"
          to="/sessions"
          class="col-span-2 row-span-2"
        >
          <div v-if="recentSessions.length" class="flex flex-col gap-0.5 mt-1">
            <HomeListRow
              v-for="s in recentSessions"
              :key="s.id"
              :label="s.title"
              :meta="timeAgo(s.updatedAt)"
              :dot="sessions.isUnread(s.id)"
              tone="accent"
              interactive
              @select="openSession(s.id)"
            />
          </div>
          <EmptyView
            v-else
            :icon="MessageSquarePlus"
            :title="tr('home.recent_sessions.empty_title')"
            :description="tr('home.recent_sessions.empty_desc')"
          />
        </HomeTile>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  CheckCircle2,
  GitBranch,
  Inbox,
  Loader,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  Plug,
  Users,
} from 'lucide-vue-next'

const { t } = useTheme()
const {
  sessions,
  git,
  workspace,
  tr,
  awaitingSessions,
  awaitingTasks,
  attentionCount,
  attentionTo,
  streamingSessions,
  runningTasks,
  runningCount,
  runningTo,
  dirtyCount,
  topAgents,
  recentCommits,
  recentSessions,
  openSession,
  openTask,
  timeAgo,
} = useHomeDashboard()
</script>
