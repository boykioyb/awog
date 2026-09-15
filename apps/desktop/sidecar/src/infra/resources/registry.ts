// Registry của Explorer: tra cứu view theo id, và xuất METADATA cho UI.
//
// VÌ SAO CÓ BƯỚC "XUẤT METADATA" RIÊNG. Khuôn `InfraViewSpec` chứa HÀM (`pick`,
// `consoleUrl`) — không serialize qua IPC được, và cũng KHÔNG NÊN: renderer không
// cần biết lệnh CLI nào đứng sau một cột. `toDescriptor()` cắt đúng phần nhìn
// thấy được (nhãn i18n, bộ cột, form, hành động, có/không chi tiết) và bỏ hết
// phần thực thi. Nhờ vậy một lỗ hổng XSS ở renderer không tự biến thành khả năng
// chạy `aws` tuỳ ý — muốn chạy phải gọi RPC và RPC vẫn hỏi ma trận quyền.
//
// Bảng tra là MỘT Map dựng từ danh sách view; tra theo id không nhận id lạ, nên
// không có đường "viewId từ renderer" đi thẳng vào argv.

import { AWS_RESOURCE_VIEWS } from './aws-views.js'
import type { InfraColumn, InfraFormField, InfraViewSpec } from './spec.js'

const BY_ID = new Map<string, InfraViewSpec>(AWS_RESOURCE_VIEWS.map((v) => [v.id, v]))

export function viewById(id: string): InfraViewSpec | null {
  return BY_ID.get(id) ?? null
}

export function allViews(): readonly InfraViewSpec[] {
  return AWS_RESOURCE_VIEWS
}

export function allViewIds(): readonly string[] {
  return AWS_RESOURCE_VIEWS.map((v) => v.id)
}

/** View nào dùng được ngay (không cần tham số bắt buộc). */
export function viewNeedsParams(spec: InfraViewSpec): boolean {
  return (spec.list.required?.length ?? 0) > 0
}

// ─── Metadata cho UI ─────────────────────────────────────────────────────────

export type ViewDescriptorAction = {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  /** Tên action IAM để đối chiếu kết quả dò quyền (task 3.3); vắng = chưa khai. */
  iam: string | null
  /**
   * Ô nhập thêm của hành động (Mốc 4). Rỗng = bấm là chạy; có phần tử = UI mở
   * form với ngữ cảnh của dòng đã điền sẵn rồi mới gọi. Hình dạng trường dùng
   * CHUNG với form cấp view để chỉ có một khuôn ô nhập trong toàn màn.
   */
  fields: readonly InfraFormField[]
  /**
   * Hành động này KHÔNG chạy lệnh — nó mở view con với tham số suy từ dòng.
   * UI đọc trường này TRƯỚC khi gọi RPC: mở view là việc của renderer, còn gọi
   * CLI mới là việc của sidecar.
   */
  opensView: { viewId: string; values: Readonly<Record<string, string>> } | null
}

export type ViewDescriptorForm = {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  iam: string | null
  typeNameField: string | null
  fields: readonly InfraFormField[]
}

export type ViewDescriptor = {
  id: string
  service: string
  label: string
  about: string
  /** Cảnh báo luôn hiện khi mở view (khoá i18n); null = không có. */
  notice: string | null
  support: 'full' | 'list'
  columns: { simple: readonly InfraColumn[]; full: readonly InfraColumn[] }
  required: readonly InfraFormField[]
  hasDetail: boolean
  hasConsole: boolean
  canProbe: boolean
  actions: readonly ViewDescriptorAction[]
  forms: readonly ViewDescriptorForm[]
}

function actionShape(a: {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  iam?: string
  fields?: readonly InfraFormField[]
  opensView?: { viewId: string; values: Readonly<Record<string, string>> }
}): ViewDescriptorAction {
  return {
    id: a.id,
    label: a.label,
    consequence: a.consequence,
    danger: a.danger,
    confirm: a.confirm,
    iam: a.iam ?? null,
    fields: a.fields ?? [],
    opensView: a.opensView ?? null,
  }
}

export function toDescriptor(spec: InfraViewSpec): ViewDescriptor {
  return {
    id: spec.id,
    service: spec.service,
    label: spec.label,
    about: spec.about,
    notice: spec.notice ?? null,
    support: spec.support,
    columns: spec.columns,
    required: spec.list.required ?? [],
    hasDetail: spec.detail !== undefined,
    hasConsole: spec.consoleUrl !== undefined,
    canProbe: spec.probe !== undefined,
    actions: (spec.actions ?? []).map(actionShape),
    forms: (spec.forms ?? []).map((f) => ({
      ...actionShape(f),
      typeNameField: f.typeNameField ?? null,
      fields: f.fields,
    })),
  }
}

export function allDescriptors(): readonly ViewDescriptor[] {
  return AWS_RESOURCE_VIEWS.map(toDescriptor)
}
