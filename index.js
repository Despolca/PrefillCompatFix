/* ============================================================
   Bản vá tương thích Prefill (PrefillCompatFix) — Module logic chính (index.js)
   ============================================================ */

/* 【Chỉ mục khối】 (Theo thứ tự từ trên xuống dưới của file)
   1. Tham số có thể điều chỉnh & Hằng số    Danh sách mô hình, Nội dung giữ chỗ, Thời điểm cài đặt
   2. Biến trạng thái                        Trạng thái hook và kết quả phán đoán gần nhất
   3. Công cụ log                            Tiền tố log và cấp độ thống nhất
   4. Công cụ cơ bản                         Đối tượng Request, URL, Header, tên mô hình (Hàm thuần túy)
   5. Trích xuất tên mô hình                 Thu thập ứng viên theo mức độ ưu tiên rõ ràng và trả về nguồn cuối cùng
   6. Chọn mảng tin nhắn                     Chọn mục tiêu đơn lẻ giữa messages / contents
   7. Phân tích & Sửa đổi Body               Chỉ phán đoán, thêm user, tạo init đã sửa đổi
   8. Chặn Fetch Request                     Logic bọc (wrapper) dùng chung cho cửa sổ chính và iframe cùng nguồn
   9. Chặn XHR Request                       Bọc open/send và phán đoán bổ sung đồng bộ
   10. Cài đặt Hook                          Cửa sổ chính, iframe cùng nguồn, iframe động (fetch + XHR)
   11. Giao diện debug                       window.__PrefillCompatFix dùng để test và khắc phục sự cố
   12. Khởi tạo                              Chờ ST sẵn sàng rồi mới cài đặt
   ============================================================ */

/* ── Tham số có thể điều chỉnh & Hằng số ───────────────────── */

const PLUGIN_KEY = 'PrefillCompatFix';
const ENABLED = true;                  /* Công tắc tổng: Phiên bản hiện tại mặc định bật */
const DEBUG_LOGS = false;              /* Có xuất log debug chi tiết hay không */
const PLACEHOLDER_TEXT = ' ';          /* Nội dung tin nhắn thêm vào: Phải là chuỗi khác rỗng */
const APP_READY_FALLBACK_MS = 1200;    /* Độ trễ cài đặt dự phòng (ms) khi đã bỏ lỡ APP_READY */
const JSON_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/* Danh sách bảo vệ mặc định: Tên mô hình thực tế chứa bất kỳ cấu hình nào đều sẽ trúng; Không phân biệt chữ hoa chữ thường */
const MODEL_PATTERNS = [
    /* Google Gemini: Các mô hình bị giới hạn prefill chính thức */
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',

    /* Anthropic Claude: 4.6 và các mô hình mới hơn */
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

/* ── Biến trạng thái ─────────────────────────── */

/* WeakMap<Window, Function>: Cửa sổ đã cài đặt bọc (wrapper) → Hàm bọc */
const hookedFetchHooks = new WeakMap();
/* WeakMap<XMLHttpRequest, {method, url}>: Tham số open của instance XHR (Đọc khi send; Ghi đè nếu open lặp lại) */
const xhrOpenMeta = new WeakMap();
/* WeakMap<Window, {open, send}>: realm (Cửa sổ chính + iframe cùng nguồn) đã cài đặt bọc XHR → Phương thức prototype khi cài đặt,
   Mục đích giống như hookedFetchHooks: Chống bọc lặp lại trên cùng một realm; Bọc lại khi iframe reload hoặc prototype bị thay thế */
const hookedXhrProtos = new WeakMap();
/* WeakSet<Window>: Các cửa sổ đã được đưa vào thống kê, tránh đếm trùng một cửa sổ */
const hookedWindows = new WeakSet();
/* WeakSet<HTMLIFrameElement>: Các iframe đã gắn listener load, tránh bind trùng lặp */
const iframeLoadListenersAttached = new WeakSet();

/* boolean: Hook cửa sổ chính (fetch + XHR) đã được cài đặt chưa */
let mainHookInstalled = false;
/* boolean: Trình quét hook iframe (fetch + XHR) đã được cài đặt chưa */
let iframeHooksInstalled = false;
/* number: Số lượng cửa sổ iframe đã được cài đặt hook (dùng để debug) */
let iframeHookCount = 0;
/* object|null: Kết quả phán đoán tóm tắt của request gần nhất */
let lastDecision = null;
/* boolean: Đã xuất thông báo khởi động thành công chưa */
let startupLogged = false;

/* ── Công cụ log ─────────────────────────── */

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

/* Thông báo khởi động thành công: Chỉ xuất một lần bất kể trạng thái của DEBUG_LOGS */
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

/* Kiểm tra xem có phải là đối tượng thông thường không (Loại trừ mảng và null) */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/* Kiểm tra xem có phải là đối tượng giống Request không: instanceof không đáng tin cậy khi vượt ranh giới realm, sử dụng duck typing */
function isRequestLike(input) {
    return !!input
        && typeof input === 'object'
        && typeof input.clone === 'function'
        && typeof input.text === 'function';
}

/* Lấy chuỗi URL tương ứng với input của fetch */
function getFetchRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
        if (input instanceof URL) return input.toString();
    } catch (error) {
        /* Đối tượng URL vượt ranh giới realm có thể không thể instanceof trực tiếp, bỏ qua */
    }
    return '';
}

/* Lấy đối tượng URL của URL request; Trả về null nếu thất bại */
function getRequestUrlObject(requestUrl) {
    if (!requestUrl) return null;
    try {
        return new URL(requestUrl, window.location.href);
    } catch (error) {
        return null;
    }
}

/* Lấy pathname của URL; Trả về chuỗi rỗng nếu thất bại */
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

/* Lấy method thực sự có hiệu lực của lần fetch này */
function getEffectiveMethod(input, init) {
    if (init && typeof init.method === 'string' && init.method) {
        return init.method.toUpperCase();
    }
    if (isRequestLike(input) && typeof input.method === 'string' && input.method) {
        return input.method.toUpperCase();
    }
    return 'GET';
}

/* Lấy Content-Type thực sự có hiệu lực của lần fetch này */
function getEffectiveContentType(input, init) {
    if (init && init.headers !== undefined && init.headers !== null) {
        return getHeaderValue(init.headers, 'content-type');
    }
    if (isRequestLike(input)) {
        return getHeaderValue(input.headers, 'content-type');
    }
    return null;
}

/* Kiểm tra xem Content-Type có thể được xử lý như văn bản JSON hay không */
function isJsonContentType(contentType) {
    if (!contentType) return true;
    const lower = String(contentType).toLowerCase();
    return lower.includes('application/json') || lower.includes('+json');
}

/* Giải mã an toàn phân đoạn URL */
function safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return '';
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

/* Chuẩn hóa tên mô hình */
function normalizeModelName(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/* Chuẩn hóa role của tin nhắn */
function normalizeRole(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/* Trả về mục cấu hình trúng đầu tiên; Trả về chuỗi rỗng nếu không trúng */
function findMatchedModelPattern(modelName) {
    const normalizedModel = normalizeModelName(modelName);
    if (!normalizedModel) return '';

    for (const pattern of MODEL_PATTERNS) {
        const normalizedPattern = normalizeModelName(pattern);
        if (!normalizedPattern) continue;
        if (normalizedModel.includes(normalizedPattern)) return normalizedPattern;
    }

    return '';
}

/* ── Trích xuất tên mô hình ───────────────────────── */

/* Thu thập các ứng viên mô hình xuất hiện trong request body và URL, duy trì thứ tự ưu tiên */
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

/* Lấy tên mô hình cuối cùng được sử dụng, nguồn và tất cả các ứng viên */
function getModelInfo(body, requestUrl) {
    const candidates = collectModelCandidates(body, requestUrl);
    const primary = candidates.length > 0 ? candidates[0] : null;
    const uniqueValues = new Set(candidates.map(item => normalizeModelName(item.value)));

    if (uniqueValues.size > 1) {
        logWarn('Phát hiện nhiều ứng viên mô hình khác nhau, xử lý theo trường có mức độ ưu tiên cao nhất', candidates);
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

/* ── Chọn mảng tin nhắn ─────────────────────── */

/* Kiểm tra xem có phải là mảng khác rỗng không */
function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/* Chọn mảng tin nhắn thực sự cần sửa đổi trong request lần này */
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

    return { target: null, reason: 'Cả messages và contents đều tồn tại, không thể phán đoán an toàn mảng thực sự được sử dụng' };
}

/* ── Phân tích & Sửa đổi Body ─────────────────── */

/* Phân tích request body JSON đã parse, chỉ phán đoán, không sửa đổi */
function analyzeParsedBody(body, requestUrl) {
    const modelInfo = getModelInfo(body, requestUrl);
    if (!modelInfo.matched) {
        return {
            ...modelInfo,
            decision: 'not-target-model',
            reason: 'Mô hình không trúng danh sách bảo vệ',
            target: null,
            lastRole: '',
            changed: false,
        };
    }

    const targetInfo = selectTargetArray(body, requestUrl);
    if (!targetInfo.target) {
        return {
            ...modelInfo,
            decision: targetInfo.reason.includes('không thể phán đoán an toàn') ? 'ambiguous-payload' : 'unsupported-body',
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
            reason: 'Mục cuối của mảng mục tiêu không phải là đối tượng thông thường có chứa chuỗi role',
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
            reason: 'Mục cuối đã là user',
            target: targetInfo.target,
            lastRole,
            changed: false,
        };
    }

    return {
        ...modelInfo,
        decision: 'needs-fix',
        reason: 'Trúng mô hình mục tiêu và mục cuối không phải là user',
        target: targetInfo.target,
        lastRole,
        changed: false,
    };
}

/* Trả về request body mới sau khi đã thêm tin nhắn user có một dấu cách, không sửa đổi đối tượng truyền vào */
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

/* Đọc văn bản request body thực sự có hiệu lực của lần fetch này */
async function readEffectiveRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
        if (typeof init.body === 'string') {
            return { ok: true, text: init.body, source: 'init.body' };
        }
        return { ok: false, reason: 'init.body không phải là chuỗi' };
    }

    if (!isRequestLike(input)) {
        return { ok: false, reason: 'Input không phải là Request và init.body không khả dụng' };
    }

    try {
        const clonedRequest = input.clone();
        const text = await clonedRequest.text();
        return { ok: true, text, source: 'request.body' };
    } catch (error) {
        return { ok: false, reason: 'Không thể clone hoặc đọc Request body' };
    }
}

/* Tạo fetch init mới bằng văn bản đã sửa đổi, chỉ ghi đè body */
function buildModifiedInit(init, bodyText) {
    if (init && typeof init === 'object') {
        return { ...init, body: bodyText };
    }
    return { body: bodyText };
}

/* Phân tích và tạo tham số request đã sửa đổi; Trả về changed:false cho bất kỳ tình huống nào không thể hoàn thành an toàn */
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
            reason: 'Request body không phải là JSON hợp lệ',
            url: requestUrl,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Cấp cao nhất của request body JSON không phải là đối tượng thông thường',
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

/* Hàm kiểm tra thuần túy dùng cho giao diện debug, không gửi request */
function inspectRequestBody(bodyOrText, requestUrl) {
    let body;

    if (typeof bodyOrText === 'string') {
        try {
            body = JSON.parse(bodyOrText);
        } catch (error) {
            return {
                changed: false,
                decision: 'unsupported-body',
                reason: 'Request body không phải là JSON hợp lệ',
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
            reason: 'Request body không phải là đối tượng hoặc chuỗi JSON',
            url: requestUrl || '',
            body: null,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Cấp cao nhất của request body JSON không phải là đối tượng thông thường',
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

/* Tạo kết quả phán đoán tóm tắt có thể lưu và in an toàn */
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

/* Ghi lại và in kết quả phán đoán gần nhất */
function recordDecision(plan) {
    const summary = summarizeDecision(plan);
    lastDecision = summary;

    if (summary.decision === 'fixed') {
        logInfo('Đã bổ sung tin nhắn user vào cuối', summary);
        return;
    }
    if (summary.decision === 'modification-failed') {
        logError('Quy trình sửa đổi thất bại, gửi theo request gốc', summary);
        return;
    }
    if (summary.decision === 'ambiguous-payload') {
        logWarn('Request body có sự mơ hồ, không sửa đổi', summary);
        return;
    }
    logDebug('Chưa sửa đổi request', summary);
}

/* ── Chặn Fetch Request ───────────────────── */

/* Tạo một wrapper fetch; Cửa sổ chính và iframe cùng nguồn dùng chung một logic */
function createFetchHook(realmWindow, getOriginalFetch) {
    /* Đặt cờ trong quá trình gọi fetch gốc: Tránh việc wrapper bị chính nó chặn lại dẫn đến đệ quy */
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
                reason: 'Đã xảy ra ngoại lệ trong giai đoạn sửa đổi của plugin',
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
            logError('Fetch đồng bộ sau khi sửa đổi thất bại, quay lui về request gốc', error);
            return originalFetch.apply(realmWindow, [input, init]);
        } finally {
            invokingOriginal = false;
        }
    };
}

/* ── Chặn XHR Request ─────────────────────── */

/* Phân tích địa chỉ nhận được từ open thành địa chỉ tuyệt đối theo location của chính realm đó (location của cửa sổ chính và iframe khác nhau) */
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

/* Phán đoán đồng bộ một lần xem request body của XHR có cần bổ sung hay không (send là đồng bộ, không thể đi theo quy trình fetch async).
   Tiêu chí giống với fetch, không phải cứ "có thể parse thành JSON" là sửa: Phương thức ghi + URL mục tiêu + Cấu trúc request body + Trúng danh sách mô hình;
   Nếu không thỏa mãn bất kỳ bước nào thì trả về changed:false, giữ nguyên request gốc. */
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
            reason: 'Request body không phải là JSON hợp lệ',
            url: requestUrl,
        };
    }

    if (!isPlainObject(body)) {
        return {
            changed: false,
            decision: 'unsupported-body',
            reason: 'Cấp cao nhất của request body JSON không phải là đối tượng thông thường',
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

/* Cài đặt wrapper XHR cho một realm duy nhất (Cửa sổ chính và iframe cùng nguồn dùng chung): open ghi lại phương thức và địa chỉ (Địa chỉ tương đối được phân tích thành tuyệt đối theo
   location của chính realm đó); send phán đoán đồng bộ bên trong, nếu cần bổ sung thì dùng văn bản đã sửa gọi send gốc, ngược lại giữ nguyên tham số gốc.
   Cùng một realm chỉ cài đặt một lần: Đã cài đặt và phương thức prototype chưa bị thay thế thì bỏ qua; Bọc lại khi iframe reload hoặc script bên trong thay thế prototype.
   Gửi theo request gốc khi bản thân logic bảo vệ có ngoại lệ; Giữ nguyên hành vi ngoại lệ gốc, không gửi lại khi bản thân send gốc ném lỗi. */
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
            /* Catch thất bại không ảnh hưởng đến việc gọi open gốc */
        }
        return originalOpen.apply(this, arguments);
    };

    const hookedSend = function hookedXhrSend(body) {
        if (!ENABLED) return originalSend.apply(this, arguments);

        /* string|null: Văn bản request sau khi thay thế khi cần bổ sung; Giữ null nghĩa là gửi theo tham số gốc */
        let modifiedBodyText = null;
        let meta = null;
        try {
            meta = xhrOpenMeta.get(this);
            /* Chỉ xử lý body chuỗi: Blob, FormData, ArrayBuffer, v.v. không thể ghi lại an toàn, cho qua nguyên trạng */
            if (typeof body === 'string' && body && meta && JSON_BODY_METHODS.has(meta.method)) {
                const plan = planXhrBodyModification(meta.url, meta.method, body);
                recordDecision(plan);
                if (plan.changed) modifiedBodyText = plan.fixedBodyText;
            }
        } catch (error) {
            /* Bản thân logic bảo vệ có ngoại lệ: Từ bỏ sửa đổi, gửi nguyên trạng (không gửi lại lặp lại) */
            recordDecision({
                changed: false,
                decision: 'modification-failed',
                reason: 'Đã xảy ra ngoại lệ trong giai đoạn sửa đổi của plugin',
                url: meta ? meta.url : '',
                errorStage: 'modify',
                errorMessage: error && error.message ? error.message : String(error),
            });
        }

        if (modifiedBodyText === null) return originalSend.apply(this, arguments);
        /* Gửi bằng văn bản đã sửa; Giữ nguyên hành vi ngoại lệ gốc, không gửi lại khi bản thân send gốc ném lỗi */
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

/* Thống kê số lượng realm đã cài đặt wrapper XHR (Cửa sổ chính + iframe cùng nguồn, dùng cho giao diện debug) */
function countXhrHookedRealms() {
    let count = hookedXhrProtos.has(window) ? 1 : 0;
    document.querySelectorAll('iframe').forEach((frame) => {
        try {
            if (frame.contentWindow && hookedXhrProtos.has(frame.contentWindow)) count++;
        } catch (error) {
            /* Bỏ qua iframe cross-origin */
        }
    });
    return count;
}

/* ── Cài đặt Hook ────────────────────────── */

/* Cài đặt chặn request cửa sổ chính (fetch + XHR): Cả hai bộ bọc (wrapper) luôn được cài đặt */
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

    logInfo('Đã cài đặt chặn request cửa sổ chính (fetch + XHR)');
}

/* Cài đặt wrapper request cho một iframe cùng nguồn duy nhất (fetch + XHR) */
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
        logWarn('Không thể đọc iframe cross-origin, đã bỏ qua', iframe.src || '');
        return false;
    }

    /* Wrapper fetch: Đã cài đặt và chưa bị thay thế thì bỏ qua, tránh phá vỡ chuỗi bọc (wrapper chain) của realm đó */
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

    /* Wrapper XHR: Cùng một realm chỉ cài đặt một lần, đã cài đặt và chưa bị thay thế thì bỏ qua */
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

    logInfo('Đã cài đặt chặn request iframe cùng nguồn (fetch + XHR)', iframe.src || iframe.id || '');
    return true;
}

/* Cài đặt hook request iframe (fetch + XHR): Quét ban đầu + Lắng nghe động */
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

    logInfo(`Đã quét xong hook request iframe (fetch + XHR, ban đầu ${hookedCount}/${scannedCount} cái)`);
}

/* ── Giao diện debug ─────────────────────────── */

window.__PrefillCompatFix = {
    inspect: inspectRequestBody,
    getLastDecision: () => lastDecision,
    getHookCount: () => ({
        main: mainHookInstalled ? 1 : 0,
        iframes: iframeHookCount,
        xhr: countXhrHookedRealms(),
        total: (mainHookInstalled ? 1 : 0) + iframeHookCount,
    }),
};

/* ── Khởi tạo ───────────────────────────── */

/* Đọc context ST; Trả về null khi chưa sẵn sàng */
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

/* Cài đặt tất cả hook (Gọi lặp lại an toàn) */
function installAllHooks() {
    installMainRequestHooks();
    installIframeRequestHooks();
    logStartupOnce();
}

/* Chờ ST sẵn sàng (APP_READY) rồi mới cài đặt, cố gắng xếp sau các extension khác; Khi đã bỏ lỡ thì dùng độ trễ cài đặt dự phòng */
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
    logInfo('Context ST tạm thời không khả dụng, sử dụng thời điểm dự phòng để cài đặt chặn request (fetch + XHR)');
}

scheduleHookInstall();