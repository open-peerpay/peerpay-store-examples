import { apiError } from "./services";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};

export function json<T>(data: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set("cache-control", "no-store");
  return Response.json({ data }, { ...init, headers });
}

export function errorResponse(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: number }).status)
    : 500;
  const message = error instanceof Error ? error.message : "服务器内部错误";
  return json({ error: message }, { status: Number.isFinite(status) ? status : 500 });
}

export async function withErrors(handler: () => Response | Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw apiError(400, "请求体不是有效 JSON");
  }
}

export function pageOptions(url: URL) {
  return {
    limit: clamp(Number(url.searchParams.get("limit") ?? 50), 1, 200),
    offset: Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
  };
}

export function boolFromBody(value: unknown, label = "enabled") {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  throw apiError(400, `${label} 必须是布尔值`);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
