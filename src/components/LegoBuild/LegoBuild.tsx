import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
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
      return;
    }
    scene.background = new Color(background);
    gl.setClearColor(background, 1);
  }, [background, gl, scene]);

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
    const startedAt = useRef(0);
    const running = useRef(false);
    const epochRef = useRef(0);
    const armedEpoch = useRef(-1);
    const finishedEpoch = useRef(-1);
    const recordingRef = useRef(false);
    const recordReadyWaiter = useRef<(() => void) | null>(null);
    const completeRef = useRef(onBuildComplete);
    completeRef.current = onBuildComplete;

    const clockRef = useRef<BuildClock>({
      now: () => 0,
    });

    clockRef.current.now = () => {
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
          await new Promise((r) => requestAnimationFrame(() => r(undefined)));

          const safeName =
            filename ??
            `lego-build-${(text || "build").replace(/[^\w\-]+/g, "_").slice(0, 24)}.mp4`;

          await recordCanvasToMp4({
            canvas,
            soundUrl: playSound ? soundSrc : undefined,
            durationSec: AUDIO_DURATION + 0.35,
            filename: safeName,
            fillStyle:
              background === "transparent" ? DEFAULT_BACKGROUND : background,
          });
        } finally {
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
          gl={{
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: true,
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
