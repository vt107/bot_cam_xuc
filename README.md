## Bot cảm xúc

### Giới thiệu
Bot tự động cuộn (scroll) và thả tim/like bài viết trên Facebook mobile
(`m.facebook.com`) cho **một tài khoản cá nhân duy nhất**, mô phỏng hành vi người dùng
thật (cuộn ngẫu nhiên, nghỉ ngẫu nhiên, tránh like lại bài đã like) và **chỉ like bài
viết của bạn bè** — không like bài tài trợ/đề xuất, bài của người lạ, hay bài dịch từ
tiếng nước ngoài.

Bot chỉ chạy cho 1 tài khoản mỗi lần chạy, nên chạy trên chính máy đang dùng Facebook để
hạn chế bị checkpoint.

### Tính năng
- Đăng nhập bằng cookie có sẵn, không cần nhập mật khẩu.
- Giả lập thiết bị iPhone 12 (user agent + viewport di động) và dùng
  `puppeteer-extra-plugin-stealth` để giảm dấu hiệu trình duyệt tự động.
- Cuộn feed với khoảng cách và hướng ngẫu nhiên (kể cả cuộn ngược lại).
- **Chỉ like bài viết của bạn bè** — đối chiếu tác giả từng bài với danh sách bạn bè,
  xem mục [Danh sách bạn bè](#danh-sách-bạn-bè) bên dưới. Có thể tắt để quay lại like mọi
  bài (trừ tài trợ/đề xuất).
- Mỗi đợt tác vụ tự động like 1 bài viết chưa like, không phải bài tài trợ/đề xuất,
  không phải bài đã dịch từ ngôn ngữ khác.
- Thỉnh thoảng nghỉ dài 60-120 giây rồi tải lại trang, mô phỏng người dùng nghỉ tay.
- Nếu quét không thấy bài nào của bạn bè, bot cuộn thêm rồi thử lại; chỉ khởi động lại
  toàn bộ phiên trình duyệt sau nhiều lượt quét liên tiếp không thấy gì.

Chi tiết kỹ thuật đầy đủ nằm trong [`docs/`](./docs) — xem mục
[Tài liệu](#tài-liệu) bên dưới.

### Yêu cầu hệ thống
- Node.js v18 hoặc v20.
- Một tài khoản Facebook cá nhân và cookie phiên đăng nhập còn hiệu lực của tài khoản đó.
- Khuyến nghị chạy trên máy bạn vẫn thường dùng để truy cập Facebook (xem
  [Lưu ý an toàn](#lưu-ý-an-toàn--rủi-ro)).

### Tải xuống
Clone repo về hoặc nhấn nút **"<> Code"** màu xanh trên GitHub, chọn **"Download Zip"**.

### Lấy cookie Facebook
1. Đăng nhập Facebook như bình thường trên trình duyệt (khuyến khích dùng bản
   `m.facebook.com` trên điện thoại hoặc chế độ giả lập mobile trên máy tính).
2. Mở DevTools (F12) → tab **Network** → chọn một request bất kỳ tới `facebook.com`.
3. Trong phần **Request Headers**, tìm header `Cookie` và copy toàn bộ giá trị của nó
   (chuỗi dạng `name1=value1; name2=value2; ...`).
4. Dán nguyên chuỗi đó vào file `cookie.txt` (không thêm dấu ngoặc, không xuống dòng).

Cookie là thông tin đăng nhập — xem thêm lưu ý bảo mật bên dưới.

### Thiết lập để thực thi
```bash
# 1. Tạo file cookie.txt ở thư mục gốc dự án
touch cookie.txt

# 2. Dán cookie Facebook đã lấy ở bước trên vào file cookie.txt

# 3. Cài đặt các gói phụ thuộc
npm install

# 4. Tạo friends.json — bắt buộc trước lần chạy đầu, xem mục
#    "Danh sách bạn bè" bên dưới (khuyến nghị: lưu trang HTML rồi
#    chạy `node get_friends.js --from-html <file>`)

# 5. Chạy bot
npm start
```

`npm start` chạy `node bot_cx.js` trực tiếp, tiến trình sẽ chiếm cửa sổ terminal hiện tại.
Nhấn `Ctrl+C` để dừng. Bot **không tự tạo danh sách bạn bè** — nếu bỏ qua bước 4 và chưa
có `friends.json` hợp lệ, bot sẽ báo lỗi và thoát ngay ở bước 5 thay vì chạy mà không like
được bài nào. Xem mục [Danh sách bạn bè](#danh-sách-bạn-bè) bên dưới.

### Danh sách bạn bè
Bot **chỉ like bài viết của bạn bè**, dựa vào file `friends.json` ở thư mục gốc dự án
(không commit lên git, xem `.gitignore`). Bot **không tự quét danh sách này nữa** — việc
lấy danh sách đã tách thành một lệnh riêng (`npm run friends` / `node get_friends.js`)
chạy độc lập với bot. Nếu chưa có `friends.json` hợp lệ khi chạy `npm start`, bot sẽ **in
lỗi và thoát ngay** (`process.exit(1)`) chứ không âm thầm chạy mà không like được bài nào.

Có 3 cách để tạo file này (cộng thêm cách sửa tay khi quét sai, xem bên dưới). **Quét
sống trực tiếp qua trình duyệt hiện chưa quét ổn định** — Cách 1 bên dưới (lưu trang HTML
rồi đọc offline) là cách **khuyến nghị và đã kiểm chứng hoạt động**.

**Cách 1 — lưu trang HTML rồi đọc offline bằng `--from-html` (khuyến nghị, đã kiểm chứng)**:
không cần `cookie.txt`, không mở trình duyệt tự động, không phụ thuộc việc Facebook có
cho quét sống hay không — vì bạn tự mắt thấy trang trước khi lưu.
1. Đăng nhập Facebook bình thường trên trình duyệt (khuyến khích dùng bản máy tính
   `www.facebook.com`, vào trang bạn bè của chính mình, ví dụ
   `facebook.com/<tên-bạn>/friends`; bản `m.facebook.com` cũng dùng được).
2. **Cuộn xuống tận cùng trang cho tới khi không còn tải thêm bạn bè nào nữa.** Bước này
   bắt buộc — `get_friends.js` chỉ đọc được những gì đã thật sự hiển thị trên trang lúc
   lưu, cuộn thiếu là thiếu bạn bè trong `friends.json`.
3. Lưu trang: `Ctrl+S` (chọn "Webpage, HTML only" hoặc "Complete"), hoặc F12 → chuột phải
   thẻ `<html>` → Copy → Copy outerHTML rồi dán vào file text. Đặt tên tuỳ ý, ví dụ
   `friend.txt` (đã có sẵn trong `.gitignore`, không sợ commit nhầm).
4. Chạy:
   ```bash
   node get_friends.js --from-html friend.txt
   ```

Dùng được với cả HTML lưu từ `www.facebook.com` (máy tính) lẫn `m.facebook.com` (di
động). Sau khi chạy xong, **mở `friends.json` kiểm tra số lượng so với số bạn bè thật của
mình** — trang bạn bè có thể lẫn cả mục "Những người bạn có thể biết" hoặc link điều
hướng khác, terminal sẽ nhắc lại điều này.

**Cách 2 — thử quét sống qua trình duyệt bằng `npm run friends` (thử trước, có thể không
ăn)**: lệnh này tự mở một trình duyệt (ẩn theo mặc định), đăng nhập bằng `cookie.txt`,
thử lần lượt vài địa chỉ trang bạn bè khác nhau của Facebook. Cách này **hiện chưa quét ổn
định** trên tài khoản thật — nếu ra rỗng hoặc quá ít, đừng cố gỡ, chuyển sang Cách 1 ở
trên. Các cách chạy:
```bash
node get_friends.js            # quét bình thường — npm run friends dùng lệnh này
node get_friends.js --debug    # + lưu debug_friends.html và in chi tiết chẩn đoán
node get_friends.js --show     # hiện cửa sổ trình duyệt để xem trực tiếp quá trình quét
node get_friends.js --force    # ghi đè cả khi friends.json đang có "manual": true
```

> **Quét ra rỗng hoặc quá ít bạn bè (dù ở Cách 1 hay Cách 2)?** Chạy lại với `--debug`,
> rồi gửi đoạn "CHẨN ĐOÁN" in ra terminal (tổng số link, các pathname phổ biến nhất, mẫu
> href bị loại) kèm file HTML đã dùng — không cần chụp màn hình. Nếu vẫn không được, tạo
> tay `friends.json` theo hướng dẫn "Sửa tay danh sách" bên dưới.

Cả hai cách trên đều tôn trọng `"manual": true`: nếu `friends.json` hiện có đang đánh dấu
cờ này (xem "Sửa tay danh sách" bên dưới), lệnh sẽ **từ chối ghi đè** — in ra số lượng
vừa lấy được, báo rõ là chưa lưu, và nhắc dùng `--force` nếu thật sự muốn ghi đè.

**Cách 3 — dùng file xuất từ Facebook (Tải xuống thông tin của bạn)**:
1. Vào Facebook → Cài đặt → **Tải xuống thông tin của bạn** (Download Your Information),
   chọn định dạng JSON, chỉ chọn mục **Bạn bè** (Friends) cho gọn.
2. Tải file JSON kết quả về sau khi Facebook xử lý xong.
3. Copy/đổi tên file đó thành `friends.json` ở thư mục gốc dự án (ghi đè file cũ nếu có).

Bot tự nhận ra định dạng này (có mảng `friends_v2`) và so khớp theo **tên hiển thị**
thay vì id — kém chính xác hơn Cách 1/2 (trùng tên hoặc đổi tên vẫn có thể gây sai lệch),
nhưng dùng được ngay mà không cần chạy `get_friends.js`.

**Sửa tay danh sách (`"manual": true`)**: nếu quét ra sai (lẫn người lạ, thiếu bạn bè),
mở `friends.json`, sửa lại mảng `ids`/`names` cho đúng rồi thêm dòng `"manual": true`
vào file. Cờ này giờ có **2 tác dụng cùng lúc**:
- Bot **dùng file này mãi mãi, bỏ qua kiểm tra hạn cache** — file sẽ không bao giờ tự
  coi là quá hạn khiến bot báo lỗi đòi quét lại.
- `npm run friends` chạy lại sau đó sẽ **từ chối ghi đè** danh sách bạn đã sửa tay —
  muốn quét lại đè lên thì phải chạy `node get_friends.js --force` một cách chủ động.

Nói cách khác, việc sửa tay giờ an toàn thật sự: chạy lại `npm run friends` cho vui hay
theo thói quen sẽ không vô tình xoá công sức sửa tay của bạn nữa. Xoá cờ hoặc xoá file
để quay lại quét bình thường. Ví dụ:
```json
{
  "manual": true,
  "ids": ["100012345678901", "nguyen.van.a"],
  "names": ["Nguyễn Văn A"]
}
```

**Tắt bộ lọc bạn bè**: muốn quay lại like mọi bài (trừ tài trợ/đề xuất) bất kể tác giả,
mở `bot_cx.js`, sửa trong khối `config` ở đầu file: `friendsOnly: false`.

**`verifyMode` — kiểm chứng bộ lọc trước khi tin tưởng**: mặc định `config.verifyMode =
true`, mỗi bài viết quét qua bot in ra tác giả nhận diện được và có khớp bạn bè hay
không, ví dụ:
```
  tác giả: 100012345678901 (Nguyễn Văn A) ✓ bạn bè
  tác giả: 100099998888777 (Người Lạ) ✗ bỏ qua
```
Hãy để chế độ này bật và theo dõi vài lượt quét đầu để chắc chắn bot nhận diện đúng tác
giả và so khớp đúng bạn bè, trước khi để bot chạy không giám sát lâu dài. Khi đã yên tâm,
tắt bằng cách sửa `verifyMode: false` trong `config` để log gọn hơn.

### Chạy nền với PM2
Để chạy bot ở chế độ nền, tự động ghi log kèm timestamp, dùng
[PM2](https://pm2.keymetrics.io/) với cấu hình có sẵn trong `ecosystem.config.js`:

```bash
npm install -g pm2      # nếu chưa có PM2
pm2 start ecosystem.config.js
pm2 logs bot_cx          # xem log
pm2 stop bot_cx          # dừng
pm2 restart bot_cx       # khởi động lại thủ công
```

Lưu ý: cấu hình PM2 đặt `autorestart: false` — nếu tiến trình gặp lỗi nghiêm trọng và
thoát (crash), PM2 sẽ **không** tự khởi động lại; bạn cần theo dõi `pm2 status`/`pm2
logs` để phát hiện. Chi tiết xem
[`docs/system-architecture.md`](./docs/system-architecture.md#pm2).

### Lưu ý an toàn & rủi ro
- **Nguy cơ checkpoint/khóa tài khoản**: đây là hành vi tự động hóa trên tài khoản cá
  nhân thật; dù đã cố mô phỏng hành vi người dùng (cuộn/nghỉ ngẫu nhiên), Facebook vẫn có
  thể phát hiện và hạn chế/checkpoint/khóa tài khoản. Chạy càng lâu, nguy cơ càng tăng.
- **Điều khoản sử dụng của Facebook**: tự động hóa tương tác tài khoản theo cách này
  nhiều khả năng vi phạm Điều khoản dịch vụ của Facebook. Người vận hành bot tự chịu
  trách nhiệm về quyết định sử dụng.
- **Không chia sẻ `cookie.txt`**: cookie tương đương mật khẩu, cho phép truy cập toàn
  quyền vào tài khoản. File này đã được thêm vào `.gitignore` — không commit, không
  đăng công khai, không gửi cho người khác.
- **Cookie hết hạn**: bot đọc cookie một lần khi khởi động và không có cơ chế tự làm mới
  — khi cookie hết hạn, cần lấy cookie mới và khởi động lại bot thủ công. Xem chi tiết ở
  [`docs/project-overview-pdr.md`](./docs/project-overview-pdr.md#constraints--risks).
- **Chỉ hỗ trợ 1 tài khoản/lần chạy**: muốn chạy nhiều tài khoản, cần chạy nhiều tiến
  trình độc lập với cookie khác nhau.

### Tài liệu
Tài liệu kỹ thuật đầy đủ nằm trong thư mục [`docs/`](./docs), là nguồn tham khảo chính
thức (README này chỉ là điểm khởi đầu, không lặp lại nội dung chi tiết):

| Tài liệu | Nội dung |
|---|---|
| [`docs/project-overview-pdr.md`](./docs/project-overview-pdr.md) | Mục tiêu dự án, đối tượng sử dụng, yêu cầu chức năng/phi chức năng, rủi ro/ràng buộc, roadmap các phần còn thiếu. |
| [`docs/system-architecture.md`](./docs/system-architecture.md) | Kiến trúc runtime, vòng đời tiến trình, thiết kế hàng đợi tác vụ (producer/consumer), luồng dữ liệu của quy trình like, vai trò của PM2 — kèm sơ đồ. |
| [`docs/codebase-summary.md`](./docs/codebase-summary.md) | Bản đồ file, bảng hàm/method kèm số dòng trong `bot_cx.js` và `get_friends.js`, các hằng số thời gian/ngẫu nhiên, và danh sách selector DOM (phần dễ vỡ nhất của bot). |
| [`docs/code-standards.md`](./docs/code-standards.md) | Cấu trúc mã nguồn, quy ước code hiện có, cách xử lý lỗi, cách xử lý secret, hướng dẫn thêm loại tác vụ mới. |

### Ghi chú kỹ thuật ngắn gọn
- Ứng dụng gồm 2 file: `bot_cx.js` (~524 dòng, chạy bot) và `get_friends.js` (~249 dòng,
  quét danh sách bạn bè riêng — xem mục [Danh sách bạn bè](#danh-sách-bạn-bè)). Không có
  build step, không có test tự động, không có CI/CD.
- Dependencies chính: `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`,
  `cheerio` (xem `package.json`).
- Không có biến môi trường cấu hình (`.env`) — các tuỳ chọn (bật/tắt lọc bạn bè,
  `verifyMode`, v.v.) gom trong một khối `config` ở đầu `bot_cx.js`; muốn đổi vẫn phải
  sửa source rồi khởi động lại bot.
