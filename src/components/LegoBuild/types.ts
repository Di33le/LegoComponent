export type LegoBuildHandle = {
  rebuild: () => void;
  /** Renders the export offline and returns the blob (does not open a save dialog). */
  downloadMp4: (filename?: string) => Promise<Blob>;
};

export type LegoColorMode = "classic" | "rainbow" | string;

export type LegoBuildProps = {
  text: string;
  color?: LegoColorMode;
  playSound?: boolean;
  soundSrc?: string;
  autoPlay?: boolean;
  showBaseplate?: boolean;
  hideUntilBuild?: boolean;
  smooth?: boolean;
  enableOrbit?: boolean;
  flat?: boolean;
  /** Scene backdrop. CSS color, or `"transparent"`. Default `#141c2b`. */
  background?: string;
  className?: string;
  onBuildComplete?: () => void;
};

export type BuildClock = {
  now: () => number;
};
