import { ref } from 'vue'

// Trạng thái mở THỦ CÔNG của popover điều phối phiên con — menu ⋯ của một phiên
// gọi `open(id)` và SessionSpawnHost (mount ở AppGlobalHosts) hiện popover.
// Đường do model đề xuất (tool `create_session` park chờ duyệt) KHÔNG đi qua
// đây: nó hiện qua `store.pendingSpawn`. Host đọc cả hai nguồn — popover mở
// thủ công chỉ hiện khi không có request nào đang chờ.
//
// `parentId` là numeric client id của phiên CHA (host tự resolve Session từ
// store). null = đóng.
const parentId = ref<number | null>(null)

export function useSessionSpawnDialog() {
  function open(id: number): void {
    parentId.value = id
  }
  function close(): void {
    parentId.value = null
  }
  return { parentId, open, close }
}
