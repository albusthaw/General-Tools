// Google sign-in in the Android app. Google does not allow sign-in inside an
// app's own web view, so it opens in the phone's browser and comes back through
// the app's return link. The sign-in uses PKCE: the one-time code is useless
// without the secret kept in this app, and the app only accepts a code while a
// sign-in it started is waiting.
import { Browser } from "@capacitor/browser";
import { toast } from "../../components/feedback.js";
import { UserError } from "../../lib/errors.js";
import { RETURN_LINK } from "../../lib/platform/links.js";
import { supabase } from "../../lib/supabase.js";

const WAITING_KEY = "cs-google-started";
const WAIT_MS = 10 * 60 * 1000;

function waiting() {
  try {
    const started = Number(localStorage.getItem(WAITING_KEY));
    return Number.isFinite(started) && Date.now() - started < WAIT_MS;
  } catch {
    return false;
  }
}

function setWaiting(on) {
  try {
    if (on) localStorage.setItem(WAITING_KEY, String(Date.now()));
    else localStorage.removeItem(WAITING_KEY);
  } catch {
    // Without storage the return link is simply not accepted.
  }
}

export async function startGoogleSignIn() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: RETURN_LINK, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data?.url || !data.url.startsWith("https://")) throw new UserError("Google sign-in could not start. Please try again.", "oauth");
  setWaiting(true);
  await Browser.open({ url: data.url });
}

/** Called with a parsed return link ({ kind: "auth", code } or { kind: "auth", failed }). */
export async function finishGoogleSignIn(link) {
  if (!waiting()) return;
  setWaiting(false);
  await Browser.close().catch(() => {});
  if (!link.code || !supabase) {
    toast("Google sign-in did not finish. Please try again.", "bad", 6000);
    return;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(link.code);
  if (error) toast("Google sign-in did not finish. Please try again.", "bad", 6000);
}
