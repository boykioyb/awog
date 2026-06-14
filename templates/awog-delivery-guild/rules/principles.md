---
name: Engineering principles
description: Core engineering principles (KISS, YAGNI, DRY, SRP, SoC, fail-fast).
enabled: true
---

# Nguyên tắc

Khi xung đột: **KISS + YAGNI thắng DRY** (chấp nhận trùng tạm thay vì abstract sớm).

- **KISS** — đơn giản nhất có thể. Đo phức tạp bằng số khái niệm phải giữ trong đầu.
- **YAGNI** — không viết cho nhu cầu chưa tồn tại. Bỏ tham số/config "biết đâu cần".
- **DRY** — mỗi *tri thức* một nguồn. Nhưng đừng gộp **trùng lặp ngẫu nhiên** (giống shape ≠ giống ý nghĩa).
- **Rule of Three** — 1 viết, 2 copy, 3 mới abstract.
- **SRP** — một module/component/function = một lý do thay đổi. "Và" trong mô tả = đa nhiệm.
- **SoC** — UI không biết FS, sidecar không biết DOM, adapter không biết workflow.
- **OCP** — mở rộng bằng thêm adapter mới, không sửa code dùng adapter (`ModelAdapter`, `ContextProvider`, `Skill`).
- **Composition > Inheritance** — composable + function thuần, không class hierarchy.
- **Fail Fast** — validate biên, throw ngay khi state bất khả thi. Không default "an toàn" che bug.
- **Least Astonishment** — `getX` không mutate, `useXxx` không throw đồng bộ, side effect có động từ rõ.
- **Law of Demeter** — không truy cập chuỗi sâu `a.b.c.d.e`. Expose method/computed ở trung gian.
- **Encapsulation** — Pinia: state readonly + action; composable: interface tối thiểu.
- **Boy Scout Rule** — sửa nhỏ chỗ đi qua (typo, tên dở, dead code).
- **Tin code nội bộ, validate ở biên** — chỉ validate input user/file/API ngoài/IPC.
- **Sửa root cause** — không `--no-verify`, không tắt rule lint, không try/catch nuốt lỗi.

Chi tiết + ví dụ: [docs/coding/general.md#nguyên-tắc](../../docs/coding/general.md#nguyên-tắc).
