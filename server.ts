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
type ViewMode = "wide" | "mid" | "close" | "model";
type StyleId = "minimal" | "luxury";

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
  const base = {
    roomType: "客厅",
    style: "现代高端客厅",
    lighting: "大面积窗户自然光与室内暖色灯带混合照明",
    lightingDirection: "以窗户方向的柔和自然光为主，室内暖光作为环境填充；沙发高光、阴影方向和接触阴影需要与地毯/地面一致",
    colorPalette: "中性色、米色地毯、浅色地面、黑色皮质沙发和冷暖混合光",
    cameraAngle: "平视或轻微俯拍",
    perspectiveCues: "参考地毯边缘、地砖缝、长沙发边线、电视墙和窗户框线判断地面透视与消失点",
    modelInteractionSuggestion: "如加入模特，身体应自然坐靠，脚部与地面或脚踏形成真实接触阴影",
    elements: ["地毯", "地面", "窗户", "长沙发", "灯光", "墙面"],
    analysisSource: "fallback",
    analysisWarning: error?.cause?.code || error?.message || "Gemini analysis unavailable",
  };

  if (viewMode === "close") {
    return {
      ...base,
      placementSuggestion:
        "近景只做沙发局部细节特写，使用地毯边缘、地砖缝、窗光或灯光作为少量场景线索，不展示完整客厅。",
      recommendedScale:
        "只显示扶手、坐垫、靠背缝线、脚部或侧拉杆等局部，画面中的产品局部可以较大，但隐含尺寸仍为正常单人沙发。",
      recommendedOrientation:
        "局部朝向应跟随地面透视和窗光方向，避免像棚拍抠图贴到场景上。",
    };
  }

  if (viewMode === "mid") {
    return {
      ...base,
      placementSuggestion:
        "中近景采用局部 seating area 裁切，可只展示地毯、长沙发一侧、窗帘/窗光、灯具或绿植局部；单椅应放在地毯上的自然休闲椅位置，避免房间几何中心和动线。",
      recommendedScale:
        "单人沙发在局部中景中可占画面高度约36%-50%，宽度约28%-42%，但必须明显窄于长沙发并保持真实单人椅尺寸。",
      recommendedOrientation:
        "沙发应略微朝向电视墙、长沙发或会客区，角度跟随地毯和地砖透视；上传产品图只作为款式参考，生成时可以改变朝向。",
    };
  }

  if (viewMode === "model") {
    return {
      ...base,
      placementSuggestion:
        "沙发和模特应放在地毯或会客区的自然座位位置，留出脚部落地和身体接触空间。",
      recommendedScale:
        "沙发按真实单人椅尺寸处理，座高接近成人膝盖，扶手接近肘部，靠背不应大到吞没人体。",
      recommendedOrientation:
        "沙发朝向应与会客区一致，模特坐姿、手脚接触和阴影要自然。",
    };
  }

  return {
    ...base,
    placementSuggestion:
      "远景保留完整空间，但单人沙发应放在自然会客区，例如地毯上、长沙发旁或面向电视墙/长沙发的位置，避免远窗边小模型感和房间正中心。",
      recommendedScale:
      "远景中单人沙发约占画面高度16%-24%、宽度12%-20%，清晰可辨但小于长沙发，背高接近或略高于长沙发靠背。",
    recommendedOrientation:
      "沙发通常与电视墙或长沙发形成15-35度自然夹角，跟随地面透视与会客动线；上传产品图方向不应锁定最终朝向。",
  };
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
    "high-end minimalist ecommerce furniture campaign for a La-Z-Boy Indian single recliner in fully extended reclining state. Premium contemporary interior or refined outdoor-lounge inspired setting, warm natural daylight, clean architectural lines, textured rug, subtle natural materials, linen or travertine tones, curated side props, generous negative space, editorial catalog composition, no clutter. Lighting design: large soft side key light, gentle warm fill, controlled highlights on leather, soft contact shadows, polished but natural floor/rug texture, premium commercial retouching.",
  luxury:
    "luxury high-end ecommerce furniture campaign for a La-Z-Boy Indian single recliner in fully extended reclining state. Sophisticated premium living room, boutique hotel lounge, luxury villa corner, or elevated resort terrace mood; stone or marble details, sculptural lamp, refined metal accents, handmade rug, elegant wall art, layered warm ambient lighting, cinematic natural highlights. Lighting design: soft directional window light plus warm practical lights, 1:3 contrast ratio, glossy leather highlights controlled and elegant, deep but soft shadows, premium editorial furniture photography.",
};

const viewPrompts: Record<ViewMode, string> = {
  wide:
    "远景: Wide shot: ecommerce full-room interior photograph using a 24-30mm wide-angle lens, moderate depth of field at f/5.6-f/8. Camera height 1.35-1.55m, level verticals, no extreme ceiling-dominant distortion. Shoot from about 3.5-5 meters away from the key furniture. The single armchair must remain clearly readable as the hero furniture, not a tiny distant prop. Place the armchair in a plausible seating zone, usually within the same seating group as the existing couch and TV, not randomly centered in an empty walkway. The chair should occupy about 18-28% of image height and 14-24% of image width; smaller than a three-seat couch but large enough to see cushion structure and side arms. The floor should occupy about 35-45% of the image in the lower area. Use partial-entry composition: furniture may be partially cropped at the side edges, such as sofa arm, coffee table edge, or only the left half of the couch. Walls, curtains, and lamps may appear only at the frame edges; the full room architecture and all four walls need not be shown. The reference scene image provides atmosphere only and does not need to be preserved in full. Create a design-forward ecommerce home catalog style with clean negative space reserved for text. Use soft diffused side-window natural light, natural floor sheen, and gentle furniture shadows. Single-point perspective, floor seams guide depth. The armchair must remain realistically scaled to the room, with correct floor contact, not oversized or floating. Retain a recognizable room atmosphere, but avoid huge empty ceiling taking over the frame.",
  mid:
    "中近景: Mid shot: product detail medium close-up, not a full-room placement image. Show about 70-95% of the single armchair: full seat cushion, one armrest, back cushion, and partial leg/base structure. It is acceptable and preferred that surrounding furniture and architecture are partially outside the frame; do not force the complete room to appear. Include only a small partial scene context such as a rug edge, floor seam, curtain/window light corner, side-table edge, lamp blur, plant pot fragment, or wall material patch, taking about 15-30% of the frame. Use a 40-55mm lens feeling, camera 1.4-2.4m from the product, shallow depth of field at f/2.8-f/4, soft side-window natural light, tactile fabric/leather grain, believable contact shadow only where the chair meets the floor. The visible armchair should occupy 40-60% of the image because it is a medium close-up crop, but its implied real-world size must remain a normal single-person armchair; never show a giant full chair dominating an intact living room. The reference scene image provides atmosphere only and need not be preserved in full; walls may fall outside the frame, curtains need only appear as a light streak, and the complete spatial structure is not required.",
  close:
    "近景: product detail close-up, not a full-room placement image. Show only a cropped portion of the single armchair/sofa: cushion texture, armrest, stitching, back cushion edge, seat-front panel, lever, leg, or 1-2 connected structural details. It is acceptable and preferred that the sofa is partially outside the frame; do not force the whole chair to appear. Include only a small partial scene context such as a rug edge, floor seam, curtain/window light, side-table edge, lamp blur, or wall material, taking about 20-35% of the frame. Use a 50-70mm lens feeling, camera 0.8-1.2m from the product, shallow depth of field at f/2.8-f/4, soft side-window natural light, tactile fabric/leather grain, believable contact shadow only where the cropped part meets the floor. The visible sofa part may occupy 55-75% of the image because it is a close-up crop, but its implied real-world size must remain a normal single-person armchair; never show a giant full chair dominating an intact living room.",
  model:
    "模特: Model shot: include one tasteful lifestyle model naturally sitting on or interacting with the armchair, face may be partially visible or turned away, posture relaxed and unposed, product remains the main subject and must not be blocked. Match the lighting direction and quality of the reference scene image exactly: if the scene has soft diffused side-window light, the model must be lit from the same direction with the same softness; if warm afternoon sun, the model carries the same warm tone and shadow angle; if cool overcast ambient, the model blends into that flat cool atmosphere. No artificial studio lighting that contradicts the scene. Use the model's body as a strict scale reference: the armchair must fit one adult naturally, with seat height around knee height, armrests around elbow height, backrest below or slightly above shoulder/head depending on the product, and believable leg/foot placement on the floor. The model's body weight, legs, hands, clothing folds and shadows must interact naturally with the chair fabric and structure. Clothing should be casual lifestyle attire in neutral tones that complement the chair color without clashing. Do not enlarge the chair to fit the composition; scale the chair, model, rug, floor, lamp and wall art consistently. The reference scene image provides atmosphere and lighting reference; walls and decor may be partially cropped, only the lighting environment must be preserved.",
};

function buildGenerationPrompt({
  mode,
  styleId,
  sceneAnalysis,
  selectedElements,
  removedElements,
  addedElements,
  viewMode,
}: {
  mode: SceneMode;
  styleId: StyleId;
  sceneAnalysis?: any;
  selectedElements?: string[];
  removedElements?: string[];
  addedElements?: string[];
  viewMode: ViewMode;
}) {
  const shared = `
Task: Generate a professional ecommerce image for a single-person sofa / armchair.
Product fidelity is critical: preserve the uploaded sofa's exact shape, fabric texture, color, proportions, legs, seams, cushions and design language. Do not invent a different sofa.
The uploaded product image is a product identity reference, not a fixed 2D cutout or fixed camera angle. You may and should rotate the sofa in 3D, change its yaw angle, show the other side, or infer a slightly different camera-facing view when the room layout requires it. Preserve the same product design, cushion structure, fabric, color, lever position logic and proportions, but do not copy the product photo's original facing direction if it conflicts with the scene.
No text, logo overlays, watermarks, UI elements, price tags, labels, or banners.
Use realistic lighting, contact shadows, material reflections, correct perspective and physically plausible scale.
Lighting must match the scene: direction, softness, color temperature, shadow length, highlight intensity and ambient fill should be consistent across the sofa, room and model if present.
Scale must match the scene: size the sofa according to floor area, nearby furniture, wall height, camera distance and perspective. Avoid oversized, miniature, floating or pasted-on results.
Orientation must match the scene: rotate and place the sofa according to the room layout, floor perspective lines, vanishing point, seating direction and nearby furniture arrangement. Scene logic has priority over the uploaded product photo's original angle.
If a model is present, make the pose natural and physically plausible. The model should sit or interact with the sofa with believable weight, contact shadows, hand placement, leg position and clothing folds. Do not let the model cover the product's key silhouette.
Output should look like a finished product-in-scene commercial photo for an online store.
Camera/view requirement: ${viewPrompts[viewMode]}
`;

  const roomFramingStrategy =
    viewMode === "wide"
      ? `
Scene framing strategy for wide view:
Use the uploaded room image as a close layout reference. Preserve the recognizable room structure, major wall/floor/window relationships, lighting direction and main decor placement.
Compose a believable full-room catalog shot: the room should remain spacious, but the product must still be a readable hero item rather than a tiny object at the far window.
Keep the original seating logic. Place the single armchair in a natural seating zone on or near the rug, aligned to the sofa/TV/window relationship, with correct distance from the couch and wall.
Recommended placement: use a believable empty lounge-chair position, such as the open left/center-left area of the rug angled toward the TV or couch, or a side seating position near the couch conversation zone. Do not place the chair dead-center on the rug unless the original room layout clearly supports that.
Control the camera so ceiling and floor do not overwhelm the product. Prefer a balanced room view with the chair in the middle ground and visible contact shadows.`
      : viewMode === "close"
        ? `
Scene framing strategy for close view:
The output should be a cropped sofa detail photograph, not a rebuilt whole-room scene and not a full sofa replacement in the original room.
Use the uploaded room image only for local visual cues: lighting direction, color temperature, rug/floor/wall material, and at most 1-2 blurred or partial recognizable elements.
Crop into the sofa so that only connected parts of the product are visible. The sofa can enter from the bottom, left, or right edge and may be cut off by the frame.
Show just enough surrounding scene to prove the material and lighting belong to the room. Avoid showing a complete living room with a complete oversized chair in the middle.
Judge scale from implied product details: cushion thickness, armrest height, stitch spacing, leg size, rug weave, floor seams and nearby partial objects must all feel normal-sized.`
      : viewMode === "mid"
        ? `
Scene framing strategy for mid view:
Do not copy the entire uploaded room image or force all original objects to appear.
Use the uploaded room image as a partial scene reference: inherit its lighting direction, color temperature, floor/wall materials, window feeling, rug texture, decor language and 1-3 selected recognizable elements.
Show a local seating-area crop, not a complete room. It is acceptable and preferred to crop out most of the ceiling, far walls, TV wall and distant decor if that makes the chair scale more natural.
Place the chair in a plausible seating position, not simply in the geometric center of the room. Prefer a cropped view of the open rug/seating zone, angled toward the TV or toward the couch, with enough floor/rug contact visible to prove it is standing in the scene.
Keep at least one partial scale reference nearby, such as a couch edge, table edge, lamp base, plant pot, floor seam, rug border or curtain edge. These references may be cropped or softly blurred.
Prioritize realism, physical scale, clean ecommerce composition and natural camera framing over exact scene reconstruction.
The final image should look like a real photograph taken in the same design language as the uploaded room, not a literal full-scene copy.`
        : `
Scene framing strategy for model view:
Use the uploaded room image as an atmosphere and material reference rather than a strict layout copy.
Keep lighting, color temperature, wall/floor material feeling and a few room cues, but compose a natural lifestyle scene around the sofa and model.
The model, sofa and local scene should feel physically coherent and naturally photographed.
Use human ergonomics to validate scale: one adult should sit comfortably without making the chair look like a giant throne or two-seat sofa. The model's knees, elbows, shoulders, feet and hip width should align with a real single armchair.`;

  if (mode === "room") {
    const elementEditingRules =
      viewMode === "close"
        ? `
Strict element editing instructions for close view:
- In close view, selected scene elements are local visual cues, not a requirement to show the full room.
- Keep only 1-2 useful selected elements as cropped edges, textures, reflections, or softly blurred background cues: ${(selectedElements || []).join(", ") || "none"}.
- MUST DELETE these recognized scene elements completely from the final image if they would appear: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with physically plausible wall, floor, rug, furniture surface or background that matches the original scene.
- MUST ADD these user-requested objects as real physical objects only if they fit the close-up crop: ${(addedElements || []).join(", ") || "none"}. Add each item with correct scale, perspective, lighting direction, contact shadows, material response and natural placement.
- Do not expand the camera outward just to satisfy the keep list. The close-up crop is more important than showing many room elements.`
        : viewMode === "mid"
          ? `
Strict element editing instructions for mid view:
- In mid view, selected scene elements are local scene cues. Do not show the entire uploaded room just to include every selected element.
- Keep 1-3 useful selected elements visible as partial, cropped, or softly blurred scale/context references: ${(selectedElements || []).join(", ") || "none"}.
- Prioritize elements that help placement and lighting, such as rug, floor seams, couch edge, window/curtain light, lamp, plant, table edge, or wall material.
- MUST DELETE these recognized scene elements completely from the generated crop if they would appear: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with plausible matching material.
- MUST ADD these user-requested objects as real physical objects only if they fit the partial-scene composition: ${(addedElements || []).join(", ") || "none"}. Add each item with correct scale, perspective, lighting direction, contact shadows, material response and natural placement.
- The mid-view crop and natural sofa placement are higher priority than preserving a full list of room objects.`
          : `
Strict element editing instructions:
- MUST KEEP these recognized scene elements visible and recognizable: ${(selectedElements || []).join(", ") || "none"}.
- MUST DELETE these recognized scene elements completely from the final image: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with physically plausible wall, floor, rug, furniture surface or background that matches the original scene.
- MUST ADD these user-requested objects as real physical objects in the final image: ${(addedElements || []).join(", ") || "none"}. Add each item clearly enough to be recognizable, with correct scale, perspective, lighting direction, contact shadows, material response and natural placement in the room.
- The keep/delete/add lists are hard constraints. Do not treat them as optional style suggestions.`;

    const placementLightingRules =
      viewMode === "mid"
        ? `
Placement and lighting rules for mid view:
Use a local crop of the reference room. The generated frame may show only 35-60% of the original room width and should usually crop out most of the ceiling.
Choose a believable seating position on the rug or immediately beside it, aligned with the room's existing conversation/TV layout. The chair should face slightly toward the TV wall, couch, or room center, not straight at the camera unless the perspective supports it.
Rotate the product naturally for that position. Do not preserve the product upload's original left-facing/right-facing angle if the seating zone needs another yaw direction. Reconstruct the same chair from the new view as a real 3D object.
Do not place the chair in the exact center of a wide empty room. Do not block the couch unnaturally. Leave enough walkway/floor around the chair to feel placed by an interior designer.
Match the reference lighting: in this room, daylight comes mainly from the large rear/side windows with warm ceiling strip/practical light. The chair should have soft cool daylight highlights from the window side, warmer fill from ceiling/ambient light, and contact shadows falling consistently on the rug/floor.
The chair's shadow should be soft, attached under the base/legs, and consistent with the rug texture. Avoid pasted-on edges, different color temperature, or studio lighting that ignores the room.`
        : viewMode === "wide"
          ? `
Placement and lighting rules for wide view:
Preserve the full-room layout, but choose a natural lounge-chair placement within the seating group: on the open rug area, near a side of the couch, or angled toward the TV/window conversation zone.
Do not place the chair at the far window unless the room analysis explicitly identifies that as the seating zone. Do not place it dead-center in an empty walkway. Keep realistic clearance from the couch, TV wall, plant, window and rug border.
The chair orientation should follow the floor perspective and seating logic, usually angled 15-35 degrees toward the TV wall or couch rather than randomly facing the camera. The chair may face left, right, away from camera, or three-quarter to camera as needed; do not lock it to the uploaded product photo's angle.
Match the reference lighting: daylight comes mainly from the large windows, while warm ceiling strip/practical lights add ambient fill. The chair must share the same cool/warm balance, soft shadow direction, highlight side, and rug/floor contact shadows as the room.
Avoid studio-lit or pasted-on product lighting. The chair should inherit room reflections, ambient color and shadow softness.`
          : "";

    const viewQualityRules =
      viewMode === "mid"
        ? `
Mid-view final self-check before generating:
- The image must read as a cropped partial-scene product shot, not as the original full room with a chair inserted.
- Only part of the surrounding room should be visible; most ceiling and far-room context should be cropped away.
- The chair must sit in a plausible seating position with natural clearance, angle and floor contact.
- The chair must pass a physical scale check: one adult seat, narrower than a couch module group, backrest around couch-back height or slightly higher, seat height near normal knee height.
- The product identity must pass a 3D orientation check: same sofa model, but rotated naturally for the room, not copied from the upload angle.
- The chair's highlight side, shadow side, contact shadow softness and color temperature must match the reference room lighting.`
        : viewMode === "wide"
          ? `
Wide-view final self-check before generating:
- The image must read as a full-room catalog shot with a naturally placed single lounge chair.
- The chair must be clear but not oversized, in a real seating zone rather than the exact room center or far window.
- The chair orientation must make sense relative to the couch, TV wall, rug and room perspective.
- The chair must pass a physical scale check: one-person recliner/armchair, smaller than the multi-seat couch, not taller than room elements, and not scaled from the uploaded product photo's frame size.
- The product identity must pass a 3D orientation check: same sofa model, but rotated naturally for the room, not copied from the upload angle.
- The chair's light, reflections and shadows must match the window daylight plus warm interior ambient lighting.`
          : "";

    const physicalScaleRules =
      viewMode === "wide" || viewMode === "mid"
        ? `
Physical scale procedure:
1. First estimate the room's real scale from visible anchors: couch seat modules, rug width, floor tile seams, wall art, plant pot, lamp, window height and cabinet height.
2. Then place the sofa as a real single-person recliner on that floor plane. Treat it as about 0.8-1.0m wide, 0.85-1.05m deep and 0.85-1.1m tall.
3. Only after the real-world size is fixed, choose camera crop and image framing. Never enlarge the sofa just because the uploaded product photo fills its frame.
4. If the product appears too large for the rug, couch, lamp or wall art, reduce it or move/crop the camera; do not make the room scale bend around the product.`
        : "";

    const roomScaleRules =
      viewMode === "close"
        ? `
Close-up scale and crop rules:
This is a product detail close-up. Do not compose a complete armchair sitting in a complete living room.
Show a cropped detail region of the uploaded sofa, such as the armrest plus seat cushion, back cushion stitching, front apron plus leg, side lever plus cushion seam, or the recliner padding transition.
Only a portion of the sofa should be visible. The full outline, full back, full seat, and full floor footprint should not all be visible at once.
The visible product area can be large in the frame because it is cropped close, but the implied object scale must remain realistic: normal cushion thickness, normal arm width, normal leg size, normal stitch spacing, and normal relation to rug weave or floor seams.
Use the room reference as partial context only. Show 1-2 local scene cues at the edges or softly blurred in the background, not an intact room.
If a selected scene element is large, such as a window, sofa, wall art, or coffee table, it may appear only as a cropped edge, reflection, texture, or blurred background cue in close view.
Negative constraints for close view: full oversized chair centered in the room, full living-room reconstruction, giant chair, tiny room, mismatched floor contact, excessive visible rug around every side, distant wide-angle perspective, product pasted onto a complete scene.`
        : viewMode === "wide"
          ? `
Wide-view scale rules:
The sofa must be a normal single-person armchair, approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, wall art, floor tiles, rug, lamp and room height.
Show the complete armchair with all main product structure visible. It should occupy about 16-24% of the image height and 12-20% of the image width in a full-room composition. Use these numbers only after checking real scale anchors.
The chair must be clearly readable and not miniature. Cushion divisions, armrests and back height should remain visible, but it must not become the dominant foreground object.
The chair must be smaller than a three-seat sofa and should be roughly one lounge-chair seating module: about one couch seat plus armrest in width, not two couch seats. Its back height should align with a normal lounge chair: around couch-back height or modestly higher, not near window, wall-art, cabinet or lamp height.
Use the rug, couch seat modules, floor tile seams, plant pot, lamp height and wall art as physical measuring references before choosing image size. Do not decide size from the product photo alone.
Place it in the room's middle ground on the floor/rug plane. Do not push it all the way to the far window like a small toy, and do not pull it into the foreground like a giant object.
Preserve full-room context, but keep the ceiling, floor and negative space balanced so the product does not disappear.
Negative constraints for wide view: tiny distant chair, dollhouse scale, chair lost in empty room, oversized chair blocking the seating area, extreme fisheye room, ceiling-dominant composition, pasted-on product.`
        : viewMode === "mid"
          ? `
Mid-view scale rules:
The sofa must be a normal single-person armchair, approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, rug, lamp, floor seams, couch and wall height.
Show the entire chair or most of the chair. Cropping one side, the footrest edge, or the top edge slightly is acceptable when it improves product-medium-shot composition, but keep the main product identity readable.
The chair should occupy about 36-50% of image height and 28-42% of image width. It should look like a medium product shot in a cropped room area, not a close-up giant chair and not a full-room distant chair.
The chair width should be about one single lounge chair, clearly narrower than the multi-seat couch and no wider than one couch seat plus armrest. It should not span most of the rug width or block the room walkway.
Use nearby partial furniture as scale anchors before sizing: couch seat width, rug weave and border, floor tile seams, table/lamp/plant size, wall art height. Keep visible rug/floor contact around the chair base, especially in front and one side, so the viewer can judge its footprint.
Prefer a cropped local seating-zone composition with very limited ceiling. If the reference room has a large ceiling, crop lower and closer rather than enlarging the chair inside a full-room wide view.
Negative constraints for mid view: full-room wide-angle view, giant chair dominating the room, chair wider than the couch seat group, huge recliner blocking the sofa, extreme wide-angle distortion, complete room shown with product too small, floating base, mismatched shadow, wrong lighting direction.`
        : `
Scale the sofa as a real single-person armchair in the room.
The sofa should be approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, wall art, floor tiles, rug, lamp and room height.
For scene integration, the sofa should occupy only 28%-40% of the image height.
For model view, the sofa and model together should look like a realistic single-person seating setup. The sofa should not exceed about 40%-48% of the image height in a normal lifestyle composition, and the model should not appear miniature relative to the chair.
The sofa width should not exceed 45%-55% of the visible rug width, and should be clearly smaller than the main wall art or background wall area.
Keep visible floor and rug space around the sofa on all sides.
Do not make the sofa oversized, giant, floating, pasted-on, or closer to camera than the room perspective allows.`;

    return `${shared}
Use the uploaded room scene as the reference environment. Preserve its lighting direction, color temperature, wall/floor materials, decor language and spatial logic. For wide views, keep the room layout more recognizable. For mid, close and model views, preserve only the useful local scene cues needed for a natural photograph.
${roomFramingStrategy}
Scene analysis to preserve: ${JSON.stringify(sceneAnalysis || {})}
${elementEditingRules}
Image 1 is the exact sofa product reference. Image 2 is the room scene reference.
Do not redesign, reshape, inflate, simplify, merge, or invent any part of the sofa. Preserve the product identity, not the original 2D product-photo pose.
The generated sofa must preserve the same cushion layout, armrest shape, backrest height, seams, stitching, legs, fabric/leather texture, color and physical proportions from Image 1, but it may be rendered from a different camera angle or facing direction to match the room.
If the uploaded product image is front-facing, side-facing, left-facing, right-facing, upright, or photographed from a product studio angle, infer the same real chair rotated into the scene's natural orientation. Do not paste the uploaded product image as a flat cutout.
Do not add extra cushions, extra panels, oversized footrests, recliner mechanisms, or change the sofa into a bulky massage chair.

${roomScaleRules}

${placementLightingRules}

${viewQualityRules}

${physicalScaleRules}

Before placing the sofa, infer the floor plane, tile seams, rug size, vanishing point, camera height, wall scale, lamp height and surrounding furniture size.
Place the sofa on the floor plane with correct contact shadows.
Rotate the sofa to match the room layout and floor perspective lines.
The sofa front direction should align naturally with the seating area, not randomly face the camera.

Integrate the exact uploaded single sofa into the reference room as a real physical object, not as a redesigned generated chair.
Use the room's floor grid, rug size, wall art, lamp and furniture as scale references.
Choose the sofa distance according to the selected view and room layout; for mid view, crop the scene closer instead of pushing the chair farther back.
The sofa must remain a single-person armchair size and must not dominate the room.
Preserve enough negative space, visible rug, visible floor and surrounding decor.
Match the room's lighting direction, shadow softness, color temperature and perspective.
If an existing chair or empty seating zone is implied, place the sofa there.
Before generating, infer the room's light source, camera height, vanishing point, floor plane, available placement zone and furniture orientation. Use those cues to choose the sofa position, size, rotation and facing direction.
The sofa must sit on the floor with correct contact shadows and occlusion. Its front/back/side orientation should feel intentional within the room layout, not randomly facing the camera. Match shadows and perspective to the reference photo.
For model view specifically: the model's thighs should rest on the seat, back should contact the back cushion naturally, feet should meet the floor or footrest believably, and shadows should show real contact between body, sofa and floor. Do not scale the sofa larger to make the model fit.
Negative constraints: oversized sofa, giant chair, two-seat sofa, bulky massage chair, model looks tiny, model swallowed by chair, distorted human anatomy, distorted cushions, changed armrest shape, changed backrest shape, extra seams, extra pillows, floating object, wrong perspective, pasted-on product, incorrect scale.`;
  }

  return `${shared}
Create a brand-new scene using this chosen style: ${stylePrompts[styleId]}.
The uploaded product image is the exact reference for a La-Z-Boy Indian single recliner. The final generated product must be shown in the extended reclining state, similar to a premium ecommerce hero image: backrest slightly reclined, footrest fully extended forward, continuous padded cushion structure visible, plush segmented leather panels, side lever if visible, and the relaxed lounge posture clearly communicated.
If the uploaded reference is upright, closed, or photographed from a different angle, infer the same chair unfolded into its correct extended recliner state while preserving the product identity, brown leather color, cushion layout, armrest shape, stitching, seams, material texture and proportions.
Do not generate a generic armchair, ordinary sofa, two-seat couch, massage chair, or redesigned recliner. Do not add text, barcode, labels, poster typography, logos, watermarks or graphic overlays.
The extended footrest must look mechanically plausible and connected to the chair body, not floating or detached. Keep the chair realistically scaled as a single-person recliner in the scene.
Build the scene around the extended recliner with coherent interior styling, uncluttered composition, high-end ecommerce product clarity and beautiful lighting.
Choose a natural recliner orientation for the room layout, then make lighting, scale, camera angle and shadows coherent. If the selected view includes a model, the model must look candid, balanced and naturally supported by the extended recliner.`;
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

      const analysisViewInstruction =
        viewMode === "close"
          ? "用户选择了近景。请不要给完整客厅摆放方案，而要分析可用于局部特写的场景线索：光线方向、地毯/地板/墙面材质、可在边缘或虚化背景中保留的1-2个元素、适合拍摄沙发扶手/坐垫/靠背/缝线/脚部/侧拉杆细节的位置。recommendedScale 应说明这是局部细节裁切，沙发只显示局部，但隐含尺寸仍为正常单人沙发。placementSuggestion 应写成局部特写构图建议。"
          : viewMode === "mid"
            ? "用户选择了中近景。请给出类似近景的局部空间融入建议，可以只展示房间一角或局部 seating area，不要要求完整客厅入镜。分析适合截取哪些局部场景线索，例如地毯边缘、沙发一侧、窗帘/窗光、落地灯/绿植/边几局部、地砖缝。沙发应完整或大部分可见，位于合理的休闲椅摆放区，不能放在房间几何中心或堵住动线，朝向应与电视墙/长沙发/会客区自然关联。上传产品图方向只作为款式参考，最终朝向可以改变，请在 recommendedOrientation 中明确建议旋转角度和朝向。recommendedScale 应参考地毯、长沙发、茶几/边几、灯具、地砖缝和墙高，说明单人沙发在局部中景里可占画面约36%-50%高度但真实尺寸仍为单人椅。请特别判断光线方向、冷暖色温和阴影软硬，让生成沙发继承窗户自然光与室内暖光。placementSuggestion 应给出中景产品构图建议。"
            : viewMode === "model"
              ? "用户选择了模特视角。请重点分析人体与单人沙发的比例、坐姿接触、脚落地和阴影关系。"
              : "用户选择了远景。请分析完整空间中的合理摆放、朝向、尺寸和光线。沙发需要是完整空间中的清晰主角，不能被放到窗边远处小到像玩具，也不能前景巨大遮挡空间。请优先判断自然的休闲椅摆放区，例如地毯上的会客区、长沙发旁边或面向电视墙/长沙发的角度，避免房间几何中心和动线区域。上传产品图方向只作为款式参考，最终朝向可以改变，请在 recommendedOrientation 中明确建议旋转角度和朝向。recommendedScale 应参考三人沙发、地毯宽度、窗高、电视墙/书柜和地砖缝，说明单人沙发在全屋图中应保持正常单椅比例且细节仍可辨认。请特别说明窗户自然光、室内暖光、阴影方向和接触阴影应该如何匹配。";

      const scene = parseDataUrl(sceneImage);
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: {
          parts: [
            {
              text:
                `请分析这张室内场景图，用于把单人沙发融入场景。${analysisViewInstruction}只返回 JSON，字段包括 roomType、style、lighting、lightingDirection、colorPalette、cameraAngle、perspectiveCues、placementSuggestion、recommendedScale、recommendedOrientation、modelInteractionSuggestion、elements。elements 是字符串数组，列出需要保留的画面元素，例如墙面、地板、窗户、茶几、地毯、灯具、绿植、装饰画等。重点判断光线方向、阴影软硬、相机高度、地面透视线、沙发应放在哪里、应多大、应该朝向哪里。`,
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
        placementSuggestion: "将单人沙发放在画面主要留白区域",
        recommendedScale: "与附近茶几、地毯、墙面高度保持合理比例",
        recommendedOrientation: "朝向房间主要活动区或与现有家具形成自然夹角",
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
      const parts: any[] = [
        {
          text: buildGenerationPrompt({
            mode,
            styleId,
            sceneAnalysis,
            selectedElements,
            removedElements,
            addedElements,
            viewMode,
          }),
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
            prompt: buildGenerationPrompt({
              mode,
              styleId,
              sceneAnalysis,
              selectedElements,
              removedElements,
              addedElements,
              viewMode,
            }),
          });
        } catch (saasError: any) {
          console.error("SaaS Save Error:", saasError.message);
          return res.json({
            imageUrl: dataUrl,
            saasError: saasError.message,
            prompt: buildGenerationPrompt({
              mode,
              styleId,
              sceneAnalysis,
              selectedElements,
              removedElements,
              addedElements,
              viewMode,
            }),
          });
        }
      }

      res.json({
        imageUrl: dataUrl,
        prompt: buildGenerationPrompt({
          mode,
          styleId,
          sceneAnalysis,
          selectedElements,
          removedElements,
          addedElements,
          viewMode,
        }),
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
