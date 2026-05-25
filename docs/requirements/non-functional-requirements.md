# Non-Functional Requirements

## NFR-1. Local-first

- Ứng dụng phải chạy hoàn toàn trên máy người dùng.
- Không cần backend service hay database cho MVP.
- Mọi dữ liệu người dùng lưu trên local filesystem.

## NFR-2. Data Portability

- Workspace là một thư mục thuần gồm các file JSON, YAML và Markdown.
- Người dùng có thể backup, chia sẻ hoặc di chuyển workspace bằng cách copy thư mục.
- Định dạng file thân thiện với Git xuyên suốt.

## NFR-3. Version Control

- Mọi thay đổi artifact được Git tự động theo dõi.
- Người dùng có thể xem diff, history và revert.

## NFR-4. Privacy

- Không gửi telemetry khi chưa có sự đồng ý rõ ràng của người dùng.
- API key cho model bên ngoài lưu cục bộ, không bao giờ truyền tới hạ tầng của AWOG.

## NFR-5. Hiệu năng

- UI phải phản hồi nhanh trong khi agent chạy các task dài.
- Việc thực thi agent phải async, không block API route.

## NFR-6. Extensibility

- Skill, agent, workflow và context provider phải mở rộng được bởi người dùng.
- Việc thêm model backend mới không nên đụng đến core.

## NFR-7. Observability

- Mọi hành động của agent đều có thể trace.
- Người dùng có thể tái dựng lại agent đã làm gì và vì sao.

## NFR-8. Usability

- Trình soạn thảo trực quan (workflow, agent, skill builder) được ưu tiên hơn file cấu hình.
- Người dùng không có nền tảng lập trình vẫn có thể lắp ráp workflow cơ bản.

## NFR-9. Đa nền tảng

- Ứng dụng phải chạy được trên macOS, Windows và Linux.
- Xử lý filesystem và path phải độc lập với hệ điều hành.
