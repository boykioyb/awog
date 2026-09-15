// Phát hiện lãng phí → playbook dọn dẹp (Mốc 7, việc 7.3).
//
// LUẬT CHIA ĐÔI, VÀ NÓ LÀ PHẦN QUAN TRỌNG NHẤT CỦA FILE NÀY.
//
// Định dạng playbook đòi mỗi bước `do` có một bước `rollback` ghép cặp, và AWOG cưỡng
// chế điều đó ở `submit`. Nhưng runner KHÔNG chuyền output của bước này sang bước kia
// (biến resolve TRƯỚC khi chạy — xem `schema.ts#interpolateArgs`), nên một bước quay lui
// không thể trỏ tới thứ vừa được tạo ra giữa chừng. Hệ quả: với phần lớn thao tác xoá
// trên AWS, KHÔNG CÓ bước quay lui nào viết ra được mà không nói dối.
//
// Vì vậy các phát hiện được chia làm hai nhóm:
//
//   · HOÀN TÁC ĐƯỢC ⇒ sinh đủ `check → do → verify → rollback`:
//       - `ec2-idle`          dừng máy   ↔ bật lại      (hoàn tác THẬT)
//       - `logs-no-retention` đặt hạn lưu ↔ bỏ hạn lưu  (hoàn tác THẬT, và không xoá gì)
//       - `eip-idle`          trả IP     ↔ xin IP mới   (hoàn tác MỘT PHẦN — ghi ở `note`)
//
//   · KHÔNG HOÀN TÁC ĐƯỢC ⇒ CHỈ sinh bước `check`, không sinh `do`:
//       - `ebs-unattached` · `snapshot-stale` · `lb-no-targets` · `nat-idle`
//     Xoá một volume là mất dữ liệu; xoá một ALB là mất DNS name của nó; xoá một NAT là
//     đổi IP đi ra. Bước quay lui dựng lại một cái VỎ cùng tên rồi ghi chú "nội dung thì
//     không lấy lại được" là thứ mà playbook `teardown` dựng sẵn làm được — vì ở đó
//     NGƯỜI DÙNG tự viết và tự biết mình đang bỏ gì. Sinh TỰ ĐỘNG một lệnh phá huỷ kèm
//     một bước quay lui giả là chuyện khác hẳn: nó mời người ta bấm duyệt một thứ trông
//     như có đường lùi.
//
// Nhóm thứ hai vẫn có mặt trong kế hoạch, dưới dạng `check` — kế hoạch vì thế vẫn là bản
// ghi ĐẦY ĐỦ của lượt dò, và người đọc thấy cả thứ AWOG cố ý không tự xoá.
import type { WasteFinding } from './waste.js'

/** Hạn lưu đặt cho log group chưa có hạn. 30 ngày là mức đủ cho gỡ lỗi thường ngày. */
export const CLEANUP_RETENTION_DAYS = 30

/** Khuôn bước, khớp `PlaybookStep` của `infra/playbook/schema.ts`. */
export type CleanupStep = {
  id: string
  title: string
  verb: 'check' | 'do' | 'verify' | 'rollback'
  tool: 'aws'
  args: string[]
  note: string
}

export type CleanupDraft = {
  name: string
  description: string
  kind: 'instruction'
  variables: never[]
  steps: CleanupStep[]
}

/** Phát hiện mà AWOG tự sinh được lệnh xoá/đổi KÈM đường lùi thật sự viết ra được. */
export const REVERSIBLE_CHECKS = ['ec2-idle', 'logs-no-retention', 'eip-idle'] as const

export function isReversible(check: WasteFinding['check']): boolean {
  return (REVERSIBLE_CHECKS as readonly string[]).includes(check)
}

/**
 * Id bước phải khớp `STEP_ID_RE` (`[A-Za-z0-9._-]{1,64}`) — mà tên log group có `/` và
 * ARN có `:`. Nên id là số thứ tự, còn danh tính tài nguyên nằm ở `title`/`note`.
 */
function ids(n: number): string {
  return `s${String(n)}`
}

type Group = { check: CleanupStep; write?: CleanupStep; verify?: CleanupStep; undo?: CleanupStep }

function groupFor(f: WasteFinding, at: (n: number) => string): Group {
  switch (f.check) {
    case 'ec2-idle':
      return {
        check: {
          id: at(0),
          title: `Máy ${f.label} còn đang chạy không`,
          verb: 'check',
          tool: 'aws',
          args: ['ec2', 'describe-instances', '--instance-ids', f.resourceId],
          note: 'Đọc trước khi ghi: máy có thể đã được dùng lại từ lúc dò tới lúc duyệt.',
        },
        write: {
          id: at(1),
          title: `Dừng máy ${f.label}`,
          verb: 'do',
          tool: 'aws',
          args: ['ec2', 'stop-instances', '--instance-ids', f.resourceId],
          note: 'Dừng, KHÔNG terminate: đĩa gốc còn nguyên và bật lại được nguyên trạng.',
        },
        verify: {
          id: at(2),
          title: `Máy ${f.label} đã dừng`,
          verb: 'verify',
          tool: 'aws',
          args: ['ec2', 'describe-instances', '--instance-ids', f.resourceId],
          note: 'Trạng thái `stopping` hoặc `stopped` là kết quả mong đợi.',
        },
        undo: {
          id: at(3),
          title: `Bật lại máy ${f.label}`,
          verb: 'rollback',
          tool: 'aws',
          args: ['ec2', 'start-instances', '--instance-ids', f.resourceId],
          note: 'Hoàn tác THẬT. Địa chỉ IP công cộng động sẽ khác nếu máy không gắn Elastic IP.',
        },
      }

    case 'logs-no-retention':
      return {
        check: {
          id: at(0),
          title: `Log group ${f.label} còn để lưu vĩnh viễn không`,
          verb: 'check',
          tool: 'aws',
          args: ['logs', 'describe-log-groups', '--log-group-name-prefix', f.resourceId],
          note: 'Thiếu `retentionInDays` trong kết quả nghĩa là vẫn đang lưu vĩnh viễn.',
        },
        write: {
          id: at(1),
          title: `Đặt hạn lưu ${String(CLEANUP_RETENTION_DAYS)} ngày cho ${f.label}`,
          verb: 'do',
          tool: 'aws',
          args: [
            'logs',
            'put-retention-policy',
            '--log-group-name',
            f.resourceId,
            '--retention-in-days',
            String(CLEANUP_RETENTION_DAYS),
          ],
          note: 'Log CŨ HƠN hạn sẽ bị AWS xoá dần — đó chính là khoản tiền tiết kiệm, và nó không lấy lại được.',
        },
        verify: {
          id: at(2),
          title: `Hạn lưu của ${f.label} đã được đặt`,
          verb: 'verify',
          tool: 'aws',
          args: ['logs', 'describe-log-groups', '--log-group-name-prefix', f.resourceId],
          note: 'Kết quả phải có `retentionInDays`.',
        },
        undo: {
          id: at(3),
          title: `Bỏ hạn lưu của ${f.label}`,
          verb: 'rollback',
          tool: 'aws',
          args: ['logs', 'delete-retention-policy', '--log-group-name', f.resourceId],
          note: 'Trả về "lưu vĩnh viễn". Log đã bị xoá trong lúc hạn có hiệu lực thì không quay lại.',
        },
      }

    case 'eip-idle':
      return {
        check: {
          id: at(0),
          title: `Elastic IP ${f.label} còn rỗi không`,
          verb: 'check',
          tool: 'aws',
          args: ['ec2', 'describe-addresses', '--allocation-ids', f.resourceId],
          note: 'Có `AssociationId` nghĩa là IP đã được gắn vào đâu đó — KHÔNG chạy bước sau.',
        },
        write: {
          id: at(1),
          title: `Trả Elastic IP ${f.label}`,
          verb: 'do',
          tool: 'aws',
          args: ['ec2', 'release-address', '--allocation-id', f.resourceId],
          note: 'PHÁ HUỶ ĐỊA CHỈ: IP này về lại pool của AWS và người khác lấy được ngay.',
        },
        verify: {
          id: at(2),
          title: `Elastic IP ${f.label} đã được trả`,
          verb: 'verify',
          tool: 'aws',
          args: ['ec2', 'describe-addresses', '--allocation-ids', f.resourceId],
          note: 'Lệnh trả lỗi InvalidAllocationID.NotFound chính là dấu hiệu đã trả xong.',
        },
        undo: {
          id: at(3),
          title: 'Xin một Elastic IP mới',
          verb: 'rollback',
          tool: 'aws',
          args: ['ec2', 'allocate-address'],
          note: 'HOÀN TÁC MỘT PHẦN: bạn nhận lại MỘT địa chỉ, không phải ĐỊA CHỈ CŨ. Mọi bản ghi DNS, allowlist hay tường lửa trỏ vào IP cũ vẫn hỏng.',
        },
      }

    // Bốn phát hiện còn lại: CHỈ ghi nhận, không sinh lệnh ghi. Xem đầu file.
    case 'ebs-unattached':
      return {
        check: {
          id: at(0),
          title: `Volume rỗi ${f.label} — cần người quyết`,
          verb: 'check',
          tool: 'aws',
          args: ['ec2', 'describe-volumes', '--volume-ids', f.resourceId],
          note: 'AWOG KHÔNG tự sinh lệnh xoá volume: dữ liệu trên đó không có đường lùi. Muốn xoá, hãy `create-snapshot` trước rồi tự thêm bước `delete-volume` kèm bước quay lui `create-volume --snapshot-id <id vừa tạo>`.',
        },
      }

    case 'snapshot-stale':
      return {
        check: {
          id: at(0),
          title: `Snapshot cũ ${f.label} — cần người quyết`,
          verb: 'check',
          tool: 'aws',
          args: ['ec2', 'describe-snapshots', '--snapshot-ids', f.resourceId],
          note: 'AWOG KHÔNG tự sinh lệnh xoá snapshot: đã xoá thì không dựng lại được. Kiểm xem còn AMI nào dựa trên nó không trước khi tự thêm bước xoá.',
        },
      }

    case 'lb-no-targets':
      return {
        check: {
          id: at(0),
          title: `Load balancer không có đích: ${f.label} — cần người quyết`,
          verb: 'check',
          tool: 'aws',
          args: ['elbv2', 'describe-load-balancers', '--load-balancer-arns', f.resourceId],
          note: 'AWOG KHÔNG tự sinh lệnh xoá: xoá một LB là mất luôn DNS name của nó, và mọi bản ghi CNAME trỏ vào đó sẽ hỏng. Dựng lại được một LB mới, nhưng tên khác.',
        },
      }

    case 'nat-idle':
      return {
        check: {
          id: at(0),
          title: `NAT gateway không có lưu lượng: ${f.label} — cần người quyết`,
          verb: 'check',
          tool: 'aws',
          args: ['ec2', 'describe-nat-gateways', '--nat-gateway-ids', f.resourceId],
          note: 'AWOG KHÔNG tự sinh lệnh xoá: NAT mới có IP đi ra KHÁC, nên mọi allowlist phía đối tác dựa trên IP cũ sẽ chặn bạn. Kiểm route table trước.',
        },
      }
  }
}

/**
 * Dựng bản nháp playbook từ các phát hiện đã chọn.
 *
 * THỨ TỰ LÀ HỢP ĐỒNG: bước `do` thứ N ghép với bước `rollback` thứ N. Ta phát ra từng
 * nhóm theo cụm `check → do → verify → rollback` nên số lượng hai bên luôn bằng nhau và
 * cặp luôn khớp — miễn là không ai chèn thêm một `do` lẻ vào giữa.
 */
export function buildCleanupDraft(
  findings: readonly WasteFinding[],
  opts: { name: string; region: string },
): CleanupDraft {
  const steps: CleanupStep[] = []
  let n = 0
  const at = () => (offset: number) => ids(n + offset + 1)

  for (const f of findings) {
    const g = groupFor(f, at())
    steps.push(g.check)
    n += 1
    for (const s of [g.write, g.verify, g.undo]) {
      if (s) {
        steps.push(s)
        n += 1
      }
    }
  }

  const reversible = findings.filter((f) => isReversible(f.check)).length
  const manual = findings.length - reversible

  return {
    name: opts.name,
    description:
      `Dọn dẹp ${String(findings.length)} khoản lãng phí tìm thấy ở vùng ${opts.region || 'đang ghim'}. ` +
      `${String(reversible)} khoản có lệnh sẵn kèm đường lùi; ${String(manual)} khoản chỉ được GHI NHẬN vì thao tác xoá của chúng không hoàn tác được — xem ghi chú từng bước.`,
    kind: 'instruction',
    variables: [],
    steps,
  }
}
