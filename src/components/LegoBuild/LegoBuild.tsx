import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { Html, useProgress } from "@react-three/drei";
import { ACESFilmicToneMapping, Color, SRGBColorSpace } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import defaultBuildSound from "../../../Assets/LegoBuild.mp3";
import { BuildScene } from "./BuildScene";
import { PART_URL_LIST } from "./parts";
import { recordCanvasToMp4 } from "./recordMp4";
import { AUDIO_DURATION } from "./snaps";
import type { BuildClock, LegoBuildHandle, LegoBuildProps } from "./types";
import "./LegoBuild.css";

useLoader.preload(STLLoader, PART_URL_LIST);

const DEFAULT_BACKGROUND = "#141c2b";

type RenderApi = {
  advance: () => void;
  setFrameloop: (mode: "always" | "never" | "demand") => void;
};

function LoaderOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <Html center>
      <div className="lego-build__loading">
        Loading bricks… {Math.round(progress)}%
      </div>
    </Html>
  );
}

function SceneBackground({ background }: { background: string }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    if (background === "transparent") {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
      gl.setClearAlpha(0);
      return;
    }
    scene.background = new Color(background);
    gl.setClearColor(background, 1);
    gl.setClearAlpha(1);
  }, [background, gl, scene]);

  return null;
}

function RenderBridge({ apiRef }: { apiRef: MutableRefObject<RenderApi | null> }) {
  const advance = useThree((s) => s.advance);
  const set = useThree((s) => s.set);

  useLayoutEffect(() => {
    apiRef.current = {
      advance: () => {
        advance(performance.now());
      },
      setFrameloop: (mode) => set({ frameloop: mode }),
    };
  }, [advance, set, apiRef]);

  return null;
}

export const LegoBuild = forwardRef<LegoBuildHandle, LegoBuildProps>(
  function LegoBuild(
    {
      text,
      color = "classic",
      playSound = true,
      soundSrc = defaultBuildSound,
      autoPlay = true,
      showBaseplate = true,
      hideUntilBuild = false,
      smooth = false,
      enableOrbit = true,
      flat = false,
      background = DEFAULT_BACKGROUND,
      className,
      onBuildComplete,
    },
    ref,
  ) {
    const [buildId, setBuildId] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const renderApiRef = useRef<RenderApi | null>(null);
    const startedAt = useRef(0);
    const running = useRef(false);
    const epochRef = useRef(0);
    const armedEpoch = useRef(-1);
    const finishedEpoch = useRef(-1);
    const recordingRef = useRef(false);
    const exportModeRef = useRef(false);
    const exportTimeRef = useRef(0);
    const recordReadyWaiter = useRef<(() => void) | null>(null);
    const completeRef = useRef(onBuildComplete);
    completeRef.current = onBuildComplete;

    const clockRef = useRef<BuildClock>({
      now: () => 0,
    });

    clockRef.current.now = () => {
      if (exportModeRef.current) return exportTimeRef.current;
      if (!running.current) return 0;
      const audio = audioRef.current;
      if (playSound && audio) {
        if (!audio.paused || audio.ended || audio.currentTime > 0.001) {
          return audio.currentTime;
        }
      }
      return (performance.now() - startedAt.current) / 1000;
    };

    const markComplete = useCallback(() => {
      if (finishedEpoch.current === epochRef.current) return;
      finishedEpoch.current = epochRef.current;
      completeRef.current?.();
    }, []);

    const startClock = useCallback(() => {
      if (armedEpoch.current === epochRef.current) return;
      armedEpoch.current = epochRef.current;
      finishedEpoch.current = -1;
      running.current = true;
      startedAt.current = performance.now();

      // Offline export drives time itself — arm the scene but don't play audio.
      if (recordingRef.current) {
        exportModeRef.current = true;
        exportTimeRef.current = 0;
        recordReadyWaiter.current?.();
        recordReadyWaiter.current = null;
        return;
      }

      const audio = audioRef.current;
      if (!audio) {
        recordReadyWaiter.current?.();
        recordReadyWaiter.current = null;
        return;
      }

      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {}

      if (playSound) {
        const play = () => {
          startedAt.current = performance.now();
          void audio.play().catch(() => undefined);
          recordReadyWaiter.current?.();
          recordReadyWaiter.current = null;
        };
        if (audio.readyState >= 2) play();
        else audio.addEventListener("canplay", play, { once: true });
      } else {
        recordReadyWaiter.current?.();
        recordReadyWaiter.current = null;
      }
    }, [playSound]);

    const rebuild = useCallback(() => {
      epochRef.current += 1;
      armedEpoch.current = -1;
      running.current = false;
      exportModeRef.current = false;
      exportTimeRef.current = 0;
      setBuildId((value) => value + 1);
    }, []);

    const downloadMp4 = useCallback(
      async (filename?: string) => {
        if (recordingRef.current) {
          throw new Error("A recording is already in progress.");
        }
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error("Canvas is not ready yet.");
        }

        recordingRef.current = true;
        setIsRecording(true);
        try {
          const ready = new Promise<void>((resolve) => {
            recordReadyWaiter.current = resolve;
          });
          rebuild();
          await ready;
          // Let geometries / first layout settle.
          await new Promise((r) => requestAnimationFrame(() => r(undefined)));
          await new Promise((r) => requestAnimationFrame(() => r(undefined)));

          const api = renderApiRef.current;
          if (!api) throw new Error("Renderer is not ready yet.");

          api.setFrameloop("never");
          exportModeRef.current = true;

          const transparent = background === "transparent";
          const safeName =
            filename ??
            `lego-build-${(text || "build").replace(/[^\w\-]+/g, "_").slice(0, 24)}`;

          return await recordCanvasToMp4({
            canvas,
            soundUrl: playSound ? soundSrc : undefined,
            durationSec: AUDIO_DURATION + 0.35,
            filename: safeName,
            transparent,
            fillStyle: transparent ? DEFAULT_BACKGROUND : background,
            autoDownload: false,
            renderFrame: (timeSec) => {
              exportTimeRef.current = timeSec;
              api.advance();
            },
          });
        } finally {
          exportModeRef.current = false;
          renderApiRef.current?.setFrameloop("always");
          recordingRef.current = false;
          recordReadyWaiter.current = null;
          setIsRecording(false);
        }
      },
      [rebuild, text, playSound, soundSrc, background],
    );

    useImperativeHandle(ref, () => ({ rebuild, downloadMp4 }), [
      rebuild,
      downloadMp4,
    ]);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const onEnded = () => markComplete();
      audio.addEventListener("ended", onEnded);
      return () => audio.removeEventListener("ended", onEnded);
    }, [markComplete]);

    const skipFirst = useRef(true);
    useEffect(() => {
      if (!autoPlay) return;
      if (skipFirst.current) {
        skipFirst.current = false;
        return;
      }
      if (recordingRef.current) return;
      rebuild();
    }, [autoPlay, text, color, showBaseplate, hideUntilBuild, smooth, flat, rebuild]);

    const transparent = background === "transparent";
    const rootClass = [
      "lego-build",
      flat ? "lego-build--flat" : null,
      transparent ? "lego-build--clear" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={rootClass}
        role="img"
        aria-label={text ? `Lego text ${text}` : "Lego text"}
      >
        <audio ref={audioRef} src={soundSrc} preload="auto" />
        <Canvas
          shadows={!flat}
          dpr={[1, 2]}
          frameloop="always"
          gl={{
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: true,
            premultipliedAlpha: true,
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = ACESFilmicToneMapping;
            gl.outputColorSpace = SRGBColorSpace;
            canvasRef.current = gl.domElement;
          }}
          onPointerMissed={() => {
            if (!recordingRef.current) rebuild();
          }}
        >
          <RenderBridge apiRef={renderApiRef} />
          <SceneBackground background={background} />
          <LoaderOverlay />
          <Suspense fallback={null}>
            <BuildScene
              key={`${text}-${color}-${smooth}-${showBaseplate}-${hideUntilBuild}-${flat}-${buildId}`}
              text={text}
              color={color}
              buildId={buildId}
              clock={clockRef.current}
              showBaseplate={showBaseplate}
              hideUntilBuild={hideUntilBuild}
              smooth={smooth}
              enableOrbit={enableOrbit && !isRecording}
              flat={flat}
              onReady={startClock}
              onComplete={markComplete}
            />
          </Suspense>
        </Canvas>
      </div>
    );
  },
);
