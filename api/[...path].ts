import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server";

const appPromise = createApp({ mountFrontend: false });

function normalizeApiUrl(req: IncomingMessage) {
  if (!req.url || req.url.startsWith("/api/")) return;
  req.url = `/api${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  normalizeApiUrl(req);
  const app = await appPromise;
  return app(req, res);
}
