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
  "最高优先级落位：上传单人沙发必须物理保持在原图已有主窗/落地窗/窗帘前方的室内采光区，沙发背侧或一侧靠近原图真实存在的窗墙、窗台、落地窗内侧或窗帘线；窗户不需要占满背景，但沙发不能离开窗前采光区。窗户结构硬锁：只能使用参考图中已经存在的主窗和窗帘位置，禁止在右侧墙面、画作旁、落地灯旁、原沙发右侧或画面边缘新增第二扇窗、新落地窗、新白纱帘或额外强光窗。该规则高于构图和参考图复刻。画面必须能通过原有窗帘线、窗框、窗台、窗墙、柔和窗光或玻璃边缘判断沙发仍在窗户前面。禁止把沙发放到房间中央、地毯中央、茶几旁中心、电视前方、柜门前方、原沙发正前方或通道中央，禁止只把窗户当远处背景而沙发离窗很远。";

const FIXED_ROOM_SOFA_PLACEMENT =
  "唯一固定落点：如果参考房间里有现有沙发/长沙发，上传单人沙发只能放在原图已有主窗/窗帘前方的室内地面上，同时靠近现有沙发靠主窗一端的后侧外角；整把单人沙发必须位于现有沙发前沿线之后，也就是更靠窗、更靠墙、更靠后的位置，不得进入原沙发前沿线向相机、茶几或地毯中心延伸的前方区域。这个位置是唯一物理落点，不在原沙发左侧或右侧之间二选一，也不是地毯中央、茶几旁、原沙发正前方或前侧地面。";

const WINDOW_SIDE_CAMERA =
  `机位总规则：第一步只确定一次沙发的物理落点和朝向，并固定执行：${FIXED_ROOM_SOFA_PLACEMENT} 第二步所有视角都只移动相机位置、焦段、视角高度和裁切来形成当前视角。远景、中近景、近景绝不能重新选择沙发位置，不能为了构图、居中、完整展示或看见正面而移动沙发本体。三个视角互斥：远景是全屋建立镜头，只允许接近原图主机位的轻微后退/轻微升高/轻微广角化；中近景是完整产品环境主视觉，相机只用于观察已经斜向摆在唯一固定落点上的单人沙发，不要把相机需求解释成把沙发前移到原沙发前方；近景是材质与结构特写，相机明显靠近并允许局部裁切。背景只能来自原房间结构的裁切和平移，不要随机重组窗户、墙面和家具关系；禁止新增原图没有的第二扇窗、右侧落地窗、额外白纱帘、墙面开间或纯窗外景。`;

const SOFA_ORIENTATION_MATCH =
  `已有沙发避前硬锁：如果参考房间里有现有沙发、长沙发、贵妃位或清晰座位，先识别现有沙发的正面向量、前沿线、主窗一端、后侧外角、绿植/边几/灯具/柜体/地毯边界等尺度参照。${FIXED_ROOM_SOFA_PLACEMENT} 新生成的单人沙发/单人椅不要求 L 型，也不要求与现有沙发平行或同向；以约 15-35 度自然斜向摆放，像真实室内陈列一样略微转角。沙发可以不在图片中心，构图中心不重要，避开原沙发前方才是最高优先级。禁止放在现有沙发正前方、前侧地面、茶几通道、地毯中央前景或视觉前景里，哪怕只压到原沙发前沿一点点也视为错误。不要为了让产品居中、填满画面或正对镜头而把沙发挪到原沙发前面；如果需要看到正面或侧面，只能移动相机到唯一固定落点后的合适角度拍摄。尺寸硬规则：产品比例必须参考原房间里的长沙发、绿植、落地灯、边几、窗高、地砖和地毯尺寸，生成得比当前主视觉再小一档；整体只相当于长沙发的一个单座位或更小一点，不能接近双人位、不能比边几/落地灯/绿植显得异常庞大，不能成为占据客厅中心的大主体。只有在参考图没有可识别沙发时，才根据电视墙、会客区或主要活动区决定自然朝向。`;

const stylePrompts: Record<StyleId, string> = {
  minimal:
    "高端极简电商家具场景。现代室内或高级休闲空间，温暖自然光，干净建筑线条，质感地毯，自然材质，克制软装，画面整洁，有适度留白，整体像精修家居画册。",
  luxury:
    "奢华高端电商家具场景。高级客厅、精品酒店休息区或别墅角落氛围，石材、金属、艺术灯、手工地毯和装饰画等精致元素，暖色层次灯光与自然窗光结合。",
};

const viewPrompts: Record<ViewMode, string> = {
  wide:
    `远景图 / 全屋建立镜头（空间关系优先）：只展示原房间整体结构、窗户位置、主要家具关系和沙发真实落点，不是产品主视觉，也不是局部特写。机位身份必须接近原图主视角，只允许轻微后退、轻微升高或轻微广角化，镜头约 22-28mm 等效广角，平视或轻微俯视；不要推进到沙发前方，不要改成三分之四产品主图。必须保留原图的主窗位置、电视墙、原沙发区、茶几、地面反射、天花灯和主要墙面关系。不要新增窗户、扩大窗户、生成额外落地窗或把房间扩成原图不存在的左侧大窗空间。先按唯一固定落点确定沙发位置：${FIXED_ROOM_SOFA_PLACEMENT} 再保持沙发位置和朝向不动。沙发完整可见但不是最大主体，占画面高度约 9%-16%、宽度约 8%-18%，周围必须有明显地面、墙面和空间留白；至少 70% 画面用于展示房间。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 远景只需能判断沙发位于原房间窗边采光区，窗户、窗帘或窗光按原图结构出现，不强制成为整面主体背景。视角边界：禁止中近景产品主图、近景裁切、沙发过大、房间结构大幅改造、凭空增加窗户、把沙发放到房间中央、只拍单椅和一小块地毯或贴图感。`,
  mid:
    `中近景 / 产品环境主视觉（只改变机位，不改变沙发位置）：沙发物理位置、比例约束和斜向朝向必须完全继承已确定的唯一固定落点：${FIXED_ROOM_SOFA_PLACEMENT} 中近景只允许改变相机位置、焦段、视角高度和裁切，让沙发更清楚可见；绝不能重新摆放、前移、居中移动、旋转沙发本体或改变沙发与窗户、原沙发前沿线的相对关系。沙发仍然在原图已有主窗/窗帘前方的室内采光区，背景只能来自原房间结构的裁切和平移；必须保留原图主窗只有一组，右侧是画作墙和落地灯而不是窗户，禁止新增第二扇窗、右侧落地窗、额外白纱帘或原图不存在的窗墙。绝对不要把生成沙发放到原沙发正前方、前侧地面、茶几通道、地毯中央前景或视觉前景中，不能越过或压住原沙发前沿，哪怕一点点也不允许。推荐 35-50mm 等效中焦，平视或略低平视，相机看向窗前固定落点拍摄；沙发可以不在图片中心。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 沙发必须完整可见但要比当前主视觉更小，占画面高度约 14%-24%、宽度约 12%-22%，整体只相当于长沙发一个单座位或更小一点，靠背、扶手、坐垫、脚踏/底座和整体轮廓不能被裁掉。背景范围占画面约 60%-75%，参考地毯、地板、边几、灯具、绿植、已有沙发局部、电视墙、柜体、墙面、窗帘或窗户局部中的 2-4 类锚点判断真实比例；与这些物品相比宁可偏小，不能显得像双人沙发或客厅主沙发。视角边界：禁止全屋远景、近景裁切、房间中央摆放、原沙发前方摆放、茶几旁中心、电视前方、通道中央、新增窗户、为了镜头旋转沙发、为了画面居中前移沙发、比例失真或纯窗外景。`,
  close:
    `近景 / 材质与结构特写（局部细节优先）：目标是突出沙发材质、坐垫鼓包、扶手、靠背分区、缝线、脚踏连接和真实光影；不是全屋远景，也不是完整产品主视觉。先确定沙发仍在窗边固定落点，再只把相机明显靠近、提高焦段或改变裁切；不移动沙发本体，不改变沙发与窗边采光区的相对位置。推荐 50-85mm 等效中长焦，近距离平视或略低视角，景深可以更浅。沙发主体占画面约 50%-70%，允许且应当出现局部裁切，例如上半靠背+扶手+坐垫、扶手+坐垫+脚踏连接、正侧面局部、缝线与皮革/布料纹理；不强制完整看见整把椅子，但必须能识别为同一款上传产品。即使是近景，沙发的物理尺度也必须参考边几、落地灯、绿植、地毯/地砖和已有长沙发单座，整体只相当于真实单人椅，不能显得比图中其他物品异常大或像双人沙发。环境占约 25%-42%，作为虚化或边缘锚点；窗户/窗光可作为光源、边缘线索、局部背景或柔和高光，背景保留地毯、地板、墙面、边几、窗帘或软装局部用于校准尺寸。${WINDOW_FRONT_PRIORITY} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 视角边界：禁止完整客厅远景、完整产品主视觉、中近景完整构图、展示大量房间环境、棚拍抠图、纯微距到无法识别产品、房间中央摆放、为了镜头改变沙发朝向或贴图感。`,
};

const styleViewPrompts: Record<ViewMode, string> = {
  wide:
    "风格远景 / 完整空间建立镜头：空间关系优先，不是产品主视觉半身图。先在全新室内/生活方式场景中确定产品的自然陈列位置，再把相机明显后退，使用 22-28mm 左右较广角的完整房间/完整休闲区构图。产品应位于中景或中远景，占画面高度约 10%-18%、宽度约 8%-18%，完整可见但不占据画面中心大部分；至少 65% 画面用于展示环境。必须看到明确空间结构和多个尺度参照，例如大面积地面/地毯边界、墙面或窗帘、边几、灯具、绿植、装饰画、窗光或建筑线条。产品四周要有可见留白和落地区域，不能贴边或前景巨大。禁止中近景产品主图、产品特写、只拍单椅和一小块地毯、空棚拍、产品过大、过小或漂浮。",
  mid:
    "风格中近景 / 完整产品环境主视觉：产品完整和商业展示优先，不是完整房间远景，也不是局部特写。先确定产品在全新场景中的自然陈列位置，再把相机移动到更近的室内侧前方或侧前方拍摄，使用 35-50mm 中焦构图。中近景只表示相机更近、画面裁切更紧、焦段更集中，不表示重新摆放产品。产品必须完整可见，靠背、扶手、坐垫、脚踏、底座和整体轮廓都要进入画面，不裁掉主体边缘；产品占画面高度约 34%-48%、宽度约 26%-42%。环境占画面约 42%-58%，保留 2-4 个局部环境锚点，例如地毯/地板、边几、灯具、墙面、窗光、绿植或软装虚化。画面要像电商产品主图的环境版：产品清楚、比例真实、四周有呼吸空间。禁止全屋远景、产品过小、完整空间展示、近景特写、局部裁切、产品贴边、正面平拍、背面视角、巨大产品或比例失真。",
  close:
    "风格近景 / 材质结构特写：局部细节优先，不是完整产品主视觉。先确定产品在全新场景中的自然陈列位置，再把相机明显靠近，使用 50-85mm 中长焦或近距离裁切突出材质、轮廓、坐垫鼓包、扶手、靠背分区、缝线、脚踏连接和面料/皮革纹理。近景只移动相机和裁切画面，不重新摆放产品。产品主体占画面约 70%-88%，环境只占约 12%-30%，作为柔和背景或边缘尺度参照。允许并鼓励裁切掉产品的少量边缘，例如只展示上半靠背+扶手+坐垫，或扶手+脚踏+坐垫细节；不要求完整看见整把椅子，但必须能识别为同一款上传产品。若选择有模特，模特坐在沙发上即可，姿态自然、与沙发接触真实。背景只保留地毯/地板、墙面、窗光、边几或软装的局部虚化，不展示完整房间关系。禁止中近景完整产品图、完整椅子带大量环境、全屋远景、空棚拍、无法识别产品、漂浮脚踏或贴图感。",
};

function buildModelRequirement(viewMode: ViewMode, withModel: boolean) {
  if (!withModel) {
    return "模特要求：不要添加人物、人体局部、手、脚、倒影人物、海报人物或人形装饰；画面只展示产品和室内环境。";
  }

  if (viewMode === "close") {
    return "近景模特要求：模特坐在沙发上即可，姿态自然、与沙发接触真实。";
  }

  return "模特要求：加入一位自然入镜的真人模特，与产品形成真实尺度对比，姿态生活化，不能遮挡产品主体。模特应真实坐在或自然互动于沙发/躺椅上，身体重量落在坐垫上，腿部、手部、衣褶和阴影接触可信。";
}

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
    recommendedScale: "根据参考房间中的长沙发单座、地毯、地砖缝、边几、灯具、绿植、窗高、柜体和通道宽度判断偏小的真实单人椅比例；宁可小一档，不要接近双人位体量。",
    recommendedOrientation: `如果有现有沙发，先识别现有沙发的前沿线、正面开口方向、主窗一端、后侧外角、主窗位置和周边物品尺度，再执行：${FIXED_ROOM_SOFA_PLACEMENT} 沙发斜向约 15-35 度自然摆放；禁止放到原沙发正前方或前侧地面。${SOFA_ORIENTATION_MATCH}`,
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
  return `场景分析落位参考（仅作为参考；如有冲突，必须执行统一硬规则：沙发固定在原图已有主窗/落地窗/窗帘旁的室内采光区；禁止新增第二扇窗、右侧落地窗、额外白纱帘或原图没有的窗墙。如果房间里有现有沙发，先判断现有沙发前沿线、正面向量、主窗一端、后侧外角和周边物品尺度，再执行：${FIXED_ROOM_SOFA_PLACEMENT} 沙发斜向约 15-35 度自然摆放；不要求 L 型，沙发可以不在图片中心，禁止为了居中放到原沙发正前方或前侧地面；尺寸必须和长沙发单座、边几、落地灯、绿植、地毯/地砖相比偏小，宁可小一档，不要像双人位或客厅主沙发；生成时只移动相机位置、焦段和裁切。远景必须保留原图主视角和核心空间结构；中近景和近景只能裁切/平移原房间结构，不能重造窗户和墙面关系）：placementSuggestion=${placement}；recommendedScale=${scale}；recommendedOrientation=${orientation}。`;
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
  const modelRequirement = buildModelRequirement(viewMode, withModel);

  const shared = `
任务：生成一张专业电商家具场景图，主体是单人沙发/单人椅。
视角含义：只能执行用户当前选择的一个视角，不要混用其他视角。远景、中近景、近景分别对应不同机位、焦段、画面占比和背景范围；当前视角只表示镜头远近、取景范围、焦段和裁切，不表示随意改变产品比例或让产品漂浮。先确定一个自然可信的产品物理落点和朝向，并在后续所有视角中保持不动；然后只通过移动相机位置、焦段和裁切来形成当前视角。
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
房间融入专用规则：${WINDOW_FRONT_PRIORITY} 必须执行唯一固定落点：${FIXED_ROOM_SOFA_PLACEMENT} 并参照绿植、边几、灯具、柜体、地砖和地毯尺寸把沙发缩小到偏小的真实单椅比例；整体只相当于长沙发一个单座位或更小一点，不能像双人位或客厅主沙发。${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA}
房间融合规则：参考图用于提取房间类型、主要元素、装修风格、材质、采光和空间气质。必须保留原图主窗位置、窗户数量、窗帘范围、右侧画作墙、落地灯、原沙发区、电视墙、地面反射和主要墙面关系；只在这些结构内摆入沙发。中近景和近景可以裁切、平移和改变家具显隐，但不能自然重组出新窗户、新墙面开间、新落地窗或额外白纱帘。任何视角都不能改变“沙发固定在原图已有窗边采光区”这一空间关系，也不要凭空新增窗户或扩展房间。
用于风格、元素和光线参考的场景分析：${JSON.stringify(safeSceneAnalysis)}
${scenePlacementContext}
${elementEditingRules}
图 1 是准确的沙发产品参考，图 2 是房间和空间参考。
摆放逻辑：先判断原图已有主窗、阳台/窗帘、电视墙、通道、已有沙发/茶几/柜体、右侧画作墙和落地灯的位置；如果有现有沙发，再判断现有沙发的前沿线、正面开口方向、主窗一端、后侧外角和周边物品尺度；只确定一次上传单人沙发的物理落点：${FIXED_ROOM_SOFA_PLACEMENT} 并确认该落点仍位于原图已有窗户边/落地窗边/窗帘旁采光区，斜向约 15-35 度自然摆放；锁定沙发位置、比例、朝向和避开原沙发前方的关系，之后不得再移动沙发，只移动相机位置、焦段和裁切来满足当前视角。远景必须在原图核心空间结构内摆入沙发，不新增房间结构；中近景和近景可以通过相机远近、平移、旋转和局部裁切形成对应视角，背景只能来自原房间结构裁切，不能随机位新增窗户。禁止把生成沙发放到原沙发正前方、前侧地面、茶几旁、电视前方或通道中央。
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
  }。聚焦于：1. 房间类型和装修风格；2. 门窗、阳台、墙地面、主要家具和动线；3. 光线方向、阴影软硬、色温和曝光；4. 相机高度、透视线、地面平面和尺度参照；5. 单人沙发最合理摆放位置、尺寸比例和自然朝向。placementSuggestion 必须建议：${WINDOW_FRONT_PRIORITY} ${FIXED_ROOM_SOFA_PLACEMENT} ${SOFA_ORIENTATION_MATCH} ${WINDOW_SIDE_CAMERA} 不要建议新增第二扇窗、右侧落地窗、额外白纱帘、房间中央、原沙发正前方、前侧地面、茶几旁中心、地毯中央、通道中央或电视前方。recommendedOrientation 必须先描述图中现有沙发/长沙发的前沿线、正面开口方向、主窗一端、后侧外角、主窗位置和绿植/边几/灯具/柜体/地毯等尺度参照；如果有现有沙发/长沙发，上传单人沙发不要做 L 型，必须执行唯一固定落点，不允许写成左侧、右侧或侧后方多选，斜向约 15-35 度自然摆放，不能越过或压住原沙发前沿，哪怕一点点也不允许。只返回 JSON，字段包括 roomType、style、lighting、lightingDirection、colorPalette、cameraAngle、perspectiveCues、placementSuggestion、recommendedScale、recommendedOrientation、modelInteractionSuggestion、elements。elements 是需要保留的画面元素数组。`;

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
