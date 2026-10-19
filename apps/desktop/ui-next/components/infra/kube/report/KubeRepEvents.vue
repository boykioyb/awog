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
  <div class="flex flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline gap-2.5">
      <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.events') }}</span>
      <span v-if="lines" class="text-xs text-faint">
        {{ t('infra.kube.report.eventsN', { n: lines }) }}
      </span>
      <!-- TƯƠI VÀ CŨ ĐỨNG CẠNH NHAU Ở TIÊU ĐỀ. `kubectl get events` giữ event tới
           một giờ, nên một cụm ĐÃ SỬA XONG vẫn còn đầy `Warning` của lúc hỏng:
           không tách ra thì khối này kêu về chuyện hôm kia, người đọc học cách bỏ
           qua nó, và lần nó kêu thật thì không ai nhìn. Cảnh báo VỪA bắn là tin (màu
           cảnh báo); cảnh báo cũ là bối cảnh (chữ mờ). -->
      <span v-if="freshLines" class="text-xs text-warning tabular-nums">
        {{ t('infra.kube.report.eventsFresh', { n: freshLines }) }}
      </span>
      <span v-if="staleLines" class="text-xs text-faint">
        {{ t('infra.kube.report.eventsStale', { n: staleLines, min: windowMin }) }}
      </span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gap.events') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>
    <!-- Không có event Warning là một KẾT QUẢ, không phải khối trống: nói ra để
         người dùng biết nó đã được đọc. -->
    <p v-else-if="lines === 0" class="text-xs text-faint">
      {{ t('infra.kube.report.eventsNone') }}
    </p>
    <!-- Còn cảnh báo nhưng không cái nào tươi: một DÒNG, không phải một danh sách.
         Nhóm cũ vẫn được đếm (nó không biến mất), nhưng nó không được chiếm chỗ của
         thứ đang xảy ra. -->
    <p v-else-if="groups.length === 0" class="text-xs text-faint">
      {{ t('infra.kube.report.eventsStaleOnly', { n: staleLines, min: windowMin }) }}
    </p>

    <!-- MỘT CẢNH BÁO MỘT HÀNG, cùng khuôn với khối CPU/RAM (chốt 2026-09-17). Thử hai
         cột rồi bỏ: `message` của `FailedScheduling` dài vài trăm ký tự nên ở nửa cột
         nó bị cắt đúng đoạn nói lý do. Gạch TRÊN cho mọi ô, không phải khung bốn
         cạnh: khối này nằm trong card của mục "Cụm", khung riêng từng ô là
         card-trong-card. -->
    <ul v-if="groups.length" class="flex flex-col gap-2">
      <li
        v-for="g in groups"
        :key="`${g.reason} ${g.object}`"
        class="flex min-w-0 flex-col gap-0.5 border-t pt-2"
      >
        <span class="flex min-w-0 flex-wrap items-baseline gap-2">
          <span
            class="size-2 shrink-0 self-center rounded-full"
            :class="EV_DOT[g.rate] ?? 'bg-faint'"
          />
          <b class="text-sm font-semibold text-foreground">{{ g.reason }}</b>
          <!-- mono-ok: `pod/api-7d9c` là thứ dán vào kubectl -->
          <code
            class="max-w-full truncate font-mono text-xs text-muted-foreground"
            :title="g.object"
          >
            {{ g.object }}
          </code>
          <span v-if="g.count > 1" class="text-xs text-warning tabular-nums">{{ g.count }}×</span>
          <span v-if="g.lastSeen" class="text-xs text-faint">{{ g.lastSeen }}</span>
        </span>
        <!-- Thông điệp event dài (vài trăm ký tự với `FailedScheduling`), nên nó được
             cuộn theo hai dòng rồi cắt — cắt một dòng thì mất đúng phần nói lý do. -->
        <span v-if="g.message" class="line-clamp-2 text-xs text-muted-foreground">
          {{ g.message }}
        </span>
      </li>
    </ul>
    <span v-if="more > 0" class="text-xs text-faint">
      {{ t('infra.kube.report.eventsMore', { n: more }) }}
    </span>
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

const EV_DOT: Record<string, string> = {
  warn: 'bg-warning',
  bad: 'bg-destructive',
}
</script>
