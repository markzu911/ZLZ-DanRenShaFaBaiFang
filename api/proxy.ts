type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9";
type ImageSize = "1K" | "2K" | "4K";
type SceneMode = "room" | "style";
type ViewMode = "wide" | "mid" | "close";
type StyleId = "minimal" | "luxury";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

const JSON_LIMIT_BYTES = 20 * 1024 * 1024;
const SAAS_ORIGIN = stripTrailingSlash(process.env.SAAS_ORIGIN || "http://aibigtree.com");
const SAAS_ENDPOINTS = {
  launch: resolveSaasEndpoint("SAAS_LAUNCH_URL", "/api/tool/launch"),
  verify: resolveSaasEndpoint("SAAS_VERIFY_URL", "/api/tool/verify"),
  consume: resolveSaasEndpoint("SAAS_CONSUME_URL", "/api/tool/consume"),
  uploadToken: resolveSaasEndpoint("SAAS_UPLOAD_TOKEN_URL", "/api/upload/direct-token"),
  uploadCommit: resolveSaasEndpoint("SAAS_UPLOAD_COMMIT_URL", "/api/upload/commit"),
};
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";

const WINDOW_FRONT_PRIORITY =
  "最高优先级落位：上传单人沙发只需要物理放在窗户边/落地窗边/窗帘旁的室内采光区，靠近窗墙、窗台、落地窗内侧或窗帘线即可；不强制在窗户正前方，也不强制窗户成为整面背景。画面只需能通过窗帘线、窗框、窗台、窗墙、柔和窗光或玻璃边缘判断沙发在窗边。禁止把沙发放到房间中央、地毯中央、茶几旁中心、电视前方、柜门前方或通道中央，禁止只把窗户当远处背景而沙发离窗很远。";

const WINDOW_SIDE_CAMERA =
  "机位规则：先固定沙发在窗户边的位置和朝向，再只移动相机位置、焦段和裁切来形成当前视角；不要为了构图移动沙发本体。相机可在窗边侧前方、同向沙发的正前方或侧前方取景，也可根据房间结构略微平移或旋转。房间背景允许随着机位改变而自然重组，可以看到电视墙、柜体、内墙、会客区、地毯、灯具、绿植、窗帘或窗户局部；不要强制固定某一种背景。窗户可以作为边缘线索、侧后方线索或局部背景，但不要把镜头变成纯窗外景。";

const SOFA_ORIENTATION_MATCH =
  "已有沙发朝向硬锁：如果参考房间里有现有沙发、长沙发、贵妃位或清晰座位，新生成的单人沙发必须与现有沙发大体平行、同向，只允许约 5-15 度自然偏角；禁止反向、垂直、面对现有沙发或为了展示产品而把沙发转向镜头。";

const stylePrompts: Record<StyleId, string> = {
  minimal:
    "高端极简电商家具场景。现代室内或高级休闲空间，温暖自然光，干净建筑线条，质感地毯，自然材质，克制软装，画面整洁，有适度留白，整体像精修家居画册。",
  luxury:
    "奢华高端电商家具场景。高级客厅、精品酒店休息区或别墅角落氛围，石材、金属、艺术灯、手工地毯和装饰画等精致元素，暖色层次灯光与自然窗光结合。",
};

const viewPrompts: Record<ViewMode, string> = {
  wide:
    `远景图：完整呈现房间、主要家具和沙发摆放关系。先确定沙发在窗户边的固定落点，再只移动相机位置、焦段和取景范围。沙发是正常单人椅比例，占画面高度约 16%-24%，完整可见但不主导画面。窗户、窗帘或窗光可以出现在背景、侧边或边缘，比例根据机位自然决定。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}`,
  mid:
    `中近景：核心目标只有一个：沙发固定在窗户边/落地窗边/窗帘旁的室内采光区。先确定沙发在窗边的固定落点和朝向，再只移动相机到更近位置拍摄；中近景只表示相机更近、画面裁切更紧、焦段更集中，不允许移动沙发本体。沙发占画面高度约 32%-42%、宽度约 24%-34%，完整产品轮廓清楚，比例真实。房间背景可以根据移动后的机位和原房间结构自然改变，不需要复刻原图角度；可出现地毯、地板、边几、灯具、绿植、已有沙发局部、电视墙、柜体、墙面、窗帘或窗户局部中的任意组合。窗户只需要证明沙发在窗边，可以是侧后方、边缘、局部背景、柔和窗光或窗框线索；不要强制窗户成为整面背景，也不要强制屋内家具成为唯一主背景。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}`,
  close:
    `近景：先确定沙发在窗户边的固定落点，再把相机继续靠近或改变裁切，突出沙发材质、轮廓、坐垫和局部软装细节。近景只移动相机和裁切画面，不移动沙发本体，不改变沙发与窗边采光区的相对位置。沙发主体占画面约 60%-72%，环境约 28%-40%；窗户/阳台/采光面可以是光源、边缘线索、局部背景或柔和窗光。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}`,
};

const styleViewPrompts: Record<ViewMode, string> = {
  wide:
    "远景图：完整展示产品和高端场景关系，产品为正常单人椅比例，占画面高度约 18%-28%，环境完整、空间通透。",
  mid:
    "中近景：产品为视觉主角，占画面高度约 38%-52%，能看清扶手、靠背、坐垫和脚踏，同时保留地毯、墙面、灯具或边几等场景质感。",
  close:
    "近景：产品占画面约 62%-76%，突出材质、缝线、坐垫厚度和脚踏结构，同时保留少量高端室内背景作为商业摄影氛围。",
};

class HttpError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveSaasEndpoint(envKey: string, defaultPath: string) {
  const configured = process.env[envKey]?.trim();
  const pathOrUrl = configured || defaultPath;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SAAS_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function setCorsHeaders(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}

function sendJson(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data));
}

function sendRaw(res: any, status: number, contentType: string, body: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType || "application/json; charset=utf-8");
  return res.end(body);
}

function normalizeApiPath(req: any) {
  const url = new URL(req.url || "/", "http://localhost");
  const rewrittenPath = url.searchParams.get("path");
  let pathname = url.pathname;

  if (pathname === "/api/proxy" && rewrittenPath) {
    pathname = `/api/${decodeURIComponent(rewrittenPath).replace(/^\/+/, "")}`;
    url.searchParams.delete("path");
  }

  if (!pathname.startsWith("/api/") && pathname !== "/api") {
    pathname = `/api${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  return {
    pathname,
    query: url.searchParams.toString(),
  };
}

async function getJsonBody(req: any) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString("utf8")) : {};
    return req.body || {};
  }

  if (!req[Symbol.asyncIterator]) return {};

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > JSON_LIMIT_BYTES) {
      throw new HttpError(413, "Request body exceeds 20mb limit");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parseDataUrl(image: string) {
  const match = image.match(/^data:([^;]+);base64,(.*)$/);
  return {
    mimeType: match?.[1] || "image/png",
    data: match?.[2] || image,
  };
}

function readJsonBlock(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}") + 1;
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return null;
  }
}

function extractGeminiText(data: any) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || "")
      .filter(Boolean)
      .join("\n") || ""
  );
}

function extractGeminiImage(data: any) {
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    const inlineData = part.inlineData || part.inline_data;
    if (inlineData?.data) {
      return {
        data: inlineData.data,
        mimeType: inlineData.mimeType || inlineData.mime_type || "image/png",
      };
    }
  }
  return null;
}

function buildFallbackSceneAnalysis(viewMode: ViewMode, error?: any) {
  return {
    roomType: "客厅",
    style: "现代高端客厅",
    lighting: "大面积窗户自然光与室内暖色灯带混合照明",
    lightingDirection: "以窗户方向的柔和自然光为主，室内暖光作为环境填充",
    colorPalette: "中性色、米色地毯、浅色地面、黑色皮质沙发和冷暖混合光",
    cameraAngle: "平视或轻微俯拍",
    perspectiveCues: "参考地毯边缘、地砖缝、长沙发边线、电视墙和窗户框线判断地面透视与消失点",
    placementSuggestion: `${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 当前视角：${viewPrompts[viewMode]}`,
    recommendedScale: "根据参考房间中的长沙发、地毯、地砖缝、灯具、窗高、柜体和通道宽度判断真实单人椅比例。",
    recommendedOrientation: `如果有现有沙发，先识别靠背线、座面开口、扶手方向和茶几/电视墙关系，再让上传单人沙发与现有沙发同向。${SOFA_ORIENTATION_MATCH}`,
    modelInteractionSuggestion: "如加入模特，身体应自然坐靠，脚部与地面或脚踏形成真实接触阴影",
    elements: ["地毯", "地面", "窗户", "长沙发", "灯光", "墙面"],
    analysisSource: "fallback",
    analysisWarning: error?.cause?.code || error?.message || "Gemini analysis unavailable",
  };
}

function sanitizeSceneAnalysisForPrompt(sceneAnalysis?: any) {
  if (!sceneAnalysis || typeof sceneAnalysis !== "object") return {};
  const {
    placementSuggestion: _placementSuggestion,
    recommendedScale: _recommendedScale,
    recommendedOrientation: _recommendedOrientation,
    ...safeAnalysis
  } = sceneAnalysis;
  return safeAnalysis;
}

function buildScenePlacementContext(sceneAnalysis?: any) {
  if (!sceneAnalysis || typeof sceneAnalysis !== "object") return "无额外场景落位分析。";
  return `场景分析落位参考：placementSuggestion=${sceneAnalysis.placementSuggestion || "未提供"}；recommendedScale=${
    sceneAnalysis.recommendedScale || "未提供"
  }；recommendedOrientation=${sceneAnalysis.recommendedOrientation || "未提供"}。如与最高优先级落位、同向规则或机位规则冲突，必须忽略这里并执行硬规则。`;
}

function buildGenerationPrompt({
  mode,
  styleId,
  sceneAnalysis,
  selectedElements,
  removedElements,
  addedElements,
  viewMode,
  withModel,
}: {
  mode: SceneMode;
  styleId: StyleId;
  sceneAnalysis?: any;
  selectedElements?: string[];
  removedElements?: string[];
  addedElements?: string[];
  viewMode: ViewMode;
  withModel: boolean;
}) {
  const cameraViewRequirement = mode === "style" ? styleViewPrompts[viewMode] : viewPrompts[viewMode];
  const safeSceneAnalysis = sanitizeSceneAnalysisForPrompt(sceneAnalysis);
  const scenePlacementContext = buildScenePlacementContext(sceneAnalysis);
  const modelRequirement = withModel
    ? "模特要求：加入一位自然入镜的真人模特，与产品形成真实尺度对比，姿态生活化，不能遮挡产品主体。模特应真实坐在或自然互动于沙发/躺椅上，身体重量落在坐垫上，腿部、手部、衣褶和阴影接触可信。"
    : "模特要求：不要添加人物、人体局部、手、脚、倒影人物、海报人物或人形装饰；画面只展示产品和室内环境。";

  const shared = `
任务：生成一张专业电商家具场景图，主体是单人沙发/单人椅。
产品一致性：严格保留上传沙发的外形轮廓、颜色、材质、扶手、靠背、坐垫、脚架、缝线和比例；不能换款、变形或生成不相关沙发。
真实融合：相机高度、焦距、透视、景深、曝光、色温和自然光方向必须自洽。沙发必须接受同一套房间光源，亮面、暗面、阴影方向、材质高光、地面反射和环境色都要与周围家具一致。
落地要求：先判断地面平面和墙地交界线，再把沙发稳定放在地面或地毯上，必须有接触点、接触阴影、遮挡关系和受力感，不能悬空、漂浮、穿模、半透明或像贴纸。
禁止文字、logo、水印、价格牌、标签、UI、边框或说明标注。
视角要求：${cameraViewRequirement}
朝向一致性：${SOFA_ORIENTATION_MATCH}
${modelRequirement}
`;

  if (mode === "room") {
    const elementEditingRules = `
元素保留与增删：
保留用户选择的元素：${(selectedElements || []).join(", ") || "无"}。按当前视角自然保留，可完整、局部、裁切或虚化出现，但不要喧宾夺主。
删除元素：${(removedElements || []).join(", ") || "无"}。不要再出现在画面中。
新增元素：${(addedElements || []).join(", ") || "无"}。保持真实比例和原房间风格，不破坏主要空间关系，不遮挡沙发主体。`;

    return `${shared}
房间融入专用规则：${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}
房间融合规则：参考图用于提取房间类型、主要元素、装修风格、材质、采光和空间气质；最终应在不违反房间融入专用规则的前提下重新生成一张风格稳定、质感类似的完整室内场景，不需要逐像素复刻原图。可以根据新机位自然重组背景、家具显隐和画面比例，但不能改变“沙发固定在窗户边采光区”这一空间关系。
用于风格、元素和光线参考的场景分析：${JSON.stringify(safeSceneAnalysis)}
${scenePlacementContext}
${elementEditingRules}
图 1 是准确的沙发产品参考，图 2 是房间和空间参考。
摆放逻辑：先判断窗户、阳台、电视墙、通道、已有沙发/茶几/柜体的位置，并确定一个位于窗户边/落地窗边/窗帘旁采光区的固定沙发落点；如果有现有沙发，再判断现有沙发的大体朝向，把上传单人沙发的正面向量锁定为同一方向；保持沙发位置和朝向不动，只移动相机位置、焦段和裁切来满足当前视角。背景可随机位变化自然出现电视墙、柜体、内墙、会客区、地毯、灯具、绿植、窗帘或窗户局部，不要强制某一种背景。
光线匹配：生成沙发前先判断窗光、灯光、墙面反光和地面反射。沙发不能比同区域家具更亮、更冷或更硬。`;
  }

  return `${shared}
风格直接生成模式：没有房间参考图，请按所选风格创建全新的室内/生活方式场景，并为产品选择自然、可信、适合电商展示的落地位置。
按所选风格生成全新的室内/生活方式场景：${stylePrompts[styleId]}。
上传产品图是 La-Z-Boy Indian 单人躺椅的准确参考。最终产品应为展开休闲状态：靠背微微后仰，脚踏向前展开，连续厚实坐垫、分段皮革、扶手、缝线和材质纹理清晰。
如果参考图是直立、收起或其他角度，请推断同一把椅子的展开状态，并保持上传产品的实际颜色、实际材质、坐垫布局、扶手形状、缝线、纹理和比例一致。
不要生成普通扶手椅、普通沙发、双人沙发、按摩椅或改款躺椅；脚踏必须与椅身机械连接合理，不能漂浮或断开。`;
}

function normalizeGeminiPayload(payload: any) {
  const normalized = { ...(payload || {}) };
  if (normalized.config && !normalized.generationConfig) {
    normalized.generationConfig = normalized.config;
    delete normalized.config;
  }
  if (normalized.contents && !Array.isArray(normalized.contents)) {
    normalized.contents = [normalized.contents];
  }
  return normalized;
}

async function callGemini(model: string, payload: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "GEMINI_API_KEY is not configured on the server");
  }

  const modelId = model.startsWith("models/") ? model : `models/${model}`;
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeGeminiPayload(payload)),
  });

  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 600) };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || `Gemini request failed: ${response.status}`;
    throw new HttpError(response.status, message, data);
  }

  return data;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed: ${response.status}`);
  }

  return data;
}

async function verifyBeforeGenerate(userId?: string, toolId?: string) {
  if (!userId || !toolId) return;
  const response = await fetch(SAAS_ENDPOINTS.verify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
  const data = await readJsonResponse(response);
  if (data.valid === false) {
    throw new Error(data.error || data.message || "积分校验失败");
  }
}

async function saveResultImageToSaas({
  userId,
  toolId,
  imageBuffer,
  mimeType,
  fileName,
}: {
  userId: string;
  toolId: string;
  imageBuffer: Buffer;
  mimeType: string;
  fileName: string;
}) {
  const consumeRes = await fetch(SAAS_ENDPOINTS.consume, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
  await readJsonResponse(consumeRes);

  const tokenRes = await fetch(SAAS_ENDPOINTS.uploadToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      toolId,
      source: "result",
      mimeType,
      fileName,
      fileSize: imageBuffer.byteLength,
    }),
  });
  const token = await readJsonResponse(tokenRes);
  if (!token.uploadUrl || !token.objectKey) {
    throw new Error("SaaS upload token response missing uploadUrl or objectKey");
  }

  const uploadRes = await fetch(token.uploadUrl, {
    method: token.method || "PUT",
    headers: token.headers || { "Content-Type": mimeType },
    body: imageBuffer as any,
  });
  if (!uploadRes.ok) throw new Error(`OSS upload failed: ${uploadRes.status}`);

  const commitRes = await fetch(SAAS_ENDPOINTS.uploadCommit, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      toolId,
      source: "result",
      objectKey: token.objectKey,
      fileSize: imageBuffer.byteLength,
    }),
  });
  const commit = await readJsonResponse(commitRes);
  const image = commit.image || commit;
  if (!commit.savedToRecords && !image.savedToRecords) {
    throw new Error(commit.error || "Failed to save record to SaaS");
  }
  if (!(image.recordId ?? commit.recordId) || !(image.url ?? commit.url)) {
    throw new Error("SaaS commit response missing recordId or url");
  }

  return {
    ...image,
    recordId: image.recordId ?? commit.recordId,
    url: image.url ?? commit.url,
    fileName: image.fileName ?? commit.fileName ?? token.fileName,
    fileSize: image.fileSize ?? commit.fileSize ?? imageBuffer.byteLength,
    savedToRecords: true,
  };
}

function appendQuery(targetUrl: string, query: string) {
  if (!query) return targetUrl;
  const url = new URL(targetUrl);
  new URLSearchParams(query).forEach((value, key) => url.searchParams.append(key, value));
  return url.toString();
}

function resolveSaasProxyUrl(pathname: string, query: string) {
  const exact: Record<string, string> = {
    "/api/tool/launch": SAAS_ENDPOINTS.launch,
    "/api/tool/verify": SAAS_ENDPOINTS.verify,
    "/api/tool/consume": SAAS_ENDPOINTS.consume,
    "/api/upload/direct-token": SAAS_ENDPOINTS.uploadToken,
    "/api/upload/commit": SAAS_ENDPOINTS.uploadCommit,
  };
  return appendQuery(exact[pathname] || `${SAAS_ORIGIN}${pathname}`, query);
}

async function proxyToSaas(req: any, res: any, pathname: string, query: string) {
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await getJsonBody(req);
  const response = await fetch(resolveSaasProxyUrl(pathname, query), {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  return sendRaw(
    res,
    response.status,
    response.headers.get("content-type") || "application/json; charset=utf-8",
    text,
  );
}

async function handleGeminiProxy(req: any, res: any) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const { model, payload } = await getJsonBody(req);
  if (!model || !payload) {
    return sendJson(res, 400, { error: "Missing model or payload in request body" });
  }

  const data = await callGemini(model, payload);
  return sendJson(res, 200, data);
}

async function handleAnalyze(req: any, res: any) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const { sceneImage, viewMode = "wide" } = (await getJsonBody(req)) as {
    sceneImage?: string;
    viewMode?: ViewMode;
  };
  if (!sceneImage) {
    return sendJson(res, 400, { error: "sceneImage is required" });
  }

  const scene = parseDataUrl(sceneImage);
  const analysisPrompt = `请用中文分析这张室内场景图，用于生成单人沙发效果图。当前视角规则：${
    viewPrompts[viewMode]
  }。聚焦于：1. 房间类型和装修风格；2. 门窗、阳台、墙地面、主要家具和动线；3. 光线方向、阴影软硬、色温和曝光；4. 相机高度、透视线、地面平面和尺度参照；5. 单人沙发最合理摆放位置、尺寸比例和自然朝向。placementSuggestion 必须建议：${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 不要建议房间中央、茶几旁中心、地毯中央、通道中央或电视前方。只返回 JSON，字段包括 roomType、style、lighting、lightingDirection、colorPalette、cameraAngle、perspectiveCues、placementSuggestion、recommendedScale、recommendedOrientation、modelInteractionSuggestion、elements。elements 是需要保留的画面元素数组。`;

  try {
    const data = await callGemini(TEXT_MODEL, {
      contents: [
        {
          parts: [{ text: analysisPrompt }, { inlineData: { data: scene.data, mimeType: scene.mimeType } }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
    const text = extractGeminiText(data);
    const parsed = readJsonBlock(text) || JSON.parse(text || "{}");
    return sendJson(res, 200, parsed);
  } catch (error: any) {
    console.error("Analysis Error:", error);
    if (error instanceof HttpError && error.status === 500) {
      throw error;
    }
    return sendJson(res, 200, buildFallbackSceneAnalysis(viewMode, error));
  }
}

async function handleGenerate(req: any, res: any) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const {
    mode,
    productImage,
    sceneImage,
    styleId = "minimal",
    viewMode = "wide",
    withModel = false,
    ratio = "1:1",
    resolution = "1K",
    sceneAnalysis,
    selectedElements,
    removedElements,
    addedElements,
    userId,
    toolId,
  }: {
    mode: SceneMode;
    productImage?: string;
    sceneImage?: string;
    styleId?: StyleId;
    viewMode?: ViewMode;
    withModel?: boolean;
    ratio?: AspectRatio;
    resolution?: ImageSize;
    sceneAnalysis?: any;
    selectedElements?: string[];
    removedElements?: string[];
    addedElements?: string[];
    userId?: string;
    toolId?: string;
  } = await getJsonBody(req);

  if (!productImage) return sendJson(res, 400, { error: "productImage is required" });
  if (mode === "room" && !sceneImage) {
    return sendJson(res, 400, { error: "sceneImage is required in room mode" });
  }

  await verifyBeforeGenerate(userId, toolId);

  const product = parseDataUrl(productImage);
  const generationPrompt = buildGenerationPrompt({
    mode,
    styleId,
    sceneAnalysis,
    selectedElements,
    removedElements,
    addedElements,
    viewMode,
    withModel,
  });

  const parts: any[] = [{ text: generationPrompt }, { inlineData: { data: product.data, mimeType: product.mimeType } }];
  if (mode === "room" && sceneImage) {
    const scene = parseDataUrl(sceneImage);
    parts.push({ inlineData: { data: scene.data, mimeType: scene.mimeType } });
  }

  const data = await callGemini(IMAGE_MODEL, {
    contents: [{ parts }],
    generationConfig: {
      imageConfig: {
        aspectRatio: ratio,
        imageSize: resolution,
      },
    },
  });

  const image = extractGeminiImage(data);
  if (!image) {
    return sendJson(res, 502, { error: extractGeminiText(data) || "Gemini returned no image data" });
  }

  const imageBuffer = Buffer.from(image.data, "base64");
  if (userId && toolId) {
    try {
      const saasImage = await saveResultImageToSaas({
        userId,
        toolId,
        imageBuffer,
        mimeType: image.mimeType,
        fileName: `sofa-scene-${Date.now()}.${image.mimeType.includes("jpeg") ? "jpg" : "png"}`,
      });
      return sendJson(res, 200, {
        imageUrl: saasImage.url,
        recordId: saasImage.recordId,
        saasInfo: saasImage,
        prompt: generationPrompt,
      });
    } catch (saasError: any) {
      console.error("SaaS Save Error:", saasError);
      return sendJson(res, 502, {
        error: saasError.message || "SaaS result image save failed",
        saasSaveFailed: true,
        prompt: generationPrompt,
      });
    }
  }

  return sendJson(res, 200, {
    imageUrl: `data:${image.mimeType};base64,${image.data}`,
    prompt: generationPrompt,
  });
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const { pathname, query } = normalizeApiPath(req);
  const lowerPath = pathname.toLowerCase();

  try {
    if (lowerPath === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        runtime: "vercel-proxy",
        imageModel: IMAGE_MODEL,
        textModel: TEXT_MODEL,
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
        saasOrigin: SAAS_ORIGIN,
      });
    }

    if (lowerPath === "/api/gemini") return handleGeminiProxy(req, res);
    if (lowerPath === "/api/analyze") return handleAnalyze(req, res);
    if (lowerPath === "/api/generate") return handleGenerate(req, res);

    if (lowerPath.startsWith("/api/tool/") || lowerPath.startsWith("/api/upload/")) {
      return proxyToSaas(req, res, pathname, query);
    }

    return sendJson(res, 404, { error: "Path Not Found", path: pathname });
  } catch (error: any) {
    console.error("Proxy Error:", error);
    if (error instanceof HttpError) {
      return sendJson(res, error.status, error.data || { error: error.message });
    }
    return sendJson(res, 500, { error: error?.message || "Internal Server Error" });
  }
}
