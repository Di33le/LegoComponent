import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type {
  BufferGeometry,
  Mesh,
  OrthographicCamera as OrthoCam,
  PerspectiveCamera as PerspCam,
} from "three";
import { Box3, Vector3 } from "three";
import { CLASSIC_MIX, RAINBOW } from "./colors";
import { packText, type PackedBrick } from "./pack";
import {
  BODY_H,
  BRICK_H,
  PART_URLS,
  PART_URL_LIST,
  ROW_PITCH,
  STUD,
  partHeight,
  type PartId,
} from "./parts";
import {
  AUDIO_DURATION,
  SETTLE_AT,
  SETTLE_DURATION,
  assignSnapTimes,
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuad,
  lerp,
  motionTiming,
  type MotionTiming,
} from "./snaps";
import type { BuildClock } from "./types";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickColor(mode: string, letterIndex: number, random: () => number): string {
  if (mode === "classic") {
    return CLASSIC_MIX[Math.floor(random() * CLASSIC_MIX.length)];
  }
  if (mode === "rainbow") {
    return RAINBOW[letterIndex % RAINBOW.length];
  }
  return mode;
}

function usePartGeometries(): Record<PartId, BufferGeometry> {
  const loaded = useLoader(STLLoader, PART_URL_LIST);
  return useMemo(() => {
    const keys = Object.keys(PART_URLS) as PartId[];
    const map = {} as Record<PartId, BufferGeometry>;
    const box = new Box3();
    const center = new Vector3();

    keys.forEach((key, index) => {
      const geometry = loaded[index].clone();
      geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      box.copy(geometry.boundingBox!);
      box.getCenter(center);
      geometry.translate(-center.x, -box.min.y, -center.z);
      map[key] = geometry;
    });
    return map;
  }, [loaded]);
}

type Vec3 = [number, number, number];

type PlacedPiece = {
  brick: PackedBrick;
  color: string;
  pile: Vec3;
  pileRot: Vec3;
  hover: Vec3;
  dest: Vec3;
  yaw: number;
  timing: MotionTiming;
};

type PileBox = {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
};

function layoutMessyPile(
  bricks: PackedBrick[],
  width: number,
  depth: number,
  random: () => number,
  flat: boolean,
): { pile: Vec3; pileRot: Vec3 }[] {
  const results: { pile: Vec3; pileRot: Vec3 }[] = [];
  const leftBoxes: PileBox[] = [];
  const rightBoxes: PileBox[] = [];
  const halfDepth = Math.max(depth * 0.55, STUD * 3);

  for (let index = 0; index < bricks.length; index++) {
    const brick = bricks[index];
    const side = index % 2 === 0 ? -1 : 1;
    const boxes = side < 0 ? leftBoxes : rightBoxes;
    const h = partHeight(brick.part);
    const footX = Math.max(brick.sx, 1) * STUD * 0.5;
    const footZ = Math.max(brick.sz, 1) * STUD * 0.5;

    const baseX =
      side < 0
        ? -STUD * (flat ? 4.8 : 5.8) - random() * STUD * 0.8
        : width + STUD * (flat ? 4.8 : 5.8) + random() * STUD * 0.8;
    const flatZ = STUD * 0.5;

    let bestX = baseX;
    let bestY = 0;
    let bestZ = flat ? flatZ : halfDepth;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 14; attempt++) {
      const px = baseX + (random() - 0.5) * STUD * (flat ? 6.2 : 8.5);
      const pz = flat
        ? flatZ + (random() - 0.5) * 0.4
        : halfDepth + (random() - 0.5) * STUD * 7.5;

      let y = 0;
      for (const b of boxes) {
        const overlapX = Math.abs(px - b.x) < footX + b.hx * 0.88;
        if (!overlapX) continue;
        if (flat) {
          y = Math.max(y, b.y + b.hy * 2 * 0.92);
        } else if (Math.abs(pz - b.z) < footZ + b.hz * 0.85) {
          y = Math.max(y, b.y + b.hy * 2);
        }
      }

      const score = y + random() * STUD * 0.12;
      const maxY = BRICK_H * (flat ? 5.5 : 3.2);
      if (score < bestScore && y < maxY) {
        bestScore = score;
        bestX = px;
        bestY = y;
        bestZ = pz;
      }
    }

    if (bestY > BRICK_H * (flat ? 4 : 2.4)) {
      bestX = baseX + side * STUD * (1.8 + random() * 2.4);
      bestY = flat ? random() * STUD * 1.6 : 0;
      bestZ = flat ? flatZ : halfDepth + (random() - 0.5) * STUD * 9;
    }

    const tipX = flat ? 0 : (random() - 0.5) * 0.72;
    const tipZ = (random() - 0.5) * (flat ? 0.5 : 0.72);
    const yaw = flat ? (random() - 0.5) * 0.85 : random() * Math.PI * 2;
    const tipLift = flat
      ? Math.abs(tipZ) * STUD * 0.1
      : (Math.abs(tipX) + Math.abs(tipZ)) * STUD * 0.22;
    const pileY = bestY + tipLift;

    boxes.push({
      x: bestX,
      y: pileY,
      z: bestZ,
      hx: footX,
      hy: h * 0.5,
      hz: flat ? footX : footZ,
    });

    results.push({
      pile: [bestX, pileY, bestZ],
      pileRot: flat ? [0, yaw, tipZ] : [tipX, yaw, tipZ],
    });
  }

  return results;
}

function BrickPiece({
  geometry,
  piece,
  clock,
  hideUntilBuild,
}: {
  geometry: BufferGeometry;
  piece: PlacedPiece;
  clock: BuildClock;
  hideUntilBuild: boolean;
}) {
  const meshRef = useRef<Mesh>(null);
  const { pile, pileRot, hover, dest, yaw, timing } = piece;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.visible = !hideUntilBuild;
    mesh.position.set(pile[0], pile[1], pile[2]);
    mesh.rotation.set(pileRot[0], pileRot[1], pileRot[2]);
    mesh.scale.setScalar(1);
  }, [pile, pileRot, hideUntilBuild]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const time = clock.now();
    const { liftStart, liftDur, travelDur, alignDur, dropDur, snapAt } = timing;
    const travelStart = liftStart + liftDur;
    const alignStart = travelStart + travelDur;
    const dropStart = alignStart + alignDur;

    if (time >= SETTLE_AT || time >= AUDIO_DURATION - 0.02) {
      mesh.visible = true;
      mesh.position.set(dest[0], dest[1], dest[2]);
      mesh.rotation.set(0, yaw, 0);
      mesh.scale.setScalar(1);
      return;
    }

    if (time < liftStart) {
      mesh.visible = !hideUntilBuild;
      mesh.position.set(pile[0], pile[1], pile[2]);
      mesh.rotation.set(pileRot[0], pileRot[1], pileRot[2]);
      mesh.scale.setScalar(1);
      return;
    }

    mesh.visible = true;

    if (time < travelStart) {
      const t = easeOutCubic((time - liftStart) / liftDur);
      mesh.position.set(pile[0], lerp(pile[1], hover[1], t), pile[2]);
      mesh.rotation.set(
        lerp(pileRot[0], 0, t),
        lerp(pileRot[1], yaw, t * 0.35),
        lerp(pileRot[2], 0, t),
      );
      mesh.scale.setScalar(1);
      return;
    }

    if (time < alignStart) {
      const t = easeInOutCubic((time - travelStart) / travelDur);
      const arc = Math.sin(t * Math.PI) * BRICK_H * 0.22;
      mesh.position.set(
        lerp(pile[0], hover[0], t),
        hover[1] + arc,
        lerp(pile[2], hover[2], t),
      );
      mesh.rotation.set(
        lerp(pileRot[0], 0, easeOutQuad(t)),
        lerp(pileRot[1], yaw, easeOutQuad(t)),
        lerp(pileRot[2], 0, easeOutQuad(t)),
      );
      mesh.scale.setScalar(1);
      return;
    }

    if (time < dropStart) {
      const t = easeOutCubic((time - alignStart) / alignDur);
      const wobble = (1 - t) * STUD * 0.04;
      mesh.position.set(
        lerp(hover[0], dest[0], t) + Math.sin(time * 38) * wobble,
        hover[1],
        lerp(hover[2], dest[2], t) + Math.cos(time * 34) * wobble,
      );
      mesh.rotation.set(0, yaw, 0);
      mesh.scale.setScalar(1);
      return;
    }

    if (time < snapAt + 0.1) {
      const dropT = clamp01((time - dropStart) / dropDur);
      const eased = easeInCubic(dropT);
      mesh.position.set(dest[0], lerp(hover[1], dest[1], eased), dest[2]);
      mesh.rotation.set(0, yaw, 0);

      if (time >= snapAt) {
        const settle = clamp01((time - snapAt) / 0.085);
        const punch = 1 - Math.sin(settle * Math.PI) * 0.04;
        mesh.position.y = dest[1] - (1 - settle) * 0.4;
        mesh.scale.set(1 / Math.sqrt(punch), punch, 1 / Math.sqrt(punch));
      } else {
        mesh.scale.setScalar(1);
      }
      return;
    }

    mesh.position.set(dest[0], dest[1], dest[2]);
    mesh.rotation.set(0, yaw, 0);
    mesh.scale.setScalar(1);
  });

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow>
      <meshStandardMaterial
        color={piece.color}
        roughness={0.34}
        metalness={0.04}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

function BasePlate({
  width,
  depth,
  flat = false,
}: {
  width: number;
  depth: number;
  flat?: boolean;
}) {
  if (flat) {
    const w = width + STUD * 18;
    return (
      <group position={[width / 2, -0.6, 0]}>
        <mesh receiveShadow={false}>
          <boxGeometry args={[w, 1.2, STUD * 0.9]} />
          <meshStandardMaterial color="#1a2333" roughness={0.92} metalness={0.02} />
        </mesh>
      </group>
    );
  }
  const w = width + STUD * 22;
  const d = Math.max(depth + STUD * 14, STUD * 20);
  return (
    <group position={[width / 2, 0, depth / 2]}>
      <mesh receiveShadow position={[0, -0.5, 0]}>
        <boxGeometry args={[w, 1, d]} />
        <meshStandardMaterial color="#1a2333" roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh receiveShadow position={[0, -2.2, 0]}>
        <boxGeometry args={[w * 1.04, 2.4, d * 1.04]} />
        <meshStandardMaterial color="#10161f" roughness={0.96} metalness={0} />
      </mesh>
    </group>
  );
}

function BuildCamera({
  clock,
  cx,
  cy,
  cz,
  dist,
  enableOrbit,
}: {
  clock: BuildClock;
  cx: number;
  cy: number;
  cz: number;
  dist: number;
  enableOrbit: boolean;
}) {
  const camera = useThree((s) => s.camera as PerspCam);
  const controls = useThree((s) => s.controls) as unknown as
    | {
        target: Vector3;
        update: () => void;
        enabled: boolean;
        enableDamping: boolean;
      }
    | undefined;
  const released = useRef(false);

  const start = useMemo(
    () => new Vector3(cx + dist * 0.4, Math.max(cy * 0.25, 18) + dist * 0.22, cz + dist * 1.02),
    [cx, cy, cz, dist],
  );
  const mid = useMemo(
    () => new Vector3(cx + dist * 0.36, cy * 0.5 + dist * 0.3, cz + dist * 1.16),
    [cx, cy, cz, dist],
  );
  const end = useMemo(
    () => new Vector3(cx + dist * 0.26, cy * 0.45 + dist * 0.2, cz + dist * 0.88),
    [cx, cy, cz, dist],
  );
  const look = useMemo(() => new Vector3(cx, Math.max(cy * 0.45, 8), cz), [cx, cy, cz]);
  const lookEnd = useMemo(() => new Vector3(cx, cy * 0.55, cz), [cx, cy, cz]);
  const tmp = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    released.current = false;
    camera.position.copy(start);
    camera.lookAt(look);
    if (controls) {
      controls.target.copy(look);
      controls.enabled = false;
      controls.update();
    }
  }, [camera, controls, start, look]);

  useFrame(() => {
    const time = clock.now();
    const done = time >= AUDIO_DURATION - 0.02;

    if (enableOrbit && (done || released.current)) {
      released.current = true;
      if (controls) {
        controls.enabled = true;
        controls.update();
      }
      return;
    }

    if (controls) controls.enabled = false;

    const buildT = clamp01(time / SETTLE_AT);
    const finishT = clamp01((time - SETTLE_AT) / Math.max(0.01, AUDIO_DURATION - SETTLE_AT));

    if (time < SETTLE_AT) tmp.lerpVectors(start, mid, easeInOutCubic(buildT));
    else tmp.lerpVectors(mid, end, easeInOutCubic(finishT));

    camera.position.lerp(tmp, 0.07);
    const focus = time < SETTLE_AT ? look : lookEnd;
    if (controls) {
      controls.target.lerp(focus, 0.07);
      controls.update();
    } else {
      camera.lookAt(focus);
    }
  });

  return null;
}

function FlatCamera({
  clock,
  cx,
  cy,
  width,
  height,
  enableZoom,
}: {
  clock: BuildClock;
  cx: number;
  cy: number;
  width: number;
  height: number;
  enableZoom: boolean;
}) {
  const camera = useThree((s) => s.camera as OrthoCam);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as
    | {
        target: Vector3;
        update: () => void;
        enabled: boolean;
      }
    | undefined;
  const released = useRef(false);
  const focus = useMemo(() => new Vector3(cx, Math.max(cy * 0.52, 6), 0), [cx, cy]);

  const fitZoom = useMemo(() => {
    const spanX = width + STUD * 16;
    const spanY = height + STUD * 8;
    const margin = 1.18;
    return Math.min(size.width / (spanX * margin), size.height / (spanY * margin));
  }, [size.width, size.height, width, height]);

  useLayoutEffect(() => {
    released.current = false;
    camera.position.set(cx, focus.y, 500);
    camera.zoom = fitZoom * 0.92;
    camera.near = 0.1;
    camera.far = 2000;
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(focus);
      controls.enabled = false;
      controls.update();
    }
  }, [camera, controls, cx, focus, fitZoom]);

  useFrame(() => {
    const time = clock.now();
    const done = time >= AUDIO_DURATION - 0.02;
    const buildT = clamp01(time / SETTLE_AT);
    const targetZoom = lerp(fitZoom * 0.92, fitZoom, easeInOutCubic(buildT));

    if (enableZoom && (done || released.current)) {
      released.current = true;
      if (controls) {
        controls.enabled = true;
        controls.update();
      }
      return;
    }

    if (controls) controls.enabled = false;
    camera.zoom = lerp(camera.zoom, targetZoom, 0.08);
    camera.position.x = lerp(camera.position.x, cx, 0.08);
    camera.position.y = lerp(camera.position.y, focus.y, 0.08);
    camera.position.z = 500;
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.lerp(focus, 0.08);
      controls.update();
    }
  });

  return null;
}

type BuildSceneProps = {
  text: string;
  color: string;
  buildId: number;
  clock: BuildClock;
  showBaseplate?: boolean;
  hideUntilBuild?: boolean;
  smooth?: boolean;
  enableOrbit?: boolean;
  flat?: boolean;
  onReady?: () => void;
  onComplete?: () => void;
};

export function BuildScene({
  text,
  color,
  buildId,
  clock,
  showBaseplate = true,
  hideUntilBuild = false,
  smooth = false,
  enableOrbit = true,
  flat = false,
  onReady,
  onComplete,
}: BuildSceneProps) {
  const geometries = usePartGeometries();
  const completed = useRef(false);
  const { bricks, cols, rows } = useMemo(
    () => packText(text, { smooth, flat }),
    [text, smooth, flat],
  );

  useLayoutEffect(() => {
    onReady?.();
  }, [onReady, buildId]);

  const placed = useMemo(() => {
    const random = mulberry32(
      text.length * 97 + buildId * 131 + cols * 17 + (smooth ? 3 : 0) + (flat ? 11 : 0),
    );
    const sorted = [...bricks].sort((a, b) => b.y - a.y || a.x - b.x);
    const snaps = assignSnapTimes(sorted.length);
    const width = Math.max(cols * STUD, STUD);
    const depth = STUD * 2.5;
    const poses = layoutMessyPile(sorted, width, depth, random, flat);

    return sorted.map((brick, index): PlacedPiece => {
      const dest = destination(brick, rows, flat);
      const pose = poses[index];
      const hoverY = dest[1] + BRICK_H * (flat ? 1.1 : 1.45) + random() * BRICK_H * 0.2;

      return {
        brick,
        color: pickColor(color, brick.letterIndex, random),
        pile: pose.pile,
        pileRot: pose.pileRot,
        hover: [dest[0], hoverY, dest[2]],
        dest,
        yaw: brick.yaw,
        timing: motionTiming(snaps[index] ?? 0.3, index, sorted.length),
      };
    });
  }, [bricks, buildId, color, cols, rows, text.length, smooth, flat]);

  const width = Math.max(cols * STUD, STUD);
  const height = (rows - 1) * ROW_PITCH + BRICK_H + (smooth ? BODY_H * 0.35 : 0);
  const depth = STUD * 2.5;
  const cx = width / 2;
  const cy = height / 2;
  const cz = depth / 2;
  const dist = Math.max(width, height) * 1.45;

  useFrame(() => {
    if (completed.current || placed.length === 0) return;
    const time = clock.now();
    if (time < 0.05) return;
    if (time >= SETTLE_AT + SETTLE_DURATION || time >= AUDIO_DURATION - 0.02) {
      completed.current = true;
      onComplete?.();
    }
  });

  return (
    <>
      {flat ? (
        <>
          <OrthographicCamera
            makeDefault
            near={0.1}
            far={2000}
            position={[cx, Math.max(cy * 0.52, 6), 500]}
            zoom={8}
          />
          <OrbitControls
            makeDefault
            enabled={enableOrbit}
            enablePan={false}
            enableZoom={enableOrbit}
            enableRotate={false}
            target={[cx, Math.max(cy * 0.52, 6), 0]}
            minZoom={2}
            maxZoom={40}
            enableDamping
            dampingFactor={0.08}
          />
          <FlatCamera
            clock={clock}
            cx={cx}
            cy={cy}
            width={width}
            height={height}
            enableZoom={enableOrbit}
          />
        </>
      ) : (
        <>
          <PerspectiveCamera
            makeDefault
            fov={30}
            near={1}
            far={2000}
            position={[cx + dist * 0.4, Math.max(cy * 0.25, 18) + dist * 0.22, cz + dist * 1.02]}
          />
          <OrbitControls
            makeDefault
            enabled={enableOrbit}
            enablePan={false}
            enableZoom={enableOrbit}
            enableRotate={enableOrbit}
            target={[cx, Math.max(cy * 0.45, 8), cz]}
            minDistance={dist * 0.45}
            maxDistance={dist * 2.6}
            minPolarAngle={0.35}
            maxPolarAngle={1.45}
            enableDamping
            dampingFactor={0.08}
          />
          <BuildCamera
            clock={clock}
            cx={cx}
            cy={cy}
            cz={cz}
            dist={dist}
            enableOrbit={enableOrbit}
          />
        </>
      )}

      <hemisphereLight args={["#fff6e8", "#1b2433"]} intensity={flat ? 0.95 : 0.7} />
      <ambientLight intensity={flat ? 0.55 : 0.26} />
      <directionalLight
        position={flat ? [cx, cy + 40, 120] : [cx + 50, cy + 80, cz + 40]}
        intensity={flat ? 1.05 : 1.45}
        castShadow={!flat}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00025}
        shadow-normalBias={0.04}
      />
      {!flat ? (
        <directionalLight position={[cx - 40, cy + 25, cz - 35]} intensity={0.32} />
      ) : null}

      {showBaseplate ? <BasePlate width={width} depth={depth} flat={flat} /> : null}

      <group>
        {placed.map((piece) => (
          <BrickPiece
            key={`${piece.brick.id}-${buildId}`}
            geometry={geometries[piece.brick.part]}
            piece={piece}
            clock={clock}
            hideUntilBuild={hideUntilBuild}
          />
        ))}
      </group>
    </>
  );
}

function destination(brick: PackedBrick, rows: number, flat = false): Vec3 {
  const floorY = (rows - 1 - brick.y) * ROW_PITCH;
  const y =
    brick.kind === "tile"
      ? floorY + BODY_H + 0.05 // slight lift avoids z-fight with brick deck / studs
      : floorY;
  if (flat) {
    return [
      (brick.x + brick.sx / 2) * STUD,
      y,
      brick.z * 0.35 + brick.y * 0.02,
    ];
  }
  return [
    (brick.x + brick.sx / 2) * STUD,
    y,
    (brick.z + brick.sz / 2) * STUD,
  ];
}
