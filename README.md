# Bản vá tương thích Prefill (PrefillCompatFix)

Khắc phục lỗi `error 400: Requests ending with a model turn are not supported.` trong SillyTavern do mô hình không hỗ trợ prefill, giúp yêu cầu có thể được gửi đi bình thường.

Hỗ trợ các yêu cầu gốc của ST và yêu cầu từ plugin bên thứ ba (không đảm bảo plugin bao phủ 100%).

## Nguyên lý hoạt động

Tự động kiểm tra nội dung yêu cầu trước khi gửi. Nếu **mô hình được sử dụng nằm trong danh sách**, và **tin nhắn cuối cùng không phải là `user`**, thì sẽ âm thầm thêm một tin nhắn người dùng chỉ chứa một dấu cách vào cuối yêu cầu.

Chỉ xử lý các yêu cầu có mô hình nằm trong danh sách và đáp ứng điều kiện, các yêu cầu còn lại sẽ không bị sửa đổi.

Khi khắc phục không thành công, yêu cầu gốc vẫn sẽ tiếp tục được gửi đi, plugin sẽ không chặn yêu cầu. Nếu gặp phải số ít trường hợp vẫn trả về lỗi sau khi sử dụng, vui lòng kiểm tra thủ công role ở cuối.

## Cài đặt và sử dụng

Sử dụng liên kết bên dưới để cài đặt và tải lại trang, đảm bảo plugin này đang ở trạng thái kích hoạt trong quản lý tiện ích mở rộng của ST.

`https://github.com/Despolca/PrefillCompatFix`

Plugin không có bảng cấu hình trực quan, không cần cấu hình thêm. Nếu cần bật/tắt, vui lòng thao tác trong quản lý tiện ích mở rộng của ST.

### Chế độ Debug

Đặt `DEBUG_LOGS` ở đầu file `index.js` thành `true` để bật chế độ debug. Console sẽ xuất ra thông tin debug chi tiết hơn.

## Danh sách mô hình tích hợp sẵn

### Google Gemini

- `gemini-3.5-flash-lite`
- `gemini-3.6-flash`
- `gemini-3.7-flash`
- `gemini-3.8-flash`

### Anthropic Claude

- `claude-opus-4-6`
- `claude-opus-4-7`
- `claude-opus-4-8`
- `claude-opus-5`
- `claude-opus-5-5`
- `claude-sonnet-4-6`
- `claude-sonnet-5`
- `claude-sonnet-5-5`
- `claude-haiku-5-5`
- `claude-fable-5`
- `claude-fable-5-1`

### Chỉnh sửa danh sách mô hình

Nếu phát hiện các mô hình khác mà nhà phát hành tuyên bố rõ ràng là không hỗ trợ prefill, có thể báo cho tôi để cập nhật, hoặc tự thêm vào.

Vào thư mục `SillyTavern/public/scripts/extensions/third-party/PrefillCompatFix/index.js`, tìm `MODEL_PATTERNS` ở trên cùng và thêm mô hình tương ứng vào danh sách.

Khi thêm vui lòng chú ý định dạng code, tên mô hình vui lòng điền theo thực tế, chú ý cách viết số và dấu gạch nối.

## Nhật ký cập nhật

### [v1.0.0] - 2026-10-11

- Phát hành lần đầu.
- Hỗ trợ tự động thêm tin nhắn người dùng bằng dấu cách vào cuối các yêu cầu đủ điều kiện, khắc phục vấn đề tương thích ở cuối yêu cầu của một số mô hình.
- Hỗ trợ các yêu cầu trong trang chính và iframe cùng nguồn, bao gồm các yêu cầu được gửi thông qua `fetch`, XHR và jQuery `$.ajax`.
- Tích hợp sẵn danh sách các mô hình dòng Gemini và Claude.