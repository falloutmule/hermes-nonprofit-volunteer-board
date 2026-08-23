export type SmsIntent =
  | { kind: "join" }
  | { kind: "help" }
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "drop"; eventKeyword?: string }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "event"; keyword: string }
  | { kind: "unknown" };

export function normalizeSmsBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toUpperCase();
}

export function parseSmsIntent(body: string): SmsIntent {
  const normalized = normalizeSmsBody(body);
  if (normalized === "JOIN") return { kind: "join" };
  if (normalized === "HELP") return { kind: "help" };
  if (normalized === "STOP") return { kind: "stop" };
  if (normalized === "START") return { kind: "start" };
  if (normalized === "YES") return { kind: "yes" };
  if (normalized === "NO") return { kind: "no" };
  if (normalized === "DROP") return { kind: "drop" };
  if (normalized.startsWith("DROP ")) {
    return { kind: "drop", eventKeyword: normalized.slice(5) };
  }
  if (/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized)) {
    return { kind: "event", keyword: normalized };
  }
  return { kind: "unknown" };
}
