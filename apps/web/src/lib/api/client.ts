import { ApiError as ApiErrorSchema } from "@hvac/shared-types";
import type { z } from "zod";
import { safeLocalStorage } from "@/lib/utils";

export const API_BASE = "/api/v1";
const ORG_KEY = "hvac.activeOrgId";

/** Error thrown for any non-2xx API response, carrying the contract error envelope. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isConflict() {
    return this.status === 409;
  }
}

export class NetworkError extends Error {
  constructor(message = "Can't reach the server. Check your connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

let activeOrgId: string | null = null;
export function getActiveOrgId(): string | null {
  if (activeOrgId) return activeOrgId;
  activeOrgId = safeLocalStorage()?.getItem(ORG_KEY) ?? null;
  return activeOrgId;
}
export function setActiveOrgId(id: string | null) {
  activeOrgId = id;
  const ls = safeLocalStorage();
  if (!ls) return;
  if (id) ls.setItem(ORG_KEY, id);
  else ls.removeItem(ORG_KEY);
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {
  if (typeof window === "undefined") return;
  const p = window.location.pathname;
  if (p.startsWith("/login") || p.startsWith("/register")) return;
  const next = encodeURIComponent(p + window.location.search);
  // Full navigation on purpose: drops all in-memory tenant/query state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${next}`);
};
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn;
}

export interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Validate the response with a zod schema (cheap, catches contract drift early). */
  schema?: z.ZodType<T>;
  /** Send X-Organization-Id (default true). */
  tenant?: boolean;
  /** Suppress the automatic 401 redirect (used by /users/me probes on auth pages). */
  noRedirect?: boolean;
  signal?: AbortSignal;
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions<unknown>["query"]) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Requested-With"] = "hvac-studio";
  if (opts.tenant !== false) {
    const org = getActiveOrgId();
    if (org) headers["X-Organization-Id"] = org;
  }
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new NetworkError();
  }

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || "Request failed";
    let details: unknown;
    try {
      const json = await res.json();
      const parsed = ApiErrorSchema.safeParse(json);
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        details = parsed.data.error.details;
      } else if (json && typeof json === "object" && "detail" in json) {
        message = typeof json.detail === "string" ? json.detail : message;
        details = json.detail;
      }
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new NetworkError("The server is unavailable right now. Changes are kept on this device.");
    }
    if (res.status === 401 && !opts.noRedirect) onUnauthorized();
    throw new ApiError(res.status, code, message, details);
  }

  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const data: unknown = ct.includes("application/json") ? await res.json() : await res.text();
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) {
      // Contract drift: surface loudly in dev, but don't brick the UI in prod.
      console.warn(`[api] response for ${method} ${path} failed schema validation`, parsed.error.issues);
      return data as T;
    }
    return parsed.data;
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
