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
    "远景: Wide-angle interior room shot from a pulled-back camera position. This is the same room and same sofa placement logic as mid view; only the camera moves farther back and wider. Use a 24-30mm wide-angle lens feeling, camera height 1.35-1.55m, level verticals, moderate depth of field at f/5.6-f/8, and complete-room composition. Show the room, main furniture, floor/rug, walls, windows/doors or balcony area when present, and the relationship between the single sofa and surrounding furniture. Placement priority: first place the single sofa near the window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface when reasonable. Only if that area blocks a passage, door swing, cabinet opening, TV viewing line, traffic flow, or creates an obviously unreasonable layout, use the second priority: place it beside the existing main sofa / couch side within the conversation area. The chair should be fully visible and readable, correctly scaled as one-person furniture, with floor contact and realistic shadows. It should not be a close-up or medium product portrait.",
  mid:
    "中近景: Medium interior product shot from the same room and same sofa placement logic as the wide view; only move the camera closer. Use a 40-55mm lens feeling, camera about 2.8-4 meters from the single sofa, camera height 1.25-1.5m, and natural perspective. Placement priority: first place the sofa near the window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface when reasonable, in the adjacent indoor seating zone near that light area, not centered directly in front of the glass wall and not blocking the view, walkway, couch, cabinet, or TV line. Only if the window/light placement is unreasonable, use the second priority: place the sofa beside the existing main sofa / couch side within the conversation area. This is a placement rule only, not a camera target: the camera must be on the indoor side of the sofa, shooting inward toward the room interior. The sofa itself should be angled to face inward toward the room / conversation area / couch / TV wall, not toward the window or exterior view. Compose from a side-front camera angle so the camera sees the sofa front and one side while the sofa still feels oriented into the room, not posed only for the camera. The sofa should occupy about 32-42% of image height and 24-34% of image width, clearly smaller than the multi-seat couch and not dominating the room. Show the sofa plus indoor context such as rug/floor, side table, lamp, plant, couch edge, wall art, cabinet, wall edge, curtain edge, or floor seams. Treat windows/balcony/light surfaces only as light sources and placement anchors; keep them out of frame when possible, or show only a narrow edge or soft light spill. Avoid giant foreground recliner, sofa centered in front of the window, exterior-window background, sofa facing the window, straight-on frontal view, back-facing view, and wide full-room view.",
  close:
    "近景: Close interior product shot from the same room, same sofa placement and same orientation logic as the mid view; only move the camera closer. The sofa position follows the mid-view requirement: if a window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface is a reasonable placement zone, keep the sofa there. Use close framing so the sofa subject occupies about 65-75% of the image area. The camera must be on the indoor side of the sofa, shooting inward toward the room interior rather than outward toward the window or exterior view. Compose the sofa diagonally toward the camera in a front three-quarter or side-front close view, showing material, silhouette, cushion shape, armrest, stitching, leather/fabric grain, seat-front panel, back cushion edge and partial soft furnishing details. Preserve enough environment information to prove the sofa is still in the room: rug/floor texture, indoor side table/lamp/plant/couch edge/wall art/cabinet/wall material/soft decor as softly blurred background or cropped edge cues. The close-view background must be indoor room objects, not an exterior-window view. Treat windows/balcony/light surfaces only as lighting sources; normally keep them outside the frame, and if unavoidable show only a very narrow cropped edge or soft light spill. Do not turn this into an isolated studio cutout or an environment-free macro shot.",
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
  const styleViewPrompts: Record<ViewMode, string> = {
    wide:
      "远景: True wide full-room ecommerce interior photograph, not a medium product shot. Use a 22-28mm lens feeling, camera about 4.5-6.5 meters from the recliner, camera height 1.35-1.55m, level verticals, and moderate depth of field at f/5.6-f/8. Show a complete room or large living-area zone with visible floor, rug, walls, window/curtain or architectural opening, side table, lamp, art/plant/decor and enough negative space. The recliner must be fully visible and readable but placed in the middle ground as one furniture piece within the room, occupying only about 12-18% of image height and 14-22% of image width. The extended footrest may increase footprint, but the chair must still feel like normal single-person furniture, not a close-up hero product. Keep at least 55-70% of the image devoted to surrounding room context. Avoid cropped chair, detail shot, low-angle product portrait, close foreground recliner, shallow close-up blur, or composition where the recliner fills most of the frame.",
    mid: viewPrompts.mid,
    close: viewPrompts.close,
    model: viewPrompts.model,
  };
  const cameraViewRequirement = mode === "style" ? styleViewPrompts[viewMode] : viewPrompts[viewMode];

  const shared = `
Task: Generate a professional ecommerce image for a single-person sofa / armchair.
Product fidelity is critical: preserve the uploaded sofa's exact shape, fabric texture, color, proportions, legs, seams, cushions and design language. Do not invent a different sofa.
The uploaded product image is a product identity reference, not a fixed 2D cutout or fixed camera angle. You may and should rotate the sofa in 3D, change its yaw angle, show the other side, or infer a slightly different camera-facing view when the room layout requires it. Preserve the same product design, cushion structure, fabric, color, lever position logic and proportions, but do not copy the product photo's original facing direction if it conflicts with the scene.
No text, logo overlays, watermarks, UI elements, price tags, labels, or banners.
Use realistic lighting, contact shadows, material reflections, correct perspective and physically plausible scale.
Lighting must match the scene: direction, softness, color temperature, shadow length, highlight intensity and ambient fill should be consistent across the sofa, room and model if present.
Scale must be physically plausible: size the sofa according to the generated room's floor area, nearby furniture, wall height, camera distance and perspective. Avoid oversized, miniature, floating or pasted-on results.
Orientation must match the generated scene: rotate and place the sofa according to the room layout, floor perspective lines, vanishing point, seating direction and nearby furniture arrangement. Scene logic has priority over the uploaded product photo's original angle.
If a model is present, make the pose natural and physically plausible. The model should sit or interact with the sofa with believable weight, contact shadows, hand placement, leg position and clothing folds. Do not let the model cover the product's key silhouette.
Output should look like a finished product-in-scene commercial photo for an online store.
Camera/view requirement: ${cameraViewRequirement}
`;

  const roomFramingStrategy =
    viewMode === "wide"
      ? `
Scene framing strategy for wide view:
Use the uploaded room image as the actual spatial reference. Preserve the room identity, main architecture, windows/doors/balcony/light surfaces, main furniture relationships, material palette and lighting direction.
Compose a wider camera view of that same room, as if the photographer moved backward and used a wider interior lens. Do not turn it into a different room.
Complete-room context is required: show the room, major furniture, floor/rug, walls, window/balcony/light area if present, and the sofa's placement relationship to them.
Placement priority: first place the single sofa near the window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface by default.
Only avoid the window/balcony/light area if the sofa would block a passage, door swing, cabinet opening, TV viewing line, traffic flow, or create an obviously unreasonable furniture layout. In that case, use the second priority: place it beside the existing main sofa / couch side within the conversation area.
The sofa must remain a normal single-person chair, fully visible and readable, with believable floor contact, shadows and scale.`
      : viewMode === "close"
        ? `
Scene framing strategy for close view:
Use the uploaded room image as the actual spatial reference. Close view keeps the same sofa placement and orientation as mid view, only moving the camera closer.
If the sofa is placed near a window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface, keep that placement, but set the close camera on the indoor side of the sofa and shoot inward toward the room interior, not outward toward the window or exterior view.
The sofa subject should occupy about 65-75% of the image area. Keep roughly 25-35% for environment context.
Use close composition to emphasize sofa material, outline, cushion volume, armrest, stitching, leather/fabric grain, seat-front panel, back cushion edge and partial soft furnishings.
Keep enough environment information from the interior side: rug/floor texture and indoor objects such as side table, lamp, plant, couch edge, wall art, cabinet, wall material or soft decor as cropped edges or softly blurred background cues. Do not use the window, balcony or exterior view as the close-shot background. Treat the window/balcony/light surface only as a lighting source; normally keep it outside the frame, and if unavoidable show only a very narrow cropped edge or soft light spill.
Orient the sofa diagonally toward the camera in a front three-quarter or side-front close view, matching the mid-view camera logic while moving closer.
The sofa may be partially cropped, but the visible crop should still clearly belong to a normal single-person sofa in the same room. Avoid isolated studio cutouts, pure macro texture shots, or losing all room context.`
      : viewMode === "mid"
        ? `
Scene framing strategy for mid view:
Use the uploaded room image as the actual spatial reference. Mid view is the same room and same placement decision as wide view, shot from a closer camera position.
Keep the sofa near the window/balcony/main natural-light area when that is the reasonable placement zone, but place it in the adjacent indoor seating zone rather than centered directly in front of the glass or blocking circulation, couch use, cabinets, TV line, or the main view. If the window/light placement is unreasonable, the next priority is beside the existing main sofa / couch side within the conversation area.
Show a local seating-area crop photographed toward the room interior. The window/balcony/light area is only a placement anchor and light source; it should not become the camera target or background.
Keep indoor scale references visible, such as rug boundary, floor seams, side table, lamp, plant, couch edge, wall art, cabinet, curtain edge, or wall edge.
Set the camera on the indoor side of the sofa and shoot from a side-front angle. The sofa should be angled inward toward the room / conversation area / couch / TV wall, while the camera sits about 30-45 degrees off the sofa front so it can see the sofa front and one side. Avoid making the sofa face the window/exterior, straight-on frontal symmetry, back-facing views, and rear three-quarter views.
Keep the sofa medium-sized in frame, not a giant foreground object; it should feel integrated into the seating area with visible floor/rug contact and clearance.`
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
- In close view, selected scene elements are local environment cues from the same room and same placement as mid view.
- Keep useful selected elements as cropped edges, textures, reflections, or softly blurred context cues when they fit the close framing: ${(selectedElements || []).join(", ") || "none"}.
- Prioritize indoor cues that support the requested close shot: rug/floor texture, side table, lamp, plant, couch edge, cabinet, wall material, wall art, soft furnishing details, and only window light spill if useful. Do not prioritize visible window/balcony/exterior scenery in close view.
- MUST DELETE these recognized scene elements completely from the final image if they would appear: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with physically plausible wall, floor, rug, furniture surface or background that matches the original scene.
- MUST ADD these user-requested objects as real physical objects only if they fit the close-up crop: ${(addedElements || []).join(", ") || "none"}. Add each item with correct scale, perspective, lighting direction, contact shadows, material response and natural placement.
- Do not expand the camera outward just to satisfy the keep list. The close-up crop is more important than showing many room elements.`
        : viewMode === "mid"
          ? `
Strict element editing instructions for mid view:
- In mid view, selected scene elements are context and scale references from the same room, not a reason to choose a different sofa placement.
- Keep useful selected elements visible when they fit the closer camera framing: ${(selectedElements || []).join(", ") || "none"}.
- Prioritize indoor elements that prove same-room placement and lighting, such as rug, floor seams, couch edge, lamp, plant, table edge, cabinet, wall art, wall material, soft decor, and curtain/window light spill only if useful. Do not prioritize visible window/balcony/exterior scenery in mid view.
- MUST DELETE these recognized scene elements completely from the generated crop if they would appear: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with plausible matching material.
- MUST ADD these user-requested objects as real physical objects only if they fit the partial-scene composition: ${(addedElements || []).join(", ") || "none"}. Add each item with correct scale, perspective, lighting direction, contact shadows, material response and natural placement.
- The mid-view crop and natural sofa placement are higher priority than preserving a full list of room objects.`
          : `
Strict element editing instructions:
- For wide view, selected recognized scene elements are same-room preservation requirements.
- Keep these recognized scene elements visible and identifiable in the final room view: ${(selectedElements || []).join(", ") || "none"}.
- Preserve their relationship to the original room as much as the wider camera composition allows.
- MUST DELETE these recognized scene elements completely from the final image: ${(removedElements || []).join(", ") || "none"}. Remove the object itself, its partial fragments, shadows, reflections, labels, outlines and visual traces. Fill the removed area with physically plausible wall, floor, rug, furniture surface or background that matches the original scene.
- MUST ADD these user-requested objects as real physical objects in the final image: ${(addedElements || []).join(", ") || "none"}. Add each item clearly enough to be recognizable, with correct scale, perspective, lighting direction, contact shadows, material response and natural placement in the room.
- The keep/delete/add lists are hard constraints for element presence and must respect the original room's spatial logic.`;

    const placementLightingRules =
      viewMode === "mid"
        ? `
Placement and lighting rules for mid view:
Use a local crop of the reference room. The generated frame may show only part of the original room, but it should still feel like the same room and same sofa placement logic as the wide view.
Choose the sofa placement once from the room logic: default near the window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface when present and reasonable, but keep it in the adjacent indoor seating zone rather than centered in front of the glass. If that placement blocks passage, door swing, cabinet opening, TV viewing, couch use, or circulation, choose the second priority: beside the existing main sofa / couch side within the conversation area.
Shoot from the indoor side toward the room interior. The mid-shot camera should capture the sofa plus indoor objects, not the outdoor window. Keep the window/balcony/light surface out of frame whenever possible; if unavoidable, show only a very narrow edge or soft light spill.
The sofa orientation should face inward into the room, toward the conversation area, couch, or TV wall. The camera angle may be side-front, but the sofa should not look like it is facing the window or posed only toward the camera.
Rotate the product naturally for that position. Do not preserve the product upload's original left-facing/right-facing angle if the seating zone needs another yaw direction. Reconstruct the same chair from the new view as a real 3D object.
Do not place the chair in the exact center of a wide empty room, directly centered against the window, or so close to camera that it becomes a giant foreground recliner. Leave enough walkway/floor around the chair to feel placed by an interior designer.
Match the reference lighting: in this room, daylight comes mainly from the large rear/side windows with warm ceiling strip/practical light. The chair should have soft cool daylight highlights from the window side, warmer fill from ceiling/ambient light, and contact shadows falling consistently on the rug/floor.
The chair's shadow should be soft, attached under the base/legs, and consistent with the rug texture. Avoid pasted-on edges, different color temperature, or studio lighting that ignores the room.`
        : viewMode === "close"
          ? `
Placement and lighting rules for close view:
Use the exact same sofa placement and orientation logic as mid view, but push the camera closer.
When placed near the window/balcony/light area, the close camera should be positioned on the indoor side of the sofa and shoot inward toward the room interior. Do not aim the camera outward through the window or make the exterior view the background.
The sofa should be angled toward the camera in a front three-quarter or side-front close view, so the viewer can see product material details plus one side/armrest volume. Avoid back-facing, rear three-quarter, or flat straight-on views.
The close shot is photographing the interior, not the outdoor window. Prefer indoor room objects as softly blurred context behind or beside the sofa: side table, lamp, plant, couch edge, wall art, cabinet, wall material, rug or floor seams. Keep the window/balcony/light surface out of frame whenever possible; if unavoidable, show only a very narrow edge or light spill, never a large window view.
Match the reference lighting from the window side and indoor ambient fill, with soft contact shadows attached to the sofa base and consistent highlights on the material.`
        : viewMode === "wide"
          ? `
Placement and lighting rules for wide view:
Preserve the uploaded room's spatial logic and compose a wider interior camera view. Show the room, main furniture and the sofa placement relationship clearly.
Default placement rule: if the room has an obvious window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface, place the single sofa near that window/balcony/light area.
Exception rule: do not place it there if it blocks a passage, door swing, cabinet opening, TV viewing line, traffic flow, or creates an obviously unreasonable furniture layout; then use the second priority: place it beside the existing main sofa / couch side within the conversation area.
The chair orientation should follow the room's floor perspective and seating logic, usually angled 15-35 degrees toward the conversation/TV/seating area or toward the window/view as appropriate. The chair may face left, right, away from camera, or three-quarter to camera as needed; do not lock it to the uploaded product photo's angle.
Match the reference room lighting exactly enough to feel photographed in that room: daylight softness, color temperature, warm/cool balance, shadow direction, contact shadow and material response.
Avoid studio-lit or pasted-on product lighting.`
          : "";

    const viewQualityRules =
      viewMode === "mid"
        ? `
Mid-view final self-check before generating:
- The image must read as a cropped partial-scene product shot, not as the original full room with a chair inserted.
- Only part of the surrounding room should be visible; most ceiling and far-room context should be cropped away.
- The chair must sit in a plausible adjacent indoor seating position near the natural-light area when reasonable, with natural clearance, angle and floor contact.
- The sofa must not be centered directly in front of the window/glass wall and must not block the couch, walkway, cabinet, TV line, or main view.
- The camera must feel on the indoor side of the sofa, shooting toward the room interior rather than outward toward the window.
- The background must be indoor room objects such as rug/floor, side table, lamp, plant, couch edge, cabinet, wall art, wall material or soft decor. The window/balcony/exterior view should not be the background; if any window/light surface appears, it must be only a very narrow edge or light spill.
- Prefer a side-front camera view of a sofa that is diagonally facing inward into the room. The camera can see the front and one side, but the sofa should not face the window/exterior or look turned only toward the camera. Avoid back-facing or rear three-quarter views.
- The chair must pass a physical scale check: one adult seat, narrower than a couch module group, backrest around couch-back height or slightly higher, seat height near normal knee height, and not more than about 42% of image height.
- The product identity must pass a 3D orientation check: same sofa model, but rotated naturally for the room, not copied from the upload angle.
- The chair's highlight side, shadow side, contact shadow softness and color temperature must match the reference room lighting.`
        : viewMode === "close"
          ? `
Close-view final self-check before generating:
- The image must read as a close product-in-room shot from the same placement as mid view, not a full-room view and not a pure macro.
- The camera must feel on the indoor side of the sofa, shooting toward the room interior rather than outward toward the window.
- The sofa should diagonally face the camera in a front three-quarter or side-front close view. Avoid back-facing, rear three-quarter or flat straight-on views.
- The sofa subject should occupy about 65-75% of the image, with 25-35% indoor environment context.
- Indoor objects should appear as cropped or softly blurred context cues. The window/balcony/exterior view should not be the background; if any window/light surface appears, it must be only a very narrow edge or light spill.
- The chair's material highlights, shadow side, contact shadow softness and color temperature must match the reference room lighting.`
        : viewMode === "wide"
          ? `
Wide-view final self-check before generating:
- The image must read as a wide-angle full-room catalog shot of the same room, with a naturally placed single lounge chair.
- The camera should feel moved back and wider, not like a mid shot.
- If a window, floor-to-ceiling window, balcony door, balcony area, or main natural-light surface exists, verify the sofa is near that area unless it would block circulation, doors, cabinets, TV viewing or a sensible furniture layout.
- The chair must be clear but not oversized, in a real seating zone and not a foreground close-up.
- The chair orientation must make sense relative to the room's couch/seating group, window/balcony/light area, rug and room perspective.
- The chair must pass a physical scale check: one-person recliner/armchair, smaller than the multi-seat couch, not taller than room elements, and not scaled from the uploaded product photo's frame size.
- The product identity must pass a 3D orientation check: same sofa model, but rotated naturally for the room, not copied from the upload angle.
- The chair's light, reflections and shadows must match the reference room's daylight plus warm interior ambient lighting.`
          : "";

    const physicalScaleRules =
      viewMode === "wide" || viewMode === "mid"
        ? `
Physical scale procedure:
1. First estimate real scale from the reference room anchors: couch seat modules, rug width, floor tile seams, wall art, plant pot, lamp, window height, balcony door height, cabinet height and walkway width.
2. Then place the sofa as a real single-person recliner on that room's floor plane. Treat it as about 0.8-1.0m wide, 0.85-1.05m deep and 0.85-1.1m tall.
3. Only after the real-world size is fixed, choose camera crop and image framing. Never enlarge the sofa just because the uploaded product photo fills its frame.
4. If the product appears too large for the rug, couch, lamp or wall art, reduce it or move/crop the camera; do not make the room scale bend around the product.`
        : "";

    const roomScaleRules =
      viewMode === "close"
        ? `
Close-up scale and crop rules:
This is a close product-in-room shot, not a complete-room view and not an isolated macro.
Show a cropped but recognizable sofa region, such as armrest plus seat cushion, cushion texture and silhouette, back cushion stitching, seat-front panel, side lever plus cushion seam, or recliner padding transition.
The crop should highlight material, contour, cushion shape and local soft furnishing details while preserving enough room context at the edges/background.
The visible sofa subject should occupy about 65-75% of the image area. This is closer than mid view, but not an environment-free macro. The implied object scale must remain realistic: normal cushion thickness, normal arm width, normal leg size, normal stitch spacing, and normal relation to rug weave or floor seams.
If near a window/balcony/light area, do not photograph the exterior/window as the background. The camera must be on the indoor side and shoot inward toward the room, with the sofa diagonally facing the camera in a front three-quarter or side-front close angle. Use indoor objects for background context; windows/balcony/light surfaces should stay out of frame unless only a very narrow edge or soft light spill is unavoidable.
If a selected scene element is large, such as a window, sofa, wall art, or coffee table, it may appear as a cropped edge, reflection, texture, partial background cue, or softly blurred local context.
Negative constraints for close view: isolated studio cutout, pure macro texture with no environment, full living-room reconstruction, giant chair, tiny room, mismatched floor contact, excessive visible rug around every side, distant wide-angle perspective, product pasted onto a complete scene.`
        : viewMode === "wide"
          ? `
Wide-view scale rules:
The sofa must be a normal single-person armchair, approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, wall art, floor tiles, rug, lamp and room height.
Show the complete armchair with all main product structure visible. It should occupy about 16-24% of the image height and 12-20% of the image width in a full-room composition. Use these numbers only after checking real scale anchors.
The chair must be clearly readable and not miniature. Cushion divisions, armrests and back height should remain visible, but it must not become the dominant foreground object.
The chair must be smaller than a three-seat sofa and should be roughly one lounge-chair seating module: about one couch seat plus armrest in width, not two couch seats. Its back height should align with a normal lounge chair: around couch-back height or modestly higher, not near window, wall-art, cabinet or lamp height.
Use the rug, couch seat modules, floor tile seams, plant pot, lamp height and wall art as physical measuring references before choosing image size. Do not decide size from the product photo alone.
Place it near the window/balcony/main natural-light area when present and reasonable, scaled as a normal single chair. Do not push it so far into the background that it becomes a toy, and do not pull it into the foreground like a giant object.
Preserve full-room context, but keep the ceiling, floor and negative space balanced so the product does not disappear.
Negative constraints for wide view: tiny distant chair, dollhouse scale, chair lost in empty room, oversized chair blocking the seating area, extreme fisheye room, ceiling-dominant composition, pasted-on product.`
        : viewMode === "mid"
          ? `
Mid-view scale rules:
The sofa must be a normal single-person armchair, approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, rug, lamp, floor seams, couch and wall height.
Show the entire chair or most of the chair. Cropping one side, the footrest edge, or the top edge slightly is acceptable when it improves product-medium-shot composition, but keep the main product identity readable.
The chair should occupy about 32-42% of image height and 24-34% of image width. It should look like a medium product shot in a cropped room area, not a close-up giant chair and not a full-room distant chair.
The chair width should be about one single lounge chair, clearly narrower than the multi-seat couch and no wider than one couch seat plus armrest. It should not span most of the rug width or block the room walkway.
Use nearby partial furniture as scale anchors before sizing: couch seat width, rug weave and border, floor tile seams, table/lamp/plant size, wall art height. Keep visible rug/floor contact around the chair base, especially in front and one side, so the viewer can judge its footprint.
Prefer a cropped local seating-zone composition with very limited ceiling. If the reference room has a large ceiling, crop lower and closer rather than enlarging the chair inside a full-room wide view.
Negative constraints for mid view: full-room wide-angle view, giant chair dominating the room, chair centered directly in front of a window/glass wall, exterior-window background, chair wider than the couch seat group, huge recliner blocking the sofa, extreme wide-angle distortion, complete room shown with product too small, floating base, mismatched shadow, wrong lighting direction.`
        : `
Scale the sofa as a real single-person armchair in the room.
The sofa should be approximately 80-100cm wide, 85-105cm deep, and 85-110cm high relative to nearby furniture, wall art, floor tiles, rug, lamp and room height.
For scene integration, the sofa should occupy only 28%-40% of the image height.
For model view, the sofa and model together should look like a realistic single-person seating setup. The sofa should not exceed about 40%-48% of the image height in a normal lifestyle composition, and the model should not appear miniature relative to the chair.
The sofa width should not exceed 45%-55% of the visible rug width, and should be clearly smaller than the main wall art or background wall area.
Keep visible floor and rug space around the sofa on all sides.
Do not make the sofa oversized, giant, floating, pasted-on, or closer to camera than the room perspective allows.`;

    return `${shared}
Use the uploaded room scene as the reference environment. Preserve its room identity, lighting direction, color temperature, wall/floor materials, decor language and spatial logic. Wide, mid and close views are the same room and same sofa placement decision; only the camera position changes.
${roomFramingStrategy}
Scene analysis to preserve and use for placement/camera decisions: ${JSON.stringify(sceneAnalysis || {})}
${elementEditingRules}
Image 1 is the exact sofa product reference. Image 2 is the room scene reference and spatial reference.
For wide, mid and close views, treat Image 2 as the same room being photographed from different camera positions. Preserve the room's architecture, windows/balcony/light surfaces, main furniture relationships, material palette and lighting direction while integrating the sofa.
Do not redesign, reshape, inflate, simplify, merge, or invent any part of the sofa. Preserve the product identity, not the original 2D product-photo pose.
The generated sofa must preserve the same cushion layout, armrest shape, backrest height, seams, stitching, legs, fabric/leather texture, color and physical proportions from Image 1, but it may be rendered from a different camera angle or facing direction to match the room.
If the uploaded product image is front-facing, side-facing, left-facing, right-facing, upright, or photographed from a product studio angle, infer the same real chair rotated into the scene's natural orientation. Do not paste the uploaded product image as a flat cutout.
Do not add extra cushions, extra panels, oversized footrests, recliner mechanisms, or change the sofa into a bulky massage chair.

${roomScaleRules}

${placementLightingRules}

${viewQualityRules}

${physicalScaleRules}

Before placing the sofa, infer the floor plane, tile seams, rug size, vanishing point, camera height, wall scale, lamp height, window/balcony/light area and surrounding furniture size of the reference room.
Place the sofa on the floor plane with correct contact shadows.
Rotate the sofa to match the reference room layout and floor perspective lines.
The sofa front direction should align naturally with the seating area, not randomly face the camera.

Integrate the exact uploaded single sofa into the reference room as a real physical object, not as a redesigned generated chair.
Use the reference room's floor grid, rug size, wall art, lamp, window/balcony/light area and furniture as scale references.
Choose the same sofa placement for wide, mid and close views. For wide view, move the camera back and use a wider lens to show the whole room. For mid view, move the camera closer to the same placed sofa while preserving its orientation and surrounding room logic. For close view, push the camera closer from the indoor side and shoot inward toward the room, preserving the same placement and side-front orientation.
The sofa must remain a single-person armchair size and must not dominate the room.
Preserve enough negative space, visible rug, visible floor and surrounding decor.
Match the reference room's lighting direction, shadow softness, color temperature and perspective.
If the window/balcony/main natural-light area is a reasonable placement zone, place the sofa there by default. If not, use the second priority: place it beside the existing main sofa / couch side within the conversation area.
Before generating, infer the reference room's light source, camera height, vanishing point, floor plane, available placement zone and furniture orientation. Use those cues to choose the sofa position, size, rotation and facing direction.
The sofa must sit on the floor with correct contact shadows and occlusion. Its front/back/side orientation should feel intentional within the reference room layout, not randomly facing the camera.
For model view specifically: the model's thighs should rest on the seat, back should contact the back cushion naturally, feet should meet the floor or footrest believably, and shadows should show real contact between body, sofa and floor. Do not scale the sofa larger to make the model fit.
Negative constraints: oversized sofa, giant chair, two-seat sofa, bulky massage chair, model looks tiny, model swallowed by chair, distorted human anatomy, distorted cushions, changed armrest shape, changed backrest shape, extra seams, extra pillows, floating object, wrong perspective, pasted-on product, incorrect scale.`;
  }

  const styleModeFramingRules =
    viewMode === "wide"
      ? `
Style-mode wide-view rules:
This must be a true wide environmental room image, not a medium close-up product image.
Build the scene first as a full living room, villa lounge, boutique hotel lounge, or refined resort terrace. Then place the recliner naturally into that space.
The camera should be far enough away to show the seating zone, floor/rug footprint, wall/window/decor context, and open negative space around the chair.
The recliner should sit in the middle ground and remain fully visible, but it must not dominate the frame. Its height should be about 12-18% of the image height, with generous room context above, below, and to both sides.
Show multiple scale anchors around it: rug boundary, side table or coffee table edge, lamp, wall art, curtain/window, plant, floor seams, sofa/cabinet or architectural line.
If the image starts to look like a product portrait, pull the virtual camera back, widen the field of view, and reduce the chair size rather than cropping tighter.
Negative constraints for style wide: medium shot, close-up, recliner fills the frame, cropped recliner, footrest foreground dominating the image, shallow product portrait, empty studio set, isolated product render, room context missing.`
      : "";

  return `${shared}
Create a brand-new scene using this chosen style: ${stylePrompts[styleId]}.
${styleModeFramingRules}
The uploaded product image is the exact reference for a La-Z-Boy Indian single recliner. The final generated product must be shown in the extended reclining state, similar to a premium ecommerce hero image: backrest slightly reclined, footrest fully extended forward, continuous padded cushion structure visible, plush segmented leather panels, side lever if visible, and the relaxed lounge posture clearly communicated.
If the uploaded reference is upright, closed, or photographed from a different angle, infer the same chair unfolded into its correct extended recliner state while preserving the product identity, brown leather color, cushion layout, armrest shape, stitching, seams, material texture and proportions.
Do not generate a generic armchair, ordinary sofa, two-seat couch, massage chair, or redesigned recliner. Do not add text, barcode, labels, poster typography, logos, watermarks or graphic overlays.
The extended footrest must look mechanically plausible and connected to the chair body, not floating or detached. Keep the chair realistically scaled as a single-person recliner in the scene.
Build the scene around the extended recliner with coherent interior styling, uncluttered composition, high-end ecommerce product clarity and beautiful lighting.
Choose a natural recliner orientation for the room layout, then make lighting, scale, camera angle and shadows coherent. For wide view, prioritize full-room readability and realistic environmental scale over product close-up impact. If the selected view includes a model, the model must look candid, balanced and naturally supported by the extended recliner.`;
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
          ? "用户选择了近景。近景和中近景应理解为同一个房间、同一个沙发摆放位置下移动机位拍摄：中近景是靠近同一摆放点，近景是在同一摆放点继续推进机位。沙发摆放优先级必须明确：第一优先放在窗边、阳台边或靠近主要自然采光区的位置；只有当该位置会挡通道、门、柜体开启、电视观看动线、长沙发使用或造成明显不合理摆放时，第二优先放在现有长沙发/主沙发侧边的会客位置。近景机位必须和中近景一样在室内侧边，镜头朝室内方向拍摄，而不是朝窗外方向拍摄。近景拍摄的是室内和沙发细节，不是拍摄室外窗户；如果沙发摆在窗边/阳台边/采光区，画面应拍到沙发和部分室内物品虚像，窗户/阳台/采光面默认不入镜，只作为光源判断；如果不可避免，只能保留极窄边缘或柔和光线，不能让窗户、阳台或窗外景观成为背景主体。沙发应斜朝向镜头，使用前侧三分之四或侧前近景角度，突出沙发材质、轮廓、坐垫、扶手、缝线、皮革/布料纹理、靠背边缘和局部软装细节。沙发主体占画面约65%-75%，同时保留约25%-35%的室内环境信息，例如地毯/地板纹理、边几、灯具、绿植、长沙发边缘、柜体、墙面、装饰画或局部软装的虚化背景。placementSuggestion 应说明同一摆放点下的近景机位、室内侧边朝室内拍摄、沙发主体占比和保留的室内物品虚像，recommendedOrientation 应说明沙发斜朝向镜头和具体侧前角度。"
          : viewMode === "mid"
            ? "用户选择了中近景。中近景和远景应理解为同一个房间、同一个沙发摆放逻辑下移动机位拍摄。请先判断单人沙发在此房间最合理的固定摆放位置，摆放优先级必须明确：第一优先放在窗边、阳台边或靠近主要自然采光区的位置；只有当该位置会挡通道、门、柜体开启、电视观看动线、长沙发使用或造成明显不合理摆放时，第二优先放在现有长沙发/主沙发侧边的会客位置。窗边/阳台边/采光区是沙发摆放位置优先级，不是拍摄方向。沙发本身应斜着面朝屋内，朝向会客区、长沙发或电视墙，不要面朝窗户或窗外。中近景机位应在室内侧边，朝室内方向拍摄；相机距离约2.8-4米，使用约40-55mm中焦感，机位与沙发正面形成约30-45度夹角，因此画面能看到沙发正面和一侧，但沙发仍然是在朝屋内摆放，而不是为了镜头摆拍。画面应拍到沙发和室内物品，背景优先是地毯/地板、边几、灯具、绿植、长沙发边缘、柜体、墙面、装饰画或局部软装；窗户/阳台/采光面只作为光源和摆放锚点，尽量不入镜，如果不可避免只能保留窄边缘或柔和光线。沙发大小应是正常单人椅，占画面高度约32%-42%、宽度约24%-34%，明显小于长沙发，不要前景巨大、不要压住画面中心。placementSuggestion 应说明第一优先窗边/采光区，第二优先现有长沙发/主沙发侧边；recommendedScale 应说明32%-42%高度和24%-34%宽度；recommendedOrientation 应说明沙发斜着面朝屋内/会客区，室内侧边30-45度机位朝室内拍摄。"
            : viewMode === "model"
              ? "用户选择了模特视角。请重点分析人体与单人沙发的比例、坐姿接触、脚落地和阴影关系。"
              : "用户选择了远景。远景应使用较广角的室内远景构图，完整呈现房间、主要家具和沙发摆放关系。请先判断单人沙发在此房间最合理的固定摆放位置，摆放优先级必须明确：第一优先放在窗边、阳台边或靠近主要自然采光区的位置；只有当该位置会挡通道、门、柜体开启、电视观看动线、长沙发使用或造成明显不合理摆放时，第二优先放在现有长沙发/主沙发侧边的会客位置。沙发需要在完整空间中清晰可辨但保持正常单人椅比例，不能前景巨大遮挡空间，也不能远到像玩具。上传产品图方向只作为款式参考，最终朝向可以改变，请在 recommendedOrientation 中明确建议旋转角度和朝向。recommendedScale 应参考三人沙发、地毯宽度、窗高、电视墙/书柜、阳台门和地砖缝，说明单人沙发在全屋图中应保持正常单椅比例且细节仍可辨认。请特别说明窗户/阳台自然光、室内暖光、阴影方向和接触阴影应该如何匹配。";

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
