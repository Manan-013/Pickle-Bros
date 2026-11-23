// Builds game-ready bobblehead heads from the full character models in the project root.
//
//   node tools/build-characters.mjs
//
// For each model: bake it upright (Y up), find the neck (the narrowest slice just below the head),
// keep only the head, crop its texture to the face area, simplify to ~12K triangles and save a small
// GLB to client/public/characters/<id>.glb. The STL has no texture, so it gets skin/hair colours.

import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'client/public/characters');
const TARGET_TRIANGLES = 12000;
const TEXTURE_SIZE = 512;

const MODELS = [
  { id: 'modi', file: 'modi_tour_guide_rigged.glb' },
  { id: 'trump', file: 'trump real.glb' },
  { id: 'babita', file: 'Babita.glb' },
  { id: 'salman', file: 'salman_khan_guide.stl', zUp: true },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ------------------------------------------------------------------ loading

/** Load a GLB's single mesh as world-space triangles (+ UVs and its base colour image). */
async function loadGlb(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getMesh());
  const prim = node.getMesh().listPrimitives()[0];
  const m = node.getWorldMatrix();
  const pos = prim.getAttribute('POSITION').getArray();
  const nrm = prim.getAttribute('NORMAL')?.getArray();
  let uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);

  const P = new Float32Array(pos.length);
  const N = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
    P[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (nrm) {
      const [a, b, c] = [nrm[i], nrm[i + 1], nrm[i + 2]];
      N[i] = m[0] * a + m[4] * b + m[8] * c;
      N[i + 1] = m[1] * a + m[5] * b + m[9] * c;
      N[i + 2] = m[2] * a + m[6] * b + m[10] * c;
    }
  }

  // Base colour image, with any KHR_texture_transform baked into the UVs.
  const info = prim.getMaterial()?.getBaseColorTextureInfo();
  const texture = prim.getMaterial()?.getBaseColorTexture();
  if (uv && info) {
    const tr = info.getExtension('KHR_texture_transform');
    if (tr) {
      const [ox, oy] = tr.getOffset();
      const [sx, sy] = tr.getScale();
      const r = tr.getRotation();
      const out = new Float32Array(uv.length);
      for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i] * sx;
        const v = uv[i + 1] * sy;
        out[i] = Math.cos(r) * u + Math.sin(r) * v + ox;
        out[i + 1] = -Math.sin(r) * u + Math.cos(r) * v + oy;
      }
      uv = out;
    }
  }
  return { P, N: nrm ? N : null, UV: uv ?? null, idx, image: texture ? Buffer.from(texture.getImage()) : null };
}

/**
 * Binary STL (Z up) → Y-up indexed mesh. STL repeats every corner per triangle, so shared corners
 * are merged (by position) and smooth normals are computed — otherwise it can't be simplified.
 */
function loadStl(path) {
  const b = readFileSync(path);
  const n = b.readUInt32LE(80);
  const key = new Map();
  const pos = [];
  const idx = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) {
      const q = 84 + i * 50 + 12 + v * 12;
      // (x, y, z) Z-up → (x, z, -y) Y-up
      const x = b.readFloatLE(q), y = b.readFloatLE(q + 8), z = -b.readFloatLE(q + 4);
      const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
      let id = key.get(k);
      if (id === undefined) { id = pos.length / 3; key.set(k, id); pos.push(x, y, z); }
      idx[i * 3 + v] = id;
    }
  }
  const P = Float32Array.from(pos);
  const N = new Float32Array(P.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, c, d] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [a, c, d]) { N[o] += fx; N[o + 1] += fy; N[o + 2] += fz; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return { P, N, UV: null, idx, image: null };
}

// ------------------------------------------------------------------ finding the head

/** The neck: the narrowest horizontal slice between the shoulders and the head. */
function findNeckY(P) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < P.length; i += 3) { minY = Math.min(minY, P[i]); maxY = Math.max(maxY, P[i]); }
  const h = maxY - minY;
  const BINS = 60;
  const lo = maxY - h * 0.26; // search the top quarter of the body
  const width = new Array(BINS).fill(null).map(() => [Infinity, -Infinity]);
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1];
    if (y < lo) continue;
    const bin = Math.min(BINS - 1, Math.floor(((y - lo) / (maxY - lo)) * BINS));
    width[bin][0] = Math.min(width[bin][0], P[i]);
    width[bin][1] = Math.max(width[bin][1], P[i]);
  }
  // Only consider slices from 8% to 22% below the top (below the chin, above the shoulders).
  let best = -1, bestW = Infinity;
  for (let k = 0; k < BINS; k++) {
    const y = lo + ((k + 0.5) / BINS) * (maxY - lo);
    const fromTop = (maxY - y) / h;
    if (fromTop < 0.08 || fromTop > 0.22) continue;
    const w = width[k][1] - width[k][0];
    if (w < bestW) { bestW = w; best = y; }
  }
  return { neckY: best, minY, maxY, height: h };
}

// ------------------------------------------------------------------ building the head

async function buildHead({ id, file, zUp }) {
  const src = zUp ? loadStl(resolve(ROOT, file)) : await loadGlb(resolve(ROOT, file));
  const { P, N, UV, idx, image } = src;
  const { neckY, height } = findNeckY(P);

  // Keep triangles fully above the neck.
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (P[a * 3 + 1] > neckY && P[b * 3 + 1] > neckY && P[c * 3 + 1] > neckY) keep.push(a, b, c);
  }
  // Compact to the used vertices.
  const remap = new Map();
  const used = [];
  for (const v of keep) if (!remap.has(v)) { remap.set(v, used.length); used.push(v); }
  const n = used.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const uv = UV ? new Float32Array(n * 2) : null;
  let cx = 0, cz = 0, top = -Infinity;
  used.forEach((v, i) => {
    pos.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], i * 3);
    if (N) nrm.set([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], i * 3);
    if (uv) uv.set([UV[v * 2], UV[v * 2 + 1]], i * 2);
    cx += P[v * 3]; cz += P[v * 3 + 2]; top = Math.max(top, P[v * 3 + 1]);
  });
  cx /= n; cz /= n;
  // Origin at the base of the neck, centred; size in metres as modelled.
  for (let i = 0; i < n; i++) { pos[i * 3] -= cx; pos[i * 3 + 1] -= neckY; pos[i * 3 + 2] -= cz; }
  const indices = Uint32Array.from(keep, (v) => remap.get(v));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  const material = doc.createMaterial('head').setRoughnessFactor(0.75).setMetallicFactor(0).setDoubleSided(true);

  if (uv && image) {
    // Crop the texture to the head's UV area (sharper face, much smaller file).
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      u0 = Math.min(u0, uv[i]); u1 = Math.max(u1, uv[i]); v0 = Math.min(v0, uv[i + 1]); v1 = Math.max(v1, uv[i + 1]);
    }
    const meta = await sharp(image).metadata();
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    [u0, v0, u1, v1] = [clamp01(u0 - 0.002), clamp01(v0 - 0.002), clamp01(u1 + 0.002), clamp01(v1 + 0.002)];
    const region = {
      left: Math.floor(u0 * meta.width),
      top: Math.floor(v0 * meta.height),
      width: Math.max(1, Math.ceil((u1 - u0) * meta.width)),
      height: Math.max(1, Math.ceil((v1 - v0) * meta.height)),
    };
    const jpeg = await sharp(image).extract(region).resize(TEXTURE_SIZE, TEXTURE_SIZE, { fit: 'fill' }).jpeg({ quality: 82 }).toBuffer();
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = (uv[i] - u0) / (u1 - u0);
      uv[i + 1] = (uv[i + 1] - v0) / (v1 - v0);
    }
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
    material.setBaseColorTexture(doc.createTexture('face').setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'));
  } else {
    // No texture (STL): skin below, darker hair on the top of the head.
    const colors = new Float32Array(n * 4);
    let hMax = 0;
    for (let i = 0; i < n; i++) hMax = Math.max(hMax, pos[i * 3 + 1]);
    for (let i = 0; i < n; i++) {
      const hair = pos[i * 3 + 1] > hMax * 0.8 || (pos[i * 3 + 1] > hMax * 0.62 && pos[i * 3 + 2] < -0.02);
      colors.set(hair ? [0.08, 0.06, 0.05, 1] : [0.78, 0.56, 0.42, 1], i * 4);
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colors).setBuffer(buffer));
  }
  prim.setMaterial(material);
  const mesh = doc.createMesh(id).addPrimitive(prim);
  doc.createScene().addChild(doc.createNode(id).setMesh(mesh));

  const before = indices.length / 3;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TARGET_TRIANGLES / before), error: 0.002 }), dedup(), prune());
  const out = resolve(OUT, `${id}.glb`);
  await io.write(out, doc);
  const after = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
  let headH = 0;
  for (let i = 1; i < pos.length; i += 3) headH = Math.max(headH, pos[i]);
  console.log(
    `${id.padEnd(7)} body ${height.toFixed(2)} m, head+neck ${headH.toFixed(2)} m, ${before.toLocaleString()} → ${Math.round(after).toLocaleString()} triangles, ${(statSync(out).size / 1024).toFixed(0)} KB`,
  );
}

await MeshoptSimplifier.ready;
mkdirSync(OUT, { recursive: true });
for (const m of MODELS) await buildHead(m);
