// Deterministic condition evaluator for workflow conditions.
// Keeps the operator set small and explicit — no eval, no Function(), no
// arbitrary code paths from user-provided definitions.

export interface Condition {
  path: string;                              // dot-path into the context
  op: ConditionOp;
  value: any;
}

export type ConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists"
  | "is_true"
  | "is_false";

export interface ConditionContext {
  event: Record<string, any>;
  contact?: Record<string, any> | null;
  account?: Record<string, any> | null;
  now?: string;
}

function readPath(ctx: any, path: string): any {
  if (!path) return ctx;
  const parts = path.split(".");
  let cur: any = ctx;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function toNumber(v: any): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

export function evaluateCondition(cond: Condition, ctx: ConditionContext): boolean {
  const actual = readPath(ctx, cond.path);
  const expected = cond.value;
  switch (cond.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual);
      const e = toNumber(expected);
      if (a === null || e === null) return false;
      if (cond.op === "gt") return a > e;
      if (cond.op === "gte") return a >= e;
      if (cond.op === "lt") return a < e;
      return a <= e;
    }
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === "string") return actual.includes(String(expected));
      return false;
    case "starts_with":
      return typeof actual === "string" && actual.startsWith(String(expected));
    case "ends_with":
      return typeof actual === "string" && actual.endsWith(String(expected));
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;
    default:
      return false;
  }
}

export function evaluateAll(conds: Condition[], ctx: ConditionContext): {
  ok: boolean;
  trace: Array<{ condition: Condition; result: boolean }>;
} {
  const trace: Array<{ condition: Condition; result: boolean }> = [];
  let ok = true;
  for (const c of conds) {
    const r = evaluateCondition(c, ctx);
    trace.push({ condition: c, result: r });
    if (!r) ok = false;
  }
  return { ok, trace };
}
