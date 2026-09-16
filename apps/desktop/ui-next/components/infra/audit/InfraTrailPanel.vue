<template>
  <!-- CloudTrail trong màn Nhật ký (Mốc 7, việc 7.6).
       Khối RIÊNG, có nút riêng, và cố ý KHÔNG tự nạp theo màn cha: sổ AWOG ở trên là một
       file cục bộ, còn khối này spawn `aws cloudtrail lookup-events` — một lời gọi mạng
       thật trên API mà AWS siết 2 request/giây.

       CÂU HỎI NÓ TRẢ LỜI: "tài khoản vừa bị đổi gì, và có phải do tôi làm trong AWOG
       không". Nhãn trong/ngoài là SUY ĐOÁN (ghép theo tên thao tác + thời gian, không có
       id chung), nên mỗi dòng `awog` hiện kèm mốc của dòng sổ đã khớp để người đọc kiểm
       được thay vì phải tin. -->
  <section class="itp">
    <div class="itp-hd">
      <button class="itp-toggle" type="button" @click="open = !open">
        <Icon name="chev" class="itp-ic" :class="open ? '' : 'itp-closed'" />
        <span class="itp-ttl">{{ t('infra.trail.title') }}</span>
      </button>
      <span class="itp-hint">{{ t('infra.trail.subtitle') }}</span>
    </div>

    <template v-if="open">
      <div class="itoolbar itp-tool">
        <div class="itoolgrp">
          <div class="seg">
            <span
              v-for="r in ranges"
              :key="r"
              :class="{ on: range === r }"
              role="button"
              :aria-pressed="range === r"
              @click="range = r"
            >
              {{ r }}
            </span>
          </div>
        </div>

        <div class="itoolgrp igrow">
          <input
            v-model="resourceName"
            class="itp-inp"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('infra.trail.resourcePlaceholder')"
            :title="t('infra.trail.resourceWhy')"
            @keydown.enter="lookup"
          />

          <button
            class="btn sm pri"
            type="button"
            :disabled="loading || !hasAccount"
            :aria-busy="loading"
            @click="lookup"
          >
            <Icon name="search" class="itp-ic" :class="loading ? 'itp-spin' : ''" />
            {{ t('infra.trail.lookup') }}
          </button>
        </div>

        <label v-if="report" class="itoolgrp itp-chk">
          <input v-model="externalOnly" type="checkbox" />
          {{ t('infra.trail.externalOnly') }}
        </label>
      </div>

      <p v-if="!sidecarAvailable" class="kt-state">{{ t('infra.trail.noSidecar') }}</p>
      <InfraEmpty
        v-else-if="!hasAccount"
        :title="t('infra.empty.noProfile.title')"
        :hint="t('infra.empty.noProfile.hint.trail')"
        action="accounts"
        :action-label="t('infra.empty.noProfile.action')"
      />
      <p v-else-if="error" class="kt-state err">{{ errorText }}</p>

      <template v-else-if="report">
        <p class="itp-sum">
          {{ t('infra.trail.counts', { a: report.awogCount, e: report.externalCount }) }}
          <span v-if="report.hasMore" class="itp-muted">{{ t('infra.trail.more') }}</span>
          <span v-if="limits" class="itp-muted">
            {{ t('infra.trail.limitWhy', { d: limits.maxDays }) }}
          </span>
        </p>

        <div v-if="visible.length" class="tblcard itp-tblwrap">
          <table class="kt">
            <thead>
              <tr>
                <th>{{ t('infra.trail.col.at') }}</th>
                <th>{{ t('infra.trail.col.origin') }}</th>
                <th>{{ t('infra.trail.col.event') }}</th>
                <th>{{ t('infra.trail.col.who') }}</th>
                <th>{{ t('infra.trail.col.resource') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in visible" :key="e.id">
                <td class="itp-at">{{ hhmm(e.at) }}</td>
                <td>
                  <!-- Nhãn mang `title` nói rõ đây là suy đoán, và dòng `awog` chỉ ra
                     ĐƯỢC mốc sổ đã khớp. -->
                  <span
                    class="itp-badge"
                    :class="e.origin"
                    :title="
                      e.origin === 'awog'
                        ? t('infra.trail.matchedWhy', { at: hhmm(e.matchedAt ?? e.at) })
                        : t('infra.trail.externalWhy')
                    "
                  >
                    {{ t(`infra.trail.origin.${e.origin}`) }}
                  </span>
                </td>
                <td>
                  {{ e.name }}
                  <span v-if="e.errorCode" class="itp-err">{{ e.errorCode }}</span>
                </td>
                <td class="itp-muted">{{ e.username || '—' }}</td>
                <!-- Đơn giản: đoạn cuối của ARN (tên tài nguyên). Chuyên sâu: nguyên
                   ARN, copy dán được. `title` giữ bản đầy đủ ở cả hai. -->
                <td class="itp-res" :title="e.resources.join(' · ')">
                  {{ (isExpert ? e.resources : e.resources.map(shortRes)).join(' · ') || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="tblcard kt-state">{{ t('infra.trail.empty') }}</p>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
// Lớp bind của khối CloudTrail. Mọi state + RPC ở `useInfraTrail()`.
import { computed, ref } from 'vue'
import InfraEmpty from '~/components/infra/InfraEmpty.vue'
import { useInfraMode } from '~/composables/useInfraMode'
import { useInfraTrail } from '~/composables/useInfraTrail'

const { t } = useI18n()
const { isExpert } = useInfraMode()

const {
  hasAccount,
  sidecarAvailable,
  report,
  visible,
  loading,
  error,
  range,
  ranges,
  limits,
  externalOnly,
  resourceName,
  lookup,
} = useInfraTrail()

/** Đóng sẵn: khối này tốn một lời gọi mạng, nên nó không mời gọi bằng cách mở sẵn. */
const open = ref(false)

/**
 * Hai lỗi của sidecar là KHOÁ dịch được, phần còn lại là stderr của CLI.
 * `WINDOW_TOO_OLD` là câu trả lời hay gặp nhất và nó không phải một lỗi hệ thống —
 * dịch nó ra tiếng người thay vì để nguyên mã.
 */
const errorText = computed(() => {
  const raw = error.value
  if (raw === 'WINDOW_TOO_OLD' || raw === 'BAD_WINDOW' || raw === 'BAD_OUTPUT') {
    return t(`infra.trail.err.${raw}`)
  }
  return raw
})

/**
 * Phần của một ARN mà người đọc NHẬN RA. `arn:aws:s3:::my-bucket` ⇒ `my-bucket`;
 * `…:instance/i-0abc` ⇒ `i-0abc`. Không phải ARN thì giữ nguyên.
 *
 * ⚠ Load balancer là ngoại lệ, và lấy đoạn cuối ở đó là SAI: ARN của nó kết thúc
 * bằng `loadbalancer/app/<tên>/<mã băm>`, nên luật "đoạn cuối" trả về cái mã băm
 * (`50dc6c49`) — đúng cú pháp, vô nghĩa với người đọc. Tên nằm ở đoạn áp chót.
 */
const LB_TYPES = new Set(['app', 'net', 'gwy'])

function shortRes(v: string): string {
  if (!v.startsWith('arn:')) return v
  const tail = v.split(':').pop() ?? v
  const parts = tail.split('/').filter((x) => x !== '')
  if (parts.length === 0) return tail
  const lbAt = parts.findIndex((x) => LB_TYPES.has(x))
  if (lbAt >= 0 && parts[lbAt + 1]) return parts[lbAt + 1] as string
  return parts[parts.length - 1] as string
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso
}
</script>

<style scoped>
.itp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.itp-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.itp-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.itp-ttl {
  color: var(--text);
}

.itp-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

/* Bố cục + da của thanh nằm ở `.itoolbar`/`.itoolgrp` (app-shell.css). */

/* Bảng CloudTrail có header dính (`.kt th` là `position: sticky`), mà sticky chỉ
   bám vào một tổ tiên CÓ CUỘN — không có khung này thì nó dính vào vùng cuộn của
   cả màn và trôi lên trên thanh công cụ. */
.itp-tblwrap {
  max-height: 420px;
  overflow: auto;
}

.itp-inp {
  flex: 1 1 220px;
  min-width: 160px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.itp-chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  white-space: nowrap;
}

.itp-sum {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}

.itp-muted {
  color: var(--textFaint);
}

.itp-badge {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
}

.itp-badge.external {
  border-color: var(--amberBorder);
  color: var(--amber);
}

.itp-at {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.itp-res {
  font-family: var(--code); /* mono-ok: id tài nguyên AWS, copy được vào lệnh */
  word-break: break-all;
}

.itp-err {
  margin-left: 6px;
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.itp-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex-shrink: 0;
}

.itp-closed {
  transform: rotate(-90deg);
}

.itp-spin {
  animation: itp-rot 1s linear infinite;
}

@keyframes itp-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
