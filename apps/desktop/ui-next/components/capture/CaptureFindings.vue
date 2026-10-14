<template>
  <div class="cap-findings">
    <div class="cap-bar">
      <span class="cap-dim">
        {{
          analyzing
            ? t('capture.findings.analyzing')
            : t('capture.findings.count', { n: cap.findings.value.length })
        }}
      </span>
      <span class="cap-grow" />
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
        <Icon name="refresh" :class="{ 'fnd-spin': analyzing }" />
        {{ t('capture.findings.rerun') }}
      </Button>
    </div>
    <div v-if="!cap.findings.value.length && !analyzing" class="cap-empty">
      {{ t('capture.findings.none') }}
    </div>
    <template v-for="g in groups" :key="g.severity">
      <section v-if="g.items.length" class="cap-sec">
        <h4>
          <Badge :variant="SEVERITY_VARIANT[g.severity]">
            {{ t(`capture.severity.${g.severity}`) }}
          </Badge>
          <span class="cap-dim tnum">{{ g.items.length }}</span>
        </h4>
        <button
          v-for="f in g.items"
          :key="`${f.id}:${f.entryId}`"
          type="button"
          class="fnd-row"
          :title="t('capture.findings.show')"
          @click="cap.showFinding(f)"
        >
          <span class="fnd-t">{{ t(f.title, f.params) }}</span>
          <span class="fnd-d">{{ t(f.detail, f.params) }}</span>
          <span v-if="f.evidence" class="fnd-e cap-code">{{ f.evidence }}</span>
        </button>
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

<style scoped>
.fnd-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.fnd-row:hover {
  background: var(--bgHover);
}
.fnd-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accentBorder);
  background: var(--accentDim);
}
.fnd-t {
  font-weight: 600;
}
.fnd-d {
  color: var(--textMuted);
}
.fnd-e {
  color: var(--textDim);
  overflow-wrap: anywhere;
}
.fnd-spin {
  animation: fnd-spin 1s linear infinite;
}
@keyframes fnd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
