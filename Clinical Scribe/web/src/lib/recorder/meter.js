// Live sound level (0 to 1) from the microphone, for the level bars.
const SILENT = { level: () => 0, wake() {}, close() {} };

export function createMeter(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return SILENT;
  let context;
  try {
    context = new AudioContextClass();
  } catch {
    return SILENT;
  }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let smooth = 0;
  if (context.state === "suspended") context.resume().catch(() => {});

  return {
    level() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const value = Math.min(1, rms * 4.5);
      smooth = value > smooth ? value : smooth * 0.85 + value * 0.15;
      return smooth;
    },
    // A call or a locked phone can stop the meter; it starts again on Resume.
    wake() {
      if (context.state !== "running") context.resume().catch(() => {});
    },
    close() {
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
      context.close().catch(() => {});
    },
  };
}
