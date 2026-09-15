<template>
  <!-- Route cũ, giữ lại để deep-link và bookmark không chết.
       Màn Kế hoạch đã chuyển vào `/infra` (nhóm "Thay đổi") ngày 2026-09-15 — xem
       `components/infra/playbook/InfraPlaybooks.vue`. -->
  <section class="page on" data-page="playbooks" />
</template>

<script setup lang="ts">
// XIN TAB TRƯỚC RỒI MỚI ĐIỀU HƯỚNG. `/infra` nằm dưới `<NuxtPage keepalive />` nên lần
// vào thứ hai nó KHÔNG remount; một cú `navigateTo('/infra')` trần sẽ trả người dùng về
// tab họ đang mở dở chứ không phải Kế hoạch. Cầu nối mọc-module sống ngoài vòng đời
// component nên trang kia nhận được yêu cầu ở cả hai ca.
//
// `replace: true`: route này không phải một điểm dừng: bấm Back từ /infra phải về chỗ
// người dùng đến từ đó, không phải quay lại một trang rỗng rồi bị đẩy sang /infra lần nữa.
import { onMounted } from 'vue'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'

const { request } = useInfraTabOpen()

onMounted(() => {
  request('playbooks')
  void navigateTo('/infra', { replace: true })
})
</script>
