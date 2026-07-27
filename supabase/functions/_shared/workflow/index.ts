// Workflow engine shared helpers — used by both the webhook entrypoint
// (workflow-ingest) and the executor (workflow-execute).

export { evaluateAll, evaluateCondition } from "./conditions.ts";
export type { Condition, ConditionContext, ConditionOp } from "./conditions.ts";
export { runAction } from "./actions.ts";
export type { ActionContext, ActionRequest, ActionResult } from "./actions.ts";
