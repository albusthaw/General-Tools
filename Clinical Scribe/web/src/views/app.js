// Decides what to show: sign-in, a blocked-account screen, or the app itself.
import { openDialog } from "../components/dialog.js";
import { currentSession, loadContext, loadPublicConfig, onSessionChange, signOut } from "../lib/api/session.js";
import { h } from "../lib/dom.js";
import { messageOf } from "../lib/errors.js";
import { startIdleTimer } from "../lib/idle.js";
import { abandon, attach, isRecording } from "../lib/recorder/recorder.js";
import { recoverInterrupted } from "../lib/recorder/recovery.js";
import { store } from "../lib/store.js";
import { forgetUser } from "../lib/uploads/idb.js";
import * as queue from "../lib/uploads/queue.js";
import { renderAccountBlocked, renderServerProblem } from "./blocked.js";
import { renderLogin } from "./login.js";
import { mountShell } from "./shell.js";

let root = null;
let shell = null;
// The frame and sign-in screen: the website's own, or the apps' (see app/start.js).
let mountFrame = mountShell;
let showLogin = renderLogin;
let stopIdle = null;
let inApp = false;
let entering = false;

async function isBusy() {
  return isRecording() || (await queue.hasPending());
}

function cleanUrl() {
  // Remove the one-time sign-in code that Google sign-in leaves in the address.
  const url = new URL(window.location.href);
  if (url.searchParams.has("code") || url.searchParams.has("error")) {
    const hadError = url.searchParams.get("error_description");
    url.search = "";
    window.history.replaceState(null, "", url.toString());
    if (hadError) sessionStorage.setItem("cs-oauth-error", "1");
  }
}

function leaveApp() {
  inApp = false;
  queue.stop();
  stopIdle?.();
  stopIdle = null;
  shell?.destroy();
  shell = null;
}

async function doSignOut(reason = "signed_out") {
  const userId = store.get().context?.profile?.id;
  if (reason) sessionStorage.setItem("cs-signout-reason", reason);
  leaveApp();
  // A recording must not carry on for someone who signed out.
  await abandon();
  if (userId) await forgetUser(userId);
  store.set({ session: null, context: null });
  await signOut();
  showLogin(root);
}

// Signs out at once (the apps use this before changing server).
export async function signOutNow() {
  await doSignOut(null);
}

// Asks before signing out while audio is still being saved.
export async function requestSignOut() {
  if (await isBusy()) {
    openDialog({
      title: "Audio is still being saved",
      body: [h("p", { text: "Wait until the recording is saved. If you sign out now, audio that has not been saved yet is deleted from this device." })],
      actions: [
        { label: "Stay signed in", variant: "primary" },
        { label: "Sign out anyway", variant: "danger", onClick: () => doSignOut() },
      ],
    });
    return;
  }
  await doSignOut();
}

function startIdle(minutes) {
  let warning = null;
  stopIdle = startIdleTimer({
    minutes,
    isBusy,
    onWarn: (secondsLeft) => {
      warning = openDialog({
        title: "Are you still there?",
        body: [h("p", { text: `For your patients' privacy you will be signed out in about ${secondsLeft} seconds because there has been no activity.` })],
        actions: [{ label: "Stay signed in", variant: "primary" }],
      });
    },
    onActive: () => {
      warning?.close();
      warning = null;
    },
    onTimeout: () => {
      warning?.close();
      doSignOut("idle");
    },
  });
}

async function enterApp(session) {
  if (entering) return;
  entering = true;
  try {
    let context;
    try {
      context = await loadContext();
    } catch (error) {
      renderServerProblem(root, messageOf(error), () => enterApp(session), () => doSignOut(null));
      return;
    }
    store.set({ session, context });
    if (context.profile.status !== "active") {
      renderAccountBlocked(root, context.profile.status, () => doSignOut(null));
      return;
    }

    inApp = true;
    queue.start(context.profile.id);
    // In the Android app a recording may still be running from before.
    await attach(context.profile.id);
    const interrupted = await recoverInterrupted(context.profile.id);
    store.set({ interrupted });
    shell = mountFrame(root, { onSignOut: requestSignOut });
    startIdle(context.idle_signout_minutes);
  } finally {
    entering = false;
  }
}

// Refreshes the signed-in person's details (credit, readiness) after changes.
export async function refreshContext() {
  try {
    const context = await loadContext();
    store.set({ context });
    return context;
  } catch {
    return store.get().context;
  }
}

export async function startApp(rootElement, { frame = mountShell, login = renderLogin } = {}) {
  root = rootElement;
  mountFrame = frame;
  showLogin = login;
  window.addEventListener("beforeunload", (event) => {
    if (isRecording() || queue.status().running) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  const publicConfig = await loadPublicConfig();
  store.set({ publicConfig });

  const session = await currentSession();
  cleanUrl();
  if (session) await enterApp(session);
  else showLogin(root);

  onSessionChange((event, next) => {
    if (event === "SIGNED_OUT") {
      if (inApp) {
        leaveApp();
        store.set({ session: null, context: null });
        showLogin(root);
      }
    } else if (event === "SIGNED_IN" && !inApp && next) {
      enterApp(next);
    } else if (next) {
      store.set({ session: next });
    }
  });
}
