/**
 * Game.jsx — Main game component. Orchestrates everything:
 * - Canvas setup and game loop
 * - Popadom creation, fracture, and physics
 * - Contact mode switching (finger tap vs karate chop)
 * - Ambient Indian restaurant soundscape
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { createPopadom } from "../engine/popadom.js";
import { precomputeVoronoi, fractureAtPoint, refractureFragment } from "../engine/fracture.js";
import { createPhysics } from "../engine/physics.js";
import { createPopadomTexture, createTableclothPattern, render } from "../engine/renderer.js";
import { initAudio, playCrackSound, playSlideSound, playNewPopadomSound, startAmbient } from "../audio/soundManager.js";
import { setupInput } from "../input/inputHandler.js";

export default function Game() {
  const canvasRef = useRef(null);
  const gameStateRef = useRef(null);
  const animFrameRef = useRef(null);
  const cleanupInputRef = useRef(null);
  const [showNewButton, setShowNewButton] = useState(false);
  const [contactMode, setContactMode] = useState("finger"); // "finger" or "chop"
  const ambientStartedRef = useRef(false);

  const initGame = useCallback((canvas) => {
    const width = canvas.width;
    const height = canvas.height;

    const radius = Math.min(width, height) * 0.35;
    const centerX = width / 2;
    const centerY = height / 2;

    const popadom = createPopadom(centerX, centerY, radius);
    const cells = precomputeVoronoi(popadom, 60);
    const texture = createPopadomTexture(popadom);
    const tableclothCanvas = createTableclothPattern(width, height);

    let physics = gameStateRef.current?.physics;
    if (physics) {
      physics.clearFragments();
      physics.resize(width, height);
    } else {
      physics = createPhysics(width, height);
    }

    gameStateRef.current = {
      width,
      height,
      popadom,
      cells,
      physics,
      texture,
      tableclothCanvas,
      contactMode: contactMode,
      dragTarget: null,
    };

    setShowNewButton(false);
  }, [contactMode]);

  // Keep gameState.contactMode in sync
  useEffect(() => {
    if (gameStateRef.current) {
      gameStateRef.current.contactMode = contactMode;
    }
  }, [contactMode]);

  const handleTap = useCallback((x, y) => {
    const state = gameStateRef.current;
    if (!state) return;

    initAudio();

    // Start ambient on first interaction
    if (!ambientStartedRef.current) {
      ambientStartedRef.current = true;
      startAmbient();
    }

    const { cells, physics, popadom } = state;
    const mode = state.contactMode || "finger";

    // Check if we tapped on an existing fragment
    const hitBody = physics.bodyAtPoint(x, y);
    if (hitBody && hitBody.popadomData) {
      const subFragments = refractureFragment(hitBody.popadomData, x, y);
      if (subFragments) {
        physics.removeBody(hitBody);
        for (const sub of subFragments) {
          physics.addFragment(sub, x, y);
        }
        playCrackSound(0.3, subFragments.length);
        return;
      }
    }

    // Crack the intact popadom
    const intactCount = cells.filter((c) => c.intact).length;
    if (intactCount === 0) return;

    const newlyBroken = fractureAtPoint(cells, x, y, popadom.radius, 1, mode);

    if (newlyBroken.length > 0) {
      for (const cell of newlyBroken) {
        physics.addFragment(cell, x, y);
      }

      const intensity = Math.min(1, newlyBroken.length / 8);
      playCrackSound(intensity, newlyBroken.length);
    }

    // Check if fully broken
    const remaining = cells.filter((c) => c.intact).length;
    if (remaining === 0) {
      setShowNewButton(true);
    }
  }, []);

  // Karate chop: swipe detection — track swipe and fracture along the line
  const handleChopSwipe = useCallback((x, y, dx, dy) => {
    const state = gameStateRef.current;
    if (!state || state.contactMode !== "chop") return;

    const speed = Math.sqrt(dx * dx + dy * dy);
    if (speed < 5) return; // need some velocity for a chop

    const { cells, physics, popadom } = state;
    const intactCount = cells.filter((c) => c.intact).length;
    if (intactCount === 0) return;

    // Calculate swipe angle
    const angle = Math.atan2(dy, dx);

    const newlyBroken = fractureAtPoint(cells, x, y, popadom.radius, 1, "chop");

    if (newlyBroken.length > 0) {
      for (const cell of newlyBroken) {
        physics.addFragment(cell, x, y);
      }
      const intensity = Math.min(1, newlyBroken.length / 6);
      playCrackSound(intensity, newlyBroken.length);
    }

    const remaining = cells.filter((c) => c.intact).length;
    if (remaining === 0) {
      setShowNewButton(true);
    }
  }, []);

  const handleDragMove = useCallback((x, y, dx, dy) => {
    const state = gameStateRef.current;
    if (!state) return;

    // In chop mode, dragging across the popadom creates chop fractures
    if (state.contactMode === "chop") {
      handleChopSwipe(x, y, dx, dy);
      return;
    }

    // In finger mode, drag pushes fragments around
    const body = state.physics.bodyAtPoint(x, y);
    if (body && body.label === "fragment") {
      const force = 0.0003;
      state.physics.pushBody(body, dx * force, dy * force);

      const speed = Math.sqrt(dx * dx + dy * dy);
      playSlideSound(speed);
    }
  }, [handleChopSwipe]);

  const handleNewPopadom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    playNewPopadomSound();
    initGame(canvas);
  }, [initGame]);

  const toggleContactMode = useCallback(() => {
    setContactMode((prev) => (prev === "finger" ? "chop" : "finger"));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initGame(canvas);
    }

    resize();
    window.addEventListener("resize", resize);

    cleanupInputRef.current = setupInput(canvas, {
      onTap: handleTap,
      onDragStart: () => {},
      onDragMove: handleDragMove,
      onDragEnd: () => {},
    });

    let lastTime = performance.now();
    function gameLoop(timestamp) {
      const delta = timestamp - lastTime;
      lastTime = timestamp;

      const state = gameStateRef.current;
      if (state) {
        state.physics.update(Math.min(delta, 32));
        render(ctx, state);
      }

      animFrameRef.current = requestAnimationFrame(gameLoop);
    }

    animFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("resize", resize);
      if (cleanupInputRef.current) cleanupInputRef.current();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [initGame, handleTap, handleDragMove]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: contactMode === "chop" ? "grab" : "pointer",
        }}
      />

      {/* Contact mode toggle button */}
      <button
        onClick={toggleContactMode}
        style={{
          position: "absolute",
          top: "15px",
          right: "15px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "rgba(0, 0, 0, 0.5)",
          color: "#FFF5E6",
          border: "2px solid rgba(255, 245, 230, 0.3)",
          cursor: "pointer",
          fontSize: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(8px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.target.style.background = "rgba(0, 0, 0, 0.7)";
          e.target.style.transform = "scale(1.1)";
        }}
        onMouseLeave={(e) => {
          e.target.style.background = "rgba(0, 0, 0, 0.5)";
          e.target.style.transform = "scale(1)";
        }}
        title={contactMode === "finger" ? "Switch to Karate Chop" : "Switch to Finger Tap"}
      >
        {contactMode === "finger" ? "\u261D\uFE0F" : "\u270B"}
      </button>

      {/* Mode label */}
      <div
        style={{
          position: "absolute",
          top: "78px",
          right: "15px",
          color: "#FFF5E6",
          fontSize: "11px",
          fontFamily: "'Georgia', serif",
          textAlign: "center",
          width: "56px",
          opacity: 0.7,
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
        }}
      >
        {contactMode === "finger" ? "Tap" : "Chop"}
      </div>

      {/* New Popadom button */}
      {showNewButton && (
        <button
          onClick={handleNewPopadom}
          style={{
            position: "absolute",
            bottom: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "14px 32px",
            fontSize: "18px",
            fontFamily: "'Georgia', serif",
            background: "rgba(139, 90, 43, 0.85)",
            color: "#FFF5E6",
            border: "2px solid rgba(255, 245, 230, 0.3)",
            borderRadius: "30px",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            transition: "all 0.2s ease",
            letterSpacing: "1px",
          }}
          onMouseEnter={(e) => {
            e.target.style.background = "rgba(160, 105, 50, 0.95)";
            e.target.style.transform = "translateX(-50%) scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.target.style.background = "rgba(139, 90, 43, 0.85)";
            e.target.style.transform = "translateX(-50%) scale(1)";
          }}
        >
          New Popadom
        </button>
      )}
    </div>
  );
}
