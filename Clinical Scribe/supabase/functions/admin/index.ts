// Admin actions that need server keys. Every route checks that the caller is an
// active administrator first.
import { requireAdmin } from "../_shared/auth.ts";
import { AppError, readJson, serve } from "../_shared/http.ts";
import type { AdminAction } from "./context.ts";
import * as email from "./handlers/email.ts";
import * as google from "./handlers/google.ts";
import * as keys from "./handlers/keys.ts";
import * as models from "./handlers/models.ts";
import * as recordings from "./handlers/recordings.ts";
import * as users from "./handlers/users.ts";

const ROUTES: Record<string, AdminAction> = {
  "users.create": users.create,
  "users.set_password": users.setPassword,
  "users.set_status": users.setStatus,
  "users.remove": users.remove,
  "keys.save": keys.save,
  "keys.remove": keys.remove,
  "keys.check": keys.check,
  "models.catalog": models.catalog,
  "models.refresh": models.refresh,
  "models.test": models.test,
  "recordings.unlock": recordings.unlock,
  "recordings.part": recordings.part,
  "google.get": google.get,
  "google.save": google.save,
  "google.token_save": google.saveToken,
  "google.token_remove": google.removeToken,
  "email.get": email.get,
  "email.save": email.save,
};

serve(async (req) => {
  const caller = await requireAdmin(req);
  const body = await readJson(req, 32 * 1024);
  const action = typeof body.action === "string" ? body.action : "";
  const route = Object.hasOwn(ROUTES, action) ? ROUTES[action] : undefined;
  if (!route) throw new AppError("unknown_action", "That action is not available.", 400);
  return await route({ caller, body, req });
});
