import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { AUDIO_DURATION } from "./snaps";

const FPS = 30;
const VIDEO_BITRATE = 4_000_000;
const AUDIO_BITRATE = 128_000;
const TAIL_SECONDS = 0.35;
const MAX_WIDTH = 1280;

function even(n: number) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function decodeSound(soundUrl: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(soundUrl);
    const raw = await res.arrayBuffer();
    const ctx = new AudioContext();
    try {
      return await ctx.decodeAudioData(raw.slice(0));
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

async function encodeAudioTrack(
  muxer: Muxer<ArrayBufferTarget>,
  audioBuffer: AudioBuffer,
  durationSec: number,
) {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    return;
  }

  const numberOfChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;

  const config: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    numberOfChannels,
    sampleRate,
    bitrate: AUDIO_BITRATE,
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) return;

  let audioError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addAudioChunk(chunk, meta);
      } catch (err) {
        audioError = err instanceof Error ? err : new Error(String(err));
      }
    },
    error: (err) => {
      audioError = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure(config);

  const frameSize = 1024;
  const totalSamples = Math.min(
    audioBuffer.length,
    Math.ceil(durationSec * sampleRate),
  );
  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  for (let offset = 0; offset < totalSamples; offset += frameSize) {
    if (audioError) throw audioError;
    const count = Math.min(frameSize, totalSamples - offset);
    const planar = new Float32Array(numberOfChannels * count);
    for (let c = 0; c < numberOfChannels; c++) {
      planar.set(channels[c].subarray(offset, offset + count), c * count);
    }
    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: count,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1e6),
      data: planar,
    });
    encoder.encode(data);
    data.close();
  }

  await encoder.flush();
  encoder.close();
  if (audioError) throw audioError;
}

export type RecordMp4Options = {
  canvas: HTMLCanvasElement;
  soundUrl?: string;
  durationSec?: number;
  filename?: string;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  /** Backdrop fill when copying frames (MP4 has no alpha). Default `#141c2b`. */
  fillStyle?: string;
};

export async function recordCanvasToMp4({
  canvas,
  soundUrl,
  durationSec = AUDIO_DURATION + TAIL_SECONDS,
  filename = "lego-build.mp4",
  signal,
  onProgress,
  fillStyle = "#141c2b",
}: RecordMp4Options): Promise<Blob> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("This browser cannot encode MP4 (WebCodecs unavailable).");
  }

  const scale = Math.min(1, MAX_WIDTH / Math.max(1, canvas.width));
  const width = even(canvas.width * scale);
  const height = even(canvas.height * scale);
  const frameDurationUs = Math.round(1e6 / FPS);

  const audioBuffer = soundUrl ? await decodeSound(soundUrl) : null;
  const hasAudio = Boolean(audioBuffer);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width,
      height,
    },
    ...(hasAudio && audioBuffer
      ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
            sampleRate: audioBuffer.sampleRate,
          },
        }
      : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encoderError: Error | null = null;
  let videoChunks = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
        videoChunks += 1;
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error(String(err));
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  const config: VideoEncoderConfig = {
    codec: "avc1.42001f",
    width,
    height,
    bitrate: VIDEO_BITRATE,
    framerate: FPS,
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "realtime",
    avc: { format: "avc" },
  };

  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    config.hardwareAcceleration = "prefer-software";
    delete config.latencyMode;
    const soft = await VideoEncoder.isConfigSupported(config);
    if (!soft.supported) {
      throw new Error("H.264 encoding is not supported in this browser.");
    }
  }
  encoder.configure(config);

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!ctx) throw new Error("Could not create export canvas.");

  const started = performance.now();
  let framesEncoded = 0;
  let lastTimestamp = -1;

  await new Promise<void>((resolve, reject) => {
    const encodeOne = (timestamp: number) => {
      ctx.fillStyle = fillStyle;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(canvas, 0, 0, width, height);

      const frame = new VideoFrame(exportCanvas, {
        timestamp,
        duration: frameDurationUs,
      });
      const keyFrame = framesEncoded === 0 || framesEncoded % (FPS * 2) === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      lastTimestamp = timestamp;
      framesEncoded += 1;
      onProgress?.(Math.min(1, (timestamp / 1e6) / durationSec));
    };

    const tick = () => {
      void (async () => {
        try {
          if (signal?.aborted) {
            reject(new DOMException("Recording aborted", "AbortError"));
            return;
          }
          if (encoderError) {
            reject(encoderError);
            return;
          }

          const elapsed = (performance.now() - started) / 1000;
          const timestamp =
            framesEncoded === 0 ? 0 : Math.round(elapsed * 1e6);

          if (timestamp > lastTimestamp && elapsed < durationSec) {
            encodeOne(timestamp);
          }

          if (elapsed >= durationSec) {
            const endTs = Math.round(durationSec * 1e6);
            if (endTs > lastTimestamp) {
              encodeOne(endTs);
            }
            resolve();
            return;
          }

          requestAnimationFrame(tick);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    };
    requestAnimationFrame(tick);
  });

  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  if (videoChunks === 0) {
    throw new Error("MP4 export produced no video frames.");
  }

  if (audioBuffer) {
    await encodeAudioTrack(muxer, audioBuffer, durationSec);
  }

  muxer.finalize();

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 32) {
    throw new Error("MP4 muxer produced an empty file.");
  }

  const blob = new Blob([buffer], { type: "video/mp4" });
  downloadBlob(blob, filename.endsWith(".mp4") ? filename : `${filename}.mp4`);
  return blob;
}
