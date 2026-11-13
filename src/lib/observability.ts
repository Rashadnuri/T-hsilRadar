/**
 * Server error records for the hosting platform's log search / log drains. One JSON object per line
 * (`event: "request_error"`), built to contain NO personal data: never headers, cookies, query strings,
 * request bodies or user ids — only what is needed to find and group the failure.
 */
const SECRETS = /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|sk-ant-[\w-]+|sb_(?:secret|publishable)_\w+|Bearer\s+\S+|(?:password|token|apikey|api_key)=\S+/gi;
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

export const redact = (text: string): string => text.replace(SECRETS, "[redacted]").replace(EMAIL, "[email]");

interface RequestInfo { path?: string; method?: string }
interface ContextInfo { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string }

export function describeRequestError(error: unknown, request: RequestInfo, context: ContextInfo) {
  const err = error as { name?: unknown; message?: unknown; digest?: unknown } | null;
  const isObject = typeof error === "object" && error !== null;
  return {
    level: "error" as const,
    event: "request_error" as const,
    name: isObject && typeof err?.name === "string" ? err.name.slice(0, 80) : "Error",
    message: redact(isObject && typeof err?.message === "string" ? err.message : String(error)).slice(0, 300),
    digest: isObject && err?.digest !== undefined ? String(err.digest).slice(0, 40) : undefined,
    method: request.method,
    // The path only: query strings can carry one-time codes (?code=…) or search terms.
    path: (request.path ?? "").split(/[?#]/)[0]!.slice(0, 200),
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
  };
}
