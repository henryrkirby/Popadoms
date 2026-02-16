/**
 * popadom.js — Generates a single popadom with realistic shape and surface.
 *
 * What this does:
 * - Creates a roughly circular outline with irregular edges (like a real popadom)
 * - Generates a heightmap using simplex noise (bumps, bubbles, thin spots)
 * - The heightmap is used later for both visuals (shadows/colour) and physics
 *   (thin spots break more easily)
 */

import { createNoise2D } from "simplex-noise";

/**
 * Generate the outline of a popadom — roughly circular but with wobbly edges.
 * Returns an array of {x, y} points forming a closed polygon.
 *
 * @param {number} centerX - centre X position on canvas
 * @param {number} centerY - centre Y position on canvas
 * @param {number} radius - average radius in pixels
 * @param {number} [numPoints=64] - how many points around the edge
 * @returns {{ x: number, y: number }[]}
 */
export function generateOutline(centerX, centerY, radius, numPoints = 64) {
  const noise = createNoise2D();
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;

    // Use noise to wobble the radius at each angle.
    // The 2.5 multiplier controls how "wavy" the edge is.
    // The 0.08 multiplier controls how far the edge deviates from a perfect circle.
    const wobble = noise(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5);
    const r = radius * (1 + wobble * 0.08);

    points.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r,
    });
  }

  return points;
}

/**
 * Generate a heightmap for the popadom surface.
 * Higher values = thicker/raised areas (bubbles), lower values = thinner areas.
 *
 * The heightmap is a 2D grid stored as a flat array. Each cell holds a value
 * from 0 (very thin) to 1 (thick bubble).
 *
 * @param {number} width - grid width in cells
 * @param {number} height - grid height in cells
 * @returns {{ data: Float32Array, width: number, height: number }}
 */
export function generateHeightmap(width, height) {
  const noise = createNoise2D();
  const data = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Layer multiple noise frequencies for a natural look:
      // - Large, gentle undulations (frequency 0.015)
      // - Medium bumps (frequency 0.04)
      // - Small bubbles (frequency 0.1)
      const nx = x / width;
      const ny = y / height;

      const large = noise(nx * 3, ny * 3) * 0.4;
      const medium = noise(nx * 8 + 100, ny * 8 + 100) * 0.35;
      const small = noise(nx * 20 + 200, ny * 20 + 200) * 0.25;

      // Combine and normalise to 0-1 range
      const value = (large + medium + small + 1) / 2;
      data[y * width + x] = Math.max(0, Math.min(1, value));
    }
  }

  return { data, width, height };
}

/**
 * Sample the heightmap at a given world position.
 * Used by the fracture system to determine how easy a point is to crack.
 *
 * @param {{ data: Float32Array, width: number, height: number }} heightmap
 * @param {number} x - world X relative to popadom top-left
 * @param {number} y - world Y relative to popadom top-left
 * @param {number} popadomSize - the bounding size of the popadom in pixels
 * @returns {number} height value 0-1
 */
export function sampleHeightmap(heightmap, x, y, popadomSize) {
  // Convert world coords to heightmap grid coords
  const gx = Math.floor((x / popadomSize) * heightmap.width);
  const gy = Math.floor((y / popadomSize) * heightmap.height);

  if (gx < 0 || gx >= heightmap.width || gy < 0 || gy >= heightmap.height) {
    return 0.5; // default for out-of-bounds
  }

  return heightmap.data[gy * heightmap.width + gx];
}

/**
 * Create a full popadom object with all the data needed for rendering and physics.
 *
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radius
 * @returns {object} popadom object
 */
export function createPopadom(centerX, centerY, radius) {
  const outline = generateOutline(centerX, centerY, radius);
  const heightmapResolution = 128; // 128x128 grid — good balance of detail vs performance
  const heightmap = generateHeightmap(heightmapResolution, heightmapResolution);

  return {
    centerX,
    centerY,
    radius,
    outline,
    heightmap,
    // These will be set by the fracture system once the popadom is cracked
    fragments: null,
    isBroken: false,
  };
}
