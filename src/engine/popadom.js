/**
 * popadom.js — Generates popadom geometry and heightmap data for the 3D mesh.
 *
 * Creates:
 * - A disc geometry with irregular edge and surface displacement
 * - A heightmap (simplex noise) for bumps, bubbles, thin spots
 * - Thickness data used by the stress/fracture model
 */

import { createNoise2D } from "simplex-noise";

/**
 * Generate a heightmap for the popadom surface.
 * Values 0..1 where higher = thicker/raised (bubbles), lower = thinner.
 */
export function generateHeightmap(resolution = 128) {
  const noise = createNoise2D();
  const data = new Float32Array(resolution * resolution);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const nx = x / resolution;
      const ny = y / resolution;

      // Layer multiple octaves for natural look
      const large = noise(nx * 3, ny * 3) * 0.4;
      const medium = noise(nx * 8 + 100, ny * 8 + 100) * 0.35;
      const small = noise(nx * 20 + 200, ny * 20 + 200) * 0.25;

      const value = (large + medium + small + 1) / 2;
      data[y * resolution + x] = Math.max(0, Math.min(1, value));
    }
  }

  return { data, width: resolution, height: resolution };
}

/**
 * Sample the heightmap at normalised UV coordinates (0..1).
 */
export function sampleHeightmap(heightmap, u, v) {
  const gx = Math.floor(u * (heightmap.width - 1));
  const gy = Math.floor(v * (heightmap.height - 1));
  if (gx < 0 || gx >= heightmap.width || gy < 0 || gy >= heightmap.height) {
    return 0.5;
  }
  return heightmap.data[gy * heightmap.width + gx];
}

/**
 * Create a complete popadom data object.
 * This is pure data — the 3D mesh is built from it in the React component.
 */
export function createPopadomData(radius = 1.0) {
  const heightmap = generateHeightmap(128);

  // Generate wobbly edge offsets (per-vertex radial variation)
  const edgeNoise = createNoise2D();
  const edgeSegments = 64;
  const edgeOffsets = new Float32Array(edgeSegments);
  for (let i = 0; i < edgeSegments; i++) {
    const angle = (i / edgeSegments) * Math.PI * 2;
    const wobble = edgeNoise(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5);
    edgeOffsets[i] = wobble * 0.06; // 6% max deviation
  }

  return {
    radius,
    heightmap,
    edgeOffsets,
    edgeSegments,
  };
}
