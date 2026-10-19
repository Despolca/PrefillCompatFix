/* ============================================================
   Bản Vá Tương Thích Prefill (PrefillCompatFix) — Module logic chính (index.js)
   ============================================================ */

/* [Mục lục các khối] (Theo thứ tự từ trên xuống dưới của tệp)
   1. Tham số tùy chỉnh và hằng số      Danh sách model, nội dung giữ chỗ, thời điểm cài đặt
   2. Cài đặt danh sách model          Lưu trữ, hợp nhất, modal popup và chèn lối tắt của người dùng
   3. Biến trạng thái                  Trạng thái hook và kết quả phán đoán gần nhất
   4. Công cụ ghi log                  Chuẩn hóa tiền tố log và cấp độ log
   5. Công cụ cơ bản                   Các hàm thuần túy cho Request object, URL, Header, tên model
   6. Trích xuất tên model             Thu thập các ứng viên theo mức độ ưu tiên rõ ràng và trả về nguồn cuối cùng
   7. Lựa chọn mảng tin nhắn           Lựa chọn mục tiêu đơn lẻ giữa messages / contents
   8. Phân tích và sửa đổi request body Phán đoán thuần túy, nối thêm user, tạo modified init
   9. Chặn Request Fetch               Logic đóng gói dùng chung cho cửa sổ chính và iframe cùng nguồn
   10. Chặn Request XHR                Đóng gói open/send và phán đoán bù đắp đồng bộ
   11. Cài đặt Hook                    Cửa sổ chính, iframe cùng nguồn, iframe động (fetch + XHR)
   12. Giao diện Debug                 window.__PrefillCompatFix dùng cho kiểm thử và khắc phục sự cố
   13. Khởi tạo                        Chờ ST sẵn sàng rồi mới cài đặt
   ============================================================ */

/* ── Tham số tùy chỉnh và hằng số ───────────────────── */

const PLUGIN_KEY = 'PrefillCompatFix';
const PLUGIN_DISPLAY_NAME = 'Bản vá tương thích Prefill';
const ENABLED = true;                  /* Công tắc tổng: Phiên bản hiện tại mặc định bật */
const DEBUG_LOGS = false;              /* Có xuất log debug chi tiết hay không */
const PLACEHOLDER_TEXT = ' ';          /* Nội dung tin nhắn nối thêm: Bắt buộc phải là chuỗi không rỗng */
const APP_READY_FALLBACK_MS = 1200;    /* Độ trễ cài đặt dự phòng một lần khi đã bỏ lỡ APP_READY (ms) */
const JSON_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/* Danh sách bảo vệ mặc định: Tên model thực tế chứa bất kỳ mục cấu hình nào sẽ khớp, không phân biệt hoa thường.
   Modal cài đặt sẽ hợp nhất các bản ghi tùy chỉnh và xóa bỏ trên nền danh sách tích hợp sẵn để ra danh sách hiệu lực cuối cùng */
const MODEL_PATTERNS = [
    /* Google Gemini */
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-4-argon',

    /* Anthropic Claude: Bản 4.6 và các model sau đó */
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
];

/* ── Cài đặt danh sách model ─────────────────────── */

const MODEL_LIST_INPUT_ID = 'pcf-model-list-input';
const MODEL_LIST_MAX_LINES = 100;      /* Giới hạn số dòng danh sách, tránh việc dán nguyên đoạn dài làm tràn tệp cài đặt */
const MODEL_LIST_LINK_ID = 'pcf-model-list-link';
const MODEL_LIST_LINK_PUSH_ID = 'pcf-model-list-push';
/* Ký tự vô hình: Ký tự điều khiển + ký tự định dạng zero-width/bidirectional phổ biến; ký tự khoảng trắng được quy về dấu cách thông thường */
const INVISIBLE_CHAR_RE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u17B4-\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;
/* Khoảng trắng cần xử lý như dấu cách (xuống dòng và khoảng trắng toàn giác được xử lý riêng trước/sau khi tách) */
const SPACE_LIKE_RE = /[\t\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F]/g;

/* Đọc bản ghi tùy chỉnh và bản ghi xóa từ cài đặt ST; cấu hình bất thường coi như rỗng */
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

/* Danh sách hiệu lực = Danh sách tích hợp sẵn − Bản ghi đã xóa + Tùy chỉnh; lọc trùng không phân biệt hoa thường */
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

/* Tạo văn bản dùng cho modal cài đặt: Hiển thị danh sách đang có hiệu lực theo dạng mỗi dòng một mục */
function getModelListText() {
    return getEffectiveModelPatterns().join('\n');
}

/* Ghi kết quả đã làm sạch trở lại cài đặt ST; custom = mục không tích hợp sẵn, removed = mục tích hợp sẵn đã bị xóa */
function saveModelListSettings(lines) {
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

    context.extensionSettings[PLUGIN_KEY] = { custom, removed };
    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
    return true;
}

/* Làm sạch dữ liệu nhập của người dùng: Trả về { lines, fixes, issues }; khi issues không rỗng cần người dùng xác nhận */
function normalizeModelListInput(text) {
    const raw = typeof text === 'string' ? text : '';
    /* Xuống dòng quy về \n; các khoảng trắng Unicode khác chuyển thành dấu cách thông thường khi làm sạch từng dòng */
    const normalized = raw
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0085\u2028\u2029]/g, '\n');
    const rawLines = normalized.split('\n');

    /* Thống kê phân loại theo hành động làm sạch thực tế; cùng một dòng có thể tính vào nhiều loại (N biểu thị số mục liên quan) */
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

    if (fullWidthSpaceLines > 0) fixes.push(`Chuyển khoảng trắng toàn giác thành bán giác (${fullWidthSpaceLines})`);
    if (invisibleLines > 0) fixes.push(`Xóa ký tự vô hình (${invisibleLines})`);
    if (blankLines > 0) fixes.push(`Xóa dòng trống (${blankLines})`);
    if (trimLines > 0) fixes.push(`Xóa khoảng trắng ở đầu và cuối (${trimLines})`);
    if (collapseLines > 0) fixes.push(`Gộp các khoảng trắng liên tiếp trong dòng (${collapseLines})`);
    if (duplicates > 0) fixes.push(`Xóa các mục trùng lặp (${duplicates})`);
    if (specialChars > 0) issues.push(`Tồn tại ký tự toàn giác hoặc ký tự đặc biệt khác (${specialChars})`);

    /* Đã xóa khoảng trắng đầu cuối, mục nào sau khi làm sạch vẫn còn khoảng trắng mới tính là khoảng trắng nội bộ */
    const spaced = result.filter((line) => /\s/.test(line)).length;
    if (spaced > 0) issues.push(`Chứa khoảng trắng trong dòng, có thể không khớp chính xác (${spaced})`);
    if (separators > 0) issues.push(`Tồn tại dấu phân cách như dấu phẩy/chấm phẩy, vui lòng xác nhận xem tên model có cần tách ra không (${separators})`);

    return { lines: result, fixes, issues, tooMany: result.length > MODEL_LIST_MAX_LINES };
}

/* Căn trái danh sách trong popup và chữ của các mục, tránh việc dấu chấm đầu dòng bị lệch khi ST căn giữa mặc định.
   Chỉ xử lý chính danh sách, tiêu đề và phần giải thích vẫn giữ căn chỉnh mặc định của popup */
function applyPopupListAlign(list) {
    list.style.textAlign = 'left';
    list.querySelectorAll('li').forEach((li) => {
        li.style.textAlign = 'left';
    });
}

/* Nối thêm một nhóm danh sách vào nội dung modal; chỉ căn chỉnh chính danh sách, phần giải thích vẫn giữ căn giữa mặc định */
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

/* Xây dựng nội dung modal: Tiêu đề, hướng dẫn và ô nhập liệu danh sách có thể điều chỉnh độ cao */
function buildModelListDialogContent(initialText) {
    const content = document.createElement('div');
    content.className = 'flex-container flexFlowColumn height100p';

    const title = document.createElement('h3');
    title.className = 'margin0 flex-container flexFlowColumn textAlignCenter';
    title.textContent = PLUGIN_DISPLAY_NAME;

    const area = document.createElement('div');
    area.className = 'flex1 flex-container flexFlowColumn';

    const hint = document.createElement('h4');
    hint.className = 'margin0';
    hint.textContent = 'Danh sách model áp dụng (mỗi dòng một model, lưu để có hiệu lực, không cần làm mới)';

    const textarea = document.createElement('textarea');
    textarea.id = MODEL_LIST_INPUT_ID;
    textarea.className = 'text_pole';
    textarea.placeholder = 'Ví dụ:\ngemini-3.7-flash\ngemini-3.8-flash\ngemini-4-argon';
    textarea.spellcheck = false;
    textarea.value = initialText;
    /* Giữ độ cao mặc định tương đối lớn và khoảng trống phía dưới, cho phép người dùng kéo thả tùy chỉnh */
    textarea.style.height = '60vh';
    textarea.style.minHeight = '8em';
    textarea.style.maxHeight = '75vh';

    area.appendChild(hint);
    area.appendChild(textarea);
    content.appendChild(title);
    content.appendChild(area);
    return { content, textarea };
}

/* Xác thực danh sách và cảnh báo cho người dùng khi vượt quá giới hạn, danh sách trống hoặc có sự cố; trả về quyền lưu */
async function confirmModelListIssues(text) {
    const context = getStContext();
    if (!context) return false;

    const info = normalizeModelListInput(text);

    /* Vượt quá giới hạn dòng: Trực tiếp từ chối lưu */
    if (info.tooMany) {
        await context.callGenericPopup(
            'Số dòng vượt quá giới hạn tối đa, vui lòng cắt giảm bớt rồi thử lại.',
            context.POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Xác nhận', cancelButton: false },
        );
        return false;
    }

    /* Danh sách rỗng tương đương việc tắt bảo vệ toàn bộ model, cần xác nhận riêng trước khi lưu */
    if (info.lines.length === 0) {
        const emptyNotice = document.createElement('div');
        emptyNotice.append('Danh sách model đang trống, ');
        const emptyStrong = document.createElement('strong');
        emptyStrong.textContent = 'sẽ không còn tự động sửa lỗi cho bất kỳ model nào nữa';
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

    /* Đồng thời có sửa đổi tự động và vấn đề cần xác nhận thì gộp làm một lần xác nhận */
    if (hasFixes && hasIssues) {
        const wrap = document.createElement('div');
        const fixTitle = document.createElement('h4');
        fixTitle.className = 'margin0';
        fixTitle.textContent = 'Đã tự động sửa định dạng:';
        wrap.appendChild(fixTitle);
        appendPopupList(wrap, info.fixes);

        /* Khối khoảng cách tránh gập margin dưới của danh sách, giữ hai khu vực thông báo tách biệt */
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

    /* Chỉ có sửa đổi tự động thì hiển thị hộp thông tin, không cần xác nhận lại */
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

    /* Dùng DOM node để hiển thị text động, tránh tên model bị hiểu nhầm thành mã HTML */
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

/* Mở modal cài đặt và xử lý lưu, hủy cũng như khôi phục mặc định */
async function openModelListDialog() {
    const context = getStContext();
    if (!context || typeof context.callGenericPopup !== 'function' || !context.POPUP_TYPE) {
        logWarn('Không thể mở cài đặt danh sách model: Thành phần popup của ST không khả dụng');
        return;
    }

    const PopupClass = context.Popup
        || (window.SillyTavern && window.SillyTavern.libs && window.SillyTavern.libs.Popup);
    if (typeof PopupClass !== 'function') {
        logWarn('Không thể mở cài đặt danh sách model: Class Popup của ST không khả dụng');
        return;
    }

    const popupType = context.POPUP_TYPE;
    const resultTypes = context.POPUP_RESULT;
    /* Nội dung đã lưu; khôi phục về nó sau khi hủy hoặc xác thực thất bại */
    let savedText = getModelListText();
    let initialText = savedText;

    while (true) {
        const parts = buildModelListDialogContent(initialText);
        /* null: Đóng bình thường; restore: Khôi phục mặc định; cancel: Hủy hoặc từ chối xác nhận */
        let closingWithResult = null;
        /* Có đang chờ kiểm tra lưu hay không */
        let savePending = false;

        const popup = new PopupClass(parts.content, popupType.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            okButton: false,
            cancelButton: false,
            customButtons: [
                { text: 'Lưu', classes: ['popup-button-ok'], action: () => { savePending = true; popup.completeAffirmative(); } },
                { text: 'Hủy', classes: ['popup-button-cancel'], result: resultTypes.NEGATIVE, appendAtEnd: true },
                { text: 'Khôi phục mặc định', action: () => { void handleRestore(); }, appendAtEnd: true },
            ],
            onClosing: async (instance) => {
                /* Xác thực trước khi lưu; không đạt thì giữ popup và giữ nguyên nội dung nhập */
                if (savePending) {
                    const ok = await confirmModelListIssues(parts.textarea.value);
                    if (!ok) {
                        savePending = false;
                        return false;
                    }
                    closingWithResult = resultTypes.AFFIRMATIVE;
                }
                return true;
            },
        });

        const handleRestore = async () => {
            const ctx = getStContext() || context;
            const confirmed = await ctx.callGenericPopup(
                'Thao tác này sẽ xóa các mục tùy chỉnh và khôi phục lại danh sách tích hợp sẵn. Bạn có chắc chắn muốn khôi phục không?',
                popupType.CONFIRM,
                '',
                { okButton: 'Xác nhận', cancelButton: 'Hủy' },
            );
            if (confirmed !== resultTypes.AFFIRMATIVE) return;
            closingWithResult = 'restore';
            await popup.completeCancelled();
        };

        await popup.show();

        if (closingWithResult === 'restore') {
            /* Mở lại popup sau khi khôi phục mặc định, chờ người dùng xác nhận lưu */
            initialText = MODEL_PATTERNS.join('\n');
            continue;
        }

        if (closingWithResult === resultTypes.AFFIRMATIVE) {
            const info = normalizeModelListInput(parts.textarea.value);
            const saved = saveModelListSettings(info.lines);
            if (!saved) {
                logWarn('Lưu danh sách model thất bại: Giao diện cài đặt ST không khả dụng');
            }
            savedText = info.lines.join('\n');
            return;
        }

        return;
    }
}

/* Chèn lối tắt cài đặt vào bên phải mục "Xem API key" trong bảng API.
   Chỉ chèn phần tử của plugin này, và dùng thanh đẩy độ rộng 0 để duy trì bố cục căn đều hai đầu ban đầu của dòng */
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

    /* Thanh đẩy dùng margin tự động để tiếp tục đẩy "Xem API key" sang mép phải */
    if (!document.getElementById(MODEL_LIST_LINK_PUSH_ID)) {
        const push = document.createElement('span');
        push.id = MODEL_LIST_LINK_PUSH_ID;
        push.style.marginLeft = 'auto';
        viewSecrets.parentElement.insertBefore(push, viewSecrets);
    }

    viewSecrets.parentElement.insertBefore(link, viewSecrets.nextSibling);
    return true;
}

/* ── Biến trạng thái ─────────────────────────── */

/* Cửa sổ → Bộ đóng gói fetch đã cài đặt */
const hookedFetchHooks = new WeakMap();
/* Thể hiện XHR → Tham số open (đọc khi send, open lặp lại sẽ ghi đè) */
const xhrOpenMeta = new WeakMap();
/* Realm → Phương thức prototype XHR khi cài đặt, dùng phát hiện cài đặt trùng lặp hoặc prototype bị thay thế */
const hookedXhrProtos = new WeakMap();
/* Cửa sổ đã tính vào thống kê */
const hookedWindows = new WeakSet();
/* Iframe đã gắn bộ lắng nghe sự kiện load */
const iframeLoadListenersAttached = new WeakSet();

/* Hook cửa sổ chính (fetch + XHR) đã cài đặt hay chưa */
let mainHookInstalled = false;
/* Trình quét hook iframe (fetch + XHR) đã cài đặt hay chưa */
let iframeHooksInstalled = false;
/* Số lượng cửa sổ iframe đã cài đặt hook (dùng cho debug) */
let iframeHookCount = 0;
/* Kết quả phán đoán tóm tắt của request gần nhất */
let lastDecision = null;
/* Thông báo khởi động thành công đã xuất ra hay chưa */
let startupLogged = false;

/* ── Công cụ ghi log ─────────────────────────── */

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

/* Thông báo khởi động thành công: Bất kể công tắc DEBUG_LOGS bật hay tắt đều chỉ xuất một lần */
function logStartupOnce() {
    if (startupLogged) return;
    startupLogged = true;
    console.info(`[${PLUGIN_KEY}] Bản vá tương thích Prefill đã được tải`);
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

/* ── Công cụ cơ bản ─────────────────────────── */

/* Kiểm tra xem có phải là plain object hay không (không chứa mảng và null) */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/* Kiểm tra xem có phải đối tượng tương tự Request không: Khi qua realm thì instanceof không đáng tin, dùng duck typing */
function isRequestLike(input) {
    return !!input
        && typeof input === 'object'
        && typeof input.clone === 'function'
        && typeof input.text === 'function';
}

/* Lấy chuỗi URL tương ứng với đầu vào fetch */
function getFetchRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
        if (input instanceof URL) return input.toString();
    } catch (error) {
        /* Đối tượng URL xuyên realm có thể không trực tiếp instanceof được, bỏ qua */
    }
    return '';
}

/* Lấy đối tượng URL của request URL; thất bại trả về null */
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

/* Đọc giá trị trường trong Headers một cách an toàn */
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

/* Kiểm tra xem Content-Type có thể xử lý dưới dạng văn bản JSON hay không */
function isJsonContentType(contentType) {
    if (!contentType) return true;
    const lower = String(contentType).toLowerCase();
    return lower.includes('application/json') || lower.includes('+json');
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

/* Trả về mục cấu hình khớp đầu tiên; không khớp trả về chuỗi rỗng */
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

/* ── Trích xuất tên model ───────────────────────── */

/* Thu thập các ứng viên model xuất hiện trong request body và URL, giữ nguyên thứ tự ưu tiên */
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

/* Lấy tên model, nguồn và tất cả ứng viên được áp dụng cuối cùng */
function getModelInfo(body, requestUrl) {
    const candidates = collectModelCandidates(body, requestUrl);
    const primary = candidates.length > 0 ? candidates[0] : null;
    const uniqueValues = new Set(candidates.map(item => normalizeModelName(item.value)));

    if (uniqueValues.size > 1) {
        logWarn('Phát hiện nhiều model tiềm năng khác nhau, xử lý theo trường có độ ưu tiên cao nhất', candidates);
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

/* ── Lựa chọn mảng tin nhắn ─────────────────────── */

/* Kiểm tra xem có phải là mảng không rỗng hay không */
function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/* Lựa chọn mảng tin nhắn thực tế cần chỉnh sửa trong request lần này */
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
        return { target: null, reason: 'Trong body của request không có mảng messages hoặc contents khả dụng' };
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

    return { target: null, reason: 'Cả messages và contents cùng tồn tại, không thể xác định an toàn mảng nào thực sự được sử dụng' };
}

/* ── Phân tích và sửa đổi request body ─────────────────── */

/* Phân tích request body JSON đã parse, chỉ đưa ra phán đoán, không chỉnh sửa */
function analyzeParsedBody(body, requestUrl) {
    const modelInfo = getModelInfo(body, requestUrl);
    if (!modelInfo.matched) {
        return {
            ...modelInfo,
            decision: 'not-target-model',
            reason: 'Model không khớp với danh sách bảo vệ',
            target: null,
            lastRole: '',
            changed: false,
        };
    }

    const targetInfo = selectTargetArray(body, requestUrl);
    if (!targetInfo.target) {
        return {
            ...modelInfo,
            decision: targetInfo.reason.includes('không thể xác định an toàn') ? 'ambiguous-payload' : 'unsupported-body',
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
            reason: 'Phần tử cuối của mảng mục tiêu không phải là plain object có role dạng string',
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
            reason: 'Phần tử cuối đã là user',
            target: targetInfo.target,
            lastRole,
            changed: false,
        };
    }

    return {
        ...modelInfo,
        decision: 'needs-fix',
        reason: 'Khớp model mục tiêu và phần tử cuối không phải là user',
        target: targetInfo.target,
        lastRole,
        changed: false,
    };
}

/* Trả về request body mới sau khi nối thêm tin nhắn user chứa dấu cách đơn, không sửa đổi đối tượng truyền vào */
function buildFixedBody(body, target) {
    if (target === 'messages') {
        return {
            ...body,
            messages: [
                ...body.messages,
                { role: 'user', content: PLACEHOLDER_TEXT },
            ],
        };
    }

    return {
        ...body,
        contents: [
            ...body.contents,
            { role: 'user', parts: [{ text: PLACEHOLDER_TEXT }] },
        ],
    };
}

/* Đọc văn bản request body thực tế có hiệu lực của fetch lần này */
async function readEffectiveRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
        if (typeof init.body === 'string') {
            return { ok: true, text: init.body, source: 'init.body' };
        }
        return { ok: false, reason: 'init.body không phải là chuỗi' };
    }

    if (!isRequestLike(input)) {
        return { ok: false, reason: 'Đầu vào không phải là Request và init.body không khả dụng' };
    }

    try {
        const clonedRequest = input.clone();
        const text = await clonedRequest.text();
        return { ok: true, text, source: 'request.body' };
    } catch (error) {
        return { ok: false, reason: 'Không thể clone hoặc đọc body của Request' };
    }
}

/* Dùng văn bản sau khi sửa để tạo fetch init mới, chỉ ghi đè trường body */
function buildModifiedInit(init, bodyText) {
    if (init && typeof init === 'object') {
        return { ...init, body: bodyText };
    }
    return { body: bodyText };
}

/* Phân tích và tạo tham số request sau khi chỉnh sửa; bất kỳ trường hợp nào không thể hoàn thành an toàn đều trả về changed:false */
async function buildModifiedFetchArgs(input, init) {
    const requestUrl = getFetchRequestUrl(input);
    const method = getEffectiveMethod(input, init);

    if (!JSON_BODY_METHODS.has(method)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: `method ${method} không phải là request ghi JSON`,
            url: requestUrl,
        };
    }

    const contentType = getEffectiveContentType(input, init);
    if (!isJsonContentType(contentType)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: `Content-Type ${contentType} không phải là JSON`,
            url: requestUrl,
        };
    }

    const bodyRead = await readEffectiveRequestBody(input, init);
    if (!bodyRead.ok) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: bodyRead.reason,
            url: requestUrl,
        };
    }

    let body;
    try {
        body = JSON.parse(bodyRead.text);
    } catch (error) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Body của request không phải là JSON hợp lệ',
            url: requestUrl,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Tầng cao nhất của JSON request body không phải là plain object',
            url: requestUrl,
        };
    }

    const analysis = analyzeParsedBody(body, requestUrl);
    if (analysis.decision !== 'needs-fix') {
        return {
            ...analysis,
            changed: false,
            url: requestUrl,
            body,
        };
    }

    const fixedBody = buildFixedBody(body, analysis.target);
    const fixedBodyText = JSON.stringify(fixedBody);

    return {
        ...analysis,
        changed: true,
        decision: 'fixed',
        url: requestUrl,
        body: fixedBody,
        modifiedInit: buildModifiedInit(init, fixedBodyText),
    };
}

/* Hàm kiểm tra thuần túy dành cho interface debug, không gửi request đi */
function inspectRequestBody(bodyOrText, requestUrl) {
    let body;

    if (typeof bodyOrText === 'string') {
        try {
            body = JSON.parse(bodyOrText);
        } catch (error) {
            return {
                changed: false,
                decision: 'unsupported-body',
                reason: 'Body của request không phải là JSON hợp lệ',
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
                reason: 'Không thể sao chép request body',
                url: requestUrl || '',
                body: null,
            };
        }
    } else {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Request body không phải là object hoặc chuỗi JSON',
            url: requestUrl || '',
            body: null,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Tầng cao nhất của JSON request body không phải là plain object',
            url: requestUrl || '',
            body,
        };
    }

    const analysis = analyzeParsedBody(body, requestUrl || '');
    if (analysis.decision !== 'needs-fix') {
        return { ...analysis, url: requestUrl || '', body };
    }

    const fixedBody = buildFixedBody(body, analysis.target);
    return {
        ...analysis,
        changed: true,
        decision: 'fixed',
        url: requestUrl || '',
        body: fixedBody,
    };
}

/* Tạo kết quả phán đoán tóm tắt có thể lưu trữ và in ra an toàn */
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
        errorStage: plan.errorStage || '',
        error: plan.errorMessage || '',
    };
}

/* Ghi lại và in ra kết quả phán đoán gần nhất */
function recordDecision(plan) {
    const summary = summarizeDecision(plan);
    lastDecision = summary;

    if (summary.decision === 'fixed') {
        logInfo('Đã bổ sung tin nhắn user ở cuối', summary);
        return;
    }
    if (summary.decision === 'modification-failed') {
        logError('Quy trình chỉnh sửa thất bại, gửi theo request gốc', summary);
        return;
    }
    if (summary.decision === 'ambiguous-payload') {
        logWarn('Request body có sự không rõ ràng/nhập nhằng, chưa chỉnh sửa', summary);
        return;
    }
    logDebug('Không chỉnh sửa request', summary);
}

/* ── Chặn Request Fetch ───────────────────── */

/* Tạo bộ bọc fetch; cửa sổ chính và iframe cùng nguồn dùng chung bộ logic này */
function createFetchHook(realmWindow, getOriginalFetch) {
    /* Đặt cờ trong thời gian gọi fetch gốc: Tránh việc wrapper tự chặn lại chính nó gây đệ quy vô hạn */
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
                reason: 'Phát sinh ngoại lệ trong giai đoạn chỉnh sửa của plugin',
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
            logError('Fetch sau khi sửa đồng bộ thất bại, hoàn tác về request gốc', error);
            return originalFetch.apply(realmWindow, [input, init]);
        } finally {
            invokingOriginal = false;
        }
    };
}

/* ── Chặn Request XHR ─────────────────────── */

/* Phân giải XHR URL thành địa chỉ tuyệt đối dựa trên địa chỉ của chính realm đó */
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

/* Lên kế hoạch sửa đổi request body của XHR một cách đồng bộ; phương thức send là đồng bộ nên không thể tái sử dụng quy trình fetch bất đồng bộ.
   Điều kiện phán đoán tương đồng với fetch, khi không thể sửa đổi an toàn sẽ trả về changed:false */
function planXhrBodyModification(requestUrl, method, bodyText) {
    if (!JSON_BODY_METHODS.has(method)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: `method ${method} không phải là request ghi JSON`,
            url: requestUrl,
        };
    }

    let body;
    try {
        body = JSON.parse(bodyText);
    } catch (error) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Body của request không phải là JSON hợp lệ',
            url: requestUrl,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Tầng cao nhất của JSON request body không phải là plain object',
            url: requestUrl,
        };
    }

    const analysis = analyzeParsedBody(body, requestUrl);
    if (analysis.decision !== 'needs-fix') {
        return { ...analysis, changed: false, url: requestUrl, body };
    }

    const fixedBody = buildFixedBody(body, analysis.target);
    return {
        ...analysis,
        changed: true,
        decision: 'fixed',
        url: requestUrl,
        body: fixedBody,
        fixedBodyText: JSON.stringify(fixedBody),
    };
}

/* Cài đặt bộ bọc XHR cho một realm đơn lẻ: open ghi nhận thông tin request, send phán đoán đồng bộ và thay thế body khi cần.
   Mỗi realm chỉ cài đặt một lần; cho phép đóng gói lại sau khi prototype bị thay thế, logic bảo vệ lỗi sẽ cho phép request gốc đi qua */
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

        /* Nội dung request khi cần chỉnh sửa; null biểu thị gửi theo tham số gốc */
        let modifiedBodyText = null;
        let meta = null;
        try {
            meta = xhrOpenMeta.get(this);
            /* Chỉ xử lý body dạng chuỗi: Blob, FormData, ArrayBuffer không thể viết lại an toàn, cho phép gửi nguyên bản */
            if (typeof body === 'string' && body && meta && JSON_BODY_METHODS.has(meta.method)) {
                const plan = planXhrBodyModification(meta.url, meta.method, body);
                recordDecision(plan);
                if (plan.changed) modifiedBodyText = plan.fixedBodyText;
            }
        } catch (error) {
            /* Ngoại lệ bên trong logic bảo vệ: Hủy chỉnh sửa, gửi nguyên gốc (không gửi lặp lại) */
            recordDecision({
                changed: false,
                decision: 'modification-failed',
                reason: 'Phát sinh ngoại lệ trong giai đoạn chỉnh sửa của plugin',
                url: meta ? meta.url : '',
                errorStage: 'modify',
                errorMessage: error && error.message ? error.message : String(error),
            });
        }

        if (modifiedBodyText === null) return originalSend.apply(this, arguments);
        /* Sử dụng văn bản đã sửa để gửi; khi send gốc ném ra ngoại lệ thì giữ nguyên ngoại lệ gốc, không gửi lại */
        return originalSend.call(this, modifiedBodyText);
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

/* Thống kê số lượng realm đã cài đặt bộ bọc XHR (cửa sổ chính + iframe cùng nguồn, dùng cho giao diện debug) */
function countXhrHookedRealms() {
    let count = hookedXhrProtos.has(window) ? 1 : 0;
    document.querySelectorAll('iframe').forEach((frame) => {
        try {
            if (frame.contentWindow && hookedXhrProtos.has(frame.contentWindow)) count++;
        } catch (error) {
            /* Bỏ qua iframe khác domain (cross-origin) */
        }
    });
    return count;
}

/* ── Cài đặt Hook ────────────────────────── */

/* Cài đặt bộ chặn request cho cửa sổ chính (fetch + XHR): Cả hai bộ bọc luôn được cài đặt */
function installMainRequestHooks() {
    if (mainHookInstalled) return;

    if (typeof window.fetch === 'function') {
        const originalFetch = window.fetch;
        const hook = createFetchHook(window, () => originalFetch);
        window.fetch = hook;
        hookedFetchHooks.set(window, hook);
    } else {
        logWarn('Fetch của cửa sổ chính không khả dụng, tạm thời chưa cài đặt chặn fetch');
    }

    installRealmXhrHook(window);
    hookedWindows.add(window);
    mainHookInstalled = true;

    logInfo('Đã cài đặt chặn request cho cửa sổ chính (fetch + XHR)');
}

/* Cài đặt bộ bọc request cho một iframe cùng nguồn đơn lẻ (fetch + XHR) */
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
        logWarn('Không thể đọc iframe khác domain (cross-origin), đã bỏ qua', iframe.src || '');
        return false;
    }

    /* Bộ bọc fetch: Nếu đã cài và chưa bị thay thế thì bỏ qua, tránh phá vỡ chuỗi bọc của realm đó */
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

    /* Bộ bọc XHR: Cùng một realm chỉ cài một lần, nếu đã cài và chưa bị thay thế thì bỏ qua */
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

    logInfo('Đã cài đặt chặn request cho iframe cùng nguồn (fetch + XHR)', iframe.src || iframe.id || '');
    return true;
}

/* Cài đặt hook request cho iframe (fetch + XHR): Quét ban đầu + Lắng nghe động */
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

    logInfo(`Quét hook request iframe hoàn tất (fetch + XHR, ban đầu ${hookedCount}/${scannedCount} iframe)`);
}

/* ── Giao diện Debug ─────────────────────────── */

window.__PrefillCompatFix = {
    inspect: inspectRequestBody,
    getLastDecision: () => lastDecision,
    getModelList: () => ({
        effective: getEffectiveModelPatterns(),
        builtin: MODEL_PATTERNS.slice(),
        stored: getModelListStored(),
    }),
    /* Dùng cho kiểm thử: Làm sạch đoạn text "mỗi dòng một mục" theo quy trình chuẩn và ghi vào cài đặt */
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

/* ── Khởi tạo ───────────────────────────── */

/* Đọc ST context; khi chưa sẵn sàng sẽ trả về null */
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
    logStartupOnce();
}

/* Chèn link cài đặt: Giao diện ST hoặc thứ tự tải extension có thể hơi muộn, đi kèm thử lại + quan sát dự phòng */
function installModelListLinkWithRetry() {
    if (installModelListLink()) return;

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (installModelListLink() || attempts >= 20) {
            clearInterval(timer);
        }
    }, 500);

    /* Nếu vẫn chưa chèn được, dùng observer đợi dòng mục tiêu xuất hiện (ví dụ: theme tùy chỉnh hoặc thay đổi DOM sau đó) */
    const observer = new MutationObserver(() => {
        if (installModelListLink()) {
            observer.disconnect();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* Đợi ST sẵn sàng (APP_READY) rồi mới cài đặt, cố gắng xếp sau các extension khác; nếu đã bỏ lỡ thì dùng độ trễ dự phòng để cài */
function scheduleHookInstall() {
    const context = getStContext();
    const eventSource = context && context.eventSource;
    const eventTypes = context && context.event_types;

    if (eventSource && eventTypes && eventTypes.APP_READY) {
        eventSource.once(eventTypes.APP_READY, () => {
            setTimeout(installAllHooks, 0);
        });
        setTimeout(installAllHooks, APP_READY_FALLBACK_MS);
        logInfo('Chờ APP_READY rồi mới cài đặt chặn request (fetch + XHR)');
        return;
    }

    setTimeout(installAllHooks, APP_READY_FALLBACK_MS);
    logInfo('Context của ST tạm thời chưa khả dụng, sử dụng thời điểm dự phòng để cài đặt chặn request (fetch + XHR)');
}

scheduleHookInstall();