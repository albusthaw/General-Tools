// Checks who is calling. Every browser-facing function starts here.
import { AppError } from "./http.ts";
import { adminClient } from "./supabase.ts";

export interface Caller {
  id: string;
  email: string;
  fullName: string;
  role: "user" | "admin";
  userAgent: string;
}

export async function requireUser(req: Request): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  // A signed-in person's token is a JWT; API keys are not accepted here.
  if (!token || token.split(".").length !== 3) {
    throw new AppError("not_signed_in", "Please sign in again.", 401);
  }

  const client = adminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new AppError("not_signed_in", "Your session has ended. Please sign in again.", 401);
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, email, full_name, role, status")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw new Error("The account could not be checked.");
  if (!profile || profile.status !== "active") {
    throw new AppError("not_allowed", "Your account cannot do this. Ask your administrator.", 403);
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  };
}

export async function requireAdmin(req: Request): Promise<Caller> {
  const caller = await requireUser(req);
  if (caller.role !== "admin") {
    throw new AppError("not_allowed", "Only administrators can do this.", 403);
  }
  return caller;
}
