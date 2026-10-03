// Ghi attachment của board item vào {project}/.awog/board-att/<itemId>/ và
// trả danh sách dòng tham chiếu ("- name: /abs/path") để append vào tin
// giao/comment — inbox + comment chỉ mang text nên file đi bằng đường dẫn.
// Attachment mang `path` (kéo/chọn từ đĩa) giữ nguyên tham chiếu gốc; ảnh dán
// (dataUrl) và text-attachment được ghi file rồi trỏ vào bản vừa ghi. Thiếu
// project path / lỗi ghi → bỏ file đó, KHÔNG chặn giao.
import { useFsApi } from '~/composables/useFsApi'
import { useProjectsStore } from '~/stores/projects'
import type { SessionAttachment } from '~/composables/useSessionsData'

export function useBoardAtts() {
  const fs = useFsApi()
  const projectsStore = useProjectsStore()

  async function materialize(
    atts: SessionAttachment[],
    projectId: string,
    itemId: string,
  ): Promise<string[]> {
    if (!atts.length) return []
    const root = projectsStore.projectById(projectId)?.path ?? ''
    const dir = `.awog/board-att/${itemId}`
    const lines: string[] = []
    for (const [i, a] of atts.entries()) {
      if (a.path) {
        lines.push(`- ${a.name}: ${a.path}${a.folder ? ' (folder)' : ''}`)
        continue
      }
      if (!root) continue
      const safe = a.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || `att-${i + 1}`
      const rel = `${dir}/${i + 1}-${safe}`
      try {
        await fs.createDir(root, dir)
        if (a.dataUrl) {
          // "data:<mime>;base64,xxx" — thiếu dấu ',' thì coi toàn bộ là base64
          // thay vì ghi file rỗng.
          const comma = a.dataUrl.indexOf(',')
          await fs.writeFileBase64(root, rel, comma >= 0 ? a.dataUrl.slice(comma + 1) : a.dataUrl)
        } else if (a.text != null) {
          await fs.writeFile(root, rel, a.text)
        } else continue
        lines.push(`- ${a.name}: ${root}/${rel}`)
      } catch (err) {
        console.warn('[board] attachment materialize failed', a.name, err)
      }
    }
    return lines
  }

  return { materialize }
}
