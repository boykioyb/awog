// Runner quét chủ động cho Network Capture: điều phối `planProbes` +
// `analyzeProbe` (utils/capture-scan.ts) qua `browser.capture.replay` của main
// (allowlist host, timeout, redirect manual đã có sẵn — renderer không fetch
// trực tiếp, không IPC mới). Mỗi lần gọi trả một instance MỚI (không singleton);
// page/parent composable sở hữu instance rồi expose cho component con.
//
// Chạy 2 pha: baseline trước (mốc timing/body), rồi mutation probe — entry nào
// baseline lỗi thì BỎ toàn bộ mutation của entry đó (đo trên host chết là vô
// nghĩa). stop() set cờ: probe đang bay xong nốt, hàng chờ bỏ → report partial.
// `.ts` extension ở import dưới là để `node --test` (type-stripping) chạy được.
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

import type { CaptureEntry, ReplayRequest, ReplayResult } from '~/types/network-capture'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` chạy được file này
import { analyzeProbe, planProbes } from '../utils/capture-scan.ts'
import type { ScanFinding, ScanProbe, ScanProbeResult, ScanReport } from '../utils/capture-scan'

/** Bridge replay của main — shape khớp `window.awog.browser.capture.replay`. */
export type ScanReplayApi = {
  replay(tabId: string, req: ReplayRequest, scope?: string): Promise<ReplayResult>
}

export type ScanRunOpts = {
  /** Forwarded làm arg thứ 3 của replay (engineId của session sở hữu tab). */
  scope?: string
  /** Chỉ chạy các scenario id này (vắng = cả 10). */
  scenarioIds?: string[]
  /** Chỉ entry của các host này (vắng = mọi host). */
  hosts?: string[]
}

const CONCURRENCY = 4
const ERROR_CAP = 50
const SEVERITY_ORDER: Record<ScanFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
}

export function useCaptureScanner(): {
  running: Ref<boolean>
  progress: Ref<{ done: number; total: number }>
  report: ShallowRef<ScanReport | null>
  run(entries: CaptureEntry[], api: ScanReplayApi, opts?: ScanRunOpts): Promise<ScanReport>
  stop(): void
} {
  const running = ref(false)
  const progress = ref({ done: 0, total: 0 })
  const report = shallowRef<ScanReport | null>(null)
  let aborted = false
  /** Promise của lượt đang chạy — caller thứ hai await cùng lượt (trả report cuối). */
  let pending: Promise<ScanReport> | null = null

  function stop(): void {
    aborted = true
  }

  async function execute(
    entries: CaptureEntry[],
    api: ScanReplayApi,
    opts?: ScanRunOpts,
  ): Promise<ScanReport> {
    running.value = true
    aborted = false

    const hosts = opts?.hosts && opts.hosts.length > 0 ? new Set(opts.hosts) : null
    const filtered = hosts ? entries.filter((e) => hosts.has(e.host)) : entries
    const byId = new Map(filtered.map((e) => [e.id, e]))
    const rep: ScanReport = {
      scannedAt: Date.now(),
      hosts: [...new Set(filtered.map((e) => e.host))].sort(),
      probes: 0,
      findings: [],
      errors: [],
      details: [],
      blocked: false,
    }
    report.value = { ...rep }

    const probes = planProbes(filtered, { scenarioIds: opts?.scenarioIds })
    progress.value = { done: 0, total: probes.length }

    /** Baseline của một entry (probe `baseline:true` gắn entryId của entry đầu tiên
     *  cùng request-signature — mutation đã dedupe theo sig nên entryId đó hợp lệ). */
    const baselineByEntry = new Map<string, ReplayResult>()
    const baselineFailed = new Set<string>()
    /** Dedupe finding.id — nhiều payload cùng scenario+param+entry trùng id → giữ nặng nhất. */
    const findingById = new Map<string, ScanFinding>()
    let done = 0

    const publish = (): void => {
      report.value = {
        ...rep,
        findings: [...findingById.values()].sort(
          (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
        ),
        errors: [...rep.errors],
        details: [...rep.details],
      }
    }

    // Đếm lỗi transport LIÊN TIẾP — khi WAF/CDN bắt đầu chặn thảm (ERR_FAILED hàng
    // loạt), cứ bắn tiếp chỉ tạo nhiễu: dừng sớm, báo `blocked` để UI nói rõ.
    let consecFail = 0
    const STORM_LIMIT = 12
    // Nhịp nghỉ giữa 2 probe của một worker — đỡ bị rate-limit mà tổng thời gian
    // chỉ chậm thêm vài giây (300 probe × 4 luồng × 40ms ≈ +3s).
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    let seq = 0

    const pushError = (msg: string): void => {
      // Dedupe theo nội dung: 200 lần "ERR_FAILED" giống nhau chỉ chiếm 1 dòng ×N.
      const last = rep.errors[rep.errors.length - 1]
      const m = last?.match(/^(.*) ×(\d+)$/s)
      if (last === msg) {
        rep.errors[rep.errors.length - 1] = `${msg} ×2`
        return
      }
      if (m?.[1] === msg) {
        rep.errors[rep.errors.length - 1] = `${msg} ×${Number(m[2]) + 1}`
        return
      }
      if (rep.errors.length < ERROR_CAP) rep.errors.push(msg)
    }

    const exec = async (p: ScanProbe): Promise<void> => {
      const e = byId.get(p.entryId)
      let res: ReplayResult
      try {
        if (e) res = await api.replay(e.tabId, p.request, opts?.scope)
        else res = { ok: false, error: 'entry no longer present' }
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      rep.probes++
      done++
      progress.value = { done, total: probes.length }

      // Ghi dòng cho bảng: probe nào → request gì → response/error gì.
      const short = p.request.url.length > 220 ? `${p.request.url.slice(0, 220)}…` : p.request.url
      const detail: ScanProbeResult = {
        id: `d${++seq}`,
        scenarioId: p.scenarioId,
        entryId: p.entryId,
        method: p.request.method,
        url: short,
        param: p.param,
        location: p.location,
        payload: p.payload,
        request: p.request,
        status: res.ok ? res.status : null,
        timeMs: res.ok ? res.timeMs : 0,
        size: res.ok ? res.body.size : 0,
        error: res.ok ? null : res.error,
        baseline: p.baseline === true,
      }

      let finding: ScanFinding | null = null
      if (p.baseline === true) {
        baselineByEntry.set(p.entryId, res)
        if (!res.ok) baselineFailed.add(p.entryId)
      } else if (res.ok) {
        finding = analyzeProbe(p, baselineByEntry.get(p.entryId) ?? null, res)
        if (finding) {
          const prev = findingById.get(finding.id)
          if (!prev || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[prev.severity]) {
            findingById.set(finding.id, finding)
          }
        }
      }
      if (finding) detail.hit = finding.severity
      rep.details.push(detail)

      // Mọi probe fail (kể cả baseline) vào errors — kèm method+url+scenario để
      // người dùng truy lại được request nào gãy.
      if (!res.ok) {
        consecFail++
        const ctx = `${p.request.method} ${short}`
        const label = p.baseline === true ? 'baseline' : p.scenarioId
        pushError(`${e?.host ?? '?'}: ${res.error} — ${ctx} [${label}]`)
        if (consecFail >= STORM_LIMIT) {
          rep.blocked = true
          aborted = true
        }
      } else {
        consecFail = 0
      }
      publish()
      // Nhịp nhỏ giữa các probe — giảm bị CloudFront/WAF chặn thảm.
      if (!aborted) await sleep(40)
    }

    /** Worker pool: mỗi worker rút probe kế tiếp (idx++ là đồng bộ → an toàn). */
    const runPool = async (list: ScanProbe[], skip?: (p: ScanProbe) => boolean): Promise<void> => {
      let idx = 0
      const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
        while (!aborted) {
          const p = list[idx++]
          if (!p) return
          if (skip?.(p)) {
            done++
            progress.value = { done, total: probes.length }
            continue
          }
          await exec(p)
        }
      })
      await Promise.all(workers)
    }

    try {
      await runPool(probes.filter((p) => p.baseline === true))
      await runPool(
        probes.filter((p) => p.baseline !== true),
        (p) => baselineFailed.has(p.entryId),
      )
    } finally {
      running.value = false
      publish()
    }
    // publish() chạy trong finally — report.value luôn đã gán trước khi tới đây.
    return report.value ?? rep
  }

  function run(
    entries: CaptureEntry[],
    api: ScanReplayApi,
    opts?: ScanRunOpts,
  ): Promise<ScanReport> {
    // Một lượt tại một thời điểm — caller thứ hai await cùng lượt đang chạy.
    if (!pending) {
      const p = execute(entries, api, opts)
      pending = p
      // finally() tạo promise mới — dùng then 2 nhánh để không sinh unhandled rejection.
      void p.then(
        () => (pending = null),
        () => (pending = null),
      )
    }
    return pending
  }

  return { running, progress, report, run, stop }
}
