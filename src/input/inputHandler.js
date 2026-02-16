/**
 * inputHandler.js — Handles touch and mouse input for the popadom game.
 *
 * What this does:
 * - Listens for taps/clicks and touch/mouse drags
 * - Supports multi-touch on mobile (crack with multiple fingers)
 * - Converts screen coordinates to canvas coordinates
 * - Calls game callbacks for crack events and drag events
 *
 * Why a separate module?
 * - Keeps input logic out of the game loop for clean code
 * - Makes it easy to swap input methods (e.g. for React Native later)
 */

/**
 * Set up all input listeners on a canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} callbacks
 * @param {function} callbacks.onTap - called with (x, y) when user taps/clicks
 * @param {function} callbacks.onDragStart - called with (x, y) when drag begins
 * @param {function} callbacks.onDragMove - called with (x, y, dx, dy) during drag
 * @param {function} callbacks.onDragEnd - called when drag ends
 * @returns {function} cleanup function to remove all listeners
 */
export function setupInput(canvas, callbacks) {
  const activeTouches = new Map(); // track multi-touch drags

  /**
   * Convert a screen position to canvas coordinates.
   * Handles cases where the canvas is scaled or offset on the page.
   */
  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  // --- TOUCH EVENTS (mobile) ---

  function handleTouchStart(e) {
    e.preventDefault(); // prevent scrolling when touching the canvas

    for (const touch of e.changedTouches) {
      const pos = canvasCoords(touch.clientX, touch.clientY);
      activeTouches.set(touch.identifier, { startX: pos.x, startY: pos.y, lastX: pos.x, lastY: pos.y });

      // Every new finger tap is a crack event
      callbacks.onTap(pos.x, pos.y);
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();

    for (const touch of e.changedTouches) {
      const pos = canvasCoords(touch.clientX, touch.clientY);
      const tracked = activeTouches.get(touch.identifier);

      if (tracked) {
        const dx = pos.x - tracked.lastX;
        const dy = pos.y - tracked.lastY;
        tracked.lastX = pos.x;
        tracked.lastY = pos.y;

        callbacks.onDragMove(pos.x, pos.y, dx, dy);
      }
    }
  }

  function handleTouchEnd(e) {
    for (const touch of e.changedTouches) {
      activeTouches.delete(touch.identifier);
      callbacks.onDragEnd();
    }
  }

  // --- MOUSE EVENTS (desktop) ---

  let mouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function handleMouseDown(e) {
    const pos = canvasCoords(e.clientX, e.clientY);
    mouseDown = true;
    lastMouseX = pos.x;
    lastMouseY = pos.y;

    callbacks.onTap(pos.x, pos.y);
  }

  function handleMouseMove(e) {
    if (!mouseDown) return;

    const pos = canvasCoords(e.clientX, e.clientY);
    const dx = pos.x - lastMouseX;
    const dy = pos.y - lastMouseY;
    lastMouseX = pos.x;
    lastMouseY = pos.y;

    callbacks.onDragMove(pos.x, pos.y, dx, dy);
  }

  function handleMouseUp() {
    mouseDown = false;
    callbacks.onDragEnd();
  }

  // Attach all listeners
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd);
  canvas.addEventListener("touchcancel", handleTouchEnd);

  canvas.addEventListener("mousedown", handleMouseDown);
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);

  // Return a cleanup function (React will call this when the component unmounts)
  return function cleanup() {
    canvas.removeEventListener("touchstart", handleTouchStart);
    canvas.removeEventListener("touchmove", handleTouchMove);
    canvas.removeEventListener("touchend", handleTouchEnd);
    canvas.removeEventListener("touchcancel", handleTouchEnd);
    canvas.removeEventListener("mousedown", handleMouseDown);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  };
}
