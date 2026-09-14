import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LegoBuild, LEGO_COLORS } from "./components/LegoBuild";
import type { LegoBuildHandle } from "./components/LegoBuild";
import "./App.css";

const PRESETS = ["LEGO", "Build", "Play", "Hello", "WOW!", "2026"];

const COLORS: { id: string; label: string; value: string }[] = [
  { id: "classic", label: "Classic mix", value: "classic" },
  { id: "rainbow", label: "Rainbow", value: "rainbow" },
  { id: "red", label: "Red", value: LEGO_COLORS.red },
  { id: "yellow", label: "Yellow", value: LEGO_COLORS.yellow },
  { id: "blue", label: "Blue", value: LEGO_COLORS.blue },
  { id: "green", label: "Green", value: LEGO_COLORS.green },
  { id: "orange", label: "Orange", value: LEGO_COLORS.orange },
  { id: "white", label: "White", value: LEGO_COLORS.white },
  { id: "azure", label: "Azure", value: LEGO_COLORS.azure },
];

type Option = {
  key: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

export default function App() {
  const buildRef = useRef<LegoBuildHandle>(null);
  const [draft, setDraft] = useState("LEGO");
  const [text, setText] = useState("LEGO");
  const [color, setColor] = useState("classic");
  const [playSound, setPlaySound] = useState(true);
  const [showBaseplate, setShowBaseplate] = useState(true);
  const [hideUntilBuild, setHideUntilBuild] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [enableOrbit, setEnableOrbit] = useState(true);
  const [flat, setFlat] = useState(false);
  const [transparentBg, setTransparentBg] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = draft.trim();
      setText(next);
      if (next) setStatus(`Building “${next}”`);
    }, 380);
    return () => window.clearTimeout(id);
  }, [draft]);

  const options: Option[] = [
    { key: "sound", label: "Sound", checked: playSound, onChange: setPlaySound },
    { key: "plate", label: "Baseplate", checked: showBaseplate, onChange: setShowBaseplate },
    { key: "hide", label: "Hide piles", checked: hideUntilBuild, onChange: setHideUntilBuild },
    { key: "smooth", label: "Smooth", checked: smooth, onChange: setSmooth },
    { key: "flat", label: "2D", checked: flat, onChange: setFlat },
    {
      key: "clear",
      label: "Clear BG",
      checked: transparentBg,
      onChange: setTransparentBg,
    },
    {
      key: "orbit",
      label: flat ? "Zoom" : "Orbit",
      checked: enableOrbit,
      onChange: setEnableOrbit,
    },
  ];

  async function exportMp4() {
    try {
      setRecording(true);
      setStatus("Recording…");
      await buildRef.current?.downloadMp4();
      setStatus(`Saved “${text}”`);
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Export failed");
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="demo">
      <header className="demo__bar">
        <h1 className="demo__logo">LegoBuild</h1>
      </header>

      <main className="demo__body">
        <section className="demo__stage" aria-label="Preview">
          {text ? (
            <LegoBuild
              ref={buildRef}
              text={text}
              color={color}
              playSound={playSound}
              showBaseplate={showBaseplate}
              hideUntilBuild={hideUntilBuild}
              smooth={smooth}
              enableOrbit={enableOrbit}
              flat={flat}
              background={transparentBg ? "transparent" : "#141c2b"}
              autoPlay
              onBuildComplete={() => setStatus(`Built “${text}”`)}
            />
          ) : (
            <p className="demo__empty">Type a word to build.</p>
          )}
          <p className="demo__hint">
            {flat ? "Scroll to zoom" : "Drag to orbit"} · click empty space to rebuild
          </p>
        </section>

        <aside className="demo__panel">
          <label className="demo__field">
            <span>Text</span>
            <input
              value={draft}
              maxLength={14}
              autoComplete="off"
              spellCheck={false}
              placeholder="LEGO"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") buildRef.current?.rebuild();
              }}
            />
          </label>

          <div className="demo__presets" role="group" aria-label="Presets">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={draft === preset ? "is-on" : undefined}
                onClick={() => setDraft(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          <fieldset className="demo__field">
            <legend>Color</legend>
            <div className="demo__swatches">
              {COLORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={color === option.value ? "is-on" : undefined}
                  style={
                    {
                      "--swatch": option.value.startsWith("#")
                        ? option.value
                        : option.id === "rainbow"
                          ? "linear-gradient(90deg, #C91A09, #F5CD2F, #0055BF)"
                          : "conic-gradient(#C91A09 0 90deg, #F5CD2F 0 180deg, #0055BF 0 270deg, #237841 0)",
                    } as CSSProperties
                  }
                  title={option.label}
                  aria-label={option.label}
                  onClick={() => setColor(option.value)}
                />
              ))}
            </div>
          </fieldset>

          <div className="demo__options">
            {options.map((option) => (
              <label key={option.key}>
                <input
                  type="checkbox"
                  checked={option.checked}
                  onChange={(e) => option.onChange(e.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          <div className="demo__actions">
            <button
              type="button"
              className="demo__primary"
              onClick={() => {
                setStatus(`Building “${text}”`);
                buildRef.current?.rebuild();
              }}
            >
              Rebuild
            </button>
            <button
              type="button"
              className="demo__secondary"
              disabled={!text || recording}
              onClick={() => void exportMp4()}
            >
              {recording ? "Recording…" : "Download MP4"}
            </button>
          </div>

          <p className="demo__status">{status}</p>
        </aside>
      </main>
    </div>
  );
}
