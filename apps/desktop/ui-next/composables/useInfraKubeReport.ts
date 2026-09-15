import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyText } from '~/utils/clipboard'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import type { InfraKubeController } from '~/composables/useInfraKube'

// Số liệu của mục **Báo cáo** trong tab Kubernetes: gom bảng Pods/Deployments vừa
// đọc thành vài chỉ số, một điểm sức khoẻ, và một dải xu hướng khi người dùng bật
// theo dõi.
//
// LUẬT CỦA FILE NÀY — KHÔNG TỰ ĐỌC THÊM GÌ.
//   · Mọi con số ở đây tính từ `kube.pods` / `kube.deployments` — hai bảng mà người
//     dùng đã tự nạp. Không có RPC riêng, không gọi thêm cluster, không tốn thêm
//     giây nào. Muốn số mới thì bấm ↻ (hoặc bật theo dõi, xem dưới).
//   · Điểm sức khoẻ là một CÔNG THỨC, không phải phán quyết của AWS. Nó tự khai ra
//     điều đó ở mọi chỗ nó xuất hiện ("tự tính", "không phải SLA") — một con số
//     trông như điểm giám sát mà lại không phải thì tệ hơn không có điểm.
//   · Theo dõi là hành động CÓ NGƯỜI BẤM và có TRẦN: mặc định tắt, tự dừng sau
//     `KUBE_WATCH_MAX_MS`, và dừng ngay khi component bị tháo (rời mục Báo cáo).
//     Luật "không auto-refresh" cấm nạp sau lưng người dùng; một vòng lặp người dùng
//     tự bật và tự thấy thì không phải sau lưng ai.

export type KubeRate = 'ok' | 'warn' | 'bad' | 'unknown'
export type KubeStatusCount = { status: string; n: number }
export type KubeRestartTop = { name: string; n: number }
/** Một mẫu của dải xu hướng. Sống trong BỘ NHỚ phiên — không ghi ra đĩa. */
export type KubeSample = { t: number; notReady: number; restarts: number; score: number | null }

/** Nhịp đọc khi bật theo dõi. */
export const KUBE_WATCH_SECONDS = 30
export const KUBE_WATCH_MS = KUBE_WATCH_SECONDS * 1000
/** Trần một phiên theo dõi: 15 phút ⇒ tối đa 30 lượt đọc rồi tự dừng. */
export const KUBE_WATCH_MAX_MS = 15 * 60_000
/** Trần số mẫu giữ lại: đủ để thấy xu hướng, không phải một mảng phình mãi. */
const MAX_SAMPLES = 60

/** `"2/3"` ⇒ `{ ready: 2, total: 3 }`. Không đúng dạng ⇒ `null` (thà bỏ qua còn
 *  hơn đoán bừa một con số rồi đem đi chấm điểm). */
export function splitReady(cell: string): { ready: number; total: number } | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(cell.trim())
  if (!m) return null
  const ready = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(ready) || !Number.isFinite(total)) return null
  return { ready, total }
}

/** Pod đã chạy xong (Job/CronJob) không phải pod hỏng — chấm nó là "chưa sẵn sàng"
 *  sẽ biến mọi cụm có CronJob thành cụm đỏ. */
function isFinished(status: string): boolean {
  const s = status.toLowerCase()
  return s.startsWith('completed') || s.startsWith('succeeded')
}

/** Mức nghiêm trọng của một trạng thái pod, dùng cho thanh phân bố và cho đèn. */
export function statusRate(status: string): KubeRate {
  const s = status.toLowerCase()
  if (isFinished(s)) return 'ok'
  if (s.startsWith('running')) return 'ok'
  if (s.startsWith('pending') || s.startsWith('containercreating') || s.startsWith('init')) {
    return 'warn'
  }
  if (
    s.startsWith('crashloop') ||
    s.startsWith('error') ||
    s.startsWith('imagepull') ||
    s.startsWith('errimagepull') ||
    s.startsWith('evicted') ||
    s.startsWith('failed') ||
    s.startsWith('unknown') ||
    s.startsWith('terminating')
  ) {
    return 'bad'
  }
  return 'warn'
}

export function useInfraKubeReport(kube: InfraKubeController) {
  const { t } = useI18n()
  const toast = useToast()
  const { askAgent } = useInfraAskAgent()

  const whereLabel = computed(() => {
    const cluster = kube.pinnedCluster.value
    if (!cluster) return '—'
    const ns = kube.pinnedNamespace.value
    return ns ? `${cluster}/${ns}` : cluster
  })

  // ── Pod: đếm theo trạng thái + tổng lần khởi động lại ──────────────────────
  const pods = computed(() => {
    const byStatus = new Map<string, number>()
    const restartsBy: KubeRestartTop[] = []
    let ready = 0
    let notReady = 0
    let finished = 0
    let restarts = 0
    const notReadyNames: string[] = []

    for (const row of kube.pods.value) {
      const rate = splitReady(row.cells[0] ?? '')
      const status = (row.cells[1] ?? '').trim() || '—'
      if (rate && rate.total > 0 && rate.ready >= rate.total) ready += 1
      else if (isFinished(status)) finished += 1
      else {
        notReady += 1
        if (notReadyNames.length < 3) notReadyNames.push(`${row.name} (${status})`)
      }

      byStatus.set(status, (byStatus.get(status) ?? 0) + 1)

      const n = Number((row.cells[2] ?? '').trim())
      const count = Number.isFinite(n) && n > 0 ? n : 0
      restarts += count
      if (count > 0) restartsBy.push({ name: row.name, n: count })
    }

    restartsBy.sort((a, b) => b.n - a.n)
    const statuses: KubeStatusCount[] = [...byStatus.entries()]
      .map(([status, n]) => ({ status, n }))
      .sort((a, b) => b.n - a.n)

    return {
      total: kube.pods.value.length,
      /** Số pod ĐƯỢC CHẤM (trừ pod đã chạy xong). */
      judged: ready + notReady,
      ready,
      notReady,
      finished,
      restarts,
      statuses,
      top: restartsBy.slice(0, 3),
      notReadyNames,
    }
  })

  // ── Deployment: bao nhiêu cái đủ bản sao ───────────────────────────────────
  const deploys = computed(() => {
    const behind: string[] = []
    let desired = 0
    let ready = 0
    let full = 0
    for (const row of kube.deployments.value) {
      const rate = splitReady(row.cells[0] ?? '')
      if (!rate || rate.total <= 0) continue
      desired += rate.total
      ready += Math.min(rate.ready, rate.total)
      if (rate.ready >= rate.total) full += 1
      else if (behind.length < 3) behind.push(`${row.name} (${rate.ready}/${rate.total})`)
    }
    return { total: kube.deployments.value.length, full, desired, ready, behind }
  })

  const hasData = computed(() => pods.value.total > 0 || deploys.value.total > 0)

  /**
   * Điểm sức khoẻ 0–100 — ba thành phần, mỗi phần chỉ được tính khi CÓ dữ liệu (một
   * cụm chỉ có pod thì không bị trừ điểm vì "không có deployment").
   *   55% tỉ lệ pod sẵn sàng · 35% tỉ lệ bản sao deployment · 10% mức khởi động lại.
   */
  const score = computed<number | null>(() => {
    const p = pods.value
    const d = deploys.value
    const parts: { w: number; v: number }[] = []
    if (p.judged > 0) parts.push({ w: 0.55, v: p.ready / p.judged })
    if (d.desired > 0) parts.push({ w: 0.35, v: d.ready / d.desired })
    if (p.total > 0) {
      // 5 lần khởi động lại / pod là mức "hết điểm" của thành phần này.
      parts.push({ w: 0.1, v: Math.max(0, 1 - p.restarts / (p.total * 5)) })
    }
    if (parts.length === 0) return null
    const wsum = parts.reduce((acc, part) => acc + part.w, 0)
    const value = parts.reduce((acc, part) => acc + part.w * part.v, 0) / wsum
    return Math.round(value * 100)
  })

  const lamp = computed<KubeRate>(() => {
    if (!hasData.value) return 'unknown'
    const p = pods.value
    const d = deploys.value
    if (p.notReady > 0 || d.ready < d.desired) return 'bad'
    if (p.restarts > 0 || (score.value !== null && score.value < 100)) return 'warn'
    return 'ok'
  })

  const lampText = computed(() => t(`infra.kube.report.lamp.${lamp.value}`))

  /** Những câu nói RÕ cái gì đang lệch — dùng cho cả màn hình và bản sao chép. */
  const findings = computed<string[]>(() => {
    const out: string[] = []
    const p = pods.value
    const d = deploys.value
    if (p.notReady > 0) {
      out.push(
        t('infra.kube.report.detail.notReady', {
          n: p.notReady,
          list: p.notReadyNames.join(', '),
        }),
      )
    }
    if (d.desired > 0 && d.ready < d.desired) {
      out.push(
        t('infra.kube.report.detail.deploys', {
          n: d.desired - d.ready,
          list: d.behind.join(', '),
        }),
      )
    }
    if (p.restarts > 0) {
      out.push(t('infra.kube.report.detail.restarts', { n: p.restarts, top: p.top[0]?.name ?? '' }))
    }
    if (out.length === 0 && hasData.value) out.push(t('infra.kube.report.detail.ok'))
    return out
  })

  // ── Dải xu hướng + vòng theo dõi ───────────────────────────────────────────
  const samples = ref<KubeSample[]>([])
  const watching = ref(false)
  const lastAt = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function pushSample(): void {
    if (!hasData.value) return
    lastAt.value = Date.now()
    samples.value = [
      ...samples.value.slice(-(MAX_SAMPLES - 1)),
      {
        t: lastAt.value,
        notReady: pods.value.notReady,
        restarts: pods.value.restarts,
        score: score.value,
      },
    ]
  }

  // Mỗi lượt nạp XONG (busy: true → false) là một mẫu. Bắt ở đây thay vì trong
  // `useInfraKube` để controller không phải biết gì về màn Báo cáo.
  watch(
    () => kube.workloadBusy.value,
    (busy, was) => {
      if (was === true && busy === false) pushSample()
    },
  )
  // Mở mục Báo cáo sau khi bảng đã nạp xong: vẫn có mẫu đầu tiên để mà vẽ.
  if (!kube.workloadBusy.value) pushSample()

  function stopWatch(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    watching.value = false
  }

  function toggleWatch(): void {
    if (watching.value) {
      stopWatch()
      return
    }
    watching.value = true
    const startedAt = Date.now()
    void kube.refreshWorkload()
    timer = setInterval(() => {
      // Trần cứng: một vòng "bật rồi để đó" không được chạy tới hết buổi làm việc.
      if (Date.now() - startedAt >= KUBE_WATCH_MAX_MS) stopWatch()
      else void kube.refreshWorkload()
    }, KUBE_WATCH_MS)
  }

  onBeforeUnmount(stopWatch)

  const trend = computed(() => {
    const list = samples.value
    if (list.length === 0) return null
    const notReady = list.map((s) => s.notReady)
    const scores = list.map((s) => s.score).filter((s): s is number => s !== null)
    return {
      n: list.length,
      from: list[0]?.t ?? 0,
      minNotReady: Math.min(...notReady),
      maxNotReady: Math.max(...notReady),
      minScore: scores.length ? Math.min(...scores) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
    }
  })

  /** Điểm cho sparkline: `null` (chưa có mẫu) ⇒ chuỗi rỗng, không vẽ gì. */
  function spark(values: (number | null)[], max: number): string {
    const list = values.filter((v): v is number => v !== null)
    if (list.length < 2) return ''
    const top = Math.max(max, 1)
    return list
      .map((v, i) => {
        const x = (i / (list.length - 1)) * 300
        const y = 56 - (Math.min(v, top) / top) * 52
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const sparkNotReady = computed(() =>
    spark(
      samples.value.map((s) => s.notReady),
      Math.max(1, ...samples.value.map((s) => s.notReady)),
    ),
  )
  const sparkScore = computed(() =>
    spark(
      samples.value.map((s) => s.score),
      100,
    ),
  )

  // ── Bản báo cáo dạng chữ (để chép / gửi agent) ─────────────────────────────
  const whenLabel = computed(() => (kube.loadedAt.value ? time(kube.loadedAt.value) : ''))
  const lastLabel = computed(() => (lastAt.value ? time(lastAt.value) : ''))
  const fromLabel = computed(() => (trend.value ? time(trend.value.from) : ''))

  function time(ts: number): string {
    return new Date(ts).toLocaleTimeString()
  }

  const reportText = computed<string>(() => {
    const p = pods.value
    const d = deploys.value
    const lines: string[] = [t('infra.kube.report.md.head', { where: whereLabel.value })]
    if (whenLabel.value) lines.push(t('infra.kube.report.md.when', { when: whenLabel.value }))
    if (!hasData.value) {
      lines.push(t('infra.kube.report.md.noData'))
      return lines.join('\n')
    }
    if (score.value !== null) lines.push(t('infra.kube.report.md.score', { score: score.value }))
    lines.push(
      t('infra.kube.report.md.pods', {
        ready: p.ready,
        total: p.judged,
        notReady: p.notReady,
      }),
    )
    if (p.statuses.length) {
      lines.push(
        t('infra.kube.report.md.statuses', {
          list: p.statuses.map((s) => `${s.status} ${s.n}`).join(', '),
        }),
      )
    }
    lines.push(
      t('infra.kube.report.md.restarts', {
        total: p.restarts,
        perPod: p.total ? (p.restarts / p.total).toFixed(1) : '0',
      }),
    )
    if (p.top.length) {
      lines.push(
        t('infra.kube.report.md.top', { list: p.top.map((x) => `${x.name} (${x.n})`).join(', ') }),
      )
    }
    lines.push(t('infra.kube.report.md.deploys', { ready: d.full, total: d.total }))
    if (trend.value && trend.value.n > 1) {
      lines.push(
        t('infra.kube.report.md.trend', {
          n: trend.value.n,
          min: trend.value.minNotReady,
          max: trend.value.maxNotReady,
          smin: trend.value.minScore ?? '—',
          smax: trend.value.maxScore ?? '—',
        }),
      )
    }
    for (const finding of findings.value) lines.push(`- ${finding}`)
    lines.push(t('infra.kube.report.md.verdict', { verdict: lampText.value }))
    return lines.join('\n')
  })

  async function copyReport(): Promise<void> {
    if (!(await copyText(reportText.value))) {
      toast.add({
        title: t('infra.kube.report.copyFailed'),
        color: 'error',
        icon: 'alert',
      })
      return
    }
    toast.add({ title: t('infra.kube.report.copied'), color: 'success', icon: 'copy' })
  }

  function askAboutReport(): void {
    void askAgent(
      t('infra.kube.report.askText', { where: whereLabel.value, report: reportText.value }),
    )
  }

  return {
    whereLabel,
    pods,
    deploys,
    hasData,
    score,
    lamp,
    lampText,
    findings,
    samples,
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
  }
}
