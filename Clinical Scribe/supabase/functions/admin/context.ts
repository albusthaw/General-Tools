import type { Caller } from "../_shared/auth.ts";

// What every admin action receives.
export interface AdminContext {
  caller: Caller;
  body: Record<string, unknown>;
  req: Request;
}

export type AdminAction = (ctx: AdminContext) => Promise<unknown>;
