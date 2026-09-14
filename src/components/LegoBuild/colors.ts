export const LEGO_COLORS = {
  red: "#C91A09",
  yellow: "#F5CD2F",
  blue: "#0055BF",
  green: "#237841",
  orange: "#FE8A18",
  white: "#F2F3F2",
  black: "#1B2A34",
  azure: "#078BC9",
  lime: "#BBE90B",
  pink: "#FF698F",
  purple: "#81007B",
  nougat: "#D67441",
} as const;

export const CLASSIC_MIX = [
  LEGO_COLORS.red,
  LEGO_COLORS.yellow,
  LEGO_COLORS.blue,
  LEGO_COLORS.green,
  LEGO_COLORS.orange,
  LEGO_COLORS.white,
  LEGO_COLORS.azure,
] as const;

export const RAINBOW = [
  LEGO_COLORS.red,
  LEGO_COLORS.orange,
  LEGO_COLORS.yellow,
  LEGO_COLORS.green,
  LEGO_COLORS.azure,
  LEGO_COLORS.blue,
  LEGO_COLORS.purple,
  LEGO_COLORS.pink,
] as const;

export type BrickPaint = {
  front: string;
  top: string;
  right: string;
  left: string;
  stud: string;
  edge: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => clamp(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function mix(hex: string, amount: number, toward = "#ffffff"): string {
  const src = hexToRgb(hex);
  const dst = hexToRgb(toward);
  return rgbToHex(
    src.r + (dst.r - src.r) * amount,
    src.g + (dst.g - src.g) * amount,
    src.b + (dst.b - src.b) * amount,
  );
}

export function paintBrick(hex: string): BrickPaint {
  return {
    front: mix(hex, 0.04, "#000000"),
    top: mix(hex, 0.28),
    right: mix(hex, 0.22, "#000000"),
    left: mix(hex, 0.34, "#000000"),
    stud: mix(hex, 0.18),
    edge: mix(hex, 0.45, "#000000"),
  };
}
