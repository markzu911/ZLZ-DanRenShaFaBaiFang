import express from "express";
import path from "path";
import http from "http";
import https from "https";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { HttpsProxyAgent } from "https-proxy-agent";
import { pathToFileURL } from "url";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const JSON_BODY_LIMIT = "20mb";
const SERVE_DIST =
  process.env.NODE_ENV === "production" ||
  process.env.SERVE_DIST === "true" ||
  process.env.npm_lifecycle_event === "start";
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
const GEMINI_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";

installGeminiProxyFetch();

type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9";
type ImageSize = "1K" | "2K" | "4K";
type SceneMode = "room" | "style";
type ViewMode = "wide" | "mid" | "close";
type StyleId = "minimal" | "luxury";

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveSaasEndpoint(envKey: string, defaultPath: string) {
  const configured = process.env[envKey]?.trim();
  const pathOrUrl = configured || defaultPath;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SAAS_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

const WINDOW_FRONT_PRIORITY =
  "最高优先级落位：上传单人沙发只需要物理放在窗户边/落地窗边/窗帘旁的室内采光区，沙发背侧或一侧靠近窗墙、窗台、落地窗内侧或窗帘线即可；不强制在窗户正前方，也不强制窗户成为整面背景。该规则高于构图和参考图复刻。画面只需能通过窗帘线、窗框、窗台、窗墙、柔和窗光或玻璃边缘判断沙发在窗边。禁止把沙发放到房间中央、地毯中央、茶几旁中心、电视前方、柜门前方或通道中央，禁止只把窗户当远处背景而沙发离窗很远。";

const WINDOW_SIDE_CAMERA =
  "机位规则：先固定沙发在窗户边的位置和朝向，再只移动相机位置、焦段和裁切来形成当前视角；不要为了构图移动沙发本体。相机可在窗边侧前方、同向沙发的正前方或侧前方取景，也可根据房间结构略微平移或旋转。房间背景允许随着机位改变而自然重组，可以看到电视墙、柜体、内墙、会客区、地毯、灯具、绿植、窗帘或窗户局部；不要强制固定某一种背景。窗户可以作为边缘线索、侧后方线索或局部背景，但不要把镜头变成纯窗外景。";

const SOFA_ORIENTATION_MATCH =
  "已有沙发朝向硬锁：如果参考房间里有现有沙发、长沙发、贵妃位或清晰座位，先识别现有沙发的正面向量：靠背线的反方向、座面开口方向、扶手/抱枕朝向和茶几/电视墙相对关系共同决定它面向哪里。新生成的单人沙发必须把自己的正面向量锁定在同一方向扇区，和现有沙发大体平行、同向，只允许约 5-15 度自然偏角，用来形成真实摆放感。大于约 20 度的明显转向、90 度垂直、180 度反向、面对现有沙发、为了展示产品正面而把沙发转向镜头、在不跟随现有沙发同向的情况下明显面向相机，全部视为错误。不要为了构图或产品展示而改变沙发本体朝向；如果需要看到产品正面或侧面，只能移动相机到同向沙发的正前方或侧前方拍摄。此时画面可以看见正面或侧面，但原因必须是相机移动，沙发正面向量仍必须与现有沙发一致，不能以镜头为基准重新定向。只有在参考图没有可识别沙发时，才让单人沙发朝向电视墙、会客区或主要活动区。";

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

function buildFallbackSceneAnalysis(viewMode: ViewMode, error?: any) {
  return {
    roomType: "客厅",
    style: "现代高端客厅",
    lighting: "大面积窗户自然光与室内暖色灯带混合照明",
    lightingDirection: "以窗户方向的柔和自然光为主，室内暖光作为环境填充；沙发高光、阴影方向和接触阴影需要与地毯/地面一致",
    colorPalette: "中性色、米色地毯、浅色地面、黑色皮质沙发和冷暖混合光",
    cameraAngle: "平视或轻微俯拍",
    perspectiveCues: "参考地毯边缘、地砖缝、长沙发边线、电视墙和窗户框线判断地面透视与消失点",
    placementSuggestion: `${WINDOW_FRONT_PRIORITY} 可靠近已有长沙发靠窗一端，但不必贴着已有长沙发扶手。${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 按当前视角规则执行：${viewPrompts[viewMode]}`,
    recommendedScale: "根据参考房间中的长沙发、地毯、地砖缝、灯具、窗高、柜体和通道宽度判断真实单人椅比例。",
    recommendedOrientation: `如果有现有沙发，先识别现有沙发的靠背线、座面开口、扶手方向和茶几/电视墙关系，再让上传单人沙发与现有沙发同向，只允许约 5-15 度自然偏角；禁止反向、垂直、面对现有沙发或为了镜头改变朝向，然后通过移动机位来获得需要的画面角度。否则根据会客区、电视墙、地毯方向、地面透视线和可用动线决定沙发朝向。${SOFA_ORIENTATION_MATCH}`,
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
  const placement = sceneAnalysis.placementSuggestion || "未提供";
  const scale = sceneAnalysis.recommendedScale || "未提供";
  const orientation = sceneAnalysis.recommendedOrientation || "未提供";
  return `场景分析落位参考（仅作为参考；如有冲突，必须执行统一硬规则：沙发固定在窗户边/落地窗边/窗帘旁的室内采光区；如果房间里有现有沙发，先判断现有沙发正面向量，再让上传单人沙发与现有沙发同向，只允许约 5-15 度自然偏角；禁止为了镜头改变沙发本体朝向；生成时只移动相机位置、焦段和裁切，房间背景可以根据新机位和原房间风格自然变化）：placementSuggestion=${placement}；recommendedScale=${scale}；recommendedOrientation=${orientation}。`;
}

function isNetworkTimeoutError(error: any) {
  return (
    error?.message === "fetch failed" ||
    error?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    error?.cause?.code === "ETIMEDOUT" ||
    error?.cause?.code === "ECONNRESET" ||
    error?.cause?.code === "ENETUNREACH"
  );
}

function createProxyFetch(proxyUrl: string): typeof fetch {
  const agent = new HttpsProxyAgent(proxyUrl);

  return async (input, init: RequestInit = {}) => {
    const sourceRequest = input instanceof Request ? input : undefined;
    const url = sourceRequest?.url || input.toString();
    const method = init.method || sourceRequest?.method || "GET";
    const headers = new Headers(sourceRequest?.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const body = init.body ?? (sourceRequest ? await sourceRequest.arrayBuffer() : undefined);

    return new Promise<Response>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === "http:" ? http : https;
      const req = transport.request(
        parsedUrl,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          agent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode || 0,
                statusText: res.statusMessage,
                headers: res.headers as HeadersInit,
              }),
            );
          });
        },
      );

      req.on("error", reject);
      init.signal?.addEventListener("abort", () => {
        req.destroy(new DOMException("The operation was aborted.", "AbortError"));
      });
      if (body) req.write(Buffer.from(body as any));
      req.end();
    });
  };
}

function installGeminiProxyFetch() {
  if (!GEMINI_PROXY) return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const proxyFetch = createProxyFetch(GEMINI_PROXY);

  globalThis.fetch = ((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (new URL(url).hostname === "generativelanguage.googleapis.com") {
      return proxyFetch(input, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  console.log(`Gemini requests will use proxy ${GEMINI_PROXY}`);
}

function buildGeminiNetworkError(error: any) {
  const code = error?.cause?.code || error?.code || "NETWORK_ERROR";
  const proxyHint = GEMINI_PROXY
    ? `当前已配置代理 ${GEMINI_PROXY}，但 Gemini 请求仍失败。请确认代理客户端允许 Node.js 访问，并且 Google/Gemini 流量会走代理。`
    : "当前未配置 HTTP_PROXY/HTTPS_PROXY。如需代理，请在 .env 中配置后重启项目。";
  return {
    error: `无法连接 Gemini 图像生成服务。请确认当前网络能访问 generativelanguage.googleapis.com。${proxyHint}`,
    code,
    detail: error?.cause?.message || error?.message || "Gemini request failed",
  };
}

async function readJsonResponse(res: Response) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }
  return data;
}

async function verifyBeforeGenerate(userId?: string, toolId?: string) {
  if (!userId || !toolId) return;
  const res = await fetch(SAAS_ENDPOINTS.verify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
  await readJsonResponse(res);
}

async function saveResultImageToSaas({
  userId,
  toolId,
  imageBuffer,
  fileName,
}: {
  userId: string;
  toolId: string;
  imageBuffer: Buffer;
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
      mimeType: "image/png",
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
    headers: token.headers || { "Content-Type": "image/png" },
    body: imageBuffer,
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

const stylePrompts: Record<StyleId, string> = {
  minimal:
    "高端极简电商家具场景。为 La-Z-Boy Indian 单人躺椅生成舒展状态的商业图：现代室内或高级休闲空间，温暖自然光，干净建筑线条，质感地毯，自然材质，克制软装，画面整洁，有适度留白。光线柔和、有方向，上传产品的面料/皮革材质表现受控，接触阴影自然，整体像精修家居画册。",
  luxury:
    "奢华高端电商家具场景。为 La-Z-Boy Indian 单人躺椅生成舒展状态的商业图：高级客厅、精品酒店休息区或别墅角落氛围，石材/金属/艺术灯/手工地毯/装饰画等精致元素，暖色层次灯光与自然窗光结合。画面优雅、质感强，阴影柔和，上传产品的面料/皮革反光或纹理高级但不过曝。",
};

const viewPrompts: Record<ViewMode, string> = {
  wide:
    `远景图：先确定沙发在窗户边的固定落点，再把相机后退并使用较广角的室内远景构图，完整呈现房间、主要家具和沙发摆放关系。远景只改变相机位置、焦段和取景范围，不改变沙发落点、朝向和与窗边采光区的真实空间关系。沙发是正常单人椅比例，占画面高度约 16%-24%，完整可见但不主导画面。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 远景可以看到完整空间，但必须能判断沙发位于窗边采光区；窗户、窗帘或窗光可以出现在背景、侧边或边缘，比例根据机位自然决定。可与已有长沙发保持合理距离，不必贴着已有长沙发扶手。避免产品特写、沙发过大、过小或贴图感。`,
  mid:
    `中近景：核心目标只有一个：沙发固定在窗户边/落地窗边/窗帘旁的室内采光区。先确定沙发在窗边的固定落点和朝向，再只移动相机到更近位置拍摄；即使用户直接选择中近景，也不能重新选择沙发落点或为了镜头改变沙发方向。中近景只表示相机更近、画面裁切更紧、焦段更集中，不允许移动沙发本体。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} 沙发占画面高度约 32%-42%、宽度约 24%-34%，完整产品轮廓清楚，比例真实。${WINDOW_SIDE_CAMERA} 房间背景可以根据移动后的机位和原房间结构自然改变，不需要复刻原图角度；可出现地毯、地板、边几、灯具、绿植、已有沙发局部、电视墙、柜体、墙面、窗帘或窗户局部中的任意组合。窗户只需要证明沙发在窗边，可以是侧后方、边缘、局部背景、柔和窗光或窗框线索；不要强制窗户成为整面背景，也不要强制屋内家具成为唯一主背景。画面可以是相机相对同向沙发约 20-35 度的前侧三分之四视角，或从同向沙发正前方略偏侧拍；这里的“前侧”只描述相机位置，不代表把沙发转向镜头。避免全屋远景、近景特写、背面主视角、房间中央摆放、茶几旁中心、电视前方、通道中央、为了镜头旋转沙发、比例失真或纯窗外景。`,
  close:
    `近景：先确定沙发在窗户边的固定落点，再把相机继续靠近或改变裁切，突出沙发材质、轮廓、坐垫和局部软装细节，同时保留能证明窗边位置的环境锚点；即使用户直接选择近景，也不能重新选择沙发落点。近景只移动相机和裁切画面，不移动沙发本体，不改变沙发与窗边采光区的相对位置，也不改变沙发与现有沙发的大体朝向关系。沙发主体占画面约 60%-72%，环境约 28%-40%。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 近景中窗户/阳台/采光面可以是光源、边缘线索、局部背景或柔和窗光；背景可以根据机位自然保留地毯、地板、边几、灯具、墙面、柜体、电视墙或软装虚化。避免棚拍抠图、纯微距、完整客厅远景、巨大椅子、房间中央摆放、为了镜头改变沙发朝向或贴图感。`,
};

const styleViewPrompts: Record<ViewMode, string> = {
  wide:
    "风格远景：这是完整空间环境图，不是产品主视觉半身图。先在全新室内/生活方式场景中确定产品的自然陈列位置，再把相机明显后退，使用较广角的完整房间/完整休闲区构图。产品应位于中景或中远景，占画面高度约 12%-20%、宽度约 10%-20%，完整可见但不占据画面中心大部分；至少 60% 画面用于展示环境。必须看到明确的空间结构和多个尺度参照，例如大面积地面/地毯边界、墙面或窗帘、边几、灯具、绿植、装饰画、窗光或建筑线条。产品四周要有可见留白和落地区域，不能贴边或前景巨大。避免中近景、产品特写、只拍单椅和一小块地毯、空棚拍、产品过大、过小或漂浮。",
  mid:
    "风格中近景：这是完整产品主视觉环境图，不是完整房间远景，也不是局部特写。先确定产品在全新场景中的自然陈列位置，再把相机移动到更近的室内侧前方拍摄，使用中焦构图。中近景只表示相机更近、画面裁切更紧、焦段更集中，不表示重新摆放产品。产品必须完整可见，靠背、扶手、坐垫、脚踏、底座和整体轮廓都要进入画面，不裁掉主体边缘；产品占画面高度约 36%-48%、宽度约 28%-42%。环境占画面约 45%-60%，保留 2-4 个局部环境锚点，例如地毯/地板、边几、灯具、墙面、窗光、绿植或软装虚化。画面要像电商产品主图的环境版：产品清楚、比例真实、四周有呼吸空间。避免全屋远景、产品过小、完整空间展示、近景特写、局部裁切、产品贴边、正面平拍、背面视角、巨大产品或比例失真。",
  close:
    "风格近景：这是产品局部材质与结构特写，不是完整产品主视觉。先确定产品在全新场景中的自然陈列位置，再把相机明显靠近，使用近距离裁切突出材质、轮廓、坐垫鼓包、扶手、靠背分区、缝线、脚踏连接和面料/皮革纹理。近景只移动相机和裁切画面，不重新摆放产品。产品主体占画面约 72%-88%，环境只占约 12%-28%，作为柔和背景或边缘尺度参照。允许并鼓励裁切掉产品的少量边缘，例如只展示上半靠背+扶手+坐垫，或扶手+脚踏+坐垫细节；不要求完整看见整把椅子，但必须能识别为同一款上传产品。背景只保留地毯/地板、墙面、窗光、边几或软装的局部虚化，不展示完整房间关系。避免中近景完整产品图、完整椅子带大量环境、全屋远景、空棚拍、无法识别产品、漂浮脚踏或贴图感。",
};

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
    ? "模特要求：加入一位自然入镜的真人模特，与产品形成真实尺度对比，姿态生活化，不能遮挡产品主体。模特应真实坐在或自然互动于沙发/躺椅上，身体重量落在坐垫上，腿部、手部、衣褶和阴影接触可信。产品保持正常单人椅比例，不要为了适配模特而放大。避免站在旁边、坐在扶手上、漂浮、人体比例错误或产品轮廓被遮挡。"
    : "模特要求：不要添加人物、人体局部、手、脚、倒影人物、海报人物或人形装饰；画面只展示产品和室内环境。";

  const shared = `
任务：生成一张专业电商家具场景图，主体是单人沙发/单人椅。
视角含义：当前视角只表示整张效果图的镜头远近、取景范围、焦段和裁切，不表示随意改变产品比例或让产品漂浮；先确定一个自然可信的产品落点，然后通过移动相机位置来形成远景、中近景或近景。
产品一致性：严格保留上传沙发的外形轮廓、颜色、材质、扶手、靠背、坐垫、脚架、缝线和比例；只能在不违反朝向一致性和现有沙发同向规则的前提下根据空间逻辑确定朝向，不能换款、变形或生成不相关沙发。
朝向一致性：${SOFA_ORIENTATION_MATCH}
真实融合：新场景的相机高度、焦距、透视、景深、曝光、色温和自然光方向要自洽，并参考原图观感；沙发必须接受同一套房间光源，亮面、暗面、阴影方向、阴影软硬、材质高光、地面反射和环境色都要与周围家具一致。光线必须自然柔和，避免棚拍光、单独补光、过曝高光、硬阴影、冷暖色温不一致或不合理光源；沙发边缘不能有硬抠图边、发光边、白边或清晰度不一致。
落地要求：先判断地面平面和墙地交界线，再把沙发稳定放在地面或地毯上，必须有接触点、接触阴影、遮挡关系和受力感，不能悬空、漂浮、穿模、半透明或像贴纸。
禁止文字、logo、水印、价格牌、标签、UI、边框或说明标注。
视角要求：${cameraViewRequirement}
${modelRequirement}
`;

  if (mode === "room") {
    const elementEditingRules = `
元素保留与增删：
保留用户选择的元素：${(selectedElements || []).join(", ") || "无"}。按当前视角自然保留，可完整、局部、裁切或虚化出现，但不要喧宾夺主。
删除元素：${(removedElements || []).join(", ") || "无"}。不要再出现在画面中。
新增元素：${(addedElements || []).join(", ") || "无"}。保持真实比例和原房间风格，不破坏主要空间关系，不遮挡沙发主体。`;

    return `${shared}
房间融入专用规则：${WINDOW_FRONT_PRIORITY} 不再要求贴着已有长沙发扶手外侧。${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 如果参考图原本不是当前机位，也必须优先满足“沙发在窗户边、沙发与现有沙发同向、只移动相机和裁切来形成当前视角”的关系。
房间融合规则：参考图只用于提取房间类型、主要元素、装修风格、材质、采光和空间气质；最终应在不违反房间融入专用规则的前提下重新生成一张风格稳定、质感类似的完整室内场景，不需要和原图布局、机位、角度或物品位置完全一样。可以根据新机位自然重组背景、家具显隐和画面比例，但不能改变“沙发固定在窗户边采光区”这一空间关系。
根据房间图识别出的元素生成风格类似的新室内场景：保留同类门窗、墙地面材质、采光方式、装修风格和主要家具关系即可，不要逐像素复刻原房间。
用于风格、元素和光线参考的场景分析：${JSON.stringify(safeSceneAnalysis)}
${scenePlacementContext}
${elementEditingRules}
图 1 是准确的沙发产品参考，图 2 是房间和空间参考。
摆放逻辑：必须像真实室内设计师在现场布置。第一步先判断房间窗户、阳台、电视墙、通道、已有沙发/茶几/柜体的位置，并确定一个位于窗户边/落地窗边/窗帘旁采光区的固定沙发落点；第二步判断已有沙发的大体朝向，用靠背线、座面开口、扶手方向、抱枕方向和茶几/电视墙关系推断现有沙发正面向量；第三步把上传单人沙发的正面向量锁定为同一方向，只允许约 5-15 度自然偏角，不能转成相反方向、垂直方向、面对现有沙发或为了镜头改变朝向；第四步保持沙发位置和朝向不动；第五步只移动相机位置、焦段和裁切来满足当前视角。对于有大窗/窗帘的客厅，远景、中近景和近景都必须把沙发固定在窗边采光区，再通过相机远近、平移、旋转和局部裁切形成对应视角；背景可随机位变化自然出现电视墙、柜体、内墙、会客区、地毯、灯具、绿植、窗帘或窗户局部，不要强制某一种背景。不要为了构图把沙发移到画面中央、茶几旁、电视前方或通道中央，也不要为了让产品正对镜头而旋转沙发本体。
光线匹配：生成沙发前先判断窗光、灯光、墙面反光和地面反射。沙发不能比同区域家具更亮、更冷或更硬；如果旁边家具受暖色灯和柔和窗光影响，沙发也必须呈现相同色温、曝光、高光强度和接触阴影。
可生成参考图中识别出的同类环境元素，如茶几、地毯、灯具、绿植、画作、柜体和软装；不要添加与参考风格无关的新物体。只有用户选择需要模特时才允许添加一位人物。
严格按“视角要求”执行机位、比例、画面占比和背景选择；但沙发摆放位置只能由最高优先级落位硬规则决定，不能由视角要求重新决定。`;
  }

  return `${shared}
风格直接生成模式：没有房间参考图，不执行靠窗、已有沙发扶手外侧、窗帘线固定落点等房间融入规则；请按所选风格创建全新的室内/生活方式场景，并为产品选择自然、可信、适合电商展示的落地位置。
按所选风格生成全新的室内/生活方式场景：${stylePrompts[styleId]}。
上传产品图是 La-Z-Boy Indian 单人躺椅的准确参考。最终产品应为展开休闲状态：靠背微微后仰，脚踏向前展开，连续厚实坐垫、分段皮革、扶手、缝线和材质纹理清晰。
如果参考图是直立、收起或其他角度，请推断同一把椅子的展开状态，并保持上传产品的实际颜色、实际材质、坐垫布局、扶手形状、缝线、纹理和比例一致；例如上传产品是蓝色布艺，就必须保持蓝色布艺，不要改成棕色皮革。
不要生成普通扶手椅、普通沙发、双人沙发、按摩椅或改款躺椅；不要文字、条码、标签、logo、水印或海报元素。
脚踏必须与椅身机械连接合理，不能漂浮或断开；整体保持真实单人躺椅比例。
围绕展开躺椅构建干净、高端、光线漂亮的电商场景。根据“视角要求”和“模特要求”统一机位、比例、画面占比和背景选择。`;
}

type CreateAppOptions = {
  mountFrontend?: boolean;
};

export async function createApp({ mountFrontend = true }: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: { "User-Agent": "sofa-scene-ai" },
    },
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      imageModel: IMAGE_MODEL,
      textModel: TEXT_MODEL,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      saasOrigin: SAAS_ORIGIN,
      serveDist: SERVE_DIST,
    });
  });

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.post("/api/tool/launch", async (req, res) => {
    try {
      const { userId, toolId } = req.body;
      if (!userId || !toolId) {
        return res.status(400).json({ success: false, message: "userId and toolId are required" });
      }
      const saasRes = await fetch(SAAS_ENDPOINTS.launch, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, toolId }),
      });
      res.json(await readJsonResponse(saasRes));
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "本地 .env 未配置 GEMINI_API_KEY，请先填写 Gemini API Key 后重启服务。" });
      }

      const { sceneImage, viewMode = "wide" } = req.body as { sceneImage?: string; viewMode?: ViewMode };
      if (!sceneImage) {
        return res.status(400).json({ error: "sceneImage is required" });
      }

      const analysisViewInstruction = `当前视角规则：${viewPrompts[viewMode]}。只按这份规则分析房间，不要扩展另一套机位、比例或构图规则。`;

      const scene = parseDataUrl(sceneImage);
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: {
          parts: [
            {
              text:
                `请用中文分析这张室内场景图，用于生成单人沙发效果图。${analysisViewInstruction}聚焦于：1. 房间类型和装修风格；2. 门窗、阳台、墙地面、主要家具和动线；3. 光线方向、阴影软硬、色温和曝光；4. 相机高度、透视线、地面平面和尺度参照；5. 单人沙发最合理摆放位置、尺寸比例和自然朝向。placementSuggestion 必须建议：${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 不要建议房间中央、茶几旁中心、地毯中央、通道中央或电视前方。recommendedOrientation 必须先描述图中现有沙发/长沙发的朝向锚点，例如靠背线、座面开口、扶手方向、抱枕方向、茶几或电视墙关系；如果图中有现有沙发/长沙发，上传单人沙发必须与现有沙发同向，只允许约 5-15 度自然偏角；不要通过旋转沙发本体来让新沙发正对相机、面对现有沙发、转成垂直方向或转成相反方向。产品可见性通过移动机位解决；如果画面看见产品正面或侧面，原因必须是相机移动到同向沙发前侧，而不是沙发转向镜头。只返回 JSON，字段包括 roomType、style、lighting、lightingDirection、colorPalette、cameraAngle、perspectiveCues、placementSuggestion、recommendedScale、recommendedOrientation、modelInteractionSuggestion、elements。elements 是需要保留的画面元素数组。`,
            },
            { inlineData: { data: scene.data, mimeType: scene.mimeType } },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              roomType: { type: Type.STRING },
              style: { type: Type.STRING },
              lighting: { type: Type.STRING },
              lightingDirection: { type: Type.STRING },
              colorPalette: { type: Type.STRING },
              cameraAngle: { type: Type.STRING },
              perspectiveCues: { type: Type.STRING },
              placementSuggestion: { type: Type.STRING },
              recommendedScale: { type: Type.STRING },
              recommendedOrientation: { type: Type.STRING },
              modelInteractionSuggestion: { type: Type.STRING },
              elements: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "roomType",
              "style",
              "lighting",
              "lightingDirection",
              "colorPalette",
              "cameraAngle",
              "perspectiveCues",
              "placementSuggestion",
              "recommendedScale",
              "recommendedOrientation",
              "modelInteractionSuggestion",
              "elements",
            ],
          },
        },
      });

      const parsed = readJsonBlock(response.text || "") || {
        roomType: "客厅",
        style: "现代家居",
        lighting: "自然光",
        lightingDirection: "根据窗户和阴影判断主要光源方向",
        colorPalette: "中性色",
        cameraAngle: "平视",
        perspectiveCues: "参考地面、墙角和家具边线判断透视",
        placementSuggestion: `${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}`,
        recommendedScale: "与附近茶几、地毯、墙面高度保持合理比例",
        recommendedOrientation: `如果有现有沙发，先识别现有沙发的靠背线、座面开口、扶手方向和茶几/电视墙关系，再让上传单人沙发与现有沙发同向，只允许约 5-15 度自然偏角；禁止反向、垂直、面对现有沙发或为了镜头改变朝向，产品可见性通过移动机位解决。如果没有现有沙发，则朝向房间主要活动区或电视墙。${SOFA_ORIENTATION_MATCH}`,
        modelInteractionSuggestion: "模特自然坐靠，身体重量落在坐垫上，避免遮挡沙发轮廓",
        elements: ["墙面", "地板", "窗户", "软装", "装饰物"],
      };
      res.json(parsed);
    } catch (error: any) {
      console.error("Analysis Error:", error);
      if (isNetworkTimeoutError(error)) {
        return res.json(buildFallbackSceneAnalysis(req.body?.viewMode || "wide", error));
      }
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "本地 .env 未配置 GEMINI_API_KEY，请先填写 Gemini API Key 后重启服务。" });
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
        productImage: string;
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
      } = req.body;

      if (!productImage) return res.status(400).json({ error: "productImage is required" });
      if (mode === "room" && !sceneImage) {
        return res.status(400).json({ error: "sceneImage is required in room mode" });
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

      console.log("\n===== Final Gemini Image Prompt =====");
      console.log(
        JSON.stringify(
          {
            mode,
            styleId,
            viewMode,
            withModel,
            ratio,
            resolution,
          },
          null,
          2,
        ),
      );
      console.log(generationPrompt);
      console.log("===== End Final Gemini Image Prompt =====\n");

      const parts: any[] = [
        {
          text: generationPrompt,
        },
        { inlineData: { data: product.data, mimeType: product.mimeType } },
      ];

      if (mode === "room" && sceneImage) {
        const scene = parseDataUrl(sceneImage);
        parts.push({ inlineData: { data: scene.data, mimeType: scene.mimeType } });
      }

      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: ratio,
            imageSize: resolution,
          },
        },
      });

      let imageData = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          imageData = part.inlineData.data;
          break;
        }
      }

      if (!imageData) {
        return res.status(502).json({ error: response.text || "Gemini returned no image data" });
      }

      const imageBuffer = Buffer.from(imageData, "base64");
      const dataUrl = `data:image/png;base64,${imageData}`;

      if (userId && toolId) {
        try {
          const saasImage = await saveResultImageToSaas({
            userId,
            toolId,
            imageBuffer,
            fileName: `sofa-scene-${Date.now()}.png`,
          });
          return res.json({
            imageUrl: saasImage.url,
            recordId: saasImage.recordId,
            saasInfo: saasImage,
            prompt: generationPrompt,
          });
        } catch (saasError: any) {
          console.error("SaaS Save Error:", saasError.message);
          return res.status(502).json({
            error: saasError.message || "SaaS result image save failed",
            saasSaveFailed: true,
            prompt: generationPrompt,
          });
        }
      }

      res.json({
        imageUrl: dataUrl,
        prompt: generationPrompt,
      });
    } catch (error: any) {
      console.error("Generation Error:", error);
      if (isNetworkTimeoutError(error)) {
        return res.status(502).json(buildGeminiNetworkError(error));
      }
      res.status(500).json({ error: error.message || "Generation failed" });
    }
  });

  if (!mountFrontend) {
    return app;
  }

  if (!SERVE_DIST) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SofaGen AI running on http://localhost:${PORT}`);
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startServer();
}
