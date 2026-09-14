export type LegoBuildHandle = {
  rebuild: () => void;
  downloadMp4: (filename?: string) => Promise<void>;
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
