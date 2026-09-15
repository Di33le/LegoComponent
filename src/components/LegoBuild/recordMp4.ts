import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { AUDIO_DURATION } from "./snaps";

const FPS = 30;
const VIDEO_BITRATE = 5_000_000;
const AUDIO_BITRATE = 128_000;
const TAIL_SECONDS = 0.35;
const MAX_WIDTH = 1280;
const DEFAULT_FILL = "#141c2b";

export type RenderFrameFn = (timeSec: number) => void | Promise<void>;

export type RecordVideoOptions = {
  canvas: HTMLCanvasElement;
  /** Seek the build to `timeSec` and draw one frame (offline render). */
  renderFrame: RenderFrameFn;
  soundUrl?: string;
  durationSec?: number;
  filename?: string;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  fillStyle?: string;
  transparent?: boolean;
  /** When false, skip the browser download dialog / anchor click. */
  autoDownload?: boolean;
};

async function postAgentSave(filename: string, blob: Blob): Promise<string | null> {
  try {
    const res = await fetch(`/__agent_save/${encodeURIComponent(filename)}`, {
      method: "POST",
      body: blob,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { path?: string };
    return json.path ?? null;
  } catch {
    return null;
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))),
      "image/png",
    );
  });
}

function paintCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  size = 16,
) {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const on = ((x / size) | 0) + ((y / size) | 0);
      ctx.fillStyle = on % 2 === 0 ? "#d0d4dc" : "#ffffff";
      ctx.fillRect(x, y, size, size);
    }
  }
}

function even(n: number) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
};

type FileHandleWithPermission = FileSystemFileHandle & {
  queryPermission?: (descriptor?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

async function writeBlobToFileHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
) {
  const h = handle as FileHandleWithPermission;
  if (typeof h.queryPermission === "function") {
    let state = await h.queryPermission({ mode: "readwrite" });
    if (state !== "granted" && typeof h.requestPermission === "function") {
      state = await h.requestPermission({ mode: "readwrite" });
    }
    if (state !== "granted") {
      throw new DOMException(
        "Save permission was not granted.",
        "NotAllowedError",
      );
    }
  }

  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

/**
 * Opens a native Save dialog and writes `blob` immediately in the same user
 * gesture. Falls back to a normal download if the File System Access write
 * path is blocked (common after long async work, or in embedded browsers).
 */
export async function saveVideoBlobWithDialog(
  blob: Blob,
  filename: string,
  mimeType: "video/webm" | "video/mp4",
): Promise<"file-picker" | "download"> {
  const ext = mimeType === "video/webm" ? ".webm" : ".mp4";
  const suggestedName = withExtension(
    filename,
    mimeType === "video/webm" ? "webm" : "mp4",
  );
  const w = window as SaveFilePickerWindow;

  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: mimeType === "video/webm" ? "WebM video" : "MP4 video",
            accept: { [mimeType]: [ext] },
          },
        ],
      });
      try {
        await writeBlobToFileHandle(handle, blob);
        return "file-picker";
      } catch (writeErr) {
        // Picker worked but createWritable is blocked in this context.
        console.warn("createWritable failed; falling back to download", writeErr);
        downloadBlob(blob, suggestedName);
        return "download";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      console.warn("showSaveFilePicker failed; falling back to download", err);
    }
  }

  downloadBlob(blob, suggestedName);
  return "download";
}

function withExtension(name: string, ext: string) {
  const bare = name.replace(/\.(mp4|webm)$/i, "");
  return `${bare}.${ext}`;
}

async function yieldToUi() {
  await new Promise<void>((r) => setTimeout(r, 0));
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

async function encodeAacTrack(
  addChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
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
        addChunk(chunk, meta);
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

/**
 * Offline render: seek animation per frame, then encode. Not a realtime capture.
 */
export async function recordCanvasToMp4(
  options: RecordVideoOptions,
): Promise<Blob> {
  if (options.transparent) {
    return renderTransparentWebm(options);
  }
  return renderOpaqueMp4(options);
}

async function renderOpaqueMp4({
  canvas,
  renderFrame,
  soundUrl,
  durationSec = AUDIO_DURATION + TAIL_SECONDS,
  filename = "lego-build.mp4",
  signal,
  onProgress,
  fillStyle = DEFAULT_FILL,
  autoDownload = true,
}: RecordVideoOptions): Promise<Blob> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("This browser cannot encode MP4 (WebCodecs unavailable).");
  }

  const scale = Math.min(1, MAX_WIDTH / Math.max(1, canvas.width));
  const width = even(canvas.width * scale);
  const height = even(canvas.height * scale);
  const frameDurationUs = Math.round(1e6 / FPS);
  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));

  const audioBuffer = soundUrl ? await decodeSound(soundUrl) : null;

  const target = new Mp4Target();
  const muxer = new Mp4Muxer({
    target,
    video: { codec: "avc", width, height },
    ...(audioBuffer
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
    hardwareAcceleration: "prefer-software",
    avc: { format: "avc" },
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error("H.264 encoding is not supported in this browser.");
  }
  encoder.configure(config);

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create export canvas.");

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      throw new DOMException("Recording aborted", "AbortError");
    }
    if (encoderError) throw encoderError;

    const timeSec = i / FPS;
    await renderFrame(timeSec);

    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);

    const frame = new VideoFrame(exportCanvas, {
      timestamp: i * frameDurationUs,
      duration: frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();

    onProgress?.(i / totalFrames);
    if (i % 4 === 0) await yieldToUi();
  }

  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  if (videoChunks === 0) throw new Error("MP4 export produced no video frames.");

  if (audioBuffer) {
    await encodeAacTrack(
      (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      audioBuffer,
      durationSec,
    );
  }

  muxer.finalize();
  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 32) {
    throw new Error("MP4 muxer produced an empty file.");
  }

  const blob = new Blob([buffer], { type: "video/mp4" });
  if (autoDownload) {
    downloadBlob(blob, withExtension(filename, "mp4"));
  }
  await postAgentSave(withExtension(filename, "mp4"), blob);
  onProgress?.(1);
  return blob;
}

/**
 * Transparent WebM via Mediabunny: encodes color + alpha as parallel VP9 streams.
 * Plain VideoEncoder/MediaRecorder alpha paths drop transparency in Chromium.
 */
async function renderTransparentWebm({
  canvas,
  renderFrame,
  soundUrl,
  durationSec = AUDIO_DURATION + TAIL_SECONDS,
  filename = "lego-build.webm",
  signal,
  onProgress,
  autoDownload = true,
}: RecordVideoOptions): Promise<Blob> {
  const canVp9Alpha = await canEncodeVideo("vp9", { alpha: "keep" });
  if (!canVp9Alpha) {
    throw new Error(
      "This browser cannot encode transparent VP9 WebM (need a Chromium-based browser).",
    );
  }

  const scale = Math.min(1, MAX_WIDTH / Math.max(1, canvas.width));
  const width = even(canvas.width * scale);
  const height = even(canvas.height * scale);
  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
  const frameDur = 1 / FPS;
  const baseName = filename.replace(/\.(mp4|webm)$/i, "");

  // Intermediate 2D canvas so we own the alpha buffer Mediabunny reads.
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Could not create export canvas.");

  const audioBuffer = soundUrl ? await decodeSound(soundUrl) : null;
  const wantAudio = Boolean(audioBuffer) && (await canEncodeAudio("opus"));

  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });

  const videoSource = new CanvasSource(exportCanvas, {
    codec: "vp9",
    bitrate: QUALITY_HIGH,
    alpha: "keep",
    latencyMode: "quality",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource);

  let audioSource: AudioBufferSource | null = null;
  if (wantAudio && audioBuffer) {
    audioSource = new AudioBufferSource({
      codec: "opus",
      bitrate: QUALITY_MEDIUM,
    });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  if (audioSource && audioBuffer) {
    await audioSource.add(audioBuffer);
    audioSource.close();
  }

  let sawTransparentPixel = false;
  let proofSourceBlob: Blob | null = null;
  let proofMagentaBlob: Blob | null = null;
  let proofCheckerBlob: Blob | null = null;
  let alphaReport: Record<string, unknown> | null = null;

  const proofFrameIndex = Math.min(totalFrames - 1, Math.floor(FPS * 2.2));

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      throw new DOMException("Recording aborted", "AbortError");
    }

    await renderFrame(i / FPS);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);

    if (!sawTransparentPixel) {
      const probes = [
        ctx.getImageData(0, 0, 1, 1).data,
        ctx.getImageData(width - 1, 0, 1, 1).data,
        ctx.getImageData(0, height - 1, 1, 1).data,
        ctx.getImageData(width - 1, height - 1, 1, 1).data,
      ];
      sawTransparentPixel = probes.some((p) => p[3] < 8);
      if (i === Math.min(5, totalFrames - 1) && !sawTransparentPixel) {
        throw new Error(
          "WebGL frame has no transparent pixels — clear color alpha is not reaching the canvas.",
        );
      }
    }

    if (i === proofFrameIndex) {
      const corner = [...ctx.getImageData(2, 2, 1, 1).data];
      const midSky = [
        ...ctx.getImageData((width / 2) | 0, (height * 0.12) | 0, 1, 1).data,
      ];
      alphaReport = {
        frameIndex: i,
        timeSec: i / FPS,
        width,
        height,
        cornerRGBA: corner,
        midSkyRGBA: midSky,
      };

      proofSourceBlob = await canvasToPngBlob(exportCanvas);

      const magenta = document.createElement("canvas");
      magenta.width = width;
      magenta.height = height;
      const mctx = magenta.getContext("2d", { alpha: true });
      if (!mctx) throw new Error("magenta proof canvas failed");
      mctx.fillStyle = "#ff00aa";
      mctx.fillRect(0, 0, width, height);
      mctx.drawImage(exportCanvas, 0, 0);
      proofMagentaBlob = await canvasToPngBlob(magenta);

      const checker = document.createElement("canvas");
      checker.width = width;
      checker.height = height;
      const cctx = checker.getContext("2d", { alpha: true });
      if (!cctx) throw new Error("checker proof canvas failed");
      paintCheckerboard(cctx, width, height);
      cctx.drawImage(exportCanvas, 0, 0);
      proofCheckerBlob = await canvasToPngBlob(checker);
    }

    await videoSource.add(i * frameDur, frameDur);
    onProgress?.(i / totalFrames);
    if (i % 4 === 0) await yieldToUi();
  }

  videoSource.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 32) {
    throw new Error("WebM muxer produced an empty file.");
  }

  const blob = new Blob([buffer], { type: "video/webm" });

  // Fail closed: do not hand the user an opaque file.
  const decodedProof = await assertWebmHasAlpha(blob, width, height);

  // Write proofs to disk via Vite middleware (no Save dialog).
  const saved: Record<string, string | null> = {
    webm: await postAgentSave(`${baseName}.webm`, blob),
  };
  if (proofSourceBlob) {
    saved.sourcePng = await postAgentSave(`${baseName}-source-rgba.png`, proofSourceBlob);
  }
  if (proofMagentaBlob) {
    saved.magentaPng = await postAgentSave(
      `${baseName}-on-magenta.png`,
      proofMagentaBlob,
    );
  }
  if (proofCheckerBlob) {
    saved.checkerPng = await postAgentSave(
      `${baseName}-on-checker.png`,
      proofCheckerBlob,
    );
  }
  if (decodedProof.magentaPng) {
    saved.decodedMagentaPng = await postAgentSave(
      `${baseName}-decoded-on-magenta.png`,
      decodedProof.magentaPng,
    );
  }
  if (decodedProof.checkerPng) {
    saved.decodedCheckerPng = await postAgentSave(
      `${baseName}-decoded-on-checker.png`,
      decodedProof.checkerPng,
    );
  }
  if (decodedProof.sourcePng) {
    saved.decodedSourcePng = await postAgentSave(
      `${baseName}-decoded-rgba.png`,
      decodedProof.sourcePng,
    );
  }

  const report = {
    ...alphaReport,
    decoded: decodedProof.stats,
    saved,
    webmBytes: blob.size,
  };
  await postAgentSave(
    `${baseName}-alpha-report.json`,
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );

  if (autoDownload) {
    downloadBlob(blob, withExtension(filename, "webm"));
  }

  onProgress?.(1);
  return blob;
}

async function assertWebmHasAlpha(
  blob: Blob,
  width: number,
  height: number,
): Promise<{
  stats: Record<string, unknown>;
  sourcePng: Blob | null;
  magentaPng: Blob | null;
  checkerPng: Blob | null;
}> {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("WebM has no video track.");
    const transparent = await track.canBeTransparent();
    if (!transparent) {
      throw new Error("Encoded WebM is missing an alpha track.");
    }

    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(2.2);
    if (!sample) throw new Error("Could not decode a verification frame.");

    const frame = document.createElement("canvas");
    frame.width = width;
    frame.height = height;
    const fctx = frame.getContext("2d", { alpha: true });
    if (!fctx) {
      sample.close();
      throw new Error("Could not create decode canvas.");
    }
    fctx.clearRect(0, 0, width, height);
    sample.draw(fctx, 0, 0, width, height);
    sample.close();

    const corner = [...fctx.getImageData(2, 2, 1, 1).data];
    const midSky = [
      ...fctx.getImageData((width / 2) | 0, (height * 0.12) | 0, 1, 1).data,
    ];
    if (corner[3] > 16 && midSky[3] > 16) {
      throw new Error(
        `Decoded WebM is not transparent (corner alpha=${corner[3]}, sky alpha=${midSky[3]}).`,
      );
    }

    // Composite over magenta — pink must show through empty sky if alpha works.
    const magenta = document.createElement("canvas");
    magenta.width = width;
    magenta.height = height;
    const mctx = magenta.getContext("2d", { alpha: true });
    if (!mctx) throw new Error("decode magenta canvas failed");
    mctx.fillStyle = "#ff00aa";
    mctx.fillRect(0, 0, width, height);
    mctx.drawImage(frame, 0, 0);
    const magCorner = [...mctx.getImageData(2, 2, 1, 1).data];
    // Magenta is ~255,0,170 — if we see near-black, alpha failed.
    if (magCorner[0] < 200 || magCorner[2] < 120) {
      throw new Error(
        `Decoded frame does not reveal magenta through alpha (got rgba ${magCorner.join(",")}).`,
      );
    }

    const checker = document.createElement("canvas");
    checker.width = width;
    checker.height = height;
    const cctx = checker.getContext("2d", { alpha: true });
    if (!cctx) throw new Error("decode checker canvas failed");
    paintCheckerboard(cctx, width, height);
    cctx.drawImage(frame, 0, 0);

    return {
      stats: {
        transparentTrack: true,
        cornerRGBA: corner,
        midSkyRGBA: midSky,
        magentaCornerRGBA: magCorner,
      },
      sourcePng: await canvasToPngBlob(frame),
      magentaPng: await canvasToPngBlob(magenta),
      checkerPng: await canvasToPngBlob(checker),
    };
  } finally {
    input.dispose();
  }
}
