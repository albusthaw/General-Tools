// How much sound an audio part holds, measured from the file itself. Minutes are
// charged for this length, so a changed app cannot claim a shorter recording than
// it sent. Only audio frames are counted, so paused time never counts.
//
// Formats: WebM and Ogg with Opus (browsers), MP4 with AAC (Safari) and AAC in
// ADTS frames (the Android app). Anything else, or a file that cannot be read
// to the end, gives null and is not processed. Other codecs are refused because
// their length could only be read from timing a file can fake.

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
// AAC kinds whose frames hold 1024 samples at the core rate: Main, LC, SSR, LTP,
// and HE-AAC (SBR) and HE-AAC v2 (PS) on top of them. Kinds with longer frames
// (such as USAC) are refused.
const AAC_CORE = new Set([1, 2, 3, 4]);
// The longest Opus packet is 120 ms (5760 samples at 48 kHz).
const OPUS_MAX_PACKET = 5760;
// A part may end with a frame cut off when the app stopped. Anything longer after
// the last whole frame is not audio this check understands, and could hide some.
const MAX_TAIL_BYTES = 2048;

/** Seconds of sound in the file, or null when the length cannot be read. */
export function audioSeconds(bytes: Uint8Array, mimeType: string): number | null {
  const type = String(mimeType ?? "").split(";")[0].trim().toLowerCase();
  try {
    let seconds: number | null = null;
    if (type === "audio/aac") seconds = adtsSeconds(bytes);
    else if (type === "audio/ogg") seconds = oggSeconds(bytes);
    else if (type === "audio/webm") seconds = webmSeconds(bytes);
    else if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/m4a") seconds = mp4Seconds(bytes);
    return seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 100) / 100 : null;
  } catch {
    return null;
  }
}

// Opus ----------------------------------------------------------------------

/** Samples (at 48 kHz) in one Opus packet, from its first one or two bytes (RFC 6716, 3.1). */
export function opusPacketSamples(toc: number, second: number | undefined): number | null {
  const config = toc >> 3;
  let frameSize: number;
  if (config < 12) frameSize = [480, 960, 1920, 2880][config & 3];
  else if (config < 16) frameSize = [480, 960][config & 1];
  else frameSize = [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  let frames = code === 0 ? 1 : 2;
  if (code === 3) {
    if (second === undefined) return null;
    frames = second & 0x3f;
  }
  const samples = frames * frameSize;
  return samples > 0 && samples <= OPUS_MAX_PACKET ? samples : null;
}

// ADTS (AAC) -------------------------------------------------------------------

function adtsSeconds(b: Uint8Array): number | null {
  let pos = 0;
  let samples = 0;
  let rate = 0;
  while (pos + 7 <= b.length) {
    if (b[pos] !== 0xff || (b[pos + 1] & 0xf6) !== 0xf0) break;
    const rateIndex = (b[pos + 2] >> 2) & 0x0f;
    if (rateIndex >= ADTS_RATES.length) return null;
    if (rate && ADTS_RATES[rateIndex] !== rate) return null;
    rate = ADTS_RATES[rateIndex];
    const headerLength = (b[pos + 1] & 0x01) === 1 ? 7 : 9;
    const frameLength = ((b[pos + 3] & 0x03) << 11) | (b[pos + 4] << 3) | (b[pos + 5] >> 5);
    if (frameLength <= headerLength || pos + frameLength > b.length) break;
    samples += ((b[pos + 6] & 0x03) + 1) * 1024;
    pos += frameLength;
  }
  if (!rate || b.length - pos > MAX_TAIL_BYTES) return null;
  return samples / rate;
}

// Ogg (Opus) -------------------------------------------------------------------

function oggSeconds(b: Uint8Array): number | null {
  let pos = 0;
  let serial = -1;
  let packetIndex = 0;
  let samples = 0;
  let lastGranule = 0;
  let preSkip = 0;
  // The first bytes of the packet being read, which may span segments and pages.
  let head: number[] = [];
  let inPacket = false;

  const finishPacket = () => {
    if (packetIndex === 0) {
      // OpusHead: "OpusHead", version, channels, pre-skip (little-endian).
      if (head.length < 12 || String.fromCharCode(...head.slice(0, 8)) !== "OpusHead") throw new Error("not opus");
      preSkip = head[10] | (head[11] << 8);
    } else if (packetIndex > 1) {
      const count = opusPacketSamples(head[0], head[1]);
      if (count === null) throw new Error("bad packet");
      samples += count;
    }
    packetIndex++;
    head = [];
    inPacket = false;
  };

  while (pos + 27 <= b.length) {
    if (b[pos] !== 0x4f || b[pos + 1] !== 0x67 || b[pos + 2] !== 0x67 || b[pos + 3] !== 0x53) break;
    const view = new DataView(b.buffer, b.byteOffset + pos, 27);
    const granuleLow = view.getUint32(6, true);
    const granuleHigh = view.getInt32(10, true);
    const pageSerial = view.getUint32(14, true);
    if (serial === -1) serial = pageSerial;
    else if (pageSerial !== serial) return null;
    const count = b[pos + 26];
    if (pos + 27 + count > b.length) break;
    let dataPos = pos + 27 + count;
    let pageLength = 27 + count;
    for (let i = 0; i < count; i++) pageLength += b[pos + 27 + i];
    if (pos + pageLength > b.length) break;
    for (let i = 0; i < count; i++) {
      const size = b[pos + 27 + i];
      inPacket = true;
      const need = packetIndex === 0 ? 12 : 2;
      for (let j = 0; j < size && head.length < need; j++) head.push(b[dataPos + j]);
      dataPos += size;
      if (size < 255) finishPacket();
    }
    if (!(granuleHigh === -1 && granuleLow === 0xffffffff)) lastGranule = Math.max(lastGranule, granuleHigh * 2 ** 32 + granuleLow);
    pos += pageLength;
  }
  if (inPacket && packetIndex > 1 && head.length) finishPacket();
  if (packetIndex < 2 || b.length - pos > MAX_TAIL_BYTES) return null;
  // The larger of the counted packets and the stream's own end position.
  return Math.max(samples, lastGranule - preSkip, 0) / 48000;
}

// WebM (EBML) ------------------------------------------------------------------

const ID = {
  segment: 0x18538067,
  cluster: 0x1f43b675,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  blockGroup: 0xa0,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  simpleBlock: 0xa3,
  block: 0xa1,
};
// Elements whose children follow straight after their header; the walk goes into
// them instead of over them, so elements of unknown size are no problem.
const CONTAINERS = new Set([ID.segment, ID.cluster, ID.tracks, ID.trackEntry, ID.blockGroup]);

function readVint(b: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  if (pos >= b.length) return null;
  const first = b[pos];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || pos + length > b.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(b: Uint8Array, pos: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + b[pos + i];
  return value;
}

interface WebmTrack {
  number: number;
  type: number;
  codec: string;
}

function webmSeconds(b: Uint8Array): number | null {
  const tracks: WebmTrack[] = [];
  let track: WebmTrack | null = null;
  let sawSegment = false;
  const blocks: Array<{ track: number; start: number; end: number }> = [];

  let pos = 0;
  while (pos < b.length) {
    const id = readVint(b, pos, true);
    if (!id) break;
    const size = readVint(b, pos + id.length, false);
    if (!size) break;
    const body = pos + id.length + size.length;
    if (CONTAINERS.has(id.value)) {
      if (id.value === ID.segment) sawSegment = true;
      if (id.value === ID.trackEntry) {
        track = { number: 0, type: 0, codec: "" };
        tracks.push(track);
      }
      pos = body;
      continue;
    }
    if (size.unknown) return null;
    const end = body + size.value;
    if (end > b.length) break;
    switch (id.value) {
      case ID.trackNumber:
        if (track) track.number = readUint(b, body, size.value);
        break;
      case ID.trackType:
        if (track) track.type = readUint(b, body, size.value);
        break;
      case ID.codecId:
        if (track) track.codec = String.fromCharCode(...b.subarray(body, end));
        break;
      case ID.simpleBlock:
      case ID.block: {
        // Track number, a 2-byte time (not needed), then the flags and the audio.
        const number = readVint(b, body, false);
        if (!number || body + number.length + 3 > end) return null;
        blocks.push({ track: number.value, start: body + number.length + 2, end });
        break;
      }
      default:
        break;
    }
    pos = end;
  }
  if (!sawSegment || b.length - pos > MAX_TAIL_BYTES) return null;

  const audio = tracks.filter((t) => t.type === 2 || t.codec.startsWith("A_"));
  // Browsers record WebM audio as Opus, whose packets say their own length.
  if (!audio.length || audio.some((t) => t.codec !== "A_OPUS")) return null;
  let longest = 0;
  for (const t of audio) {
    let samples = 0;
    for (const block of blocks) {
      if (block.track !== t.number) continue;
      const count = blockOpusSamples(b, block.start, block.end);
      if (count === null) return null;
      samples += count;
    }
    longest = Math.max(longest, samples / 48000);
  }
  return longest;
}

// Samples in one WebM block of Opus: the flags byte, then one packet, or several
// when the block uses lacing.
function blockOpusSamples(b: Uint8Array, start: number, end: number): number | null {
  const flags = b[start];
  let pos = start + 1;
  const lacing = (flags >> 1) & 0x03;
  const sizes: number[] = [];
  if (lacing === 0) {
    sizes.push(end - pos);
  } else {
    if (pos >= end) return null;
    const frames = b[pos] + 1;
    pos++;
    if (lacing === 1) {
      for (let i = 0; i < frames - 1; i++) {
        let size = 0;
        while (pos < end && b[pos] === 255) {
          size += 255;
          pos++;
        }
        if (pos >= end) return null;
        size += b[pos++];
        sizes.push(size);
      }
    } else if (lacing === 3) {
      const first = readVint(b, pos, false);
      if (!first) return null;
      pos += first.length;
      sizes.push(first.value);
      let previous = first.value;
      for (let i = 1; i < frames - 1; i++) {
        const raw = readVint(b, pos, false);
        if (!raw) return null;
        pos += raw.length;
        const bias = 2 ** (7 * raw.length - 1) - 1;
        previous += raw.value - bias;
        if (previous < 0) return null;
        sizes.push(previous);
      }
    }
    const used = sizes.reduce((sum, size) => sum + size, 0);
    if (lacing === 2) {
      const each = (end - pos) / frames;
      if (!Number.isInteger(each)) return null;
      for (let i = 0; i < frames; i++) sizes.push(each);
    } else {
      if (end - pos - used < 0) return null;
      sizes.push(end - pos - used);
    }
  }
  let samples = 0;
  for (const size of sizes) {
    if (size <= 0 || pos + size > end) return null;
    const count = opusPacketSamples(b[pos], size > 1 ? b[pos + 1] : undefined);
    if (count === null) return null;
    samples += count;
    pos += size;
  }
  return samples;
}

// MP4 ------------------------------------------------------------------------

interface Mp4Track {
  id: number;
  audio: boolean;
  codec: string;
  timescale: number;
  // The rate written in the sample entry, and the kind and rate of AAC the
  // decoder uses (from the AAC setup in the esds box).
  entryRate: number;
  aacKind: number;
  aacRate: number;
  // Frames in the time table, in the size table, and in later fragments.
  timedFrames: number;
  sizedFrames: number;
  fragmentFrames: number;
  ticks: number;
}

const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf"]);

function boxType(b: Uint8Array, pos: number): string {
  return String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
}

// Reads bits from start, most significant first.
function bitReader(b: Uint8Array, start: number, end: number): (count: number) => number {
  let bit = start * 8;
  return (count) => {
    let value = 0;
    for (let i = 0; i < count; i++, bit++) {
      if (bit >> 3 >= end) throw new Error("cut");
      value = value * 2 + ((b[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    return value;
  };
}

// An MPEG-4 descriptor's length: 1 to 4 bytes of 7 bits each.
function descriptorLength(b: Uint8Array, pos: number, end: number): { length: number; size: number } | null {
  let length = 0;
  for (let size = 1; size <= 4 && pos + size <= end; size++) {
    const byte = b[pos + size - 1];
    length = length * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { length, size };
  }
  return null;
}

// The AAC setup (AudioSpecificConfig, ISO 14496-3) inside an esds box: the kind
// of AAC and the core sample rate, which is the rate the frames are decoded at.
function aacSetup(b: Uint8Array, start: number, end: number): { kind: number; rate: number } | null {
  let pos = start + 4;
  if (b[pos] !== 0x03) return null;
  let d = descriptorLength(b, pos + 1, end);
  if (!d) return null;
  pos += 1 + d.size;
  const flags = b[pos + 2];
  pos += 3;
  if (flags & 0x80) pos += 2;
  if (flags & 0x40) pos += 1 + b[pos];
  if (flags & 0x20) pos += 2;
  if (pos >= end || b[pos] !== 0x04) return null;
  d = descriptorLength(b, pos + 1, end);
  if (!d) return null;
  pos += 1 + d.size + 13;
  if (pos >= end || b[pos] !== 0x05) return null;
  d = descriptorLength(b, pos + 1, end);
  if (!d || d.length < 2) return null;
  pos += 1 + d.size;
  const read = bitReader(b, pos, Math.min(end, pos + d.length));
  const kindOf = () => {
    const kind = read(5);
    return kind === 31 ? 32 + read(6) : kind;
  };
  // Only the standard rates; a rate written out in full is refused.
  const rateOf = () => ADTS_RATES[read(4)] ?? 0;
  let kind = kindOf();
  const rate = rateOf();
  read(4);
  if (kind === 5 || kind === 29) {
    // HE-AAC: the rate after SBR, then the kind of the core AAC.
    rateOf();
    kind = kindOf();
  }
  return { kind, rate };
}

function mp4Seconds(b: Uint8Array): number | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tracks = new Map<number, Mp4Track>();
  const trexDefault = new Map<number, number>();
  let current: Mp4Track | null = null;
  let fragmentTrack: Mp4Track | null = null;
  let fragmentDefault = 0;
  let sawMoov = false;

  // Walks boxes between start and end, going into the containers.
  const walk = (start: number, end: number, depth: number): void => {
    if (depth > 8) throw new Error("too deep");
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = boxType(b, pos + 4);
      let header = 8;
      if (size === 1) {
        if (pos + 16 > end) throw new Error("cut");
        size = Number(view.getBigUint64(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      // A recording cut off part way ends inside its last block of audio data,
      // whose frames were already counted from the fragment that lists them.
      if (depth === 0 && type === "mdat" && pos + size > end && size >= header) {
        pos = end;
        break;
      }
      if (size < header || pos + size > end) throw new Error("bad size");
      const body = pos + header;
      const boxEnd = pos + size;
      if (type === "moov") sawMoov = true;
      if (type === "trak") {
        current = {
          id: 0, audio: false, codec: "", timescale: 0, entryRate: 0, aacKind: 0, aacRate: 0,
          timedFrames: 0, sizedFrames: 0, fragmentFrames: 0, ticks: 0,
        };
      }
      if (MP4_CONTAINERS.has(type)) {
        if (type === "traf") {
          fragmentTrack = null;
          fragmentDefault = 0;
        }
        walk(body, boxEnd, depth + 1);
        if (type === "trak" && current) {
          tracks.set(current.id, current);
          current = null;
        }
      } else {
        leaf(type, body, boxEnd);
      }
      pos = boxEnd;
    }
    if (pos !== end && end - pos > 0 && depth === 0 && end - pos > MAX_TAIL_BYTES) throw new Error("tail");
  };

  // The AAC setup in an audio sample entry: an esds box among the entry's own
  // boxes (inside a wave box in the QuickTime layout).
  const findSetup = (start: number, end: number, depth: number): { kind: number; rate: number } | null => {
    let pos = start;
    while (pos + 8 <= end && depth < 3) {
      const size = view.getUint32(pos);
      const type = boxType(b, pos + 4);
      if (size < 8 || pos + size > end) return null;
      if (type === "esds") return aacSetup(b, pos + 8, pos + size);
      if (type === "wave") {
        const inner = findSetup(pos + 8, pos + size, depth + 1);
        if (inner) return inner;
      }
      pos += size;
    }
    return null;
  };

  const leaf = (type: string, body: number, end: number): void => {
    const version = b[body];
    const flags = (b[body + 1] << 16) | (b[body + 2] << 8) | b[body + 3];
    switch (type) {
      case "tkhd":
        if (current) current.id = view.getUint32(body + (version === 1 ? 20 : 12));
        break;
      case "mdhd":
        if (current) current.timescale = view.getUint32(body + (version === 1 ? 20 : 12));
        break;
      case "hdlr":
        if (current) current.audio = boxType(b, body + 8) === "soun";
        break;
      case "stsd": {
        // The first sample entry: its type is the codec. An audio entry holds a
        // sample rate and its own boxes; QuickTime layouts 1 and 2 are longer.
        if (!current || body + 16 > end) break;
        const entry = body + 8;
        const entryEnd = Math.min(end, entry + view.getUint32(entry));
        current.codec = boxType(b, entry + 4);
        if (entry + 36 > entryEnd) break;
        current.entryRate = view.getUint32(entry + 32) >>> 16;
        const layout = view.getUint16(entry + 16);
        const setup = findSetup(entry + 36 + (layout === 1 ? 16 : layout === 2 ? 36 : 0), entryEnd, 0);
        if (setup) {
          current.aacKind = setup.kind;
          current.aacRate = setup.rate;
        }
        break;
      }
      case "stts": {
        if (!current) break;
        const count = view.getUint32(body + 4);
        if (body + 8 + count * 8 > end) throw new Error("cut");
        for (let i = 0; i < count; i++) {
          const frames = view.getUint32(body + 8 + i * 8);
          current.timedFrames += frames;
          current.ticks += frames * view.getUint32(body + 12 + i * 8);
        }
        break;
      }
      case "stsz":
      case "stz2":
        // The number of frames the decoder will read.
        if (current) current.sizedFrames = view.getUint32(body + 8);
        break;
      case "trex":
        trexDefault.set(view.getUint32(body + 4), view.getUint32(body + 12));
        break;
      case "tfhd": {
        const id = view.getUint32(body + 4);
        fragmentTrack = tracks.get(id) ?? null;
        let offset = body + 8;
        if (flags & 0x000001) offset += 8;
        if (flags & 0x000002) offset += 4;
        fragmentDefault = flags & 0x000008 ? view.getUint32(offset) : trexDefault.get(id) ?? 0;
        break;
      }
      case "trun": {
        if (!fragmentTrack) break;
        const count = view.getUint32(body + 4);
        let offset = body + 8;
        if (flags & 0x000001) offset += 4;
        if (flags & 0x000004) offset += 4;
        const fields = [0x000100, 0x000200, 0x000400, 0x000800].filter((flag) => flags & flag).length;
        if (offset + count * fields * 4 > end) throw new Error("cut");
        fragmentTrack.fragmentFrames += count;
        if (flags & 0x000100) {
          for (let i = 0; i < count; i++) fragmentTrack.ticks += view.getUint32(offset + i * fields * 4);
        } else {
          fragmentTrack.ticks += count * fragmentDefault;
        }
        break;
      }
      default:
        break;
    }
  };

  walk(0, b.length, 0);
  if (!sawMoov) return null;
  let longest = 0;
  let any = false;
  for (const track of tracks.values()) {
    if (!track.audio) continue;
    // Safari records AAC. Each frame holds 1024 samples at the core rate,
    // whatever the container's timing says; the slower of the two written rates
    // is used, and the larger of the frame counts.
    if (track.codec !== "mp4a" || !AAC_CORE.has(track.aacKind) || !track.aacRate) return null;
    any = true;
    const rate = track.entryRate ? Math.min(track.entryRate, track.aacRate) : track.aacRate;
    const frames = Math.max(track.timedFrames, track.sizedFrames) + track.fragmentFrames;
    const byTime = track.timescale ? track.ticks / track.timescale : 0;
    longest = Math.max(longest, byTime, (frames * 1024) / rate);
  }
  return any ? longest : null;
}
