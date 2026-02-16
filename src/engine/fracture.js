/**
 * fracture.js — Voronoi-based brittle fracture system.
 *
 * What this does:
 * - Pre-generates a Voronoi tessellation across the popadom shape
 * - When the user taps, determines which cells to crack based on:
 *   - Distance from tap point (closer = more likely to crack)
 *   - Surface thickness from heightmap (thinner = easier to crack)
 * - Returns polygon fragments that become physics bodies
 *
 * How Voronoi shattering works (in plain English):
 * Imagine scattering a bunch of random dots on the popadom. Now draw lines
 * exactly halfway between each pair of neighbouring dots. This creates a
 * mosaic of irregular shapes — that's a Voronoi diagram. These shapes look
 * like natural crack patterns, which is why games use them for shattering.
 */

import { Delaunay } from "d3-delaunay";
import { sampleHeightmap } from "./popadom.js";

/**
 * Generate random seed points within the popadom outline.
 * More points = smaller fragments = more detailed shattering.
 *
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radius
 * @param {{ x: number, y: number }[]} outline
 * @param {number} count - number of seed points
 * @returns {number[][]} array of [x, y] points
 */
function generateSeedPoints(centerX, centerY, radius, outline, count) {
  const points = [];
  const radiusSq = radius * radius;

  // Use rejection sampling: pick random points in the bounding box,
  // keep only those inside the popadom outline
  while (points.length < count) {
    const x = centerX - radius + Math.random() * radius * 2;
    const y = centerY - radius + Math.random() * radius * 2;

    // Quick circle check first (fast), then precise polygon check if needed
    const dx = x - centerX;
    const dy = y - centerY;
    if (dx * dx + dy * dy <= radiusSq * 1.05) {
      points.push([x, y]);
    }
  }

  return points;
}

/**
 * Check if a point is inside a polygon using ray casting.
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Clip a polygon to the popadom outline using Sutherland-Hodgman algorithm.
 * This ensures fragments don't extend beyond the popadom's edges.
 */
function clipPolygonToCircle(polygon, centerX, centerY, radius) {
  // Simple approach: clip each vertex to be within the radius
  const clipped = polygon.map((p) => {
    const dx = p[0] - centerX;
    const dy = p[1] - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius * 1.08) {
      // Push the point inward to the edge
      const scale = (radius * 1.08) / dist;
      return [centerX + dx * scale, centerY + dy * scale];
    }
    return p;
  });
  return clipped;
}

/**
 * Compute the centroid (centre point) of a polygon.
 */
function polygonCentroid(vertices) {
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v[0];
    cy += v[1];
  }
  return [cx / vertices.length, cy / vertices.length];
}

/**
 * Compute the area of a polygon (using the shoelace formula).
 */
function polygonArea(vertices) {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Pre-compute the Voronoi tessellation for a popadom.
 * Call this once when a popadom is created. The cells are invisible until
 * the user taps, at which point we "activate" some of them as cracks.
 *
 * @param {object} popadom - popadom object from createPopadom()
 * @param {number} [cellCount=90] - how many Voronoi cells
 * @returns {object[]} array of cell objects
 */
export function precomputeVoronoi(popadom, cellCount = 90) {
  const { centerX, centerY, radius, outline, heightmap } = popadom;

  // Generate seed points
  const seeds = generateSeedPoints(centerX, centerY, radius, outline, cellCount);

  // Build the Voronoi diagram
  const bounds = [
    centerX - radius * 1.2,
    centerY - radius * 1.2,
    centerX + radius * 1.2,
    centerY + radius * 1.2,
  ];
  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi(bounds);

  // Extract each cell as a polygon, clipped to the popadom shape
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    const cellPolygon = voronoi.cellPolygon(i);
    if (!cellPolygon) continue;

    // Clip to popadom outline
    const clipped = clipPolygonToCircle(cellPolygon, centerX, centerY, radius);
    if (clipped.length < 3) continue;

    const area = polygonArea(clipped);
    if (area < 10) continue; // skip tiny slivers

    const centroid = polygonCentroid(clipped);

    // Sample the heightmap at this cell's centre to get its thickness
    const localX = centroid[0] - (centerX - radius);
    const localY = centroid[1] - (centerY - radius);
    const thickness = sampleHeightmap(heightmap, localX, localY, radius * 2);

    cells.push({
      seed: seeds[i],
      vertices: clipped,
      centroid,
      area,
      thickness, // 0-1, used for break resistance and fragment mass
      intact: true, // becomes false when cracked off
    });
  }

  return cells;
}

/**
 * Fracture the popadom at a tap point. Determines which cells to break
 * based on distance from tap and surface thickness.
 *
 * @param {object[]} cells - Voronoi cells from precomputeVoronoi()
 * @param {number} tapX - tap/click X position
 * @param {number} tapY - tap/click Y position
 * @param {number} radius - popadom radius (used for scaling distances)
 * @param {number} [force=1] - tap force multiplier (1 = normal tap)
 * @returns {object[]} array of newly broken cell objects
 */
export function fractureAtPoint(cells, tapX, tapY, radius, force = 1) {
  const newlyBroken = [];

  // The crack radius — how far from the tap the cracks spread.
  // Scaled by force. A normal tap cracks about 30-45% of the radius.
  const crackRadius = radius * (0.3 + Math.random() * 0.15) * force;

  for (const cell of cells) {
    if (!cell.intact) continue;

    const dx = cell.centroid[0] - tapX;
    const dy = cell.centroid[1] - tapY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > crackRadius) continue;

    // Break probability: higher when closer to tap and when thinner.
    // Distance factor: 1.0 at tap point, fading to 0 at crackRadius edge
    const distanceFactor = 1 - dist / crackRadius;

    // Thickness factor: thin areas (low value) break easily, thick bubbles resist.
    // Inverted: 0 thickness → 1.0 breakability, 1.0 thickness → 0.3 breakability
    const thicknessFactor = 1 - cell.thickness * 0.7;

    const breakProbability = distanceFactor * thicknessFactor;

    // Add some randomness so it doesn't look too uniform
    if (Math.random() < breakProbability * 0.9 + 0.1) {
      cell.intact = false;
      newlyBroken.push(cell);
    }
  }

  return newlyBroken;
}

/**
 * Re-fracture an existing fragment into smaller pieces.
 * Used when the user taps on an already-broken fragment.
 *
 * @param {object} fragment - a physics fragment object
 * @param {number} tapX
 * @param {number} tapY
 * @returns {object[]} array of sub-fragment vertex arrays
 */
export function refractureFragment(fragment, tapX, tapY) {
  const vertices = fragment.vertices;
  const centroid = polygonCentroid(vertices);
  const area = polygonArea(vertices);

  // Don't break very small pieces further
  if (area < 400) return null;

  // Generate 3-5 sub-points within this fragment
  const subCount = 3 + Math.floor(Math.random() * 3);
  const subSeeds = [[tapX, tapY]];

  for (let i = 0; i < subCount; i++) {
    // Random points biased toward the tap location
    const t = Math.random();
    const px = tapX + (centroid[0] - tapX) * t * 2 + (Math.random() - 0.5) * 40;
    const py = tapY + (centroid[1] - tapY) * t * 2 + (Math.random() - 0.5) * 40;
    subSeeds.push([px, py]);
  }

  // Build a mini Voronoi within this fragment's bounds
  const minX = Math.min(...vertices.map((v) => v[0]));
  const maxX = Math.max(...vertices.map((v) => v[0]));
  const minY = Math.min(...vertices.map((v) => v[1]));
  const maxY = Math.max(...vertices.map((v) => v[1]));

  const delaunay = Delaunay.from(subSeeds);
  const voronoi = delaunay.voronoi([minX - 10, minY - 10, maxX + 10, maxY + 10]);

  const subFragments = [];
  for (let i = 0; i < subSeeds.length; i++) {
    const cellPoly = voronoi.cellPolygon(i);
    if (!cellPoly) continue;

    // Clip to the parent fragment shape using Sutherland-Hodgman
    const clipped = clipToPolygon(cellPoly, vertices);
    if (clipped.length >= 3 && polygonArea(clipped) > 50) {
      subFragments.push({
        vertices: clipped,
        centroid: polygonCentroid(clipped),
        area: polygonArea(clipped),
        thickness: fragment.thickness || 0.5,
      });
    }
  }

  return subFragments.length >= 2 ? subFragments : null;
}

/**
 * Sutherland-Hodgman polygon clipping.
 * Clips `subject` polygon to be inside `clip` polygon.
 */
function clipToPolygon(subject, clip) {
  let output = subject.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
  const clipVerts = clip.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));

  for (let i = 0; i < clipVerts.length; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];

    const edgeStart = clipVerts[i];
    const edgeEnd = clipVerts[(i + 1) % clipVerts.length];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];

      const currInside = isInside(current, edgeStart, edgeEnd);
      const prevInside = isInside(previous, edgeStart, edgeEnd);

      if (currInside) {
        if (!prevInside) {
          const inter = intersect(previous, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = intersect(previous, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }

  return output;
}

function isInside(point, edgeStart, edgeEnd) {
  return (
    (edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) -
      (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]) >=
    0
  );
}

function intersect(a, b, c, d) {
  const denom =
    (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denom) < 1e-10) return null;

  const t =
    ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denom;

  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export { polygonCentroid, polygonArea };
