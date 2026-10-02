// iPhone and iPad screen sizes for the iPhone web app's launch images (portrait).
// Used by vite.config.js (the <link> tags) and build/make-icons.mjs (the images).
// width × height in points, and the pixel ratio.
export const LAUNCH_SCREENS = [
  [440, 956, 3], // iPhone 17 Pro Max, 16 Pro Max
  [420, 912, 3], // iPhone Air
  [402, 874, 3], // iPhone 17, 17 Pro, 16 Pro
  [430, 932, 3], // iPhone 16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max
  [393, 852, 3], // iPhone 16, 15, 15 Pro, 14 Pro
  [390, 844, 3], // iPhone 16e, 14, 13, 13 Pro, 12, 12 Pro
  [428, 926, 3], // iPhone 14 Plus, 13 Pro Max, 12 Pro Max
  [414, 896, 3], // iPhone 11 Pro Max, XS Max
  [414, 896, 2], // iPhone 11, XR
  [375, 812, 3], // iPhone 13 mini, 12 mini, 11 Pro, XS, X
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone SE (2nd and 3rd generation), 8
  [1032, 1376, 2], // iPad Pro 13-inch (M4)
  [1024, 1366, 2], // iPad Pro 12.9-inch, iPad Air 13-inch
  [834, 1210, 2], // iPad Pro 11-inch (M4)
  [834, 1194, 2], // iPad Pro 11-inch, iPad Air 11-inch
  [820, 1180, 2], // iPad (10th generation), iPad Air (4th and 5th generation)
  [810, 1080, 2], // iPad (9th generation)
  [744, 1133, 2], // iPad mini (6th and 7th generation)
];

export function launchFile([width, height, ratio]) {
  return `launch/launch-${width * ratio}x${height * ratio}.png`;
}

export function launchMedia([width, height, ratio]) {
  return `screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`;
}
