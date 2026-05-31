import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server";

export const config = {
  api: {
    bodyParser: false,
  },
};

const appPromise = createApp({ mountFrontend: false });

function normalizeApiUrl(req: IncomingMessage) {
  if (!req.url || req.url.startsWith("/api/")) return;
  req.url = `/api${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    normalizeApiUrl(req);
    const app = await appPromise;
    return app(req, res);
  } catch (error: any) {
    console.error("Vercel API handler failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: error?.message || "Internal Server Error" }));
  }
}
