/**
 * renderer.js — Draws the popadom, fragments, and effects to the canvas.
 *
 * What this does:
 * - Draws the intact popadom with realistic surface texture (bumps, shadows, colour variation)
 * - Draws broken fragments with the same texture, correctly positioned by physics
 * - Draws crack lines and shadow effects
 * - Uses an offscreen canvas for the popadom texture (drawn once, reused each frame)
 */

/**
 * Create a texture image for the popadom surface.
 * This is drawn once to an offscreen canvas and then stamped onto fragments.
 *
 * @param {object} popadom - popadom object
 * @returns {HTMLCanvasElement} offscreen canvas with the texture
 */
export function createPopadomTexture(popadom) {
  const { radius, heightmap } = popadom;
  const size = Math.ceil(radius * 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const imageData = ctx.createImageData(size, size);
  const pixels = imageData.data;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Check if this pixel is inside the popadom circle (with some edge softness)
      const dx = px - radius;
      const dy = py - radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius * 1.05) continue;

      // Sample the heightmap at this pixel
      const hx = Math.floor((px / size) * heightmap.width);
      const hy = Math.floor((py / size) * heightmap.height);
      const h = heightmap.data[hy * heightmap.width + hx] || 0.5;

      // Base popadom colour: warm golden-brown
      // Varies with height: raised areas are lighter (bubbles catching light),
      // lower areas are slightly darker (shadows in the dips)
      const baseR = 210 + h * 35; // 210-245
      const baseG = 165 + h * 30; // 165-195
      const baseB = 80 + h * 25; // 80-105

      // Add tiny random speckle for texture grain
      const speckle = (Math.random() - 0.5) * 8;

      // Edge darkening — popadoms have slightly darker, crispier edges
      const edgeFactor = dist / radius;
      const edgeDarken = edgeFactor > 0.85 ? (edgeFactor - 0.85) * 200 : 0;

      // Subtle shadow based on heightmap gradient (fake lighting from top-left)
      let shadow = 0;
      if (hx > 0 && hy > 0) {
        const hLeft = heightmap.data[hy * heightmap.width + (hx - 1)] || 0.5;
        const hUp = heightmap.data[(hy - 1) * heightmap.width + hx] || 0.5;
        shadow = ((h - hLeft) + (h - hUp)) * 40; // positive = lit, negative = shadowed
      }

      const r = Math.max(0, Math.min(255, baseR + speckle + shadow - edgeDarken));
      const g = Math.max(0, Math.min(255, baseG + speckle + shadow * 0.8 - edgeDarken));
      const b = Math.max(0, Math.min(255, baseB + speckle + shadow * 0.5 - edgeDarken));

      // Alpha: soft edge falloff
      let alpha = 255;
      if (dist > radius * 0.95) {
        alpha = Math.max(0, 255 * (1 - (dist - radius * 0.95) / (radius * 0.1)));
      }

      const idx = (py * size + px) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Add some visible bubble highlights
  addBubbleHighlights(ctx, heightmap, size, radius);

  return canvas;
}

/**
 * Add subtle bright spots where the heightmap has peaks (bubbles).
 */
function addBubbleHighlights(ctx, heightmap, size, radius) {
  ctx.globalCompositeOperation = "screen";

  for (let y = 0; y < heightmap.height; y += 2) {
    for (let x = 0; x < heightmap.width; x += 2) {
      const h = heightmap.data[y * heightmap.width + x];
      if (h > 0.72) {
        const px = (x / heightmap.width) * size;
        const py = (y / heightmap.height) * size;
        const dx = px - radius;
        const dy = py - radius;
        if (dx * dx + dy * dy > radius * radius) continue;

        const intensity = (h - 0.72) * 2.5;
        const bubbleRadius = 2 + intensity * 4;

        ctx.beginPath();
        ctx.arc(px - 1, py - 1, bubbleRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 240, 200, ${intensity * 0.25})`;
        ctx.fill();
      }
    }
  }

  ctx.globalCompositeOperation = "source-over";
}

/**
 * Main render function — draws everything each frame.
 *
 * @param {CanvasRenderingContext2D} ctx - the main canvas context
 * @param {object} gameState - current game state
 */
export function render(ctx, gameState) {
  const { width, height, popadom, cells, physics, texture, tableclothPattern } = gameState;

  // Clear the canvas
  ctx.clearRect(0, 0, width, height);

  // Draw tablecloth background
  drawTablecloth(ctx, width, height, tableclothPattern);

  if (!popadom) return;

  // Draw the intact part of the popadom (cells that haven't broken off)
  drawIntactPopadom(ctx, popadom, cells, texture);

  // Draw a subtle shadow under the popadom
  drawPopadomShadow(ctx, popadom, cells);

  // Draw physics fragments (broken pieces)
  drawFragments(ctx, physics, texture, popadom);
}

/**
 * Draw the tablecloth background — a warm peach colour with subtle check pattern.
 */
function drawTablecloth(ctx, width, height, pattern) {
  // Base peach colour
  ctx.fillStyle = "#F5C6A0";
  ctx.fillRect(0, 0, width, height);

  // Subtle checkered pattern like a 70s tablecloth
  ctx.globalAlpha = 0.08;
  const gridSize = 40;
  for (let y = 0; y < height; y += gridSize) {
    for (let x = 0; x < width; x += gridSize) {
      if ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2 === 0) {
        ctx.fillStyle = "#E8A878";
        ctx.fillRect(x, y, gridSize, gridSize);
      }
    }
  }

  // Subtle woven line texture
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "#D4956A";
  ctx.lineWidth = 0.5;
  for (let y = 0; y < height; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let x = 0; x < width; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw the intact portion of the popadom (unbroken cells).
 */
function drawIntactPopadom(ctx, popadom, cells, texture) {
  if (!cells || !texture) return;

  const intactCells = cells.filter((c) => c.intact);
  if (intactCells.length === 0) return;

  // Build a clipping path from all intact cells
  ctx.save();
  ctx.beginPath();
  for (const cell of intactCells) {
    const verts = cell.vertices;
    if (verts.length < 3) continue;
    const first = Array.isArray(verts[0]) ? verts[0] : [verts[0].x, verts[0].y];
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < verts.length; i++) {
      const v = Array.isArray(verts[i]) ? verts[i] : [verts[i].x, verts[i].y];
      ctx.lineTo(v[0], v[1]);
    }
    ctx.closePath();
  }
  ctx.clip();

  // Draw the texture within the clipping path
  const texX = popadom.centerX - popadom.radius;
  const texY = popadom.centerY - popadom.radius;
  ctx.drawImage(texture, texX, texY);

  ctx.restore();

  // Draw subtle crack lines along the edges of broken cells
  drawCrackLines(ctx, cells);
}

/**
 * Draw crack lines where intact cells border broken cells.
 */
function drawCrackLines(ctx, cells) {
  ctx.save();
  ctx.strokeStyle = "rgba(80, 50, 20, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);

  for (const cell of cells) {
    if (!cell.intact) continue;

    const verts = cell.vertices;
    for (let i = 0; i < verts.length; i++) {
      const v1 = Array.isArray(verts[i]) ? verts[i] : [verts[i].x, verts[i].y];
      const v2Idx = (i + 1) % verts.length;
      const v2 = Array.isArray(verts[v2Idx]) ? verts[v2Idx] : [verts[v2Idx].x, verts[v2Idx].y];

      // Only draw edge if it borders a broken cell (rough check via nearby cells)
      ctx.beginPath();
      ctx.moveTo(v1[0], v1[1]);
      ctx.lineTo(v2[0], v2[1]);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw a soft shadow under the intact popadom.
 */
function drawPopadomShadow(ctx, popadom, cells) {
  const intactCells = cells ? cells.filter((c) => c.intact) : [];
  if (intactCells.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.filter = "blur(8px)";

  ctx.beginPath();
  for (const cell of intactCells) {
    const verts = cell.vertices;
    if (verts.length < 3) continue;
    const first = Array.isArray(verts[0]) ? verts[0] : [verts[0].x, verts[0].y];
    ctx.moveTo(first[0] + 4, first[1] + 4);
    for (let i = 1; i < verts.length; i++) {
      const v = Array.isArray(verts[i]) ? verts[i] : [verts[i].x, verts[i].y];
      ctx.lineTo(v[0] + 4, v[1] + 4);
    }
    ctx.closePath();
  }
  ctx.fillStyle = "#5a3a1a";
  ctx.fill();

  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw the physics-driven fragments (broken pieces).
 */
function drawFragments(ctx, physics, texture, popadom) {
  if (!physics) return;

  const bodies = physics.getFragments();
  if (bodies.length === 0) return;

  const texX = popadom.centerX - popadom.radius;
  const texY = popadom.centerY - popadom.radius;

  for (const body of bodies) {
    const data = body.popadomData;
    if (!data) continue;

    ctx.save();

    // Draw shadow under each fragment
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    const verts = body.vertices;
    ctx.moveTo(verts[0].x + 3, verts[0].y + 3);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x + 3, verts[i].y + 3);
    }
    ctx.closePath();
    ctx.fillStyle = "#5a3a1a";
    ctx.fill();
    ctx.globalAlpha = 1;

    // Clip to the fragment shape and draw the texture
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.clip();

    // We need to transform the texture to match the fragment's rotation and position.
    // The fragment has moved and rotated from its original position.
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.translate(-body.position.x, -body.position.y);

    ctx.drawImage(texture, texX, texY);
    ctx.restore();

    // Draw the fragment edge (crispy broken edge look)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(120, 80, 30, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
