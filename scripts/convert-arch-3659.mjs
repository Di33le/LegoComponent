import fs from "fs";
import path from "path";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { Vector3 } from "three";

const ROOT = path.resolve(
  "Assets/Parts/SmoothParts/Arch/_tmp_ldraw/ldraw",
);
const LDU = 0.4;
const cache = new Map();
const missing = new Set();

function findPart(name) {
  const base = path.basename(name).toLowerCase();
  for (const dir of ["parts", "p"]) {
    const folder = path.join(ROOT, dir);
    if (!fs.existsSync(folder)) continue;
    const direct = path.join(folder, path.basename(name));
    if (fs.existsSync(direct)) return direct;
    const hit = fs.readdirSync(folder).find((f) => f.toLowerCase() === base);
    if (hit) return path.join(folder, hit);
  }
  return null;
}

function parseFile(filePath) {
  if (cache.has(filePath)) return cache.get(filePath);
  const text = fs.readFileSync(filePath, "utf8");
  const tris = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("0")) continue;
    const parts = t.split(/\s+/);
    const typ = parts[0];
    if (typ === "3" && parts.length >= 11) {
      tris.push(parts.slice(2, 11).map(Number));
    } else if (typ === "4" && parts.length >= 14) {
      const n = parts.slice(2, 14).map(Number);
      tris.push([n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8]]);
      tris.push([n[0], n[1], n[2], n[6], n[7], n[8], n[9], n[10], n[11]]);
    } else if (typ === "1" && parts.length >= 15) {
      const x = +parts[2],
        y = +parts[3],
        z = +parts[4];
      const a = +parts[5],
        b = +parts[6],
        c = +parts[7];
      const d = +parts[8],
        e = +parts[9],
        f = +parts[10];
      const g = +parts[11],
        h = +parts[12],
        i = +parts[13];
      const subName = parts.slice(14).join(" ");
      const subPath = findPart(subName);
      if (!subPath) {
        missing.add(subName);
        continue;
      }
      for (const tri of parseFile(subPath)) {
        const out = [];
        for (let v = 0; v < 3; v++) {
          const px = tri[v * 3],
            py = tri[v * 3 + 1],
            pz = tri[v * 3 + 2];
          out.push(
            a * px + d * py + g * pz + x,
            b * px + e * py + h * pz + y,
            c * px + f * py + i * pz + z,
          );
        }
        tris.push(out);
      }
    }
  }
  cache.set(filePath, tris);
  return tris;
}

const part = findPart("3659.dat");
if (!part) throw new Error("3659.dat not found");
const tris = parseFile(part);
console.log("tris", tris.length, "missing", [...missing].slice(0, 20));

// LDraw -Y up → Y-up mm
const yup = tris.map((t) => {
  const o = [];
  for (let v = 0; v < 3; v++) {
    o.push(t[v * 3] * LDU, -t[v * 3 + 1] * LDU, t[v * 3 + 2] * LDU);
  }
  return o;
});

let min = [Infinity, Infinity, Infinity],
  max = [-Infinity, -Infinity, -Infinity];
for (const t of yup) {
  for (let v = 0; v < 3; v++) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], t[v * 3 + a]);
      max[a] = Math.max(max[a], t[v * 3 + a]);
    }
  }
}
console.log(
  "Y-up size",
  (max[0] - min[0]).toFixed(2),
  (max[1] - min[1]).toFixed(2),
  (max[2] - min[2]).toFixed(2),
);

const outPath = path.resolve("Assets/Parts/SmoothParts/Arch/Arch_1x4.stl");
const triCount = yup.length;
const out = Buffer.alloc(84 + triCount * 50);
out.write("Arch_1x4 LDraw 3659", 0);
out.writeUInt32LE(triCount, 80);
let o = 84;
for (const t of yup) {
  // Y-up (x,y,z) → raw (L,W,H)=(x,z,y) like Arch_1x3
  const p = [t[0], t[2], t[1], t[3], t[5], t[4], t[6], t[8], t[7]];
  const ax = p[0],
    ay = p[1],
    az = p[2],
    bx = p[3],
    by = p[4],
    bz = p[5],
    cx = p[6],
    cy = p[7],
    cz = p[8];
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az;
  const vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.writeFloatLE(nx / len, o);
  out.writeFloatLE(ny / len, o + 4);
  out.writeFloatLE(nz / len, o + 8);
  out.writeFloatLE(ax, o + 12);
  out.writeFloatLE(ay, o + 16);
  out.writeFloatLE(az, o + 20);
  out.writeFloatLE(bx, o + 24);
  out.writeFloatLE(by, o + 28);
  out.writeFloatLE(bz, o + 32);
  out.writeFloatLE(cx, o + 36);
  out.writeFloatLE(cy, o + 40);
  out.writeFloatLE(cz, o + 44);
  out.writeUInt16LE(0, o + 48);
  o += 50;
}
fs.writeFileSync(outPath, out);

const loader = new STLLoader();
const geo = loader.parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
geo.rotateX(-Math.PI / 2);
geo.computeBoundingBox();
const box = geo.boundingBox;
const c = new Vector3();
box.getCenter(c);
geo.translate(-c.x, -box.min.y, -c.z);
geo.computeBoundingBox();
const b = geo.boundingBox;
const s = new Vector3();
b.getSize(s);
const arr = geo.attributes.position.array;
const strips = 8;
const mins = Array(strips).fill(Infinity);
for (let i = 0; i < arr.length; i += 3) {
  const si = Math.min(
    strips - 1,
    Math.max(0, Math.floor(((arr[i] - b.min.x) / s.x) * strips)),
  );
  mins[si] = Math.min(mins[si], arr[i + 1]);
}
console.log("pipeline W H D", s.x.toFixed(2), s.y.toFixed(2), s.z.toFixed(2));
console.log(
  "minY",
  mins.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "-")).join(" "),
);
console.log("wrote", outPath, "bytes", out.length);
