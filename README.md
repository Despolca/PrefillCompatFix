# Sửa lỗi tương thích Prefill (PrefillCompatFix)

Khắc phục lỗi `error 400: Requests ending with a model turn are not supported.` trong SillyTavern do model không hỗ trợ prefill, giúp gửi request bình thường.

Hỗ trợ cả request gốc của ST lẫn request từ plugin bên thứ ba (không đảm bảo bao phủ 100% plugin bên thứ ba).

## Cơ chế hoạt động

Tự động kiểm tra nội dung trước khi gửi request. Nếu **model đang dùng nằm trong danh sách áp dụng** và **role của tin nhắn cuối cùng không phải `user`**, plugin sẽ âm thầm nối thêm một tin nhắn user vào cuối request (mặc định là zero-width space, có thể tùy chỉnh trong phần cài đặt).

Plugin chỉ xử lý các request nằm trong danh sách và thỏa mãn điều kiện trên; mọi request còn lại đều giữ nguyên, không chỉnh sửa. Nếu quá trình khắc phục không thành công, request vẫn sẽ tiếp tục được gửi đi như ban đầu, plugin không làm gián đoạn luồng gửi.

> **Lưu ý:** `Error 400` (Bad Request) có thể xuất phát từ nhiều nguyên nhân (như vượt quá giới hạn context, sai tham số API, tin nhắn rỗng, v.v.). Plugin này **chỉ xử lý lỗi 400 gây ra bởi nguyên nhân cụ thể là "role ở cuối request không phải user (prefill)"**, không bao gồm các loại lỗi 400 khác. Nếu vẫn gặp lỗi sau khi bật plugin, vui lòng kiểm tra thêm thông tin trong Console để rà soát role cuối cùng hoặc các thiết lập tham số khác.

## Cài đặt và sử dụng

Sao chép đường dẫn bên dưới, dán vào mục "Extensions" - "Install Extension" (Tiện ích mở rộng - Cài đặt tiện ích mở rộng) trong ST để cài đặt, sau đó tải lại trang là xong:

`https://github.com/Despolca/PrefillCompatFix`

### Cài đặt plugin

Mở bảng **API Connections** (biểu tượng phích cắm) trong ST, kéo xuống dưới cùng để tìm "Sửa lỗi tương thích Prefill" (nằm bên phải mục "Xem API key bị ẩn" / "Show Hidden API Keys", trên thiết bị di động có thể nằm ở dòng dưới), nhấn vào để mở bảng cài đặt.

- **Tùy chỉnh danh sách model áp dụng**: Có thể tự thêm hoặc xóa model, mỗi dòng điền một model (cần khớp với model ID thực tế). Có hiệu lực ngay sau khi lưu mà không cần tải lại trang.
- **Cơ chế đồng bộ danh sách**: Khi plugin cập nhật danh sách model tích hợp sẵn, danh sách sẽ tự động đồng bộ và hiển thị thông báo trên trang; những model bạn đã xóa thủ công sẽ vẫn giữ trạng thái tắt và không tự động khôi phục.
- **Tùy chỉnh nội dung bổ sung**: Mặc định sử dụng zero-width space. Nếu gặp trường hợp bị plugin khác lọc mất hoặc có giới hạn đặc biệt từ phía upstream, bạn có thể tích chọn và tự tùy chỉnh nội dung tin nhắn nối thêm.

### Dọn dẹp dữ liệu và Debug

- **Dọn dẹp dữ liệu**: Cài đặt của plugin được lưu trong `extensionSettings.PrefillCompatFix`. Từ SillyTavern 1.18.0 trở lên, bạn có thể dùng trực tiếp tùy chọn "Clean extension data" (Dọn dẹp dữ liệu extension) ngay trong giao diện quản lý extension, hoặc tích chọn "Also clean extension data" (Đồng thời dọn dẹp dữ liệu extension) khi gỡ cài đặt plugin.
- **Chế độ Debug**: Chỉnh giá trị `DEBUG_LOGS` ở đầu file `index.js` trong thư mục plugin thành `true` để bật chế độ debug; Console của trình duyệt sẽ xuất ra thông tin chi tiết về quá trình chặn và xử lý request.

## Danh sách model tích hợp sẵn

### Google Gemini

- `gemini-3.5-flash-lite`
- `gemini-3.6-flash`
- `gemini-3.7-flash`
- `gemini-3.8-flash`
- `gemini-4-argon`
- `gemini-4-carbon`
- `gemini-4-hydrogen`

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
- `claude-fable-5-2`

## Nhật ký cập nhật

### [v1.3.0] - 2026-11-17

- Thêm cài đặt "Tùy chỉnh nội dung tin nhắn bổ sung"; đổi nội dung bổ sung mặc định từ dấu cách thông thường sang zero-width space, giúp giảm khả năng bị các plugin khác xóa nhầm.
- Thêm `gemini-4-carbon`, `gemini-4-hydrogen`, `claude-fable-5-2` vào danh sách model tích hợp sẵn; các lần cập nhật danh sách về sau sẽ hiển thị popup thông báo các mục thay đổi.
- Hỗ trợ tính năng dọn dẹp dữ liệu extension của ST 1.18.0.
- Tối ưu logic chặn request ở tầng thấp và phân tích body, nâng cao độ tương thích và ổn định với nhiều định dạng dữ liệu khác nhau.

### [v1.2.0] - 2026-10-18

- Thêm mục cài đặt danh sách model, cho phép tùy chỉnh trực tiếp các model áp dụng ngay trong ST.

### [v1.1.0] - 2026-10-14

- Thêm `gemini-4-argon` vào danh sách model tích hợp sẵn.

### [v1.0.0] - 2026-10-11

- Phát hành lần đầu.
- Hỗ trợ tự động nối thêm tin nhắn user chứa dấu cách vào cuối các request thỏa mãn điều kiện, khắc phục vấn đề tương thích phần cuối request trên một số model.
- Hỗ trợ các request trên trang chính và trong iframe cùng nguồn (same-origin), bao gồm các request gửi qua `fetch`, XHR và jQuery `$.ajax`, v.v.
- Tích hợp sẵn danh sách các model dòng Gemini và Claude.