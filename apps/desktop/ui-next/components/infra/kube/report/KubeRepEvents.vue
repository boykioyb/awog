<template>
  <!-- Khối "cụm vừa phàn nàn gì" — nguồn là `kubectl get events --field-selector
       type=Warning`.

       VÌ SAO KHỐI NÀY QUAN TRỌNG NHẤT TRONG BÁO CÁO. Pod/deployment/CPU trả lời
       "có gì đang lệch"; event trả lời "VÌ SAO" — `FailedScheduling` vì hết CPU,
       `OOMKilling` vì limit RAM thấp, `FailedMount` vì volume treo. Không có nó thì
       báo cáo dừng ở chỗ người đọc phải mở terminal.

       VÌ SAO GỘP THEO (lý do, đối tượng). Một pod CrashLoop sinh ra hàng trăm dòng
       `BackOff` giống nhau; đổ thẳng thì ba event KHÁC bị đẩy khỏi tầm mắt. Cùng
       cách gộp mà màn Giám sát dùng cho dòng lỗi log. -->
  <div class="ikre">
    <div class="ikre-head">
      <span class="ikre-t">{{ t('infra.kube.report.events') }}</span>
      <span v-if="lines" class="ihint">{{ t('infra.kube.report.eventsN', { n: lines }) }}</span>
      <!-- TƯƠI VÀ CŨ ĐỨNG CẠNH NHAU Ở TIÊU ĐỀ. `kubectl get events` giữ event tới
           một giờ, nên một cụm ĐÃ SỬA XONG vẫn còn đầy `Warning` của lúc hỏng:
           không tách ra thì khối này kêu về chuyện hôm kia, người đọc học cách bỏ
           qua nó, và lần nó kêu thật thì không ai nhìn. -->
      <span v-if="freshLines" class="ikre-fresh">
        {{ t('infra.kube.report.eventsFresh', { n: freshLines }) }}
      </span>
      <span v-if="staleLines" class="ihint">
        {{ t('infra.kube.report.eventsStale', { n: staleLines, min: windowMin }) }}
      </span>
    </div>

    <p v-if="gap" class="ikre-gap">
      {{ t('infra.kube.report.gap.events') }}
      <span class="ihint">{{ gap }}</span>
    </p>
    <!-- Không có event Warning là một KẾT QUẢ, không phải khối trống: nói ra để
         người dùng biết nó đã được đọc. -->
    <p v-else-if="lines === 0" class="ihint">{{ t('infra.kube.report.eventsNone') }}</p>
    <!-- Còn cảnh báo nhưng không cái nào tươi: một DÒNG, không phải một danh sách.
         Nhóm cũ vẫn được đếm (nó không biến mất), nhưng nó không được chiếm chỗ của
         thứ đang xảy ra. -->
    <p v-else-if="groups.length === 0" class="ihint">
      {{ t('infra.kube.report.eventsStaleOnly', { n: staleLines, min: windowMin }) }}
    </p>

    <ul v-if="groups.length" class="ikre-list">
      <li v-for="g in groups" :key="`${g.reason} ${g.object}`" class="ikre-i">
        <span class="ikre-row">
          <span class="ikre-dot" :class="`ev-${g.rate}`" />
          <b class="ikre-reason">{{ g.reason }}</b>
          <code class="ikre-obj" :title="g.object">{{ g.object }}</code>
          <span v-if="g.count > 1" class="ikre-n">{{ g.count }}×</span>
          <span v-if="g.lastSeen" class="ihint">{{ g.lastSeen }}</span>
        </span>
        <span v-if="g.message" class="ikre-msg">{{ g.message }}</span>
      </li>
    </ul>
    <span v-if="more > 0" class="ihint">{{ t('infra.kube.report.eventsMore', { n: more }) }}</span>
  </div>
</template>

<script setup lang="ts">
import type { EventGroup } from '~/utils/kube-report'

defineProps<{
  /** Các nhóm ĐƯỢC VẼ — nhóm TƯƠI, do `InfraKubeReport.vue` chọn và cắt sẵn. */
  groups: EventGroup[]
  /** Số nhóm không hiện (đã cắt còn N dòng). */
  more: number
  /** Tổng số dòng event đã gộp — mẫu của khối này. */
  lines: number
  /** Số dòng vừa bắn trong cửa sổ `windowMin` phút. */
  freshLines: number
  /** Số dòng cũ hơn cửa sổ đó. */
  staleLines: number
  /** Độ dài cửa sổ "vừa xảy ra", tính bằng phút. */
  windowMin: number
  /** Lý do không đọc được event (rỗng = đọc được). */
  gap: string
}>()

const { t } = useI18n()
</script>

<style scoped>
.ikre {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ikre-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.ikre-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
/* Cảnh báo VỪA bắn là tin; cảnh báo cũ là bối cảnh (`.ihint`). Hai mức đọc khác
   nhau ngay ở màu, trước khi người đọc kịp đọc con số. */
.ikre-fresh {
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.ikre-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* MỘT CẢNH BÁO MỘT HÀNG, cùng khuôn với khối CPU/RAM (chốt 2026-09-17). Thử hai
   cột rồi bỏ: `message` của `FailedScheduling` dài vài trăm ký tự nên ở nửa cột nó
   bị cắt đúng đoạn nói lý do — mà lý do chính là thứ khối này tồn tại để nói. */
.ikre-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Gạch TRÊN cho mọi ô, không phải khung bốn cạnh: khối này nằm trong card của mục
   "Cụm", khung riêng từng ô là card-trong-card (ghi chú ở `InfraKubeReport.vue`). */
.ikre-i {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.ikre-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.ikre-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--textFaint);
  align-self: center;
}
.ikre-dot.ev-warn {
  background: var(--amber);
}
.ikre-dot.ev-bad {
  background: var(--danger);
}
.ikre-reason {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.ikre-obj {
  color: var(--textMuted);
  font-family: var(--code); /* mono-ok: `pod/api-7d9c` là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ikre-n {
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
/* Thông điệp event dài (vài trăm ký tự với `FailedScheduling`), nên nó được cuộn
   theo hai dòng rồi cắt — cắt một dòng thì mất đúng phần nói lý do. */
.ikre-msg {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
</style>
