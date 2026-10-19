<template>
  <div class="min-h-0 flex-auto overflow-auto">
    <div :class="CAP_BAR">
      <span class="text-dim">
        {{
          analyzing
            ? t('capture.findings.analyzing')
            : t('capture.findings.count', { n: cap.findings.value.length })
        }}
      </span>
      <span class="flex-auto" />
      <Button
        v-if="cap.findings.value.length || scanFindings.length"
        variant="outline"
        size="sm"
        :title="t('capture.sec.agent.hint')"
        @click="cap.sendToAgent(scanFindings)"
      >
        <Icon name="send" />
        {{ t('capture.sec.agent.go') }}
      </Button>
      <Button variant="outline" size="sm" :disabled="analyzing" @click="cap.runAnalysis()">
        <Icon name="refresh" :class="analyzing && 'animate-spin'" />
        {{ t('capture.findings.rerun') }}
      </Button>
    </div>
    <div v-if="!cap.findings.value.length && !analyzing" :class="CAP_EMPTY">
      {{ t('capture.findings.none') }}
    </div>
    <template v-for="g in groups" :key="g.severity">
      <section v-if="g.items.length" :class="CAP_SEC">
        <h4 :class="CAP_SEC_TITLE">
          <Badge :variant="SEVERITY_VARIANT[g.severity]">
            {{ t(`capture.severity.${g.severity}`) }}
          </Badge>
          <span class="tnum text-dim">{{ g.items.length }}</span>
        </h4>
        <!-- Cả dòng là một vùng bấm (tiêu đề + mô tả + bằng chứng xếp dọc). -->
        <Button
          v-for="f in g.items"
          :key="`${f.id}:${f.entryId}`"
          variant="ghost"
          class="h-auto w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left font-normal whitespace-normal text-foreground focus-visible:bg-selected focus-visible:ring-selected-border"
          :title="t('capture.findings.show')"
          @click="cap.showFinding(f)"
        >
          <span class="font-semibold">{{ t(f.title, f.params) }}</span>
          <span class="text-muted-foreground">{{ t(f.detail, f.params) }}</span>
          <span v-if="f.evidence" class="font-mono wrap-anywhere text-dim">{{ f.evidence }}</span>
        </Button>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useNetworkCaptureContext } from '~/composables/useNetworkCapture'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import type { CaptureFinding } from '~/utils/capture-findings'
import { CAP_BAR, CAP_EMPTY, CAP_SEC, CAP_SEC_TITLE } from './capture-ui'

const SEVERITIES: CaptureFinding['severity'][] = ['high', 'medium', 'low', 'info']

const SEVERITY_VARIANT = {
  high: 'destructive',
  medium: 'warning',
  low: 'info',
  info: 'secondary',
} as const

const { t } = useI18n()
const cap = useNetworkCaptureContext()
const analyzing = computed(() => cap.analyzing.value)

// Findings của lần quét chủ động gần nhất (instance scanner chung của page) —
// đẩy cùng prompt sang agent khi có.
const scanFindings = computed(() => cap.scan.report.value?.findings ?? [])
const groups = computed(() =>
  SEVERITIES.map((severity) => ({
    severity,
    items: cap.findings.value.filter((f) => f.severity === severity),
  })),
)
</script>
