import express from "express";
import path from "path";
import http from "http";
import https from "https";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { HttpsProxyAgent } from "https-proxy-agent";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const SAAS_ORIGIN = process.env.SAAS_ORIGIN || "https://aibigtree.com";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";
const GEMINI_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";

installGeminiProxyFetch();

type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9";
type ImageSize = "1K" | "2K" | "4K";
type SceneMode = "room" | "style";
type ViewMode = "wide" | "mid" | "close";
type StyleId = "minimal" | "luxury";

const WINDOW_FRONT_PRIORITY =
  "最高优先级落位：上传单人沙发必须物理落在窗户/落地窗/窗帘正前方的室内采光区，沙发背侧或一侧靠近窗墙、窗台、落地窗内侧或窗帘线。该规则高于视角、构图、美观、参考图复刻和场景分析。为了配合从窗户侧向室内拍摄，不要求窗户/窗帘成为沙发背后的整面背景；只需在画面边缘、侧后方或前景窄边露出窗帘线、窗框、窗台、窗墙或柔和窗光作为落位证据。禁止把沙发放到房间中央、地毯中央、茶几旁中心、电视前方、柜门前方或通道中央，禁止只把窗户当远处背景而沙发离窗很远。";

const WINDOW_SIDE_CAMERA =
  "机位规则：相机位置可以为保持沙发同向而移动；先固定沙发位置和朝向，再移动相机到能看清产品的窗边侧前方、同向沙发的正前方或侧前方。相机实际仍在室内，靠近窗户/落地窗/窗帘这一侧或窗前采光区边缘；沙发应在机位对面或侧对面。相机只做水平旋转/水平摇镜，不做仰拍或俯冲，镜头轴线相对房间主轴约 35-45 度斜向室内，像从窗边斜看屋内。镜头轴线应从窗户/玻璃/窗帘侧或窗前采光区边缘看向沙发和室内家具，最终落到电视墙、柜体、内墙、会客区、地毯、灯具、绿植或屋内家具；画面尽头不能是窗户、落地窗、窗帘墙或窗外楼景。画面应像从窗边水平旋转约 40 度向屋内看，不是站在客厅里对着窗帘拍沙发，也不是沿着房间长轴一直拍到另一面窗户。窗户、窗帘、窗外景和玻璃反光只能占画面边缘或窄条，不能占据大面积前景或成为主体背景。不要从客厅深处朝窗户拍，不要把镜头朝室外拍，也不要让窗外楼景成为主体。";

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
  return `场景分析落位参考（仅在不违反房间融入专用规则时使用；如有冲突，必须忽略这里并执行最高优先级落位硬规则：沙发物理落在窗户/落地窗/窗帘正前方；如果房间里有现有沙发，必须先判断现有沙发正面向量，再让上传单人沙发与现有沙发同向，只允许约 5-15 度自然偏角；禁止让上传沙发反向、垂直、面对现有沙发或为了镜头改变朝向；机位可以移动到同向沙发的正前方或侧前方，相机在窗边或窗前采光区边缘水平旋转约 35-45 度斜向室内拍，画面尽头不能是窗户/窗帘，屋内家具是主背景）：placementSuggestion=${placement}；recommendedScale=${scale}；recommendedOrientation=${orientation}。`;
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
  const res = await fetch(`${SAAS_ORIGIN}/api/tool/verify`, {
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
  const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
  await readJsonResponse(consumeRes);

  const tokenRes = await fetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
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

  const uploadRes = await fetch(token.uploadUrl, {
    method: token.method || "PUT",
    headers: {
      ...token.headers,
      "Content-Type": "image/png",
    },
    body: imageBuffer,
  });
  if (!uploadRes.ok) throw new Error(`OSS upload failed: ${uploadRes.status}`);

  const commitRes = await fetch(`${SAAS_ORIGIN}/api/upload/commit`, {
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
  if (!commit.savedToRecords) {
    throw new Error(commit.error || "Failed to save record to SaaS");
  }
  return commit.image || commit;
}

const stylePrompts: Record<StyleId, string> = {
  minimal:
    "高端极简电商家具场景。为 La-Z-Boy Indian 单人躺椅生成舒展状态的商业图：现代室内或高级休闲空间，温暖自然光，干净建筑线条，质感地毯，自然材质，克制软装，画面整洁，有适度留白。光线柔和、有方向，上传产品的面料/皮革材质表现受控，接触阴影自然，整体像精修家居画册。",
  luxury:
    "奢华高端电商家具场景。为 La-Z-Boy Indian 单人躺椅生成舒展状态的商业图：高级客厅、精品酒店休息区或别墅角落氛围，石材/金属/艺术灯/手工地毯/装饰画等精致元素，暖色层次灯光与自然窗光结合。画面优雅、质感强，阴影柔和，上传产品的面料/皮革反光或纹理高级但不过曝。",
};

const viewPrompts: Record<ViewMode, string> = {
  wide:
    `远景图：先确定沙发固定落点，再把相机后退并使用较广角的室内远景构图，完整呈现房间、主要家具和沙发摆放关系。远景只改变相机位置、焦段和取景范围，不改变沙发落点、朝向和与窗帘/窗墙/窗户的真实空间关系。沙发是正常单人椅比例，占画面高度约 16%-24%，完整可见但不主导画面。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 远景可以看到完整空间，但必须能判断沙发位于窗前采光区；窗户/窗帘可以只在画面边缘或侧边作为落位证据，主视线仍应指向室内屋内家具，尽头不能是窗户或窗帘。可与已有长沙发保持合理距离，不必贴着已有沙发扶手。避免产品特写、沙发过大、过小或贴图感。`,
  mid:
    `中近景：先按最高优先级落位硬规则确定同一个沙发固定落点和沙发朝向，再把相机移动到更近的室内靠窗侧边、同向沙发的正前方或侧前方拍摄，形成中近景构图；即使用户直接选择中近景，也不能重新选择沙发落点或为了镜头改变沙发方向。中近景只表示相机更近、画面裁切更紧、焦段更集中，不允许移动沙发本体。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} 不要再把它限制到已有长沙发扶手外侧。沙发占画面高度约 32%-42%、宽度约 24%-34%。${WINDOW_SIDE_CAMERA} 中近景画面应拍到上传沙发和屋内一些物品，例如地毯、地板、边几、灯具、绿植、已有长沙发局部、电视墙、柜体、墙面或软装；这些屋内物品必须成为主要背景和视线终点。画面可以是相机相对同向沙发约 20-35 度的前侧三分之四视角，或在窗边空间受限时从同向沙发正前方略偏侧拍；这里的“前侧”只描述相机位置，不代表把沙发转向镜头。不是沿房间长轴直拍；如果参考房间已有沙发，则上传单人沙发必须和现有沙发同向，只允许相对现有沙发轻微转角，产品可见性通过移动机位解决。窗户只作为落位锚点和光源证据出现，可以在画面边缘或侧后缘露出窄窄的窗帘线、部分窗框、窗台、窗墙或柔和窗光；不要让窗帘墙、玻璃或窗外楼景占据大面积前景或背景。画面必须保留至少一个位置锚点，用来证明沙发就在窗户前面；沙发底座应清楚落在窗前采光区，而不是客厅中央空地。避免全屋远景、近景特写、背面主视角、从室内深处朝窗户拍、对着窗帘拍产品、画面尽头是窗户或窗帘、沿房间长轴直拍、房间中央摆放、茶几旁中心、电视前方、通道中央、为了镜头旋转沙发或比例失真。`,
  close:
    `近景：先按最高优先级落位硬规则确定同一个沙发固定落点，再把相机继续靠近或改变裁切，突出沙发材质、轮廓、坐垫和局部软装细节，同时保留能证明固定落点的环境锚点；即使用户直接选择近景，也不能重新选择沙发落点。近景只移动相机和裁切画面，不移动沙发本体，不改变沙发与窗墙、窗帘线、窗户的相对位置，也不改变沙发与现有沙发的大体朝向关系。沙发主体占画面约 60%-72%，环境约 28%-40%；如果主体过大会裁掉室内背景和窗前落位证据，则优先保留这些锚点并略微缩小主体。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 近景中窗户/阳台/采光面只是光源和落位锚点，画面必须出现窗帘线、窗框边缘、窗台、窗墙或柔和窗光中的至少一个，但只能作为边缘线索；背景优先保留地毯、地板、边几、灯具、墙面、柜体、电视墙或软装虚化，确保这是从窗边水平旋转约 40 度向室内拍的近景。避免棚拍抠图、纯微距、完整客厅远景、巨大椅子、房间中央摆放、对着窗帘拍产品、画面尽头是窗户或窗帘、沿房间长轴直拍、为了镜头改变沙发朝向或贴图感。`,
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
房间融入专用规则：${WINDOW_FRONT_PRIORITY} 不再要求贴着已有长沙发扶手外侧。${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 如果参考图原本不是这个机位，也必须优先满足“沙发在窗户前面、沙发与现有沙发同向、相机可以移动到同向沙发的正前方或侧前方、相机水平旋转约 40 度、画面尽头不是窗户”的关系。
房间融合规则：参考图只用于提取房间类型、主要元素、装修风格、材质、采光和空间气质；最终应在不违反房间融入专用规则的前提下重新生成一张风格类似的完整室内场景，不需要和原图布局、机位、角度或物品位置完全一样。但不得重组“窗户/窗帘/采光区、上传沙发固定落点”之间的相对关系。
根据房间图识别出的元素生成风格类似的新室内场景：保留同类门窗、墙地面材质、采光方式、装修风格和主要家具关系即可，不要逐像素复刻原房间。
用于风格、元素和光线参考的场景分析：${JSON.stringify(safeSceneAnalysis)}
${scenePlacementContext}
${elementEditingRules}
图 1 是准确的沙发产品参考，图 2 是房间和空间参考。
摆放逻辑：必须像真实室内设计师在现场布置。第一步先判断房间窗户、阳台、电视墙、通道、已有沙发/茶几/柜体的位置，并确定唯一固定沙发落点；第二步判断已有沙发的大体朝向，用靠背线、座面开口、扶手方向、抱枕方向和茶几/电视墙关系推断现有沙发正面向量；第三步把上传单人沙发的正面向量锁定为同一方向，只允许约 5-15 度自然偏角，不能转成相反方向、垂直方向、面对现有沙发或为了镜头改变朝向；第四步保持沙发位置和朝向不动；第五步只移动相机位置、焦段和裁切来满足当前视角。上传单人沙发应落在窗户、落地窗或窗帘正前方的室内采光区，靠近窗墙、窗帘线、窗台或落地窗内侧；如果有现有沙发，上传单人沙发必须与现有沙发同向，不再强行改成面向电视墙、面向镜头或面向室内的另一个方向；如果没有现有沙发，则保持沙发斜向屋内、方便使用。对于有大窗/窗帘的客厅，远景、中近景和近景都必须把沙发固定在窗帘线/窗墙/窗台前方附近，再通过相机远近和局部裁切形成对应视角；不要为了构图把沙发移到画面中央、茶几旁、电视前方或通道中央，也不要为了让产品正对镜头而旋转沙发本体。中近景机位可移动到室内靠窗侧边、窗户内侧边缘、同向沙发的正前方或侧前方；“正前方/侧前方”只描述相机相对已经锁定朝向的沙发在哪里，不表示重新给沙发定向。镜头像从窗前采光区边缘水平旋转约 35-45 度向室内拍摄，视线经过沙发后落到会客区、电视墙、柜体、内墙和屋内家具。不要沿房间长轴直拍到另一面窗户，不要让画面尽头是窗户/落地窗/窗帘墙，不要从客厅深处朝窗户方向拍，也不要对着窗帘墙拍产品。中近景画面必须保留至少一个位置锚点，例如窗帘线、窗墙、窗框边缘、窗台、柔和窗光或落地窗内侧，用来证明沙发在窗户前面；但这些窗户线索只能作为边缘或窄条，主背景必须是室内空间和屋内物品。不要把沙发放在房间中央、地毯中央、通道中央、茶几旁中心、电视前方、柜门前方或任何会阻挡动线的位置。
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

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
    });
  });

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.post("/api/tool/launch", async (req, res) => {
    try {
      const { userId, toolId } = req.body;
      const saasRes = await fetch(`${SAAS_ORIGIN}/api/tool/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, toolId }),
      });
      res.json(await readJsonResponse(saasRes));
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
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
          return res.json({
            imageUrl: dataUrl,
            saasError: saasError.message,
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

  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SofaGen AI running on http://localhost:${PORT}`);
  });
}

startServer();
