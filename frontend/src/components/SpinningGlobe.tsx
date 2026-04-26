// Spinning globe with real country outlines + BTC/ETH/SOL satellites
// orbiting on three rings.
//
// - Globe: orthographic projection of countries-110m TopoJSON, drawn
//   to <canvas> via d3-geo's path.context() (cheaper than recomputing
//   SVG path strings ~60×/sec for ~200 polygons).
// - Whirl: SVG layer composited above the canvas. Three orbital rings,
//   counter-rotating in pairs. Each ring carries a small "satellite"
//   with a crypto glyph (₿ ETH SOL). The glyph counter-rotates against
//   its ring at the same rate so the symbol stays upright while the
//   satellite traces the orbit.

import { useEffect, useRef, useState } from "react";
import { geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import worldAtlas from "world-atlas/countries-110m.json";

type LandFC = FeatureCollection<Geometry>;

let _land: LandFC | null = null;
function getLand(): LandFC {
  if (_land) return _land;
  const topo = worldAtlas as unknown as {
    objects: { countries: Parameters<typeof feature>[1] };
  };
  _land = feature(topo as never, topo.objects.countries) as unknown as LandFC;
  return _land;
}

export function SpinningGlobe({
  size = 220,
  speed = 0.18,
  className,
}: {
  size?: number;
  speed?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const radius = size * 0.42;
    const center: [number, number] = [size / 2, size / 2];

    const projection = geoOrthographic()
      .scale(radius)
      .translate(center)
      .clipAngle(90);

    const path = geoPath(projection, ctx);
    const land = getLand();

    let raf = 0;
    let lambda = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      lambda = (lambda + speed * dt * 0.06) % 360;
      projection.rotate([lambda, -12]);

      ctx.clearRect(0, 0, size, size);

      // Off-white disc.
      ctx.beginPath();
      ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f3ede0";
      ctx.fill();

      // Country fills — deep noir for crisp contrast on cream.
      ctx.beginPath();
      path(land);
      ctx.fillStyle = "#0e1018";
      ctx.fill();

      // Hairline borders.
      ctx.beginPath();
      path(land);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
      ctx.lineWidth = 0.4;
      ctx.stroke();

      // Globe edge.
      ctx.beginPath();
      ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(14, 16, 24, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, size, speed]);

  // Whirl extends ~1.7× the globe diameter so the orbits clearly leave
  // the disc edge and the satellites read as orbiting bodies.
  const whirl = Math.round(size * 1.7);

  return (
    <div
      className={className}
      style={{ position: "relative", width: whirl, height: whirl }}
    >
      <Whirl size={whirl} />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
        }}
      />
    </div>
  );
}

// Three orbital rings. Each ring has one satellite with a crypto glyph;
// glyph counter-rotates with its ring so the symbol stays upright as it
// orbits.
function Whirl({ size }: { size: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const orbits = [
    { r: size * 0.34, dur: 9,  w: 0.8, dash: "1 6",  alpha: 0.50, glyph: "₿" },
    { r: size * 0.41, dur: 15, w: 0.6, dash: "2 10", alpha: 0.36, glyph: "Ξ" },
    { r: size * 0.48, dur: 24, w: 0.5, dash: "1 14", alpha: 0.24, glyph: "◎" },
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden
    >
      <defs>
        <style>{`
          @keyframes ng-spin-cw  { from { transform: rotate(0deg); }   to { transform: rotate(360deg); } }
          @keyframes ng-spin-ccw { from { transform: rotate(0deg); }   to { transform: rotate(-360deg); } }
          .ng-orbit { transform-box: view-box; }
          .ng-glyph { transform-box: fill-box; transform-origin: center; }
        `}</style>
      </defs>

      {orbits.map((o, i) => {
        const cw = i % 2 === 0;
        const ringAnim = cw ? "ng-spin-cw" : "ng-spin-ccw";
        const glyphAnim = cw ? "ng-spin-ccw" : "ng-spin-cw";
        return (
          <g
            key={i}
            className="ng-orbit"
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: `${ringAnim} ${o.dur}s linear infinite`,
            }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={o.r}
              fill="none"
              stroke="#5eead4"
              strokeOpacity={o.alpha}
              strokeWidth={o.w}
              strokeDasharray={o.dash}
              strokeLinecap="round"
            />

            {/* Satellite at the right edge of the orbit. */}
            <g transform={`translate(${cx + o.r} ${cy})`}>
              {/* Faint glow halo behind the chip. */}
              <circle r="14" fill="#5eead4" fillOpacity="0.10" />
              <circle
                r="11"
                fill="#0a0c14"
                stroke="#5eead4"
                strokeOpacity="0.85"
                strokeWidth="1"
              />
              <text
                className="ng-glyph"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="11"
                fontWeight="600"
                fill="#5eead4"
                style={{
                  fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
                  animation: `${glyphAnim} ${o.dur}s linear infinite`,
                }}
              >
                {o.glyph}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
