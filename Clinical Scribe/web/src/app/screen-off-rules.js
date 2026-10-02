// Small rules for Screen off (screen-off.js), kept apart so they can be tested.

/**
 * True when the phone lies face down. beta is the tilt front to back (-180 to
 * 180) and gamma the tilt left to right (-90 to 90); flat on its face, beta is
 * near ±180 and gamma near 0.
 */
export function isFaceDown(beta, gamma) {
  const front = Number(beta);
  const side = Number(gamma);
  if (!Number.isFinite(front) || !Number.isFinite(side)) return false;
  return Math.abs(front) > 155 && Math.abs(side) < 25;
}

/**
 * False on an iPhone that cannot keep a Home Screen web app from locking: iOS
 * before 18.4 ignores the request there. Safari tabs and other phones can.
 */
export function canStayUnlocked(userAgent, standalone) {
  const version = /(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(String(userAgent ?? ""));
  if (!version || !standalone) return true;
  const major = Number(version[1]);
  const minor = Number(version[2]);
  return major > 18 || (major === 18 && minor >= 4);
}

/**
 * A place for the dim timer on a screen of width × height, so it moves around
 * and never marks the screen. random() gives numbers from 0 to 1; the timer keeps
 * clear of the edges and the top and bottom of the screen.
 */
export function timerSpot(random, width, height, boxWidth, boxHeight) {
  const margin = 24;
  const top = Math.max(margin, height * 0.12);
  const bottom = Math.max(top, height * 0.82 - boxHeight);
  const right = Math.max(margin, width - boxWidth - margin);
  return {
    x: Math.round(margin + random() * (right - margin)),
    y: Math.round(top + random() * (bottom - top)),
  };
}
