/* ============================================================
   Sửa lỗi tương thích Prefill (PrefillCompatFix) - Module logic chính (index.js)
   ============================================================ */

/* [Chỉ mục khối] (theo thứ tự từ trên xuống dưới trong file)
   1. Tham số tùy chỉnh & Hằng số   Danh sách model, nội dung giữ chỗ, thời điểm cài đặt
   2. Cài đặt danh sách model       Danh sách người dùng, popup cài đặt, thông báo cập nhật, chèn lối vào & dọn dẹp
   3. Biến trạng thái               Trạng thái hook và kết quả phán định gần nhất
   4. Công cụ log                   Tiền tố và cấp độ log thống nhất
   5. Công cụ cơ bản                Các hàm thuần túy cho request object, URL, Header, tên model, v.v.
   6. Trích xuất tên model          Thu thập ứng viên theo độ ưu tiên rõ ràng và trả về nguồn cuối cùng
   7. Chọn mảng tin nhắn            Chọn một mục tiêu duy nhất giữa messages / contents
   8. Phân tích & sửa request body  Mô tả body, kế hoạch sửa thống nhất, nối thêm user
   9. Chặn Fetch request            Logic bọc dùng chung giữa cửa sổ chính và iframe cùng nguồn
   10. Chặn XHR request             Bọc open/send và phán định bổ sung đồng bộ
   11. Cài đặt Hook                 Cửa sổ chính, iframe cùng nguồn, iframe động (fetch + XHR)
   12. Giao diện debug              window.__PrefillCompatFix dùng để kiểm thử và rà soát lỗi
   13. Khởi tạo                     Chờ ST sẵn sàng rồi mới cài đặt
   ============================================================ */

/* ── Tham số tùy chỉnh & Hằng số ──────── */

const PLUGIN_KEY = 'PrefillCompatFix';
const PLUGIN_DISPLAY_NAME = 'Sửa lỗi tương thích Prefill';
const BUILTIN_UPDATE_TOAST_TITLE = `${PLUGIN_DISPLAY_NAME} - Cập nhật danh sách tích hợp sẵn`;
const ENABLED = true;                  /* Công tắc an toàn nội bộ: phiên bản hiện tại luôn bật, không cung cấp công tắc tổng cho người dùng */
const DEBUG_LOGS = false;              /* Có xuất debug log chi tiết hay không */
const DEFAULT_PLACEHOLDER_TEXT = '\u200B'; /* Nội dung tin nhắn nối thêm mặc định */
const APP_READY_FALLBACK_MS = 1200;    /* Độ trễ cài đặt dự phòng một lần khi đã bỏ lỡ APP_READY (ms) */
const JSON_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/* Danh sách bảo vệ mặc định: khớp nếu tên model thực tế chứa bất kỳ mục cấu hình nào, không phân biệt hoa thường.
   Popup cài đặt sẽ gộp các mục tùy chỉnh và lịch sử xóa thủ công trên nền danh sách tích hợp sẵn để tạo ra danh sách áp dụng cuối cùng */
const MODEL_PATTERNS = [
    /* Google Gemini */
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-4-argon',
    'gemini-4-carbon',
    'gemini-4-hydrogen',

    /* Anthropic Claude: 4.6 và các phiên bản tiếp theo */
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-opus-5-5',

    'claude-sonnet-4-6',
    'claude-sonnet-5',
    'claude-sonnet-5-5',

    'claude-haiku-5-5',

    'claude-fable-5',
    'claude-fable-5-1',
    'claude-fable-5-2',
];

/* ── Cài đặt danh sách model ──────────── */

const MODEL_LIST_INPUT_ID = 'pcf-model-list-input';
const MODEL_LIST_MAX_LINES = 100;      /* Giới hạn số dòng của danh sách, tránh dán cả đoạn văn làm phình file cài đặt */
const MODEL_LIST_LINK_ID = 'pcf-model-list-link';
const MODEL_LIST_LINK_PUSH_ID = 'pcf-model-list-push';
const HELP_BUTTON_ID = 'pcf-help-button';
const CUSTOM_CONTENT_TOGGLE_ID = 'pcf-custom-content-toggle';
const CUSTOM_CONTENT_INPUT_ID = 'pcf-custom-content-input';
const BUILTIN_UPDATE_PREVIEW_LIMIT = 5; /* Số lượng model hiển thị tối đa cho mỗi nhóm trong thông báo cập nhật */
/* Ký tự không nhìn thấy: ký tự điều khiển + ký tự định dạng zero-width/hai chiều phổ biến; các ký tự giống khoảng trắng được chuẩn hóa riêng thành dấu cách chuẩn */
const INVISIBLE_CHAR_RE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u17B4-\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;
/* Khoảng trắng cần xử lý như dấu cách (xuống dòng và dấu cách toàn giác được xử lý riêng trước/sau khi tách) */
const SPACE_LIKE_RE = /[\t\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F]/g;
/* Lần tải trang này đã kiểm tra và xử lý cập nhật danh sách tích hợp sẵn hay chưa */
let builtinUpdateChecked = false;
/* Popup hướng dẫn sử dụng đã mở hay chưa, tránh bấm liên tiếp làm chồng nhiều trang hướng dẫn */
let usageHelpOpen = false;
/* Hướng dẫn sử dụng: có thể điều chỉnh trực tiếp tiêu đề phụ, nội dung chính và danh sách */
const USAGE_HELP_SECTIONS = [
    {
        heading: 'Cơ chế hoạt động',
        paragraphs: [
            'Khắc phục lỗi "error 400: Requests ending with a model turn are not supported" do một số model không hỗ trợ prefill (request kết thúc bằng role không phải user).',
            'Khi model của request nằm trong danh sách áp dụng và tin nhắn cuối cùng không phải user, plugin sẽ âm thầm nối thêm một tin nhắn user vào cuối (mặc định là zero-width space) để gửi request bình thường.',
        ],
    },
    {
        heading: 'Hướng dẫn cài đặt',
        items: [
            'Danh sách model áp dụng: Mỗi dòng điền một "model ID" thực tế của API, có hiệu lực ngay khi lưu. Sử dụng cơ chế khớp chuỗi con không phân biệt hoa thường, vui lòng không điền từ khóa chung quá ngắn (như gemini) để tránh ảnh hưởng nhầm các model bình thường.',
            'Đồng bộ cập nhật danh sách: Khi plugin cập nhật danh sách tích hợp sẵn, hệ thống sẽ tự động đồng bộ và nhắc nhở; những model tích hợp sẵn đã bị xóa thủ công sẽ không tự động khôi phục.',
            'Tùy chỉnh tin nhắn bổ sung: Chỉ nên tích chọn khi zero-width space mặc định bị plugin khác hoặc phía upstream lọc mất (có thể thử điền "Tiếp tục", "Continue" hoặc dấu câu). Nội dung tùy chỉnh sẽ được gửi trực tiếp cho model nên có thể ảnh hưởng nhẹ đến câu trả lời.',
        ],
    },
    {
        heading: 'Lưu ý & Rà soát lỗi',
        items: [
            'Phạm vi áp dụng: Chỉ giải quyết lỗi 400 do "role ở cuối không phải user (prefill)", không bao gồm lỗi 400 do vượt quá context, sai tham số, tin nhắn rỗng hoặc các nguyên nhân khác.',
            'Khả năng tương thích: Hỗ trợ request gốc của ST và các plugin bên thứ ba phổ biến, chưa bao phủ các luồng request dùng mã hóa đặc biệt, đóng gói qua backend proxy hoặc cách ly cross-origin.',
            'Rà soát khi chưa có hiệu lực: Nếu đã bật mà vẫn gặp lỗi tương tự, vui lòng kiểm tra lần lượt: (1) Model ID đã viết đúng chính tả chưa; (2) Thử bật "Tùy chỉnh nội dung tin nhắn bổ sung" để vượt qua bộ lọc tin nhắn rỗng.',
        ],
    },
];

/* Đọc bản ghi tùy chỉnh và xóa thủ công từ cài đặt ST; coi là rỗng nếu cấu trúc bất thường */
function getModelListStored() {
    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return { custom: [], removed: [] };
    }

    const stored = context.extensionSettings[PLUGIN_KEY];
    if (!isPlainObject(stored)) {
        return { custom: [], removed: [] };
    }

    const pick = (value) => Array.isArray(value)
        ? value.filter((x) => typeof x === 'string' && x.trim() !== '')
        : [];

    return { custom: pick(stored.custom), removed: pick(stored.removed) };
}

/* Đọc cài đặt tùy chỉnh nội dung tin nhắn bổ sung; trả về trạng thái rỗng nếu cấu trúc bất thường hoặc đọc thất bại */
function getCustomContentStored() {
    try {
        const context = getStContext();
        const stored = context && context.extensionSettings
            ? context.extensionSettings[PLUGIN_KEY]
            : null;
        if (!isPlainObject(stored)) {
            return { enabled: false, content: '' };
        }
        return {
            enabled: stored.customContentEnabled === true,
            content: typeof stored.customContent === 'string' ? stored.customContent : '',
        };
    } catch (error) {
        logWarn('Đọc nội dung tin nhắn bổ sung tùy chỉnh thất bại, sử dụng giá trị mặc định', error);
        return { enabled: false, content: '' };
    }
}

/* Tính toán nội dung nối thêm lần này: dùng nguyên văn nếu tùy chỉnh khác rỗng và đã bật, ngược lại quay về mặc định */
function getEffectivePlaceholderText() {
    const custom = getCustomContentStored();
    return custom.enabled && custom.content.length > 0
        ? custom.content
        : DEFAULT_PLACEHOLDER_TEXT;
}

/* Danh sách áp dụng = Danh sách tích hợp sẵn - Bản ghi đã xóa + Tùy chỉnh; lọc trùng theo chuỗi model không phân biệt hoa thường */
function getEffectiveModelPatterns() {
    const { custom, removed } = getModelListStored();
    const removedKeys = new Set(removed.map(normalizeModelName).filter((x) => x !== ''));
    const seen = new Set();
    const result = [];

    for (const pattern of MODEL_PATTERNS) {
        const key = normalizeModelName(pattern);
        if (key === '' || seen.has(key) || removedKeys.has(key)) continue;
        seen.add(key);
        result.push(pattern);
    }

    for (const pattern of custom) {
        const key = normalizeModelName(pattern);
        if (key === '' || seen.has(key)) continue;
        seen.add(key);
        result.push(pattern);
    }

    return result;
}

/* Tạo văn bản dùng trong popup cài đặt: hiển thị danh sách áp dụng hiện tại theo định dạng mỗi dòng một mục */
function getModelListText() {
    return getEffectiveModelPatterns().join('\n');
}

/* Lưu danh sách model; nếu có truyền tham số tùy chỉnh tin nhắn bổ sung thì lưu cùng lúc, không truyền thì giữ nguyên giá trị cũ */
function saveModelListSettings(lines, customContentEnabled, customContent) {
    const builtinKeys = new Set(MODEL_PATTERNS.map(normalizeModelName));
    const custom = [];
    const removed = [];

    for (const line of lines) {
        const key = normalizeModelName(line);
        if (key === '') continue;
        if (builtinKeys.has(key)) continue;
        custom.push(line);
    }

    for (const pattern of MODEL_PATTERNS) {
        const key = normalizeModelName(pattern);
        if (!key) continue;
        if (lines.some((line) => normalizeModelName(line) === key)) continue;
        removed.push(pattern);
    }

    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return false;
    }

    const stored = context.extensionSettings[PLUGIN_KEY];
    /* Ghi gộp để tránh xóa mất metadata như snapshot danh sách tích hợp sẵn */
    const next = {
        ...(isPlainObject(stored) ? stored : {}),
        custom,
        removed,
    };
    if (typeof customContentEnabled === 'boolean') {
        next.customContentEnabled = customContentEnabled;
    }
    if (typeof customContent === 'string') {
        next.customContent = customContent;
    }
    context.extensionSettings[PLUGIN_KEY] = next;
    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
    return true;
}

/* Đọc snapshot danh sách tích hợp sẵn được ghi nhận lần trước; trả về null nếu chưa từng ghi nhận */
function getBuiltinSnapshot(context) {
    const stored = context && context.extensionSettings
        ? context.extensionSettings[PLUGIN_KEY]
        : null;
    if (!isPlainObject(stored) || !Array.isArray(stored.builtinSnapshot)) {
        return null;
    }

    return stored.builtinSnapshot.filter((x) => typeof x === 'string' && x.trim() !== '');
}

/* Lưu snapshot danh sách tích hợp sẵn hiện tại, đồng thời giữ lại mục tùy chỉnh và bản ghi đã xóa của người dùng */
function saveBuiltinSnapshot(context) {
    const stored = context.extensionSettings[PLUGIN_KEY];
    context.extensionSettings[PLUGIN_KEY] = {
        ...(isPlainObject(stored) ? stored : {}),
        builtinSnapshot: MODEL_PATTERNS.slice(),
    };
    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
}

/* Tính chênh lệch danh sách tích hợp sẵn theo tập hợp model; thay đổi thứ tự hoặc hoa thường không tính là thay đổi */
function getBuiltinListDiff(previous, current) {
    const beforeKeys = new Set(previous.map(normalizeModelName).filter((x) => x !== ''));
    const afterKeys = new Set(current.map(normalizeModelName).filter((x) => x !== ''));

    return {
        added: current.filter((x) => {
            const key = normalizeModelName(x);
            return key !== '' && !beforeKeys.has(key);
        }),
        removed: previous.filter((x) => {
            const key = normalizeModelName(x);
            return key !== '' && !afterKeys.has(key);
        }),
    };
}

/* Cắt ngắn danh sách model trong thông báo: hiển thị tối đa 5 mục, vượt quá thì nối trực tiếp dấu ba chấm */
function formatNoticePatternList(patterns, decorate = (x) => x) {
    const shown = patterns
        .slice(0, BUILTIN_UPDATE_PREVIEW_LIMIT)
        .map((x) => decorate(x));
    return `${shown.join(', ')}${patterns.length > BUILTIN_UPDATE_PREVIEW_LIMIT ? '...' : ''}`;
}

/* Tạo thông báo cập nhật dạng 2 đoạn: thêm mới ở trên, gỡ bỏ ở dưới; chú thích trạng thái người dùng đi kèm từng đoạn tương ứng */
function formatBuiltinListUpdateMessage(previous, current, custom, userRemoved) {
    const { added, removed } = getBuiltinListDiff(previous, current);
    if (added.length === 0 && removed.length === 0) return '';

    const customKeys = new Set(custom.map(normalizeModelName).filter((x) => x !== ''));
    const removedKeys = new Set(userRemoved.map(normalizeModelName).filter((x) => x !== ''));
    const addedCustom = added.filter((x) => customKeys.has(normalizeModelName(x)));
    const addedManuallyRemoved = added.filter((x) => {
        const key = normalizeModelName(x);
        return removedKeys.has(key) && !customKeys.has(key);
    });
    const removedManuallyAdded = removed.filter((x) => customKeys.has(normalizeModelName(x)));
    const removedManuallyRemoved = removed.filter((x) => (
        removedKeys.has(normalizeModelName(x)) && !customKeys.has(normalizeModelName(x))
    ));

    const blocks = [];
    if (added.length > 0) {
        const notes = [];
        if (addedCustom.length > 0) {
            notes.push(`${formatNoticePatternList(addedCustom)} đã có trong danh sách tùy chỉnh trước đó`);
        }
        if (addedManuallyRemoved.length > 0) {
            notes.push(`${formatNoticePatternList(addedManuallyRemoved)} là mục đã xóa thủ công, tiếp tục giữ tắt`);
        }
        const noteText = notes.length > 0 ? `; trong đó ${notes.join('; ')}` : '';
        blocks.push(`Thêm mới ${added.length} mục: ${formatNoticePatternList(added)}${noteText}.`);
    }

    if (removed.length > 0) {
        const notes = [];
        if (removedManuallyAdded.length > 0) {
            notes.push(`${formatNoticePatternList(removedManuallyAdded)} là mục đã thêm thủ công, tiếp tục giữ lại`);
        }
        if (removedManuallyRemoved.length > 0) {
            notes.push(`${formatNoticePatternList(removedManuallyRemoved)} đã được gỡ khỏi danh sách tùy chỉnh trước đó`);
        }
        const noteText = notes.length > 0 ? `; trong đó ${notes.join('; ')}` : '';
        blocks.push(`Gỡ bỏ ${removed.length} mục: ${formatNoticePatternList(removed)}${noteText}.`);
    }

    return blocks.join('<br>');
}

/* Kiểm tra thay đổi danh sách tích hợp sẵn một lần sau khi tải trang; lần đầu cài đặt chỉ lưu snapshot, không thông báo */
function checkBuiltinListUpdateOnce() {
    if (builtinUpdateChecked) return;

    try {
        const context = getStContext();
        if (!context || !context.extensionSettings) return;

        const previous = getBuiltinSnapshot(context);
        if (previous === null) {
            builtinUpdateChecked = true;
            saveBuiltinSnapshot(context);
            return;
        }

        const diff = getBuiltinListDiff(previous, MODEL_PATTERNS);
        if (diff.added.length === 0 && diff.removed.length === 0) {
            builtinUpdateChecked = true;
            if (JSON.stringify(previous) !== JSON.stringify(MODEL_PATTERNS)) {
                saveBuiltinSnapshot(context);
            }
            return;
        }

        const toastr = window.toastr;
        if (!toastr || typeof toastr.info !== 'function') return;

        const { custom, removed } = getModelListStored();
        const message = formatBuiltinListUpdateMessage(previous, MODEL_PATTERNS, custom, removed);
        if (!message) return;

        builtinUpdateChecked = true;
        toastr.info(message, BUILTIN_UPDATE_TOAST_TITLE, {
            timeOut: 12000,
            extendedTimeOut: 5000,
            closeButton: true,
            progressBar: true,
            /* ST mặc định escape HTML; ở đây chỉ chứa các model tích hợp sẵn, tắt escape để render xuống dòng phân đoạn */
            escapeHtml: false,
        });
        saveBuiltinSnapshot(context);
    } catch (error) {
        logWarn('Kiểm tra thông báo cập nhật danh sách tích hợp sẵn thất bại', error);
    }
}

/* Hook dọn dẹp của ST: chỉ xóa cài đặt của plugin này, không ảnh hưởng dữ liệu do các extension khác lưu */
function cleanExtensionData() {
    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return;
    }

    delete context.extensionSettings[PLUGIN_KEY];
}

export { cleanExtensionData };

/* Làm sạch đầu vào của người dùng: trả về { lines, fixes, issues }; khi issues khác rỗng cần người dùng xác nhận */
function normalizeModelListInput(text) {
    const raw = typeof text === 'string' ? text : '';
    /* Thống nhất xuống dòng thành \n; các khoảng trắng Unicode khác chuyển thành dấu cách chuẩn khi làm sạch từng dòng */
    const normalized = raw
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0085\u2028\u2029]/g, '\n');
    const rawLines = normalized.split('\n');

    /* Thống kê phân loại theo thao tác làm sạch thực tế phát sinh; cùng một dòng có thể tính vào nhiều loại (N biểu thị số mục liên quan) */
    let blankLines = 0;
    let trimLines = 0;
    let collapseLines = 0;
    let invisibleLines = 0;
    let fullWidthSpaceLines = 0;
    const lines = [];

    for (const rawLine of rawLines) {
        const hadFullWidthSpace = rawLine.includes('\u3000');
        if (hadFullWidthSpace) fullWidthSpaceLines += 1;
        const normalizedLine = rawLine.replace(/\u3000/g, ' ').replace(SPACE_LIKE_RE, ' ');
        const stripped = normalizedLine.replace(INVISIBLE_CHAR_RE, '');
        const hadInvisible = stripped !== normalizedLine;
        if (hadInvisible) invisibleLines += 1;

        const line = stripped.trim().replace(/ {2,}/g, ' ');
        if (line === '') {
            blankLines += 1;
            continue;
        }
        if (stripped !== stripped.trim()) trimLines += 1;
        if (/ {2,}/.test(stripped.trim())) collapseLines += 1;
        lines.push(line);
    }

    const result = [];
    const seen = new Set();
    const issues = [];
    const fixes = [];
    let duplicates = 0;
    let separators = 0;
    let specialChars = 0;

    for (const line of lines) {
        if (/[,;:，；：、]/.test(line)) separators += 1;
        if (/[^\u0000-\u007F]/.test(line)) specialChars += 1;

        const key = line.toLowerCase();
        if (seen.has(key)) {
            duplicates += 1;
            continue;
        }
        seen.add(key);
        result.push(line);
    }

    if (fullWidthSpaceLines > 0) fixes.push(`Chuyển dấu cách toàn giác sang dấu cách chuẩn (${fullWidthSpaceLines})`);
    if (invisibleLines > 0) fixes.push(`Xóa ký tự không nhìn thấy (${invisibleLines})`);
    if (blankLines > 0) fixes.push(`Xóa dòng trống (${blankLines})`);
    if (trimLines > 0) fixes.push(`Xóa khoảng trắng đầu/cuối dòng (${trimLines})`);
    if (collapseLines > 0) fixes.push(`Gộp khoảng trắng liên tiếp trong dòng (${collapseLines})`);
    if (duplicates > 0) fixes.push(`Xóa mục trùng lặp (${duplicates})`);
    if (specialChars > 0) issues.push(`Tồn tại ký tự toàn giác hoặc ký tự đặc biệt khác (${specialChars})`);

    /* Đã xóa khoảng trắng đầu/cuối dòng, mục nào vẫn còn khoảng trắng sau khi làm sạch mới tính là khoảng trắng giữa dòng */
    const spaced = result.filter((line) => /\s/.test(line)).length;
    if (spaced > 0) issues.push(`Chứa khoảng trắng giữa dòng, có thể không khớp chính xác (${spaced})`);
    if (separators > 0) issues.push(`Tồn tại dấu phân cách như dấu phẩy/chấm phẩy, vui lòng xác nhận xem tên model có cần tách dòng hay không (${separators})`);

    return { lines: result, fixes, issues, tooMany: result.length > MODEL_LIST_MAX_LINES };
}

/* Căn trái danh sách và chữ trong các mục của popup, tránh bị lệch dấu chấm tròn và chữ khi ST mặc định căn giữa.
   Chỉ xử lý bản thân danh sách, tiêu đề và văn bản giải thích vẫn giữ căn lề mặc định của popup */
function applyPopupListAlign(list) {
    list.style.textAlign = 'left';
    list.querySelectorAll('li').forEach((li) => {
        li.style.textAlign = 'left';
    });
}

/* Nối thêm một nhóm mục danh sách vào nội dung popup; chỉ căn lề bản thân danh sách, văn bản giải thích vẫn giữ căn giữa mặc định */
function appendPopupList(parent, items) {
    const list = document.createElement('ul');
    for (const item of items) {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    }
    parent.appendChild(list);
    applyPopupListAlign(list);
}

/* Tạo một phân đoạn của hướng dẫn sử dụng theo cấu trúc "Tiêu đề phụ + Nội dung chính / Danh sách" */
function appendUsageHelpSection(parent, section) {
    const block = document.createElement('section');
    block.className = 'flex-container flexFlowColumn';
    block.style.gap = '0.4em';

    const heading = document.createElement('h4');
    heading.className = 'margin0';
    heading.textContent = section.heading;
    block.appendChild(heading);

    for (const text of section.paragraphs || []) {
        const paragraph = document.createElement('p');
        paragraph.className = 'margin0';
        paragraph.style.lineHeight = '1.55';
        paragraph.textContent = text;
        block.appendChild(paragraph);
    }

    if (Array.isArray(section.items) && section.items.length > 0) {
        const list = document.createElement('ul');
        list.style.margin = '0';
        list.style.paddingLeft = '1.25em';
        list.style.lineHeight = '1.55';
        for (const text of section.items) {
            const item = document.createElement('li');
            item.textContent = text;
            item.style.marginBottom = '0.3em';
            list.appendChild(item);
        }
        block.appendChild(list);
    }

    parent.appendChild(block);
}

/* Tạo nội dung chính cho hướng dẫn sử dụng; chỉ dùng class bố cục gốc của ST, việc cuộn giao cho vùng nội dung popup */
function buildUsageHelpDialogContent() {
    const content = document.createElement('div');
    content.className = 'flex-container flexFlowColumn';
    content.style.gap = '1em';
    content.style.paddingBottom = '0.25em';

    const title = document.createElement('h3');
    title.className = 'margin0 textAlignCenter';
    title.textContent = `Hướng dẫn sử dụng`;
    content.appendChild(title);

    for (const section of USAGE_HELP_SECTIONS) {
        appendUsageHelpSection(content, section);
    }

    return content;
}

/* Mở popup hướng dẫn sử dụng; khi nội dung quá dài sẽ dùng vùng cuộn dọc gốc của ST để hiển thị thanh tiến trình */
async function openUsageHelpDialog() {
    if (usageHelpOpen) return;

    const context = getStContext();
    if (!context || !context.POPUP_TYPE || !context.POPUP_RESULT) {
        logWarn('Không thể mở hướng dẫn sử dụng: thành phần popup của ST không khả dụng');
        return;
    }

    const PopupClass = context.Popup
        || (window.SillyTavern && window.SillyTavern.libs && window.SillyTavern.libs.Popup);
    if (typeof PopupClass !== 'function') {
        logWarn('Không thể mở hướng dẫn sử dụng: lớp Popup của ST không khả dụng');
        return;
    }

    usageHelpOpen = true;
    try {
        const popup = new PopupClass(
            buildUsageHelpDialogContent(),
            context.POPUP_TYPE.TEXT,
            '',
            {
                wide: true,
                /* Trên desktop co giãn tự nhiên theo nội dung; trên màn hình hẹp giữ popup lớn để vùng hướng dẫn không quá chật */
                large: window.innerWidth <= 768,
                leftAlign: true,
                allowVerticalScrolling: true,
                okButton: false,
                cancelButton: false,
                defaultResult: context.POPUP_RESULT.NEGATIVE,
                customButtons: [
                    {
                        text: 'Đóng',
                        result: context.POPUP_RESULT.NEGATIVE,
                    },
                ],
            },
        );
        await popup.show();
    } finally {
        usageHelpOpen = false;
    }
}

/* Tạo nội dung popup: danh sách model và cài đặt tùy chỉnh tin nhắn bổ sung */
function buildModelListDialogContent(initialText, customContentState) {
    const content = document.createElement('div');
    content.className = 'flex-container flexFlowColumn height100p';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex-container';
    titleRow.style.alignItems = 'center';
    titleRow.style.justifyContent = 'center';
    titleRow.style.gap = '0.4em';

    const title = document.createElement('h3');
    title.className = 'margin0 textAlignCenter';
    title.textContent = PLUGIN_DISPLAY_NAME;

    const helpButton = document.createElement('button');
    helpButton.type = 'button';
    helpButton.id = HELP_BUTTON_ID;
    helpButton.className = 'fa-solid fa-circle-question note-link-span';
    helpButton.title = 'Xem hướng dẫn sử dụng';
    helpButton.setAttribute('aria-label', 'Xem hướng dẫn sử dụng');
    helpButton.style.border = '0';
    helpButton.style.padding = '0';
    helpButton.style.margin = '0';
    helpButton.style.background = 'transparent';
    helpButton.style.lineHeight = '1';
    helpButton.style.fontSize = '0.95em';
    helpButton.style.transform = 'translateY(0.8px)';
    helpButton.style.cursor = 'pointer';
    helpButton.style.flex = '0 0 auto';
    helpButton.addEventListener('click', () => {
        void openUsageHelpDialog();
    });
    titleRow.append(title, helpButton);

    const area = document.createElement('div');
    area.className = 'flex1 flex-container flexFlowColumn';

    const hint = document.createElement('h4');
    hint.className = 'margin0';
    hint.textContent = 'Danh sách model áp dụng (mỗi dòng một mục, lưu để áp dụng)';

    const textarea = document.createElement('textarea');
    textarea.id = MODEL_LIST_INPUT_ID;
    textarea.className = 'text_pole';
    textarea.placeholder = 'Ví dụ:\ngemini-3.7-flash\ngemini-3.8-flash\ngemini-4-argon';
    textarea.spellcheck = false;
    textarea.value = initialText;
    /* Giữ chiều cao mặc định lớn cùng khoảng trống bên dưới, và cho phép người dùng kéo chỉnh kích thước */
    textarea.style.height = '42vh';
    textarea.style.minHeight = '8em';
    textarea.style.maxHeight = '75vh';

    area.appendChild(hint);
    area.appendChild(textarea);

    const customSection = document.createElement('div');
    customSection.className = 'flex-container flexFlowColumn';
    customSection.style.marginTop = '0.75em';

    const customHeading = document.createElement('h4');
    customHeading.className = 'margin0';
    customHeading.style.display = 'flex';
    customHeading.style.justifyContent = 'center';
    customHeading.style.alignItems = 'center';
    const customLabel = document.createElement('label');
    customLabel.style.display = 'inline-flex';
    customLabel.style.alignItems = 'center';
    customLabel.style.gap = '0.35em';
    customLabel.style.cursor = 'pointer';
    const customToggle = document.createElement('input');
    customToggle.type = 'checkbox';
    customToggle.id = CUSTOM_CONTENT_TOGGLE_ID;
    customToggle.checked = !!(customContentState && customContentState.enabled);
    customToggle.style.margin = '0';
    customToggle.style.flex = '0 0 auto';
    customToggle.style.transform = 'translateY(0.3px)';
    customLabel.append(
        customToggle,
        'Tùy chỉnh nội dung tin nhắn bổ sung (tích để bật)',
    );
    customHeading.appendChild(customLabel);

    const customInput = document.createElement('textarea');
    customInput.id = CUSTOM_CONTENT_INPUT_ID;
    customInput.className = 'text_pole';
    customInput.rows = window.innerWidth <= 768 ? 4 : 3;
    customInput.spellcheck = false;
    customInput.placeholder = 'Khi bổ sung tin nhắn user ở cuối, nội dung tại đây sẽ thay thế cho zero-width space mặc định. Nội dung này sẽ được gửi thực tế cho AI, vui lòng chú ý ảnh hưởng về mặt ngữ nghĩa.\nVí dụ: Continue, Tiếp tục';
    customInput.value = customContentState && typeof customContentState.content === 'string'
        ? customContentState.content
        : '';

    const updateCustomInputState = () => {
        const enabled = customToggle.checked;
        customInput.disabled = !enabled;
        if (enabled) {
            customInput.style.removeProperty('background-color');
        } else {
            customInput.style.setProperty(
                'background-color',
                'color-mix(in srgb, var(--SmartThemeBlurTintColor) 78%, var(--SmartThemeBodyColor) 22%)',
                'important',
            );
        }
        /* brightness(0.5) mặc định của theme sẽ làm màu xám thích ứng bị tối thêm lần nữa, trạng thái vô hiệu hóa chuyển sang biểu thị bằng màu nền */
        customInput.style.filter = enabled ? '' : 'none';
    };
    customToggle.addEventListener('change', () => {
        updateCustomInputState();
    });
    updateCustomInputState();

    customSection.appendChild(customHeading);
    customSection.appendChild(customInput);
    area.appendChild(customSection);

    content.appendChild(titleRow);
    content.appendChild(area);
    return { content, textarea, customToggle, customInput };
}

/* Kiểm tra hợp lệ danh sách và nhắc người dùng trong các trường hợp vượt giới hạn, danh sách rỗng hoặc có vấn đề; trả về việc có cho phép lưu hay không */
async function confirmModelListIssues(text) {
    const context = getStContext();
    if (!context) return false;

    const info = normalizeModelListInput(text);

    /* Vượt quá giới hạn số dòng: từ chối lưu trực tiếp */
    if (info.tooMany) {
        await context.callGenericPopup(
            'Số dòng vượt quá giới hạn, vui lòng xóa bớt rồi thử lại.',
            context.POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Xác nhận', cancelButton: false },
        );
        return false;
    }

    /* Danh sách rỗng đồng nghĩa với tắt toàn bộ bảo vệ model, xác nhận riêng trước khi lưu */
    if (info.lines.length === 0) {
        const emptyNotice = document.createElement('div');
        emptyNotice.append('Danh sách model đang trống, sẽ ');
        const emptyStrong = document.createElement('strong');
        emptyStrong.textContent = 'không còn tự động sửa lỗi cho bất kỳ model nào';
        emptyNotice.append(emptyStrong);
        emptyNotice.append('. Bạn có chắc chắn muốn lưu không?');
        const confirmed = await context.callGenericPopup(
            emptyNotice,
            context.POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Xác nhận', cancelButton: 'Hủy' },
        );
        return confirmed === context.POPUP_RESULT.AFFIRMATIVE;
    }

    const hasFixes = info.fixes.length > 0;
    const hasIssues = info.issues.length > 0;

    /* Khi đồng thời tồn tại tự động sửa lỗi và vấn đề cần xác nhận, gộp thành một lần xác nhận */
    if (hasFixes && hasIssues) {
        const wrap = document.createElement('div');
        const fixTitle = document.createElement('h4');
        fixTitle.className = 'margin0';
        fixTitle.textContent = 'Đã tự động sửa định dạng:';
        wrap.appendChild(fixTitle);
        appendPopupList(wrap, info.fixes);

        /* Khối giãn cách tránh gộp margin dưới của danh sách, giữ hai vùng thông báo tách biệt */
        const sectionGap = document.createElement('div');
        sectionGap.dataset.pcfSectionGap = '';
        sectionGap.style.height = '0.75em';
        wrap.appendChild(sectionGap);

        const issueTitle = document.createElement('h4');
        issueTitle.className = 'margin0';
        issueTitle.textContent = 'Sau khi sửa vẫn phát hiện các vấn đề sau, vui lòng xác nhận có lưu hay không:';
        wrap.appendChild(issueTitle);
        appendPopupList(wrap, info.issues);

        const confirmed = await context.callGenericPopup(
            wrap,
            context.POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Xác nhận', cancelButton: 'Hủy' },
        );
        return confirmed === context.POPUP_RESULT.AFFIRMATIVE;
    }

    /* Khi chỉ có tự động sửa lỗi thì hiển thị hộp thông tin, không cần xác nhận lại */
    if (hasFixes) {
        const fixedWrap = document.createElement('div');
        const fixedTitle = document.createElement('h4');
        fixedTitle.className = 'margin0';
        fixedTitle.textContent = 'Đã tự động sửa định dạng và lưu:';
        fixedWrap.appendChild(fixedTitle);
        appendPopupList(fixedWrap, info.fixes);
        await context.callGenericPopup(fixedWrap, context.POPUP_TYPE.CONFIRM, '', { okButton: 'Xác nhận', cancelButton: false });
        return true;
    }

    /* Không có nội dung cần xác nhận thì cho phép lưu trực tiếp */
    if (!hasIssues) {
        return true;
    }

    /* Dùng node DOM để hiển thị văn bản động, tránh tên model bị hiểu nhầm thành HTML */
    const wrap = document.createElement('div');
    const ask = document.createElement('h4');
    ask.className = 'margin0';
    ask.textContent = 'Phát hiện các vấn đề sau, vui lòng xác nhận có lưu hay không:';
    wrap.appendChild(ask);
    appendPopupList(wrap, info.issues);

    const confirmed = await context.callGenericPopup(
        wrap,
        context.POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Xác nhận', cancelButton: 'Hủy' },
    );
    return confirmed === context.POPUP_RESULT.AFFIRMATIVE;
}

/* Mở popup cài đặt, xử lý lưu, hủy và khôi phục mặc định */
async function openModelListDialog() {
    const context = getStContext();
    if (!context || typeof context.callGenericPopup !== 'function' || !context.POPUP_TYPE) {
        logWarn('Không thể mở cài đặt danh sách model: thành phần popup của ST không khả dụng');
        return;
    }

    const PopupClass = context.Popup
        || (window.SillyTavern && window.SillyTavern.libs && window.SillyTavern.libs.Popup);
    if (typeof PopupClass !== 'function') {
        logWarn('Không thể mở cài đặt danh sách model: lớp Popup của ST không khả dụng');
        return;
    }

    const popupType = context.POPUP_TYPE;
    const resultTypes = context.POPUP_RESULT;
    const parts = buildModelListDialogContent(getModelListText(), getCustomContentStored());
    let savePending = false;

    /* Không bật chiều cao cố định large: để nội dung quyết định kích thước ban đầu, sau khi kéo lớn sẽ dùng cuộn dọc gốc */
    const popup = new PopupClass(parts.content, popupType.TEXT, '', {
        wide: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: false,
        customButtons: [
            { text: 'Lưu', classes: ['popup-button-ok'], action: () => { savePending = true; popup.completeAffirmative(); } },
            { text: 'Hủy', classes: ['popup-button-cancel'], result: resultTypes.NEGATIVE, appendAtEnd: true },
            { text: 'Khôi phục mặc định', action: () => { void handleRestore(); }, appendAtEnd: true },
        ],
        onClosing: async () => {
            /* Kiểm tra hợp lệ trước khi lưu; nếu không đạt thì giữ popup và giữ nguyên nội dung đã nhập */
            if (savePending) {
                const ok = await confirmModelListIssues(parts.textarea.value);
                if (!ok) {
                    savePending = false;
                    return false;
                }
            }
            return true;
        },
    });

    const handleRestore = async () => {
        const ctx = getStContext() || context;
        const confirmed = await ctx.callGenericPopup(
            'Thao tác này sẽ xóa sạch các mục tùy chỉnh và khôi phục danh sách tích hợp sẵn. Bạn có chắc chắn muốn khôi phục không?',
            popupType.CONFIRM,
            '',
            { okButton: 'Xác nhận', cancelButton: 'Hủy' },
        );
        if (confirmed !== resultTypes.AFFIRMATIVE) return;

        /* Điền trực tiếp danh sách tích hợp sẵn tại chỗ, vẫn cần người dùng bấm "Lưu" mới ghi lại vào cài đặt */
        parts.textarea.value = MODEL_PATTERNS.join('\n');
        parts.textarea.focus();
    };

    const result = await popup.show();
    if (result === resultTypes.AFFIRMATIVE) {
        const info = normalizeModelListInput(parts.textarea.value);
        const saved = saveModelListSettings(
            info.lines,
            parts.customToggle.checked,
            parts.customInput.value,
        );
        if (!saved) {
            logWarn('Lưu danh sách model thất bại: API cài đặt của ST không khả dụng');
        }
    }
}

/* Chèn lối vào cài đặt bên phải mục "Xem API key" trong bảng API.
   Chỉ chèn phần tử của plugin này, và dùng phần tử đệm rộng 0 để duy trì bố cục hai đầu vốn có của hàng đó */
function installModelListLink() {
    const existing = document.getElementById(MODEL_LIST_LINK_ID);
    if (existing && document.body.contains(existing)) return true;

    const viewSecrets = document.getElementById('viewSecrets');
    if (!viewSecrets || !viewSecrets.parentElement) return false;

    const link = document.createElement('a');
    link.id = MODEL_LIST_LINK_ID;
    link.href = 'javascript:void(0);';
    link.textContent = PLUGIN_DISPLAY_NAME;
    link.addEventListener('click', () => {
        openModelListDialog();
    });

    /* Phần tử đệm dùng margin tự động để tiếp tục đẩy "Xem API key" về phía bên phải */
    if (!document.getElementById(MODEL_LIST_LINK_PUSH_ID)) {
        const push = document.createElement('span');
        push.id = MODEL_LIST_LINK_PUSH_ID;
        push.style.marginLeft = 'auto';
        viewSecrets.parentElement.insertBefore(push, viewSecrets);
    }

    viewSecrets.parentElement.insertBefore(link, viewSecrets.nextSibling);
    return true;
}

/* ── Biến trạng thái ──────────────────── */

/* Cửa sổ -> hàm bọc fetch đã cài đặt */
const hookedFetchHooks = new WeakMap();
/* Đối tượng XHR -> tham số open (đọc khi send, gọi open lặp lại sẽ ghi đè) */
const xhrOpenMeta = new WeakMap();
/* realm -> phương thức prototype XHR lúc cài đặt, dùng để phát hiện cài đặt trùng lặp hoặc prototype bị thay thế */
const hookedXhrProtos = new WeakMap();
/* Các cửa sổ đã được tính vào thống kê */
const hookedWindows = new WeakSet();
/* Các iframe đã gắn listener load */
const iframeLoadListenersAttached = new WeakSet();

/* Hook cửa sổ chính (fetch + XHR) đã được cài đặt hay chưa */
let mainHookInstalled = false;
/* Trình quét hook iframe (fetch + XHR) đã được cài đặt hay chưa */
let iframeHooksInstalled = false;
/* Số lượng cửa sổ iframe đã cài đặt hook (dùng để debug) */
let iframeHookCount = 0;
/* Kết quả phán định tóm tắt của request gần nhất */
let lastDecision = null;
/* Bản tóm tắt mô tả request body gần nhất (không giữ tham chiếu đến body hoặc đối tượng lớn) */
let lastBodyDescriptor = null;
/* Bộ đếm xử lý request body, dùng để kiểm thử xác nhận không đọc, parse hoặc phân tích lặp lại */
const requestPipelineStats = {
    requestReads: 0,
    jsonParses: 0,
    analyses: 0,
    modifications: 0,
};
/* Đã xuất thông báo khởi động thành công hay chưa */
let startupLogged = false;

/* ── Công cụ log ──────────────────────── */

function logDebug(message, detail) {
    if (!DEBUG_LOGS) return;
    if (detail === undefined) {
        console.debug(`[${PLUGIN_KEY}] ${message}`);
    } else {
        console.debug(`[${PLUGIN_KEY}] ${message}`, detail);
    }
}

function logInfo(message, detail) {
    if (!DEBUG_LOGS) return;
    if (detail === undefined) {
        console.info(`[${PLUGIN_KEY}] ${message}`);
    } else {
        console.info(`[${PLUGIN_KEY}] ${message}`, detail);
    }
}

/* Thông báo khởi động thành công: chỉ xuất một lần bất kể công tắc DEBUG_LOGS */
function logStartupOnce() {
    if (startupLogged) return;
    startupLogged = true;
    console.info(`[${PLUGIN_KEY}] Đã tải Sửa lỗi tương thích Prefill`);
}

function logWarn(message, detail) {
    if (detail === undefined) {
        console.warn(`[${PLUGIN_KEY}] ${message}`);
    } else {
        console.warn(`[${PLUGIN_KEY}] ${message}`, detail);
    }
}

function logError(message, error) {
    if (error === undefined) {
        console.error(`[${PLUGIN_KEY}] ${message}`);
    } else {
        console.error(`[${PLUGIN_KEY}] ${message}`, error);
    }
}

/* ── Công cụ cơ bản ───────────────────── */

/* Kiểm tra xem có phải plain object hay không (không bao gồm mảng và null) */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/* Kiểm tra xem có phải đối tượng tương tự Request hay không: khi khác realm thì instanceof không đáng tin cậy, sử dụng duck typing */
function isRequestLike(input) {
    return !!input
        && typeof input === 'object'
        && typeof input.clone === 'function'
        && typeof input.text === 'function';
}

/* Lấy chuỗi URL tương ứng của đầu vào fetch */
function getFetchRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
        if (input instanceof URL) return input.toString();
    } catch (error) {
        /* Đối tượng URL khác realm có thể không instanceof trực tiếp được, bỏ qua */
    }
    return '';
}

/* Lấy đối tượng URL của request URL; trả về null nếu thất bại */
function getRequestUrlObject(requestUrl) {
    if (!requestUrl) return null;
    try {
        return new URL(requestUrl, window.location.href);
    } catch (error) {
        return null;
    }
}

function getRequestPathname(requestUrl) {
    const urlObject = getRequestUrlObject(requestUrl);
    return urlObject ? urlObject.pathname.toLowerCase() : '';
}

/* Đọc an toàn giá trị trường trong Headers */
function getHeaderValue(headers, name) {
    if (headers === undefined || headers === null) return null;
    try {
        return new Headers(headers).get(name);
    } catch (error) {
        return null;
    }
}

function getEffectiveMethod(input, init) {
    if (init && typeof init.method === 'string' && init.method) {
        return init.method.toUpperCase();
    }
    if (isRequestLike(input) && typeof input.method === 'string' && input.method) {
        return input.method.toUpperCase();
    }
    return 'GET';
}

function getEffectiveContentType(input, init) {
    if (init && init.headers !== undefined && init.headers !== null) {
        return getHeaderValue(init.headers, 'content-type');
    }
    if (isRequestLike(input)) {
        return getHeaderValue(input.headers, 'content-type');
    }
    return null;
}

/* Kiểm tra Content-Type có thể xử lý như văn bản JSON hay không */
function isJsonContentType(contentType) {
    if (!contentType) return true;
    const lower = String(contentType).toLowerCase();
    return lower.includes('application/json') || lower.includes('+json');
}

/* Trả về lý do không hỗ trợ xử lý body theo dạng JSON/plain object; null nghĩa là có thể tiếp tục phán định.
   Ở đây chỉ nhận diện kiểu dữ liệu, không đọc, không liệt kê, không chuyển đổi body dạng nhị phân hoặc form. */
function getUnsupportedBodyReason(value) {
    if (value === '') return 'empty-body';
    if (Array.isArray(value)) return 'array-body';
    if (typeof value !== 'object' || value === null) return 'non-object-body';

    let tag = '';
    try {
        tag = Object.prototype.toString.call(value);
    } catch (error) {
        return 'body-classification-failed';
    }
    if (tag === '[object Blob]' || tag === '[object File]') return 'blob-body';
    if (tag === '[object FormData]') return 'form-data-body';
    if (tag === '[object URLSearchParams]') return 'url-search-params-body';
    if (tag === '[object ArrayBuffer]') return 'array-buffer-body';
    if (tag === '[object DataView]') return 'data-view-body';
    if (tag === '[object ReadableStream]') return 'readable-stream-body';
    try {
        if (ArrayBuffer.isView(value)) return 'typed-array-body';
    } catch (error) {
        return 'body-classification-failed';
    }
    if (tag !== '[object Object]') return 'unsupported-object-body';
    return null;
}

/* Tạo mô tả request body; valuePromise chỉ dùng cho Request body chưa đọc. */
function makeBodyDescriptor(state, origin, value, options = {}) {
    return {
        state,
        origin,
        value,
        valuePromise: options.valuePromise || null,
        hasRawText: options.hasRawText === true,
        unsupportedReason: options.unsupportedReason || null,
    };
}

/* Tạo bản tóm tắt body chỉ chứa các trường phân loại, tránh giao diện debug giữ tham chiếu lâu dài đến request body. */
function summarizeBodyDescriptor(descriptor) {
    if (!descriptor) return null;
    return {
        state: descriptor.state,
        origin: descriptor.origin,
        hasRawText: !!descriptor.hasRawText,
        unsupportedReason: descriptor.unsupportedReason || '',
    };
}

function safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return '';
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

function normalizeModelName(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeRole(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/* Trả về mục cấu hình đầu tiên khớp được; không khớp trả về chuỗi rỗng */
function findMatchedModelPattern(modelName) {
    const normalizedModel = normalizeModelName(modelName);
    if (!normalizedModel) return '';

    for (const pattern of getEffectiveModelPatterns()) {
        const normalizedPattern = normalizeModelName(pattern);
        if (!normalizedPattern) continue;
        if (normalizedModel.includes(normalizedPattern)) return normalizedPattern;
    }

    return '';
}

/* ── Trích xuất tên model ─────────────── */

/* Thu thập các ứng viên model xuất hiện trong request body và URL, giữ nguyên thứ tự độ ưu tiên */
function collectModelCandidates(body, requestUrl) {
    const candidates = [];

    function addCandidate(value, source) {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (!trimmed) return;
        candidates.push({ value: trimmed, source });
    }

    addCandidate(body.model, 'body.model');
    addCandidate(body.generationConfig && body.generationConfig.model, 'body.generationConfig.model');
    addCandidate(body.model_name, 'body.model_name');
    addCandidate(body.modelName, 'body.modelName');
    addCandidate(body.engine, 'body.engine');

    const urlObject = getRequestUrlObject(requestUrl);
    if (urlObject) {
        const pathMatch = urlObject.pathname.match(/\/models\/([^/:?#]+)/i);
        if (pathMatch && pathMatch[1]) {
            addCandidate(safeDecodeURIComponent(pathMatch[1]), 'url.path.models');
        }
        addCandidate(urlObject.searchParams.get('model'), 'url.query.model');
    }

    return candidates;
}

/* Lấy tên model được chọn cuối cùng, nguồn gốc và toàn bộ ứng viên */
function getModelInfo(body, requestUrl) {
    const candidates = collectModelCandidates(body, requestUrl);
    const primary = candidates.length > 0 ? candidates[0] : null;
    const uniqueValues = new Set(candidates.map(item => normalizeModelName(item.value)));

    if (uniqueValues.size > 1) {
        logWarn('Phát hiện nhiều ứng viên model khác nhau, xử lý theo trường có độ ưu tiên cao nhất', candidates);
    }

    const model = primary ? primary.value : '';
    const modelSource = primary ? primary.source : '';
    const matchedPattern = findMatchedModelPattern(model);

    return {
        model,
        modelSource,
        candidates,
        matched: !!matchedPattern,
        matchedPattern,
    };
}

/* ── Chọn mảng tin nhắn ───────────────── */

/* Kiểm tra xem có phải mảng khác rỗng hay không */
function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/* Chọn mảng tin nhắn thực tế cần sửa trong request lần này */
function selectTargetArray(body, requestUrl) {
    const hasMessages = hasNonEmptyArray(body.messages);
    const hasContents = hasNonEmptyArray(body.contents);

    if (hasMessages && !hasContents) {
        return { target: 'messages', reason: '' };
    }
    if (hasContents && !hasMessages) {
        return { target: 'contents', reason: '' };
    }
    if (!hasMessages && !hasContents) {
        return { target: null, reason: 'Không có mảng messages hoặc contents khả dụng trong request body' };
    }

    const pathname = getRequestPathname(requestUrl);
    const urlHintsGemini = pathname.includes('generatecontent') || pathname.includes('streamgeneratecontent');
    const urlHintsMessages = pathname.includes('chat/completions')
        || pathname.includes('chat-completions')
        || typeof body.chat_completion_source === 'string';

    if (urlHintsGemini && !urlHintsMessages) {
        return { target: 'contents', reason: '' };
    }
    if (urlHintsMessages && !urlHintsGemini) {
        return { target: 'messages', reason: '' };
    }

    return { target: null, reason: 'messages và contents cùng tồn tại, không thể phán định an toàn mảng thực sự được sử dụng' };
}

/* ── Phân tích & sửa request body ─────── */

/* Phân tích JSON request body đã parse, chỉ phán định chứ không sửa; kiểm tra thuần túy có thể tắt đếm thống kê. */
function analyzeParsedBody(body, requestUrl, trackStats = true) {
    if (trackStats) requestPipelineStats.analyses++;
    const modelInfo = getModelInfo(body, requestUrl);
    if (!modelInfo.matched) {
        return {
            ...modelInfo,
            decision: 'not-target-model',
            reason: 'Model không nằm trong danh sách bảo vệ',
            target: null,
            lastRole: '',
            changed: false,
        };
    }

    const targetInfo = selectTargetArray(body, requestUrl);
    if (!targetInfo.target) {
        return {
            ...modelInfo,
            decision: targetInfo.reason.includes('không thể phán định an toàn') ? 'ambiguous-payload' : 'unsupported-body',
            reason: targetInfo.reason,
            target: null,
            lastRole: '',
            changed: false,
        };
    }

    const messages = body[targetInfo.target];
    const lastMessage = messages[messages.length - 1];
    if (!isPlainObject(lastMessage) || typeof lastMessage.role !== 'string') {
        return {
            ...modelInfo,
            decision: 'unsupported-body',
            reason: 'Phần tử cuối cùng của mảng mục tiêu không phải là plain object có role dạng chuỗi',
            target: targetInfo.target,
            lastRole: '',
            changed: false,
        };
    }

    const lastRole = normalizeRole(lastMessage.role);
    if (lastRole === 'user') {
        return {
            ...modelInfo,
            decision: 'already-user',
            reason: 'Mục cuối cùng đã là user',
            target: targetInfo.target,
            lastRole,
            changed: false,
        };
    }

    return {
        ...modelInfo,
        decision: 'needs-fix',
        reason: 'Khớp model mục tiêu và mục cuối cùng không phải user',
        target: targetInfo.target,
        lastRole,
        changed: false,
    };
}

/* Trả về request body mới sau khi đã nối thêm tin nhắn user, không sửa đổi đối tượng được truyền vào */
function buildFixedBody(body, target) {
    const placeholderText = getEffectivePlaceholderText();
    if (target === 'messages') {
        return {
            ...body,
            messages: [
                ...body.messages,
                { role: 'user', content: placeholderText },
            ],
        };
    }

    return {
        ...body,
        contents: [
            ...body.contents,
            { role: 'user', parts: [{ text: placeholderText }] },
        ],
    };
}

/* Đọc nguồn body thực tế có hiệu lực của lệnh fetch này; ở đây chỉ phân loại, không đọc nội dung Request. */
function readFetchBodySource(input, init) {
    /* Bản thân việc đọc thuộc về lỗi thực thi; giữ nguyên ngữ nghĩa hồi quy modification-failed ở lớp ngoài. */
    const body = init ? init.body : undefined;

    if (body !== undefined && body !== null) {
        if (typeof body === 'string') {
            if (body.length === 0) {
                return makeBodyDescriptor('unsupported', 'init-string', body, {
                    unsupportedReason: 'empty-body',
                });
            }
            return makeBodyDescriptor('text', 'init-string', body, { hasRawText: true });
        }
        const unsupportedReason = getUnsupportedBodyReason(body);
        if (unsupportedReason) {
            return makeBodyDescriptor('unsupported', 'init-body', body, { unsupportedReason });
        }
        return makeBodyDescriptor('structured-object', 'init-object', body);
    }

    if (!isRequestLike(input)) {
        return makeBodyDescriptor('none', 'none', null);
    }

    let valuePromise;
    try {
        const clonedRequest = input.clone();
        valuePromise = clonedRequest.text()
            .then((text) => {
                requestPipelineStats.requestReads++;
                return typeof text === 'string' ? text : null;
            })
            .catch(() => null);
    } catch (error) {
        valuePromise = Promise.resolve(null);
    }
    return makeBodyDescriptor('text', 'request-text', null, { valuePromise });
}

/* Chuyển đổi mô tả body thành plain object có thể phân tích; văn bản Request đọc tối đa một lần. */
async function materializeFetchBody(descriptor) {
    if (!descriptor || descriptor.state === 'none') {
        return { ok: false, reason: 'Request không có body khả dụng' };
    }
    if (descriptor.state === 'unsupported') {
        return { ok: false, reason: `Kiểu body không được hỗ trợ: ${descriptor.unsupportedReason || 'unknown'}` };
    }
    if (descriptor.state === 'structured-object') {
        return { ok: true, body: descriptor.value, rawText: null };
    }

    let rawText = descriptor.value;
    if (typeof rawText !== 'string' && descriptor.valuePromise) {
        rawText = await descriptor.valuePromise;
    }
    if (typeof rawText !== 'string') {
        return { ok: false, reason: 'Request body không thể clone hoặc đọc' };
    }
    if (rawText.length === 0) {
        return { ok: false, reason: 'Kiểu body không được hỗ trợ: empty-body' };
    }

    let body;
    requestPipelineStats.jsonParses++;
    try {
        body = JSON.parse(rawText);
    } catch (error) {
        return { ok: false, reason: 'Request body không phải JSON hợp lệ' };
    }
    if (!isPlainObject(body)) {
        return { ok: false, reason: 'Lớp trên cùng của JSON request body không phải plain object' };
    }
    return { ok: true, body, rawText };
}

/* Tạo kế hoạch thống nhất khi body không được hỗ trợ. */
function makeUnsupportedPlan(requestUrl, reason, descriptor = null, options = {}) {
    const summary = summarizeBodyDescriptor(descriptor);
    return {
        changed: false,
        decision: options.decision || 'unsupported-body',
        reason,
        url: requestUrl,
        body: null,
        bodyState: summary ? summary.state : '',
        bodyOrigin: summary ? summary.origin : '',
        unsupportedReason: summary ? summary.unsupportedReason : '',
        errorStage: options.errorStage || '',
        errorMessage: options.errorMessage || '',
    };
}

/* Phân tích body đã parse và xuất ra kế hoạch sửa đổi duy nhất; body dạng văn bản đồng thời tạo sẵn chuỗi thay thế. */
function planParsedBodyModification(body, requestUrl, options = {}) {
    const trackStats = options.trackStats !== false;
    const analysis = analyzeParsedBody(body, requestUrl, trackStats);
    const plan = {
        ...analysis,
        changed: false,
        url: requestUrl,
        body,
        rawText: options.rawText || null,
        bodyState: options.bodyState || '',
        bodyOrigin: options.bodyOrigin || '',
        replacementBody: null,
        fixedBodyText: null,
    };
    if (analysis.decision !== 'needs-fix') return plan;

    const fixedBody = buildFixedBody(body, analysis.target);
    let replacementBody = fixedBody;
    let fixedBodyText = null;
    if (options.bodyState === 'text') {
        fixedBodyText = JSON.stringify(fixedBody);
        replacementBody = fixedBodyText;
    }
    if (trackStats) requestPipelineStats.modifications++;
    return {
        ...plan,
        changed: true,
        decision: 'fixed',
        body: fixedBody,
        replacementBody,
        fixedBodyText,
    };
}

/* Tạo fetch init mới bằng body đã sửa, chỉ ghi đè body. */
function buildModifiedInit(init, bodyValue) {
    if (init && typeof init === 'object') {
        return { ...init, body: bodyValue };
    }
    return { body: bodyValue };
}

/* Phân tích và tạo tham số request đã sửa; mọi trường hợp không thể hoàn thành an toàn đều trả về changed:false */
async function buildModifiedFetchArgs(input, init) {
    lastBodyDescriptor = null;
    const requestUrl = getFetchRequestUrl(input);
    const method = getEffectiveMethod(input, init);

    if (!JSON_BODY_METHODS.has(method)) {
        return makeUnsupportedPlan(requestUrl, `method ${method} không phải là request ghi JSON`);
    }

    const contentType = getEffectiveContentType(input, init);
    if (!isJsonContentType(contentType)) {
        return makeUnsupportedPlan(requestUrl, `Content-Type ${contentType} không phải JSON`);
    }

    const descriptor = readFetchBodySource(input, init);
    lastBodyDescriptor = summarizeBodyDescriptor(descriptor);
    if (descriptor.state === 'none' || descriptor.state === 'unsupported') {
        return makeUnsupportedPlan(
            requestUrl,
            descriptor.state === 'none'
                ? 'Đầu vào không phải Request và không có body khả dụng'
                : `Kiểu body không được hỗ trợ: ${descriptor.unsupportedReason || 'unknown'}`,
            descriptor,
        );
    }

    const bodyRead = await materializeFetchBody(descriptor);
    if (!bodyRead.ok) {
        return makeUnsupportedPlan(requestUrl, bodyRead.reason, descriptor);
    }

    const plan = planParsedBodyModification(bodyRead.body, requestUrl, {
        rawText: bodyRead.rawText,
        bodyState: descriptor.state,
        bodyOrigin: descriptor.origin,
    });
    if (plan.changed) {
        plan.modifiedInit = buildModifiedInit(init, plan.replacementBody);
    }
    return plan;
}

/* Hàm kiểm tra thuần túy cho giao diện debug sử dụng, không gửi request */
function inspectRequestBody(bodyOrText, requestUrl) {
    let body;

    if (typeof bodyOrText === 'string') {
        try {
            body = JSON.parse(bodyOrText);
        } catch (error) {
            return {
                changed: false,
                decision: 'unsupported-body',
                reason: 'Request body không phải JSON hợp lệ',
                url: requestUrl || '',
                body: null,
            };
        }
    } else if (isPlainObject(bodyOrText)) {
        try {
            body = JSON.parse(JSON.stringify(bodyOrText));
        } catch (error) {
            return {
                changed: false,
                decision: 'unsupported-body',
                reason: 'Request body không thể sao chép',
                url: requestUrl || '',
                body: null,
            };
        }
    } else {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Request body không phải object hoặc chuỗi JSON',
            url: requestUrl || '',
            body: null,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Lớp trên cùng của JSON request body không phải plain object',
            url: requestUrl || '',
            body,
        };
    }

    return planParsedBodyModification(body, requestUrl || '', {
        bodyState: typeof bodyOrText === 'string' ? 'text' : 'structured-object',
        bodyOrigin: typeof bodyOrText === 'string' ? 'inspect-string' : 'inspect-object',
        trackStats: false,
    });
}

/* Tạo kết quả phán định tóm tắt có thể lưu và in ra an toàn */
function summarizeDecision(plan) {
    return {
        timestamp: Date.now(),
        url: plan.url || '',
        decision: plan.decision || 'unsupported-body',
        reason: plan.reason || '',
        model: plan.model || '',
        modelSource: plan.modelSource || '',
        matchedPattern: plan.matchedPattern || '',
        candidates: plan.candidates || [],
        matched: !!plan.matched,
        target: plan.target || null,
        lastRole: plan.lastRole || '',
        changed: !!plan.changed,
        bodyState: plan.bodyState || '',
        bodyOrigin: plan.bodyOrigin || '',
        unsupportedReason: plan.unsupportedReason || '',
        errorStage: plan.errorStage || '',
        error: plan.errorMessage || '',
    };
}

/* Ghi nhận và in ra kết quả phán định gần nhất */
function recordDecision(plan) {
    const summary = summarizeDecision(plan);
    lastDecision = summary;

    if (summary.decision === 'fixed') {
        logInfo('Đã bổ sung tin nhắn user ở cuối', summary);
        return;
    }
    if (summary.decision === 'modification-failed') {
        logError('Quy trình sửa đổi thất bại, gửi theo request gốc', summary);
        return;
    }
    if (summary.decision === 'ambiguous-payload') {
        logWarn('Request body có điểm mơ hồ, không sửa đổi', summary);
        return;
    }
    logDebug('Không sửa đổi request', summary);
}

/* ── Chặn Fetch request ───────────────── */

/* Tạo một hàm bọc fetch; cửa sổ chính và iframe cùng nguồn dùng chung một bộ logic */
function createFetchHook(realmWindow, getOriginalFetch) {
    /* Bật cờ trong lúc gọi fetch gốc: tránh hàm bọc bị chính mình chặn lại lần nữa gây đệ quy */
    let invokingOriginal = false;

    return async function hookedFetch(input, init) {
        const originalFetch = getOriginalFetch();

        if (!ENABLED) {
            return originalFetch.apply(realmWindow, [input, init]);
        }

        let method = 'GET';
        try {
            method = getEffectiveMethod(input, init);
        } catch (error) {
            return originalFetch.apply(realmWindow, [input, init]);
        }

        if (!JSON_BODY_METHODS.has(method)) {
            return originalFetch.apply(realmWindow, [input, init]);
        }

        if (invokingOriginal) {
            return originalFetch.apply(realmWindow, [input, init]);
        }

        let plan;
        try {
            plan = await buildModifiedFetchArgs(input, init);
        } catch (error) {
            plan = {
                changed: false,
                decision: 'modification-failed',
                reason: 'Phát sinh ngoại lệ trong giai đoạn sửa đổi của plugin',
                url: getFetchRequestUrl(input),
                errorStage: 'modify',
                errorMessage: error && error.message ? error.message : String(error),
            };
        }

        recordDecision(plan);

        if (!plan.changed) {
            return originalFetch.apply(realmWindow, [input, init]);
        }

        invokingOriginal = true;
        try {
            return originalFetch.apply(realmWindow, [input, plan.modifiedInit]);
        } catch (error) {
            logError('fetch sau khi sửa thất bại đồng bộ, quay về request gốc', error);
            return originalFetch.apply(realmWindow, [input, init]);
        } finally {
            invokingOriginal = false;
        }
    };
}

/* ── Chặn XHR request ─────────────────── */

/* Phân giải XHR URL thành địa chỉ tuyệt đối theo địa chỉ của chính realm đó */
function resolveRealmUrl(realmWindow, url) {
    const raw = (typeof url === 'string') ? url : (url != null ? String(url) : '');
    if (!raw) return '';
    try {
        const base = (realmWindow && realmWindow.location) ? realmWindow.location.href : undefined;
        return new URL(raw, base).toString();
    } catch (error) {
        return raw;
    }
}

/* Phân loại đồng bộ đối với XHR body; không đọc hoặc liệt kê nội dung nhị phân, form và stream. */
function readXhrBodySource(body) {
    if (body === undefined || body === null) {
        return makeBodyDescriptor('none', 'xhr-none', null);
    }
    if (typeof body === 'string') {
        if (body.length === 0) {
            return makeBodyDescriptor('unsupported', 'xhr-text', body, {
                unsupportedReason: 'empty-body',
            });
        }
        return makeBodyDescriptor('text', 'xhr-text', body, { hasRawText: true });
    }
    const unsupportedReason = getUnsupportedBodyReason(body);
    if (unsupportedReason) {
        return makeBodyDescriptor('unsupported', 'xhr-body', body, { unsupportedReason });
    }
    return makeBodyDescriptor('structured-object', 'xhr-object', body);
}

/* Tạo phương án sửa XHR request body đồng bộ; phương thức gửi là đồng bộ nên không thể dùng lại quy trình fetch bất đồng bộ.
   Điều kiện phán định đồng nhất với fetch, khi không thể sửa an toàn sẽ trả về changed:false. */
function planXhrBodyModification(requestUrl, method, bodyValue) {
    lastBodyDescriptor = null;
    if (!JSON_BODY_METHODS.has(method)) {
        return makeUnsupportedPlan(requestUrl, `method ${method} không phải là request ghi JSON`);
    }

    const descriptor = readXhrBodySource(bodyValue);
    lastBodyDescriptor = summarizeBodyDescriptor(descriptor);
    if (descriptor.state === 'none' || descriptor.state === 'unsupported') {
        return makeUnsupportedPlan(
            requestUrl,
            descriptor.state === 'none'
                ? 'Request không có body khả dụng'
                : `Kiểu body không được hỗ trợ: ${descriptor.unsupportedReason || 'unknown'}`,
            descriptor,
        );
    }

    let body;
    if (descriptor.state === 'text') {
        requestPipelineStats.jsonParses++;
        try {
            body = JSON.parse(descriptor.value);
        } catch (error) {
            return makeUnsupportedPlan(requestUrl, 'Request body không phải JSON hợp lệ', descriptor);
        }
        if (!isPlainObject(body)) {
            return makeUnsupportedPlan(requestUrl, 'Lớp trên cùng của JSON request body không phải plain object', descriptor);
        }
    } else {
        body = descriptor.value;
    }

    return planParsedBodyModification(body, requestUrl, {
        rawText: descriptor.state === 'text' ? descriptor.value : null,
        bodyState: descriptor.state,
        bodyOrigin: descriptor.origin,
    });
}

/* Cài đặt hàm bọc XHR cho từng realm: open ghi lại thông tin request, send phán định đồng bộ và thay thế body theo nhu cầu.
   Mỗi realm chỉ cài đặt một lần; cho phép bọc lại sau khi prototype bị thay thế, khi logic bảo vệ gặp ngoại lệ sẽ cho phép request gốc đi qua */
function installRealmXhrHook(realmWindow) {
    if (!realmWindow) return false;

    let proto = null;
    try {
        const ctor = realmWindow.XMLHttpRequest;
        proto = ctor && ctor.prototype;
    } catch (error) {
        return false;
    }
    if (!proto || typeof proto.open !== 'function' || typeof proto.send !== 'function') return false;

    const installed = hookedXhrProtos.get(realmWindow);
    if (installed && proto.open === installed.open && proto.send === installed.send) return true;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    const hookedOpen = function hookedXhrOpen(method, url) {
        try {
            xhrOpenMeta.set(this, {
                method: typeof method === 'string' ? method.toUpperCase() : 'GET',
                url: resolveRealmUrl(realmWindow, url),
            });
        } catch (error) {
            /* Bắt lỗi thất bại không ảnh hưởng đến lệnh gọi open gốc */
        }
        return originalOpen.apply(this, arguments);
    };

    const hookedSend = function hookedXhrSend(body) {
        if (!ENABLED) return originalSend.apply(this, arguments);

        /* Request body sau khi sửa; khi không sửa thì giữ nguyên tham số gốc để gửi thẳng */
        let replacementBody = null;
        let shouldReplaceBody = false;
        let meta = null;
        try {
            meta = xhrOpenMeta.get(this);
            if (meta && JSON_BODY_METHODS.has(meta.method)) {
                const plan = planXhrBodyModification(meta.url, meta.method, body);
                recordDecision(plan);
                if (plan.changed) {
                    replacementBody = plan.replacementBody;
                    shouldReplaceBody = true;
                }
            }
        } catch (error) {
            /* Ngoại lệ của bản thân logic bảo vệ: hủy sửa đổi, gửi nguyên bản (không gửi lặp lại) */
            recordDecision({
                changed: false,
                decision: 'modification-failed',
                reason: 'Phát sinh ngoại lệ trong giai đoạn sửa đổi của plugin',
                url: meta ? meta.url : '',
                errorStage: 'modify',
                errorMessage: error && error.message ? error.message : String(error),
            });
        }

        if (!shouldReplaceBody) return originalSend.apply(this, arguments);
        /* Văn bản dùng chuỗi đã sửa, plain object tiếp tục giữ dạng object; khi send gốc ném lỗi thì giữ nguyên ngoại lệ, không gửi lại */
        return originalSend.call(this, replacementBody);
    };

    try {
        proto.open = hookedOpen;
        proto.send = hookedSend;
    } catch (error) {
        return false;
    }
    hookedXhrProtos.set(realmWindow, { open: hookedOpen, send: hookedSend });
    return true;
}

/* Thống kê số realm đã cài đặt hàm bọc XHR (cửa sổ chính + iframe cùng nguồn, dùng cho giao diện debug) */
function countXhrHookedRealms() {
    let count = hookedXhrProtos.has(window) ? 1 : 0;
    document.querySelectorAll('iframe').forEach((frame) => {
        try {
            if (frame.contentWindow && hookedXhrProtos.has(frame.contentWindow)) count++;
        } catch (error) {
            /* Bỏ qua iframe khác nguồn */
        }
    });
    return count;
}

/* ── Cài đặt Hook ─────────────────────── */

/* Cài đặt chặn request trên cửa sổ chính (fetch + XHR): luôn cài đặt cả hai bộ bọc */
function installMainRequestHooks() {
    if (mainHookInstalled) return;

    if (typeof window.fetch === 'function') {
        const originalFetch = window.fetch;
        const hook = createFetchHook(window, () => originalFetch);
        window.fetch = hook;
        hookedFetchHooks.set(window, hook);
    } else {
        logWarn('fetch trên cửa sổ chính không khả dụng, tạm thời chưa cài đặt chặn fetch');
    }

    installRealmXhrHook(window);
    hookedWindows.add(window);
    mainHookInstalled = true;

    logInfo('Đã cài đặt chặn request trên cửa sổ chính (fetch + XHR)');
}

/* Cài đặt hàm bọc request (fetch + XHR) cho từng iframe cùng nguồn */
function hookIframeRequests(iframe) {
    if (!iframe) return false;

    if (!iframe.contentWindow) {
        if (!iframeLoadListenersAttached.has(iframe)) {
            iframeLoadListenersAttached.add(iframe);
            iframe.addEventListener('load', () => hookIframeRequests(iframe));
        }
        return false;
    }

    const iframeWindow = iframe.contentWindow;
    try {
        void iframeWindow.document;
    } catch (error) {
        logWarn('Không thể đọc iframe khác nguồn, đã bỏ qua', iframe.src || '');
        return false;
    }

    /* Bọc fetch: bỏ qua nếu đã cài và chưa bị thay thế, tránh phá hỏng chuỗi bọc của realm đó */
    let fetchReady = false;
    const existingHook = hookedFetchHooks.get(iframeWindow);
    if (existingHook && iframeWindow.fetch === existingHook) {
        fetchReady = true;
    } else if (typeof iframeWindow.fetch === 'function') {
        const originalFetch = iframeWindow.fetch;
        const hook = createFetchHook(iframeWindow, () => originalFetch);
        iframeWindow.fetch = hook;
        hookedFetchHooks.set(iframeWindow, hook);
        fetchReady = true;
    }

    /* Bọc XHR: cùng một realm chỉ cài một lần, bỏ qua nếu đã cài và chưa bị thay thế */
    const xhrReady = installRealmXhrHook(iframeWindow);
    if (!fetchReady && !xhrReady) return false;

    if (!hookedWindows.has(iframeWindow)) {
        hookedWindows.add(iframeWindow);
        iframeHookCount++;
    }

    if (!iframeLoadListenersAttached.has(iframe)) {
        iframeLoadListenersAttached.add(iframe);
        iframe.addEventListener('load', () => hookIframeRequests(iframe));
    }

    logInfo('Đã cài đặt chặn request trên iframe cùng nguồn (fetch + XHR)', iframe.src || iframe.id || '');
    return true;
}

/* Cài đặt hook request cho iframe (fetch + XHR): quét ban đầu + theo dõi động */
function installIframeRequestHooks() {
    if (iframeHooksInstalled) return;
    iframeHooksInstalled = true;

    let scannedCount = 0;
    let hookedCount = 0;
    for (const iframe of document.querySelectorAll('iframe')) {
        scannedCount++;
        if (hookIframeRequests(iframe)) hookedCount++;
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'IFRAME') {
                    hookIframeRequests(node);
                } else if (node.querySelectorAll) {
                    for (const inner of node.querySelectorAll('iframe')) {
                        hookIframeRequests(inner);
                    }
                }
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    logInfo(`Đã hoàn tất quét hook request trên iframe (fetch + XHR, ban đầu ${hookedCount}/${scannedCount})`);
}

/* ── Giao diện debug ──────────────────── */

window.__PrefillCompatFix = {
    inspect: inspectRequestBody,
    getLastDecision: () => lastDecision,
    getLastBodyDescriptor: () => (lastBodyDescriptor ? { ...lastBodyDescriptor } : null),
    getRequestPipelineStats: () => ({ ...requestPipelineStats }),
    resetRequestPipelineStats: () => {
        requestPipelineStats.requestReads = 0;
        requestPipelineStats.jsonParses = 0;
        requestPipelineStats.analyses = 0;
        requestPipelineStats.modifications = 0;
    },
    getModelList: () => ({
        effective: getEffectiveModelPatterns(),
        builtin: MODEL_PATTERNS.slice(),
        stored: getModelListStored(),
    }),
    /* Dùng cho kiểm thử: làm sạch văn bản "mỗi dòng một mục" theo quy trình chính thức và ghi vào cài đặt */
    applyModelListText: (text) => {
        const info = normalizeModelListInput(text);
        const saved = saveModelListSettings(info.lines);
        return { lines: info.lines, fixes: info.fixes, issues: info.issues, saved };
    },
    getHookCount: () => ({
        main: mainHookInstalled ? 1 : 0,
        iframes: iframeHookCount,
        xhr: countXhrHookedRealms(),
        total: (mainHookInstalled ? 1 : 0) + iframeHookCount,
    }),
};

/* ── Khởi tạo ─────────────────────────── */

/* Đọc context của ST; trả về null khi chưa sẵn sàng */
function getStContext() {
    try {
        if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') {
            return null;
        }
        return window.SillyTavern.getContext();
    } catch (error) {
        return null;
    }
}

/* Cài đặt toàn bộ hook (an toàn khi gọi lặp lại) */
function installAllHooks() {
    installMainRequestHooks();
    installIframeRequestHooks();
    installModelListLinkWithRetry();
    checkBuiltinListUpdateOnce();
    logStartupOnce();
}

/* Chèn liên kết cài đặt: giao diện ST hoặc thứ tự tải plugin có thể chậm hơn một chút, kèm thử lại + theo dõi dự phòng */
function installModelListLinkWithRetry() {
    if (installModelListLink()) return;

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (installModelListLink() || attempts >= 20) {
            clearInterval(timer);
        }
    }, 500);

    /* Khi vẫn chưa chèn được, dùng observer chờ hàng mục tiêu xuất hiện (ví dụ theme tùy chỉnh hoặc biến động DOM sau đó) */
    const observer = new MutationObserver(() => {
        if (installModelListLink()) {
            observer.disconnect();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* Chờ ST sẵn sàng (APP_READY) rồi mới cài đặt, cố gắng xếp sau các extension khác; khi đã bỏ lỡ sẽ dùng độ trễ dự phòng để cài đặt */
function scheduleHookInstall() {
    const context = getStContext();
    const eventSource = context && context.eventSource;
    const eventTypes = context && context.event_types;

    if (eventSource && eventTypes && eventTypes.APP_READY) {
        eventSource.once(eventTypes.APP_READY, () => {
            setTimeout(installAllHooks, 0);
        });
        setTimeout(installAllHooks, APP_READY_FALLBACK_MS);
        logInfo('Đang chờ APP_READY để cài đặt chặn request (fetch + XHR)');
        return;
    }

    setTimeout(installAllHooks, APP_READY_FALLBACK_MS);
    logInfo('Context của ST tạm thời chưa khả dụng, dùng thời điểm dự phòng để cài đặt chặn request (fetch + XHR)');
}

scheduleHookInstall();