import { textToGrid } from "./font";
import {
  ARCH_FITS,
  PART_FITS,
  TILE_FITS,
  WALL_DEPTH,
  type PartFit,
  type PartId,
} from "./parts";

export type PackedBrick = {
  id: string;
  part: PartId;
  x: number;
  z: number;
  y: number;
  sx: number;
  sz: number;
  yaw: number;
  letterIndex: number;
  kind: "brick" | "tile" | "arch";
};

function packRun(
  fits: PartFit[],
  run: number,
  cursor: number,
  y: number,
  letterIndex: number,
  nextId: () => string,
  kind: PackedBrick["kind"],
  z = 0,
): PackedBrick[] {
  const bricks: PackedBrick[] = [];
  let remaining = run;
  let x = cursor;
  while (remaining > 0) {
    const fit = pickFit(fits, remaining, kind);
    bricks.push({
      id: nextId(),
      part: fit.part,
      x,
      z,
      y,
      sx: fit.sx,
      sz: fit.sz,
      yaw: fit.yaw,
      letterIndex,
      kind,
    });
    x += fit.sx;
    remaining -= fit.sx;
  }
  return bricks;
}

function pickFit(fits: PartFit[], remaining: number, kind: PackedBrick["kind"]): PartFit {
  if (kind === "tile" && remaining === 4) {
    const tile4 = fits.find((f) => f.sx === 4);
    if (tile4) return tile4;
  }
  return fits.find((candidate) => candidate.sx <= remaining) ?? fits[fits.length - 1];
}

function doubleAcrossDepth(
  piece: Omit<PackedBrick, "id" | "z" | "sz">,
  nextId: () => string,
): PackedBrick[] {
  const out: PackedBrick[] = [];
  for (let z = 0; z < WALL_DEPTH; z++) {
    out.push({
      ...piece,
      id: nextId(),
      z,
      sz: 1,
    });
  }
  return out;
}

function placeOnWall(
  piece: Omit<PackedBrick, "id" | "z" | "sz"> & { sz?: number },
  nextId: () => string,
  flat: boolean,
): PackedBrick[] {
  const depth = piece.sz ?? 1;
  if (depth >= WALL_DEPTH) {
    return [{ ...piece, id: nextId(), z: 0, sz: WALL_DEPTH }];
  }
  if (flat) {
    return [{ ...piece, id: nextId(), z: 0, sz: 1 }];
  }
  return doubleAcrossDepth(piece, nextId);
}

function packBrickLayer(
  grid: (number | null)[][],
  cols: number,
  rows: number,
  nextId: () => string,
): PackedBrick[] {
  const bricks: PackedBrick[] = [];

  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const letterIndex = grid[y][x];
      if (letterIndex === null) {
        x += 1;
        continue;
      }

      let run = 1;
      while (x + run < cols && grid[y][x + run] === letterIndex) run += 1;
      bricks.push(...packRun(PART_FITS, run, x, y, letterIndex, nextId, "brick", 0));
      x += run;
    }
  }

  return bricks;
}

function packTileCaps(
  grid: (number | null)[][],
  cols: number,
  rows: number,
  nextId: () => string,
  flat: boolean,
): PackedBrick[] {
  const tiles: PackedBrick[] = [];
  const capped = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  );

  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (grid[y][x] === null || capped[y][x]) {
        x += 1;
        continue;
      }

      const aboveClear = y === 0 || grid[y - 1][x] === null;
      if (!aboveClear) {
        x += 1;
        continue;
      }

      const letterIndex = grid[y][x] as number;
      let run = 1;
      while (
        x + run < cols &&
        grid[y][x + run] === letterIndex &&
        !capped[y][x + run] &&
        (y === 0 || grid[y - 1][x + run] === null)
      ) {
        run += 1;
      }

      for (let i = 0; i < run; i++) capped[y][x + i] = true;

      const row = packRun(TILE_FITS, run, x, y, letterIndex, nextId, "tile", 0);
      for (const tile of row) {
        tiles.push(
          ...placeOnWall(
            {
              part: tile.part,
              x: tile.x,
              y: tile.y,
              sx: tile.sx,
              sz: tile.sz,
              yaw: tile.yaw,
              letterIndex: tile.letterIndex,
              kind: "tile",
            },
            nextId,
            flat,
          ),
        );
      }
      x += run;
    }
  }

  return tiles;
}

function isEnclosedOpening(
  grid: (number | null)[][],
  rows: number,
  cols: number,
  x: number,
  y: number,
  run: number,
  letterIndex: number,
  direction: -1 | 1,
): boolean {
  if (run < 3) return false;
  const middles = Array.from({ length: run - 2 }, (_, i) => x + 1 + i);
  if (middles.some((cx) => cx < 0 || cx >= cols)) return false;

  const adjacent = y + direction;
  if (adjacent < 0 || adjacent >= rows) return false;
  if (!middles.every((cx) => grid[adjacent][cx] === null)) return false;

  let emptyRun = 1;
  for (let row = adjacent + direction; row >= 0 && row < rows; row += direction) {
    if (middles.every((cx) => grid[row][cx] === null)) {
      emptyRun += 1;
      continue;
    }
    if (middles.some((cx) => grid[row][cx] === letterIndex)) {
      return emptyRun >= 2;
    }
    break;
  }
  return false;
}

function isOpenCounterBridge(
  grid: (number | null)[][],
  cols: number,
  x: number,
  y: number,
  run: number,
  letterIndex: number,
): boolean {
  if (run < 3 || y <= 0) return false;
  const middles = Array.from({ length: run - 2 }, (_, i) => x + 1 + i);
  if (!middles.every((cx) => grid[y - 1][cx] === null)) return false;

  const left = x - 1;
  const right = x + run;
  if (left < 0 || right >= cols) return false;
  if (grid[y][left] !== null || grid[y][right] !== null) return false;
  return (
    grid[y - 1][left] === letterIndex && grid[y - 1][right] === letterIndex
  );
}

function applyArches(
  grid: (number | null)[][],
  cols: number,
  rows: number,
  bricks: PackedBrick[],
  nextId: () => string,
  flat: boolean,
): PackedBrick[] {
  const brickOnly = bricks.filter((b) => b.kind === "brick");
  const extras = bricks.filter((b) => b.kind !== "brick");
  const removed = new Set<string>();
  const added: PackedBrick[] = [];

  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (grid[y][x] === null) {
        x += 1;
        continue;
      }

      const letterIndex = grid[y][x] as number;
      let run = 1;
      while (x + run < cols && grid[y][x + run] === letterIndex) run += 1;

      const openingBelow = isEnclosedOpening(
        grid,
        rows,
        cols,
        x,
        y,
        run,
        letterIndex,
        1,
      );
      const openingAbove =
        isEnclosedOpening(grid, rows, cols, x, y, run, letterIndex, -1) ||
        isOpenCounterBridge(grid, cols, x, y, run, letterIndex);

      if (openingBelow || openingAbove) {
        const arch = ARCH_FITS.find((a) => (a.sy ?? 1) === 1 && a.sx === run);

        if (arch && arch.sx <= run) {
          for (const b of brickOnly) {
            if (b.y === y && b.x < x + run && b.x + b.sx > x) {
              removed.add(b.id);
            }
          }

          added.push(
            ...placeOnWall(
              {
                part: arch.part,
                x,
                y,
                sx: arch.sx,
                yaw: arch.yaw,
                letterIndex,
                kind: "arch",
              },
              nextId,
              flat,
            ),
          );

          const leftover = run - arch.sx;
          if (leftover > 0) {
            added.push(
              ...packRun(
                PART_FITS,
                leftover,
                x + arch.sx,
                y,
                letterIndex,
                nextId,
                "brick",
                0,
              ),
            );
          }

          x += run;
          continue;
        }
      }

      x += run;
    }
  }

  return [
    ...brickOnly.filter((b) => !removed.has(b.id)),
    ...extras,
    ...added,
  ];
}

export function packText(
  text: string,
  options: { smooth?: boolean; flat?: boolean } = {},
): {
  bricks: PackedBrick[];
  cols: number;
  rows: number;
} {
  const flat = Boolean(options.flat);
  const { grid, cols, rows } = textToGrid(text);
  let seq = 0;
  const nextId = () => `p${seq++}`;

  let bricks = packBrickLayer(grid, cols, rows, nextId);

  if (options.smooth) {
    bricks = applyArches(grid, cols, rows, bricks, nextId, flat);
    bricks = [...bricks, ...packTileCaps(grid, cols, rows, nextId, flat)];
  }

  return { bricks, cols, rows };
}
