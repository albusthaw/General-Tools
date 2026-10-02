// Adding, changing and removing people. Sign-in accounts are managed through the
// Supabase Auth admin API; profiles, credit and the audit log through the database.
import { AppError } from "../../_shared/http.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

const BANNED_FOREVER = "876000h";

function passwordProblem(message: string): AppError | null {
  return /password/i.test(message)
    ? new AppError("weak_password", "Choose a stronger password: at least 10 characters with letters and numbers.", 400)
    : null;
}

async function requireProfile(userId: string): Promise<{ id: string; email: string }> {
  const { data } = await adminClient().from("profiles").select("id, email").eq("id", userId).maybeSingle();
  if (!data) throw new AppError("not_found", "That person no longer exists.", 404);
  return data;
}

export async function create({ caller, body }: AdminContext) {
  const email = v.email(body.email);
  const fullName = v.text(body.full_name, { label: "Name", min: 1, max: 120 });
  const password = v.password(body.password);
  const role = v.oneOf(body.role, ["user", "admin"] as const, "role");
  const unlimited = v.bool(body.unlimited);
  const elevenlabsMinutes = v.number(body.elevenlabs_minutes ?? 0, { label: "ElevenLabs minutes", min: 0, max: 1_000_000 });
  const geminiMinutes = v.number(body.gemini_minutes ?? 0, { label: "Gemini minutes", min: 0, max: 1_000_000 });

  const auth = adminClient().auth.admin;
  const { data, error } = await auth.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data?.user) {
    const message = error?.message ?? "";
    if ((error as { code?: string } | null)?.code === "email_exists" || /already|registered|exists/i.test(message)) {
      throw new AppError("exists", "Someone with this email address already has an account.", 409);
    }
    throw passwordProblem(message) ?? new Error(`The account could not be created: ${message}`);
  }

  try {
    await rpc("svc_user_created", {
      p_user: data.user.id,
      p_full_name: fullName,
      p_role: role,
      p_elevenlabs_minutes: elevenlabsMinutes,
      p_gemini_minutes: geminiMinutes,
      p_unlimited: unlimited,
      p_actor: caller.id,
      p_user_agent: caller.userAgent,
    });
  } catch (setupError) {
    // Never leave a half-made account behind.
    await auth.deleteUser(data.user.id).catch(() => {});
    throw setupError;
  }
  return { id: data.user.id };
}

export async function setPassword({ caller, body }: AdminContext) {
  const userId = v.uuid(body.user_id);
  const password = v.password(body.password);
  await requireProfile(userId);
  const { error } = await adminClient().auth.admin.updateUserById(userId, { password });
  if (error) throw passwordProblem(error.message) ?? new Error(`The password could not be changed: ${error.message}`);
  await rpc("svc_audit", {
    p_actor: caller.id,
    p_action: "user.password_changed",
    p_target_user: userId,
    p_details: { by_admin: true },
    p_user_agent: caller.userAgent,
  });
  return { changed: true };
}

// Suspend, restore, or approve someone waiting for approval.
export async function setStatus({ caller, body }: AdminContext) {
  const userId = v.uuid(body.user_id);
  const status = v.oneOf(body.status, ["active", "suspended"] as const, "status");
  await rpc("svc_set_user_status", { p_user: userId, p_status: status, p_actor: caller.id, p_user_agent: caller.userAgent });
  const { error } = await adminClient().auth.admin.updateUserById(userId, {
    ban_duration: status === "suspended" ? BANNED_FOREVER : "none",
  });
  if (error) {
    throw new AppError(
      "signin_not_updated",
      status === "suspended"
        ? "Access to records is blocked, but the sign-in could not be locked. Please try again."
        : "The account is active again, but sign-in could not be unlocked. Please try again.",
      502,
    );
  }
  return { status };
}

export async function remove({ caller, body }: AdminContext) {
  const userId = v.uuid(body.user_id);
  const confirmEmail = v.email(body.confirm_email, "The email address");
  const snapshot = await rpc<{ email: string; full_name: string; role: string; recordings: number }>(
    "svc_check_user_removal",
    { p_user: userId, p_actor: caller.id },
  );
  if (snapshot.email !== confirmEmail) {
    throw new AppError("confirm_mismatch", "Type the person's email address exactly to confirm.", 400);
  }
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  if (error) throw new Error(`The account could not be removed: ${error.message}`);
  await rpc("svc_user_removed", { p_user: userId, p_actor: caller.id, p_snapshot: snapshot, p_user_agent: caller.userAgent });
  return { removed: true };
}
