import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Dev-only: POST body to /__agent_save/<filename> writes into tmp/exports/ (no Save dialog). */
function agentSavePlugin(): Plugin {
  return {
    name: "agent-save",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__agent_save/") || req.method !== "POST") {
          next();
          return;
        }

        const rawName = decodeURIComponent(req.url.slice("/__agent_save/".length));
        const safe = path.basename(rawName).replace(/[^\w.\-]+/g, "_");
        if (!safe) {
          res.statusCode = 400;
          res.end("bad filename");
          return;
        }

        const dir = path.resolve(process.cwd(), "tmp", "exports");
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, safe);

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fs.writeFileSync(filePath, Buffer.concat(chunks));

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, path: filePath, bytes: fs.statSync(filePath).size }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), agentSavePlugin()],
  assetsInclude: ["**/*.mp3", "**/*.stl"],
});
