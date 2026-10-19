<template>
  <Card class="gap-2 px-3.5 pt-3 pb-1">
    <div class="flex items-baseline gap-2">
      <span class="text-base text-foreground">{{ t('monitor.sessions.title') }}</span>
      <span class="text-sm text-dim">
        {{ t('monitor.sessions.count', { n: sessions.length }) }}
      </span>
    </div>

    <div
      v-if="sessions.length === 0"
      class="rounded-xl border border-dashed p-4 text-center text-sm text-faint"
    >
      {{ t('monitor.sessions.empty') }}
    </div>

    <Table v-else>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead class="h-auto px-2.5 py-1.5 text-faint">
            {{ t('monitor.sessions.col.session') }}
          </TableHead>
          <TableHead class="h-auto w-23 px-2.5 py-1.5 text-right text-faint">
            {{ t('monitor.col.cpu') }}
          </TableHead>
          <TableHead class="h-auto w-23 px-2.5 py-1.5 text-right text-faint">
            {{ t('monitor.col.mem') }}
          </TableHead>
          <TableHead class="h-auto w-23 px-2.5 py-1.5 text-right text-faint">
            {{ t('monitor.sessions.col.procs') }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="s in sessions"
          :key="s.sessionId"
          class="cursor-pointer text-dim hover:bg-accent"
          @click="emit('open', s.sessionId)"
        >
          <TableCell class="px-2.5 py-2 align-top">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="s.running ? 'bg-primary' : 'bg-faint'"
              />
              <span class="max-w-105 truncate text-foreground" :title="s.title">
                {{ s.title }}
              </span>
              <Badge
                variant="outline"
                class="rounded-sm"
                :class="
                  s.attribution !== 'own-process'
                    ? 'border-warning/40 text-warning'
                    : 'text-muted-foreground'
                "
              >
                {{ t(`monitor.sessions.attribution.${s.attribution}`) }}
              </Badge>
            </div>
            <!-- Phiên chạy trong engine/daemon dùng chung: nói rõ VÌ SAO cột CPU
                 trống, thay vì để người dùng tưởng phiên đang rảnh. -->
            <div v-if="s.attribution !== 'own-process'" class="mt-0.5 text-xs text-faint">
              {{ t(`monitor.sessions.hint.${s.attribution}`) }}
            </div>
          </TableCell>
          <!-- Màu chỉ có nghĩa khi con số là của ĐÚNG phiên này; phiên chạy trong
               engine dùng chung thì ô trống, tô màu ô trống là vô nghĩa. -->
          <TableCell
            class="px-2.5 py-2 text-right align-top tabular-nums"
            :class="own(s) ? levelText(cpuLevel(s.cpuPercent)) : undefined"
          >
            {{ own(s) ? formatCpuLoad(s.cpuPercent) : '—' }}
          </TableCell>
          <TableCell
            class="px-2.5 py-2 text-right align-top tabular-nums"
            :class="own(s) ? levelText(memLevel(s.rssKb, totalMemKb)) : undefined"
          >
            {{ own(s) ? formatMem(s.rssKb) : '—' }}
          </TableCell>
          <TableCell class="px-2.5 py-2 text-right align-top tabular-nums">
            {{ s.pids.length }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>

<script setup lang="ts">
import {
  cpuLevel,
  formatCpuLoad,
  formatMem,
  memLevel,
  type MonitorSession,
} from '~/composables/useMonitorManager'
import { levelText } from './monitor-level'

defineProps<{ sessions: MonitorSession[]; totalMemKb: number }>()
const emit = defineEmits<{ (e: 'open', sessionId: string): void }>()

const { t } = useI18n()

const own = (s: MonitorSession): boolean => s.attribution === 'own-process'
</script>
