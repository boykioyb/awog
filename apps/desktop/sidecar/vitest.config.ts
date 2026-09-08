// Chỉ nhặt test trong thư mục `__tests__/`.
//
// Mặc định của vitest là `**/*.test.ts`, mà quy ước đặt tên RPC của sidecar là
// `<domain>.<action>.ts` — nên `methods/source.test.ts` (RPC "test connection",
// ADR 0060 D-6), `methods/accounts.test.ts` và `methods/ssh.test.ts` bị nhặt vào
// như thể chúng là test, rồi báo "No test suite found in file". Ba dòng đỏ đó
// không phải lỗi thật, nhưng chúng làm mọi lần chạy suite trông như đang hỏng —
// và một suite lúc nào cũng đỏ sẵn thì không ai đọc nữa.
//
// Mọi test thật của repo đều nằm trong `__tests__/`, nên thu hẹp `include` là
// cách sửa đúng: không phải đổi tên RPC, không phải thêm dependency.
//
// Export một object thuần thay vì `defineConfig` từ 'vitest/config': vitest chưa
// nằm trong devDependencies của sidecar (chạy qua `npx vitest@2`), nên import đó
// sẽ không resolve được.
//
// `scripts/__tests__/` là ngoại lệ có chủ đích: khoá build (`scripts/build-lock.mjs`)
// phải là JS thuần chạy được NGAY, vì `build.mjs` chạy trước khi tsc sinh ra
// `dist/` — nên nó không thể sống trong `src/` như mọi module khác. Mở rộng
// `include` rẻ hơn nhiều so với việc dựng một đường biên dịch riêng cho nó.
export default {
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/__tests__/**/*.test.mjs'],
  },
}
