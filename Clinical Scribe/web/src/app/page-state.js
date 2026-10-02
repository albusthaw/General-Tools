// The open page's app controls (pull to refresh, swipe rows, the page's main
// action). The app frame sets them for each page; the app hooks use them.
let current = null;

export function setPageState(state) {
  current = state;
}

export function pageState() {
  return current;
}
