import brick1x2 from "../../../Assets/Parts/1x2_Brick.stl?url";
import brick2x2 from "../../../Assets/Parts/2x2_Brick.stl?url";
import brick2x3 from "../../../Assets/Parts/2x3_Brick.stl?url";
import brick2x4 from "../../../Assets/Parts/2x4_Brick.stl?url";
import tile1x1 from "../../../Assets/Parts/SmoothParts/Tiles/1x1_Tile.stl?url";
import tile1x2 from "../../../Assets/Parts/SmoothParts/Tiles/1x2_Tile.stl?url";
import tile1x3 from "../../../Assets/Parts/SmoothParts/Tiles/1x3_Tile.stl?url";
import tile1x4 from "../../../Assets/Parts/SmoothParts/Tiles/1x4_Tile.stl?url";
import tile1x6 from "../../../Assets/Parts/SmoothParts/Tiles/1x6_Tile.stl?url";
import tile1x8 from "../../../Assets/Parts/SmoothParts/Tiles/1x8_Tile.stl?url";
import tile2x2 from "../../../Assets/Parts/SmoothParts/Tiles/2x2_Tile.stl?url";
import tile2x4 from "../../../Assets/Parts/SmoothParts/Tiles/2x4_Tile.stl?url";
import arch1x3 from "../../../Assets/Parts/SmoothParts/Arch/Arch_1x3.stl?url";
import arch1x4 from "../../../Assets/Parts/SmoothParts/Arch/Arch_1x4.stl?url";
import arch1x6 from "../../../Assets/Parts/SmoothParts/Arch/Arch_1x6.stl?url";

export const STUD = 8;
export const BRICK_H = 11.4;
export const BODY_H = 9.6;
export const TILE_H = 3.2;
export const STUD_H = BRICK_H - BODY_H;
export const ROW_PITCH = BODY_H;
export const WALL_DEPTH = 2;

export const PART_URLS = {
  "1x2_Brick": brick1x2,
  "2x2_Brick": brick2x2,
  "2x3_Brick": brick2x3,
  "2x4_Brick": brick2x4,
  "1x1_Tile": tile1x1,
  "1x2_Tile": tile1x2,
  "1x3_Tile": tile1x3,
  "1x4_Tile": tile1x4,
  "1x6_Tile": tile1x6,
  "1x8_Tile": tile1x8,
  "2x2_Tile": tile2x2,
  "2x4_Tile": tile2x4,
  Arch_1x3: arch1x3,
  Arch_1x4: arch1x4,
  Arch_1x6: arch1x6,
} as const;

export const PART_URL_LIST = Object.values(PART_URLS);

export type PartId = keyof typeof PART_URLS;

export type PartFit = {
  part: PartId;
  sx: number;
  sz: number;
  sy?: number;
  yaw: number;
  kind?: "brick" | "tile" | "arch";
};

export const PART_FITS: PartFit[] = [
  { part: "2x4_Brick", sx: 4, sz: 2, yaw: 0, kind: "brick" },
  { part: "2x3_Brick", sx: 3, sz: 2, yaw: 0, kind: "brick" },
  { part: "2x2_Brick", sx: 2, sz: 2, yaw: 0, kind: "brick" },
  { part: "1x2_Brick", sx: 1, sz: 2, yaw: Math.PI / 2, kind: "brick" },
];

export const TILE_FITS: PartFit[] = [
  { part: "2x4_Tile", sx: 4, sz: 2, yaw: 0, kind: "tile" },
  { part: "2x2_Tile", sx: 2, sz: 2, yaw: 0, kind: "tile" },
  { part: "1x8_Tile", sx: 8, sz: 1, yaw: 0, kind: "tile" },
  { part: "1x6_Tile", sx: 6, sz: 1, yaw: 0, kind: "tile" },
  { part: "1x4_Tile", sx: 4, sz: 1, yaw: 0, kind: "tile" },
  { part: "1x3_Tile", sx: 3, sz: 1, yaw: 0, kind: "tile" },
  { part: "1x2_Tile", sx: 2, sz: 1, yaw: 0, kind: "tile" },
  { part: "1x1_Tile", sx: 1, sz: 1, yaw: 0, kind: "tile" },
];

export const ARCH_FITS: PartFit[] = [
  { part: "Arch_1x6", sx: 6, sz: 1, sy: 1, yaw: 0, kind: "arch" },
  { part: "Arch_1x4", sx: 4, sz: 1, sy: 1, yaw: 0, kind: "arch" },
  { part: "Arch_1x3", sx: 3, sz: 1, sy: 1, yaw: 0, kind: "arch" },
];

export function partHeight(part: PartId): number {
  if (part.includes("Tile") || part.includes("Plate")) return TILE_H;
  if (part.startsWith("Arch")) return BODY_H;
  return BRICK_H;
}
