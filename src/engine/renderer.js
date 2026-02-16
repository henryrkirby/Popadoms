/**
 * renderer.js — Draws the popadom, fragments, and effects to the canvas.
 *
 * - Renders a sharp, realistic popadom texture with visible bubbles and char spots
 * - Draws broken fragments in place on the table (no sliding away)
 * - Realistic tablecloth background resembling an Indian restaurant
 * - No pre-drawn fracture lines — cracks only appear where the popadom has actually broken
 */

/**
 * Create a high-resolution texture for the popadom surface.
 * Drawn once to an offscreen canvas, then reused for all fragments.
 */
export function createPopadomTexture(popadom) {
  const { radius, heightmap } = popadom;
  // Use 2x resolution for sharpness
  const scale = 2;
  const size = Math.ceil(radius * 2 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const imageData = ctx.createImageData(size, size);
  const pixels = imageData.data;
  const scaledRadius = radius * scale;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - scaledRadius;
      const dy = py - scaledRadius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > scaledRadius * 1.02) continue;

      // Sample heightmap
      const hx = Math.floor((px / size) * heightmap.width);
      const hy = Math.floor((py / size) * heightmap.height);
      const h = heightmap.data[hy * heightmap.width + hx] || 0.5;

      // Base colour: golden-brown, varying with height
      // Raised bubbles are lighter/more golden, flat areas are darker/more toasted
      let baseR = 200 + h * 45;  // 200-245
      let baseG = 155 + h * 40;  // 155-195
      let baseB = 65 + h * 30;   // 65-95

      // Char spots — dark patches on very thin areas (realistic burnt spots)
      if (h < 0.28) {
        const charIntensity = (0.28 - h) * 3.0;
        baseR -= charIntensity * 60;
        baseG -= charIntensity * 50;
        baseB -= charIntensity * 25;
      }

      // Fine grain texture (not random per-frame — use deterministic noise from position)
      const grain = (Math.sin(px * 127.1 + py * 311.7) * 43758.5453) % 1;
      const speckle = (grain - 0.5) * 12;

      // Edge darkening — crispier, more toasted edges
      const edgeFactor = dist / scaledRadius;
      let edgeDarken = 0;
      if (edgeFactor > 0.82) {
        edgeDarken = (edgeFactor - 0.82) * 280;
      }

      // Lighting from top-left — heightmap gradient gives 3D feel
      let shadow = 0;
      if (hx > 0 && hy > 0 && hx < heightmap.width && hy < heightmap.height) {
        const hLeft = heightmap.data[hy * heightmap.width + (hx - 1)] || 0.5;
        const hUp = heightmap.data[(hy - 1) * heightmap.width + hx] || 0.5;
        shadow = ((h - hLeft) + (h - hUp)) * 55;
      }

      const r = Math.max(0, Math.min(255, baseR + speckle + shadow - edgeDarken));
      const g = Math.max(0, Math.min(255, baseG + speckle + shadow * 0.8 - edgeDarken));
      const b = Math.max(0, Math.min(255, baseB + speckle + shadow * 0.5 - edgeDarken));

      // Alpha: crisp edge with slight antialiasing
      let alpha = 255;
      if (dist > scaledRadius * 0.97) {
        alpha = Math.max(0, 255 * (1 - (dist - scaledRadius * 0.97) / (scaledRadius * 0.05)));
      }

      const idx = (py * size + px) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Draw raised bubble highlights — visible bumps with shine
  addBubbleHighlights(ctx, heightmap, size, scaledRadius);

  // Store the scale factor on the canvas so the renderer knows how to draw it
  canvas._textureScale = scale;

  return canvas;
}

/**
 * Add highlight and shadow to raised bubble areas for 3D effect.
 */
function addBubbleHighlights(ctx, heightmap, size, scaledRadius) {
  // Light highlight on top-left of bubbles
  ctx.globalCompositeOperation = "screen";
  for (let y = 0; y < heightmap.height; y++) {
    for (let x = 0; x < heightmap.width; x++) {
      const h = heightmap.data[y * heightmap.width + x];
      if (h > 0.68) {
        const px = (x / heightmap.width) * size;
        const py = (y / heightmap.height) * size;
        const dx = px - scaledRadius;
        const dy = py - scaledRadius;
        if (dx * dx + dy * dy > scaledRadius * scaledRadius) continue;

        const intensity = (h - 0.68) * 3.0;
        const bubbleRadius = 1.5 + intensity * 3;

        // Highlight offset toward light source (top-left)
        ctx.beginPath();
        ctx.arc(px - 1.5, py - 1.5, bubbleRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 245, 210, ${Math.min(0.35, intensity * 0.3)})`;
        ctx.fill();
      }
    }
  }

  // Subtle shadow on bottom-right of bubbles
  ctx.globalCompositeOperation = "multiply";
  for (let y = 0; y < heightmap.height; y++) {
    for (let x = 0; x < heightmap.width; x++) {
      const h = heightmap.data[y * heightmap.width + x];
      if (h > 0.7) {
        const px = (x / heightmap.width) * size;
        const py = (y / heightmap.height) * size;
        const dx = px - scaledRadius;
        const dy = py - scaledRadius;
        if (dx * dx + dy * dy > scaledRadius * scaledRadius) continue;

        const intensity = (h - 0.7) * 2.5;
        const bubbleRadius = 1 + intensity * 2;

        ctx.beginPath();
        ctx.arc(px + 1.5, py + 1.5, bubbleRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160, 120, 60, ${Math.min(0.2, intensity * 0.15)})`;
        ctx.fill();
      }
    }
  }

  ctx.globalCompositeOperation = "source-over";
}

/**
 * Create a cached tablecloth pattern canvas.
 */
export function createTableclothPattern(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Deep burgundy/maroon base — classic Indian restaurant tablecloth
  ctx.fillStyle = "#8B1A2B";
  ctx.fillRect(0, 0, width, height);

  // Woven fabric texture — subtle cross-hatch
  const gridSize = 3;
  for (let y = 0; y < height; y += gridSize) {
    for (let x = 0; x < width; x += gridSize) {
      const noise = (Math.sin(x * 73.7 + y * 157.3) * 43758.5453) % 1;
      const variation = (noise - 0.5) * 12;
      ctx.fillStyle = `rgb(${139 + variation}, ${26 + variation * 0.3}, ${43 + variation * 0.4})`;
      ctx.fillRect(x, y, gridSize, gridSize);
    }
  }

  // Gold/yellow paisley-inspired decorative border pattern bands
  const bandWidth = 28;
  const bandSpacing = 120;
  ctx.globalAlpha = 0.12;

  for (let offset = bandSpacing; offset < Math.max(width, height); offset += bandSpacing) {
    // Horizontal bands
    ctx.fillStyle = "#D4A843";
    ctx.fillRect(0, offset - bandWidth / 2, width, bandWidth);
    // Vertical bands
    ctx.fillRect(offset - bandWidth / 2, 0, bandWidth, height);
  }

  // Inner lines within bands
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#F0D060";
  ctx.lineWidth = 1;
  for (let offset = bandSpacing; offset < Math.max(width, height); offset += bandSpacing) {
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(0, offset - bandWidth / 4);
    ctx.lineTo(width, offset - bandWidth / 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, offset + bandWidth / 4);
    ctx.lineTo(width, offset + bandWidth / 4);
    ctx.stroke();
    // Vertical
    ctx.beginPath();
    ctx.moveTo(offset - bandWidth / 4, 0);
    ctx.lineTo(offset - bandWidth / 4, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offset + bandWidth / 4, 0);
    ctx.lineTo(offset + bandWidth / 4, height);
    ctx.stroke();
  }

  // Small diamond/dot motifs at band intersections
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#F0D060";
  for (let y = bandSpacing; y < height; y += bandSpacing) {
    for (let x = bandSpacing; x < width; x += bandSpacing) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
  }

  // Subtle fabric weave overlay
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 0.5;
  for (let y = 0; y < height; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let x = 0; x < width; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * Main render function — draws everything each frame.
 */
export function render(ctx, gameState) {
  const { width, height, popadom, cells, physics, texture, tableclothCanvas, contactMode } = gameState;

  ctx.clearRect(0, 0, width, height);

  // Draw tablecloth background
  if (tableclothCanvas) {
    ctx.drawImage(tableclothCanvas, 0, 0);
  }

  if (!popadom) return;

  const texScale = texture?._textureScale || 1;

  // Draw shadow under the intact popadom
  drawPopadomShadow(ctx, popadom, cells);

  // Draw shadows under broken fragments first (so they're behind the pieces)
  drawFragmentShadows(ctx, physics);

  // Draw the intact part of the popadom (NO crack lines drawn)
  drawIntactPopadom(ctx, popadom, cells, texture, texScale);

  // Draw broken fragment pieces (lying on the table)
  drawFragments(ctx, physics, texture, popadom, texScale);

  // Draw contact mode indicator
  drawContactIndicator(ctx, width, height, contactMode);
}

/**
 * Draw the intact portion of the popadom — just the texture clipped to unbroken cells.
 * No crack lines are drawn.
 */
function drawIntactPopadom(ctx, popadom, cells, texture, texScale) {
  if (!cells || !texture) return;

  const intactCells = cells.filter((c) => c.intact);
  if (intactCells.length === 0) return;

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

  // Draw the hi-res texture scaled down to fit
  const texX = popadom.centerX - popadom.radius;
  const texY = popadom.centerY - popadom.radius;
  const drawSize = popadom.radius * 2;
  ctx.drawImage(texture, texX, texY, drawSize, drawSize);

  ctx.restore();
}

/**
 * Draw a soft shadow under the intact popadom.
 */
function drawPopadomShadow(ctx, popadom, cells) {
  const intactCells = cells ? cells.filter((c) => c.intact) : [];
  if (intactCells.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.filter = "blur(10px)";

  ctx.beginPath();
  for (const cell of intactCells) {
    const verts = cell.vertices;
    if (verts.length < 3) continue;
    const first = Array.isArray(verts[0]) ? verts[0] : [verts[0].x, verts[0].y];
    ctx.moveTo(first[0] + 5, first[1] + 5);
    for (let i = 1; i < verts.length; i++) {
      const v = Array.isArray(verts[i]) ? verts[i] : [verts[i].x, verts[i].y];
      ctx.lineTo(v[0] + 5, v[1] + 5);
    }
    ctx.closePath();
  }
  ctx.fillStyle = "#2a1a0a";
  ctx.fill();

  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw shadows under all fragment pieces.
 */
function drawFragmentShadows(ctx, physics) {
  if (!physics) return;
  const bodies = physics.getFragments();
  if (bodies.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.filter = "blur(4px)";

  for (const body of bodies) {
    if (!body.popadomData) continue;
    const verts = body.vertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x + 3, verts[0].y + 3);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x + 3, verts[i].y + 3);
    }
    ctx.closePath();
    ctx.fillStyle = "#2a1a0a";
    ctx.fill();
  }

  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw the physics-driven fragments (broken pieces sitting on the table).
 */
function drawFragments(ctx, physics, texture, popadom, texScale) {
  if (!physics) return;

  const bodies = physics.getFragments();
  if (bodies.length === 0) return;

  const texX = popadom.centerX - popadom.radius;
  const texY = popadom.centerY - popadom.radius;
  const drawSize = popadom.radius * 2;

  for (const body of bodies) {
    const data = body.popadomData;
    if (!data) continue;

    ctx.save();

    // Clip to fragment shape
    ctx.beginPath();
    const verts = body.vertices;
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.clip();

    // Transform texture to match fragment's physics position/rotation
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.translate(-body.position.x, -body.position.y);

    ctx.drawImage(texture, texX, texY, drawSize, drawSize);
    ctx.restore();

    // Draw broken edge — slightly rough, light-coloured (like real crumbled popadom edge)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(180, 140, 80, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Draw the current contact mode indicator in the corner.
 */
function drawContactIndicator(ctx, width, height, contactMode) {
  if (!contactMode) return;

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";

  const indicatorSize = 50;
  const margin = 15;
  const x = width - indicatorSize - margin;
  const y = margin;

  // Background pill
  roundRect(ctx, x - 5, y - 5, indicatorSize + 10, indicatorSize + 25, 12);
  ctx.fill();

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#FFF5E6";
  ctx.font = "24px serif";
  ctx.textAlign = "center";

  if (contactMode === "finger") {
    // Pointing finger icon
    ctx.font = "28px serif";
    ctx.fillText("\u261D", x + indicatorSize / 2, y + indicatorSize / 2 + 8);
  } else if (contactMode === "chop") {
    // Karate chop — hand emoji
    ctx.font = "28px serif";
    ctx.fillText("\u270B", x + indicatorSize / 2, y + indicatorSize / 2 + 8);
  }

  // Label
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#FFF5E6";
  ctx.globalAlpha = 0.8;
  ctx.fillText(contactMode === "finger" ? "Tap" : "Chop", x + indicatorSize / 2, y + indicatorSize + 14);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
