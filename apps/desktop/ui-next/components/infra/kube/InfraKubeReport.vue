<template>
  <!-- Mục thứ ba của vùng bảng: **Báo cáo**. Cùng số liệu với hai bảng kia, nhưng
       nhìn theo chỉ số thay vì từng hàng — "cụm này có ổn không, chỗ nào lệch, có
       đang tệ đi không".

       Vì sao nằm TRONG tab Kubernetes chứ không phải màn Tổng quan: mọi con số ở
       đây là chuyện của MỘT cluster/namespace đang ghim (pod, deployment, số lần
       khởi động lại). Màn Tổng quan nói về tài khoản AWS (chi phí, log, danh tính) —
       trộn hai thứ đó vào nhau là để người dùng đọc một chỗ rồi tưởng nó nói về chỗ
       khác.

       Vì sao KHÔNG có màn "monitor" riêng: một màn chỉ để tự nạp lại theo nhịp là
       đúng thứ luật "không auto-refresh" cấm. Ở đây có nút BẬT theo dõi (người dùng
       bấm, có trần thời gian, tắt khi rời mục) — vòng lặp do người dùng bật và nhìn
       thấy thì không phải nạp sau lưng ai. -->
  <div class="ikscroll ikrep">
    <div class="ikrep-head">
      <span
        class="ikrep-lamp"
        :class="`lamp-${lamp}`"
        role="img"
        :aria-label="lampText"
        :title="lampText"
      />
      <div class="ikrep-hwrap">
        <h3 class="ikrep-title">{{ t('infra.kube.report.title') }}</h3>
        <p class="ikrep-sub">{{ t('infra.kube.report.sub') }}</p>
      </div>
      <span v-if="whenLabel" class="ihint">
        {{ t('infra.kube.report.stale', { when: whenLabel }) }}
      </span>
      <button
        type="button"
        class="btn"
        :disabled="busy"
        :aria-busy="busy"
        :title="t('infra.kube.refresh')"
        @click="kube.refreshWorkload()"
      >
        <Icon
          name="refresh"
          :class="{ ikspin: busy }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
      </button>
    </div>

    <p v-if="!hasData" class="ihint">{{ t('infra.kube.report.noData') }}</p>

    <template v-else>
      <div class="ikrep-top">
        <div class="ikrep-score">
          <span class="ikrep-score-n">{{ score ?? '—' }}</span>
          <span class="ikrep-score-l">
            <span class="ikrep-score-t">{{ t('infra.kube.report.score') }}</span>
            <span class="ihint">{{ t('infra.kube.report.scoreNote') }}</span>
          </span>
        </div>
        <p class="ikrep-verdict" :class="`vt-${lamp}`">{{ lampText }}</p>
      </div>

      <div class="ikrep-tiles">
        <div v-for="tile in tiles" :key="tile.key" class="ikrep-tile">
          <span class="ikrep-tile-k">{{ tile.label }}</span>
          <span class="ikrep-tile-v">{{ tile.value }}</span>
          <span v-if="tile.sub" class="ikrep-tile-s">{{ tile.sub }}</span>
        </div>
      </div>

      <div v-if="pods.statuses.length" class="ikrep-block">
        <span class="ikrep-block-t">{{ t('infra.kube.report.statuses') }}</span>
        <!-- Thanh phân bố: độ rộng mỗi đoạn theo SỐ POD, để một cái CrashLoop hiện ra
             đúng tỉ lệ của nó thay vì chiếm cả thanh. -->
        <div class="ikrep-bar">
          <span
            v-for="s in pods.statuses"
            :key="s.status"
            class="ikrep-seg"
            :class="`seg-${rateOf(s.status)}`"
            :style="{ flexGrow: s.n }"
            :title="`${s.status} · ${s.n}`"
          />
        </div>
        <div class="ikrep-legend">
          <span v-for="s in pods.statuses" :key="s.status" class="ikrep-leg">
            <span class="ikrep-dot" :class="`seg-${rateOf(s.status)}`" />
            {{ s.status }}
            <b>{{ s.n }}</b>
          </span>
        </div>
      </div>

      <div v-if="pods.top.length" class="ikrep-block">
        <span class="ikrep-block-t">{{ t('infra.kube.report.topRestarts') }}</span>
        <ul class="ikrep-list ikrep-restarts">
          <li v-for="row in pods.top" :key="row.name">
            <code>{{ row.name }}</code>
            <span class="ihint">{{ row.n }}</span>
          </li>
        </ul>
      </div>

      <ul v-if="findings.length" class="ikrep-list ikrep-findings">
        <li v-for="finding in findings" :key="finding">{{ finding }}</li>
      </ul>

      <div class="ikrep-block ikrep-watch">
        <button
          type="button"
          class="btn"
          :class="{ pri: !watching }"
          :aria-pressed="watching"
          @click="toggleWatch()"
        >
          <Icon
            :name="watching ? 'stop' : 'play'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{
            watching
              ? t('infra.kube.report.monitorStop')
              : t('infra.kube.report.monitor', { sec: WATCH_SECONDS })
          }}
        </button>
        <span v-if="watching" class="ihint" role="status">
          {{ t('infra.kube.report.monitorOn', { when: lastLabel || '—' }) }}
        </span>
        <span v-else class="ihint">
          {{ t('infra.kube.report.monitorCap', { min: WATCH_MINUTES }) }}
        </span>
      </div>

      <div v-if="trend && trend.n > 1" class="ikrep-block">
        <!-- Hai đường trên cùng một khung ⇒ phải có chú giải ngay trên khung, nếu
             không thì đường thứ hai là một nét màu không ai đoán được nghĩa. -->
        <div class="ikrep-blockhead">
          <span class="ikrep-block-t">{{ t('infra.kube.report.trend') }}</span>
          <span class="ikrep-leg">
            <span class="ikrep-dot ikrep-spark-a" />
            {{ t('infra.kube.report.trendNotReady') }}
          </span>
          <span class="ikrep-leg">
            <span class="ikrep-dot ikrep-spark-b" />
            {{ t('infra.kube.report.trendScore') }}
          </span>
        </div>
        <div class="ikrep-sparkwrap">
          <svg
            class="ikrep-spark"
            viewBox="0 0 300 60"
            preserveAspectRatio="none"
            role="img"
            :aria-label="t('infra.kube.report.trend')"
          >
            <polyline
              class="ikrep-spark-a"
              vector-effect="non-scaling-stroke"
              :points="sparkNotReady"
            />
            <polyline
              class="ikrep-spark-b"
              vector-effect="non-scaling-stroke"
              :points="sparkScore"
            />
          </svg>
        </div>
        <span class="ihint">
          {{ t('infra.kube.report.series', { n: trend.n, from: fromLabel }) }}
        </span>
      </div>

      <div class="ikrep-acts">
        <button type="button" class="btn" @click="copyReport()">
          <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.kube.report.copy') }}
        </button>
        <button type="button" class="btn" @click="askAboutReport()">
          <Icon name="message" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.kube.report.ask') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Màn Báo cáo (mục 3 của vùng bảng trong tab Kubernetes). Component chỉ HIỂN THỊ;
// mọi phép tính nằm ở `useInfraKubeReport()` (khuôn page-controller của
// .claude/rules/nuxt-vue.md).
import {
  KUBE_WATCH_MAX_MS,
  KUBE_WATCH_SECONDS,
  statusRate,
  useInfraKubeReport,
} from '~/composables/useInfraKubeReport'
import type { InfraKubeController } from '~/composables/useInfraKube'

const props = defineProps<{ kube: InfraKubeController }>()
const kube = props.kube
const { t } = useI18n()

const {
  pods,
  deploys,
  hasData,
  score,
  lamp,
  lampText,
  findings,
  trend,
  watching,
  lastLabel,
  whenLabel,
  fromLabel,
  sparkNotReady,
  sparkScore,
  toggleWatch,
  copyReport,
  askAboutReport,
} = useInfraKubeReport(kube)

const busy = kube.workloadBusy
const WATCH_SECONDS = KUBE_WATCH_SECONDS
const WATCH_MINUTES = Math.round(KUBE_WATCH_MAX_MS / 60_000)

function rateOf(status: string): string {
  return statusRate(status)
}

type Tile = { key: string; label: string; value: string; sub?: string }

/** Bốn chỉ số chính. Số nào không có nguồn (chưa nạp deployment) thì hiện '—'
 *  chứ không hiện 0 — 0 nghĩa là "đã đo và bằng không", khác hẳn "chưa đo". */
const tiles = computed<Tile[]>(() => {
  const p = pods.value
  const out: Tile[] = [
    {
      key: 'pods',
      label: t('infra.kube.report.m.pods'),
      value: p.judged ? `${p.ready}/${p.judged}` : '—',
      sub: p.judged
        ? t('infra.kube.report.readyPct', { n: Math.round((p.ready / p.judged) * 100) })
        : undefined,
    },
    { key: 'notReady', label: t('infra.kube.report.m.notReady'), value: String(p.notReady) },
    {
      key: 'restarts',
      label: t('infra.kube.report.m.restarts'),
      value: String(p.restarts),
      sub: p.total
        ? t('infra.kube.report.perPod', { n: (p.restarts / p.total).toFixed(1) })
        : undefined,
    },
  ]
  // Ô deployment chỉ có mặt khi THẬT SỰ có hàng deployment: một cụm chưa nạp được
  // bảng deployment không được hiện "0/0 đủ bản sao" (câu đó vừa vô nghĩa vừa sai).
  const d = deploys.value
  if (d.total > 0) {
    out.push({
      key: 'deploys',
      label: t('infra.kube.report.m.deploys'),
      value: `${d.full}/${d.total}`,
      sub: d.desired > 0 ? `${d.ready}/${d.desired}` : undefined,
    })
  }
  // Pod đã chạy xong (Job/CronJob) là chuyện bình thường, nhưng phải NÓI RA: không
  // nói thì người dùng thấy "11/12 sẵn sàng" và đi tìm pod thứ 12 vô ích.
  if (p.finished > 0) {
    out.push({
      key: 'finished',
      label: t('infra.kube.report.finished', { n: p.finished }),
      value: String(p.finished),
    })
  }
  return out
})
</script>

<style scoped>
.ikrep {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.ikrep-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ikrep-hwrap {
  min-width: 0;
}
.ikrep-title {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: var(--lh-md);
}
.ikrep-sub {
  margin: 2px 0 0;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrep-lamp {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: var(--r-full);
  background: var(--textFaint);
}
.ikrep-lamp.lamp-ok {
  background: var(--green);
}
.ikrep-lamp.lamp-warn {
  background: var(--amber);
}
.ikrep-lamp.lamp-bad {
  background: var(--danger);
}
.ikrep-top {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ikrep-score {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.ikrep-score-n {
  color: var(--text);
  font-size: var(--fs-xl);
  font-weight: 700;
  line-height: var(--lh-xl);
  font-variant-numeric: tabular-nums;
}
.ikrep-score-l {
  display: flex;
  flex-direction: column;
}
.ikrep-score-t {
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.ikrep-verdict {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.ikrep-verdict.vt-bad {
  color: var(--danger);
}
.ikrep-verdict.vt-warn {
  color: var(--amber);
}
.ikrep-tiles {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.ikrep-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  flex: 1 1 132px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}
.ikrep-tile-k {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrep-tile-v {
  color: var(--text);
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-lg);
  font-variant-numeric: tabular-nums;
}
.ikrep-tile-s {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrep-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ikrep-block-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrep-blockhead {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ikrep-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--bgActive);
}
.ikrep-seg {
  display: block;
  min-width: 2px;
}
.ikrep-seg.seg-ok,
.ikrep-dot.seg-ok {
  background: var(--green);
}
.ikrep-seg.seg-warn,
.ikrep-dot.seg-warn {
  background: var(--amber);
}
.ikrep-seg.seg-bad,
.ikrep-dot.seg-bad {
  background: var(--danger);
}
.ikrep-seg.seg-unknown,
.ikrep-dot.seg-unknown {
  background: var(--textFaint);
}
.ikrep-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.ikrep-leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrep-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
}
.ikrep-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikrep-findings li {
  margin-bottom: 2px;
}
/* Tên pod và số lần khởi động lại là hai mẩu khác loại: dính liền nhau thì
   "api-7d9c-def7" đọc ra như một cái tên. */
.ikrep-restarts li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ikrep-watch {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ikrep-spark {
  display: block;
  width: 100%;
  height: 60px;
}
/* Khung của dải xu hướng: hai nét mảnh trôi giữa trang trắng trông như lỗi vẽ,
   một đường viền mờ là đủ để chúng thành một biểu đồ. */
.ikrep-sparkwrap {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}
.ikrep-spark polyline {
  fill: none;
  stroke-width: 1.5;
}
.ikrep-spark-a {
  stroke: var(--amber);
}
.ikrep-spark-b {
  stroke: var(--accent);
}
.ikrep-dot.ikrep-spark-a {
  background: var(--amber);
}
.ikrep-dot.ikrep-spark-b {
  background: var(--accent);
}
.ikrep-acts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
