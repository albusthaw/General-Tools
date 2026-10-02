// Phone apps: the server link staff type into the apps, a QR code that opens
// Clinical Scribe on a phone, the Android app download, the iPhone steps, and the
// clinic name shown when the apps connect.
import { button, withBusy } from "../../components/button.js";
import { banner, chip, loading, pageHead, toast } from "../../components/feedback.js";
import { textField } from "../../components/fields.js";
import { qrCode } from "../../components/qr.js";
import { appAddress, config, isApp } from "../../config.js";
import { getSettings, setClinicName } from "../../lib/api/admin.js";
import { androidAppAt, readSiteInfo, sizeText } from "../../lib/connection/published.js";
import { readAnswer } from "../../lib/connection/validate.js";
import { copyText } from "../../lib/clipboard.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";

// The website's own address, or, inside the apps, the website the server named.
function siteAddress() {
  const address = isApp ? config.siteUrl : appAddress();
  return address ? new URL("./", address).toString() : "";
}

function card(id, iconName, title, children) {
  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": id } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id } }, icon(iconName), h("span", { text: title }))),
    h("div", { class: "stack" }, children),
  );
}

function linkLine(value, label) {
  const copy = button("Copy", { icon: "copy", size: "small" });
  copy.addEventListener("click", async () => {
    const ok = await copyText(value);
    toast(ok ? "Copied." : "Copying did not work. Select the link and copy it.", ok ? "ok" : "bad");
  });
  return h("div", { class: "link-line" }, h("span", { class: "link-text", attrs: { "aria-label": label }, text: value }), copy);
}

function steps(items) {
  return h("ol", { class: "steps-list" }, items.map((text) => h("li", { text })));
}

function nameCard(current) {
  const field = textField("Clinic name", { value: current, maxLength: 80, autocomplete: "organization", placeholder: "For example: St Mary's Clinic" });
  const save = button("Save", { variant: "primary", icon: "check" });
  save.addEventListener("click", () =>
    withBusy(save, async () => {
      field.setError("");
      try {
        await setClinicName(field.value().trim());
        toast("The name is saved.");
      } catch (error) {
        field.setError(messageOf(error));
      }
    })
  );
  return card("apps-name-title", "pencil", "Name shown in the apps", [field.el, h("div", { class: "card-foot" }, save)]);
}

export async function renderPhoneApps(container) {
  const body = h("div", { class: "stack" }, loading("Loading…"));
  replace(container, pageHead("Phone apps"), body);

  const site = siteAddress();
  let settings = null;
  let info = null;
  try {
    [settings, info] = await Promise.all([getSettings(), readSiteInfo(site)]);
  } catch (error) {
    replace(body, banner({ kind: "bad", text: messageOf(error) }));
    return;
  }
  // The website works as the server link when it publishes the connect file (the
  // deploy adds it). Otherwise the server's own address, which always works.
  const serverLink = site && info && readAnswer(info).connection ? site : config.supabaseUrl;
  const android = androidAppAt(info, site);

  const androidCard = card(
    "apps-android-title",
    "phone",
    "Android app",
    android
      ? [
        h("div", { class: "btn-row" }, h("a", { class: "btn primary", href: android.url, attrs: { download: "" } }, icon("download"), h("span", { text: "Download" })), android.version ? chip(`Version ${android.version}`, "blue") : null, android.size ? chip(sizeText(android.size)) : null),
        steps(["Download the app and open the file.", "Tap Install. If the phone asks, allow installs from the browser.", "Open Clinical Scribe and enter the server link."]),
      ]
      : [h("p", { class: "muted", text: "The Android app is not published with this site yet. Run Build Clinical Scribe Android app on GitHub, then run the deploy again." })],
  );

  const iphoneCard = site
    ? card("apps-iphone-title", "phone", "iPhone and iPad", [
      linkLine(new URL("app/", site).toString(), "iPhone web app address"),
      steps(["Open the link in Safari.", "Tap ⋯, then Share, then Add to Home Screen.", "Open Clinical Scribe from the Home Screen and tap Connect."]),
    ])
    : null;

  replace(
    body,
    card("apps-link-title", "link", "Server link", [
      linkLine(serverLink, "Server link"),
      h("div", { class: "qr-box" }, qrCode(serverLink, { label: "QR code for the server link" }), h("p", { class: "field-hint", text: "Scan with a phone camera to open Clinical Scribe on the phone." })),
    ]),
    androidCard,
    iphoneCard,
    nameCard(settings?.settings?.clinic_name ?? ""),
  );
}
