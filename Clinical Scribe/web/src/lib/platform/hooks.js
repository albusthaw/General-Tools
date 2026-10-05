// Optional app features that shared screens can use. The website leaves this
// object empty; the apps fill it at start (see app/hooks.js). Screens call a hook
// only when it is there, so the website keeps its own behaviour.
//
//   decorateDialog(dialog, close)            turn a dialog into a sheet
//   enhanceList(element, options)            pull to refresh, swipe actions, long press
//   recorderExtras(card)                     sound ring around the recorder controls, Screen off on iPhone
//   saveFile(blob, filename) → Promise<"saved"|false> save a file the app's way
//   copyText(text) → Promise<bool>           copy the app's way
//   startGoogleSignIn() → Promise            Google sign-in the app's way
//   enhancePicker(select, { title })         choose from a long list in a sheet
//   pageAction(button)                       move the page's main button into the app bar
//   pageParent(path)                         where the app's back button leads from this page
//   beforeRecording() → Promise<bool>        explain and ask for permissions first
//   createCapture() → capture                record with the phone's own recorder (Android)
//   findPhoneRecording() → Promise<state|null> a recording the phone kept while the page was closed
//   recoverPhoneParts(options) → Promise     queue parts the phone kept after a crash
//   haptic(kind)                             short vibration (Android)
//   vibration → { isOn(), set(on) }          the Vibration switch in More (Android)
//   openExternal(address)                    open a web address in the phone's browser
//   copied(button)                           show that a copy button worked
export const appHooks = {};
