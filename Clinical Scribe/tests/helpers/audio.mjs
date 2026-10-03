// Small audio files for the server tests: Opus in WebM, of a chosen length. The
// worker measures every part from its audio frames before it is transcribed, so
// the tests send real frames (the sound itself is not needed, only its timing).

// EBML element ids, with their marker bits.
const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  docType: [0x42, 0x82],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackType: [0x83],
  codecId: [0x86],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  simpleBlock: [0xa3],
};

// Every size is written in 4 bytes, which EBML allows for sizes below 2^28.
function size(length) {
  return [0x10 | (length >>> 24), (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];
}

function element(id, ...parts) {
  const body = parts.flat(Infinity);
  return [...id, ...size(body.length), ...body];
}

const text = (value) => [...Buffer.from(value, "latin1")];
const uint = (value, bytes) => Array.from({ length: bytes }, (_, i) => (value >>> (8 * (bytes - 1 - i))) & 0xff);

// One Opus packet: CELT, full band, 20 ms frames (RFC 6716, 3.1). Three frames
// (code 3) make 60 ms; one frame (code 0) makes 20 ms.
function packet(frames) {
  return frames === 3 ? [0xfb, 0x03, ...new Array(30).fill(0x55)] : [0xf8, ...new Array(10).fill(0x55)];
}

/** A WebM file holding `seconds` of Opus audio (rounded to 20 ms). */
export function opusWebm(seconds) {
  const units = Math.max(1, Math.round(seconds * 50));
  const packets = [...new Array(Math.floor(units / 3)).fill(3), ...new Array(units % 3).fill(1)];
  const clusters = [];
  let time = 0;
  let blocks = [];
  let clusterStart = 0;
  const close = () => {
    if (blocks.length) clusters.push(element(ID.cluster, element(ID.timecode, uint(clusterStart, 4)), blocks));
    blocks = [];
  };
  for (const frames of packets) {
    // A block's time is a 16-bit offset from its cluster, so a new cluster starts every 30 s.
    if (time - clusterStart >= 30_000) {
      close();
      clusterStart = time;
    }
    blocks.push(element(ID.simpleBlock, 0x81, uint(time - clusterStart, 2), 0x80, packet(frames)));
    time += frames * 20;
  }
  close();
  const header = element(ID.ebml, element(ID.docType, text("webm")));
  const segment = element(
    ID.segment,
    element(ID.info, element(ID.timecodeScale, uint(1_000_000, 3))),
    element(ID.tracks, element(ID.trackEntry, element(ID.trackNumber, 1), element(ID.trackType, 2), element(ID.codecId, text("A_OPUS")))),
    clusters,
  );
  return new Uint8Array([...header, ...segment]);
}
