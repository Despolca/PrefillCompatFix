# Bản Vá Tương Thích Prefill (PrefillCompatFix)

Khắc phục lỗi `error 400: Requests ending with a model turn are not supported.` trong SillyTavern phát sinh do model không hỗ trợ prefill, giúp request có thể gửi đi bình thường.

Hỗ trợ cả request gốc của ST lẫn request từ plugin bên thứ ba (không đảm bảo plugin được hỗ trợ 100%).

## Nguyên lý hoạt động

Tự động kiểm tra nội dung request trước khi gửi. Nếu **model đang sử dụng nằm trong danh sách** và **tin nhắn cuối cùng không phải là `user`**, extension sẽ âm thầm chèn thêm một tin nhắn user chỉ chứa duy nhất một dấu cách vào cuối request.

Chỉ xử lý các request thỏa điều kiện và có model nằm trong danh sách, các request còn lại sẽ được giữ nguyên không chỉnh sửa.

Nếu sửa lỗi không thành công, request gốc vẫn sẽ tiếp tục được gửi đi, plugin tuyệt đối không chặn request. Trường hợp hiếm hoi vẫn gặp lỗi sau khi áp dụng, vui lòng kiểm tra lại role ở cuối theo cách thủ công.

## Cài đặt và sử dụng

Cài đặt bằng liên kết bên dưới rồi làm mới lại trang ST:

`https://github.com/Despolca/PrefillCompatFix`

### Tùy chỉnh danh sách model áp dụng

Mở **Bảng điều khiển kết nối API** (biểu tượng phích cắm) của ST, kéo xuống dưới cùng tìm "Vá lỗi tương thích Prefill" (nằm ở bên phải mục "Xem API key bị ẩn", trên giao diện mobile có thể nằm ở dòng tiếp theo), click vào để mở bảng cài đặt.

- Có thể tự do thêm hoặc xoá model. Sau khi lưu sẽ có hiệu lực ngay lập tức mà không cần làm mới trang.
- Mỗi dòng điền một tên model, lưu ý tên phải khớp chính xác với mã model thực tế.
- Khi plugin cập nhật danh sách model tích hợp sẵn, danh sách sẽ được đồng bộ cập nhật; các model mà người dùng đã chủ động xoá thủ công sẽ không tự động khôi phục lại.

### Chế độ Debug

Đặt biến `DEBUG_LOGS` ở đầu file `index.js` thành `true` để bật chế độ debug. Console sẽ xuất ra thông tin debug chi tiết hơn.

## Danh sách model tích hợp sẵn

### Google Gemini

- `gemini-3.5-flash-lite`
- `gemini-3.6-flash`
- `gemini-3.7-flash`
- `gemini-3.8-flash`
- `gemini-4-argon`

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

## Nhật ký cập nhật

### [v1.2.0] - 2026-10-18

- Thêm lối tắt cài đặt danh sách model, có thể tùy chỉnh trực tiếp các model áp dụng ngay trong ST.

### [v1.1.0] - 2026-10-14

- Bổ sung `gemini-4-argon` vào danh sách model tích hợp sẵn.

### [v1.0.0] - 2026-10-11

- Phát hành lần đầu.
- Hỗ trợ tự động thêm tin nhắn user chứa dấu cách vào cuối các request đủ điều kiện, khắc phục vấn đề tương thích ở lượt kết thúc request của một số model.
- Hỗ trợ các request trên trang chính lẫn trong iframe cùng nguồn (same-origin iframe), bao gồm cả các request được gửi qua `fetch`, XHR và jQuery `$.ajax`.
- Tích hợp sẵn danh sách các dòng model Gemini và Claude.