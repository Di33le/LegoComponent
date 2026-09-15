# LegoBuild

React + Three.js component that builds words from real LEGO STL parts, timed to `Assets/LegoBuild.mp3`.

## Demo

```bash
npm install
npm run dev
```

## Use in another project

This repo is a Vite app with the reusable component under `src/components/LegoBuild`. The easiest way to reuse it is to **copy those files plus the assets**.

### 1. Copy into your app

Copy:

- `src/components/LegoBuild/` → e.g. `src/components/LegoBuild/`
- `Assets/Parts/` and `Assets/LegoBuild.mp3` → keep the same relative path from the component (`../../../Assets/...`), or update the imports in `parts.ts` / `LegoBuild.tsx`

### 2. Install peer deps

```bash
npm install react react-dom three @react-three/fiber @react-three/drei mp4-muxer
```

Your bundler must be able to import `.stl` / `.mp3` as URLs (Vite does via `?url`; for Webpack/Next configure an asset rule).

### 3. Render

```tsx
import { useRef } from "react";
import { LegoBuild } from "./components/LegoBuild";
import type { LegoBuildHandle } from "./components/LegoBuild";

export function Hero() {
  const ref = useRef<LegoBuildHandle>(null);

  return (
    <LegoBuild
      ref={ref}
      text="Hello"
      color="classic"
      smooth
      flat
      background="transparent"
      onBuildComplete={() => console.log("done")}
    />
  );
}
```

### Optional: install from GitHub

After the repo is on GitHub:

```bash
npm install github:YOUR_USER/LegoComponent
```

That installs the whole app package — you still import from the package path to the component (or republish later as a proper library with an `exports` map). For most apps, **copying the folder** is simpler and avoids fighting asset paths.

## Props

```tsx
import { LegoBuild } from "./components/LegoBuild";

<LegoBuild text="LEGO" color="classic" />
```

| Prop | Default | Notes |
| --- | --- | --- |
| `text` | — | A–Z, a–z, 0–9, and `!?.,-:'+=#` |
| `color` | `"classic"` | `"classic"`, `"rainbow"`, or a hex color |
| `playSound` | `true` | Plays the build game track |
| `showBaseplate` | `true` | Dark plate under the model (Not a lego baseplate) |
| `hideUntilBuild` | `false` | Hide piles until each piece starts moving |
| `smooth` | `false` | SmoothParts tiles and arches |
| `enableOrbit` | `true` | Orbit / zoom (zoom-only when `flat`) |
| `flat` | `false` | 2D front view |
| `background` | `"#141c2b"` | CSS color, or `"transparent"` |
| `autoPlay` | `true` | Animate on mount |
| `onBuildComplete` | — | Fires when the last brick lands |

Ref methods: `rebuild()`, `downloadMp4(filename?)`.

`downloadMp4` **renders** the animation offline (seeks the clock per frame, then encodes). It is not a realtime screen capture, so the file stays smooth.

With `background="transparent"`, download exports a **WebM with a real alpha track** (VP9 color + VP9 alpha via Mediabunny), plus a checkerboard preview PNG. Solid backgrounds export **H.264 MP4**.

Open the WebM in **Chrome/Edge** (or `tmp/exports/preview.html` after a local export). Many desktop players ignore WebM alpha and show black even when the file is transparent. The dark plate under the bricks is the optional baseplate mesh, not the backdrop.
