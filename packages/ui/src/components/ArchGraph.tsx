import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ArchCard } from '../types';

interface NodeData {
  slug: string;
  name: string;
  x: number;
  y: number;
  r: number;
  importance: number;
}

interface Props {
  cards: ArchCard[];
  selectedSlug?: string | null;
  onSelect: (slug: string) => void;
}

const NODE_BASE_R = 2.0;
const NODE_R_PER_IMP = 0.46;
const PADDING_FRAC = 0.2;

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// Organic force-directed layout — deterministic seeding keeps it stable
// across renders, repulsion + edge springs + weak gravity give natural
// clustering instead of a rigid ring.
function buildLayout(cards: ArchCard[]): {
  nodes: NodeData[];
  edges: Array<{ from: string; to: string; key: string }>;
} {
  const inbound = new Map<string, number>();
  for (const c of cards) {
    if (!inbound.has(c.slug)) inbound.set(c.slug, 0);
    for (const dep of c.dependsOn ?? []) {
      inbound.set(dep, (inbound.get(dep) ?? 0) + 1);
    }
  }

  const n = cards.length;
  const nodes: NodeData[] = cards.map((c) => {
    const h = strHash(c.slug) >>> 0;
    // Golden-angle seeding scatters nodes off any obvious ring.
    const a = ((h % 10000) / 10000) * Math.PI * 2;
    const rad = 0.18 + (((h >>> 13) & 0x3ff) / 0x3ff) * 0.7;
    const imp = inbound.get(c.slug) ?? 0;
    return {
      slug: c.slug,
      name: c.name,
      x: n === 1 ? 0 : Math.cos(a) * rad,
      y: n === 1 ? 0 : Math.sin(a) * rad,
      r: NODE_BASE_R + imp * NODE_R_PER_IMP,
      importance: imp,
    };
  });

  const seen = new Set<string>();
  const edges: Array<{ from: string; to: string; key: string }> = [];
  for (const c of cards) {
    for (const dep of c.dependsOn ?? []) {
      if (cards.some((x) => x.slug === dep)) {
        const key = `${c.slug}--${dep}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ from: c.slug, to: dep, key });
        }
      }
    }
  }

  if (n > 1) {
    const idx = new Map(nodes.map((nd, i) => [nd.slug, i]));
    const idealLen = 0.78;
    let temp = 0.16;
    for (let iter = 0; iter < 460; iter++) {
      const fx = new Float64Array(n);
      const fy = new Float64Array(n);
      // Repulsion — every node pushes every other apart.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = nodes[i].x - nodes[j].x;
          let dy = nodes[i].y - nodes[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1e-4) {
            // Nudge coincident nodes apart deterministically.
            dx = ((i * 73 + j) % 7) / 7 - 0.5;
            dy = ((i * 31 + j) % 5) / 5 - 0.5;
            d2 = dx * dx + dy * dy || 1e-4;
          }
          const d = Math.sqrt(d2);
          const rep = 0.052 / d2;
          const ux = dx / d;
          const uy = dy / d;
          fx[i] += ux * rep;
          fy[i] += uy * rep;
          fx[j] -= ux * rep;
          fy[j] -= uy * rep;
        }
      }
      // Edge springs — connected nodes settle toward an ideal distance.
      for (const e of edges) {
        const a = idx.get(e.from);
        const b = idx.get(e.to);
        if (a == null || b == null) continue;
        const dx = nodes[b].x - nodes[a].x;
        const dy = nodes[b].y - nodes[a].y;
        const d = Math.hypot(dx, dy) || 1e-4;
        const f = (d - idealLen) * 0.045;
        const ux = dx / d;
        const uy = dy / d;
        fx[a] += ux * f;
        fy[a] += uy * f;
        fx[b] -= ux * f;
        fy[b] -= uy * f;
      }
      // Weak gravity keeps the cloud from drifting off-centre.
      for (let i = 0; i < n; i++) {
        fx[i] -= nodes[i].x * 0.013;
        fy[i] -= nodes[i].y * 0.013;
      }
      for (let i = 0; i < n; i++) {
        const m = Math.hypot(fx[i], fy[i]) || 1e-6;
        const step = Math.min(m, temp);
        nodes[i].x += (fx[i] / m) * step;
        nodes[i].y += (fy[i] / m) * step;
      }
      temp *= 0.991;
    }
    // Normalise the settled cloud back into a centred unit box.
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const nd of nodes) {
      if (nd.x < minX) minX = nd.x;
      if (nd.x > maxX) maxX = nd.x;
      if (nd.y < minY) minY = nd.y;
      if (nd.y > maxY) maxY = nd.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 1e-3) / 2;
    for (const nd of nodes) {
      nd.x = (nd.x - cx) / span;
      nd.y = (nd.y - cy) / span;
    }
  }

  return { nodes, edges };
}

// Warm paper & clay keyframes — aurora blobs use the clay accent
const AURORA_CSS = `
@keyframes cw-arch-a {
  0%,100% { transform: translate(-4%, 2%) }
  40%      { transform: translate(5%, -3%) }
  70%      { transform: translate(-2%, 4%) }
}
@keyframes cw-arch-b {
  0%,100% { transform: translate(3%, -2%) }
  35%     { transform: translate(-4%, 3%) }
  65%     { transform: translate(2%, -4%) }
}
@keyframes cw-arch-c {
  0%,100% { transform: translate(-3%, 3%) }
  45%     { transform: translate(3%, -1%) }
  75%     { transform: translate(-1%, 2%) }
}
`;

export function ArchGraph({ cards, selectedSlug, onSelect }: Props) {
  const filterId = useId();
  const gridId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(1.6);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanDragging, setIsPanDragging] = useState(false);
  const panRef = useRef<{
    pointerId: number;
    px: number;
    py: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth,
      h = el.clientHeight;
    if (w > 0 && h > 0) setAspect(w / h);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (w > 0 && h > 0)
        setAspect((prev) => {
          const next = w / h;
          return Math.abs(prev - next) > 0.01 ? next : prev;
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const halfH = aspect >= 1 ? 50 : 50 * aspect;
  const halfW = aspect >= 1 ? 50 * aspect : 50;
  const pad = 1 - PADDING_FRAC;

  // The force simulation is expensive — recompute only when the graph's
  // topology actually changes, not on every hover or pan.
  const layoutKey = cards.map((c) => `${c.slug}>${(c.dependsOn ?? []).join(',')}`).join('|');
  const { nodes: rawNodes, edges } = useMemo(
    () => buildLayout(cards),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  );
  const nodes: NodeData[] = rawNodes.map((n) => ({
    ...n,
    x: n.x * halfW * pad,
    y: n.y * halfH * pad,
  }));
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));

  const focusSlug = hovered ?? selectedSlug;
  const connected = new Set<string>();
  if (focusSlug) {
    connected.add(focusSlug);
    for (const { from, to } of edges) {
      if (from === focusSlug || to === focusSlug) {
        connected.add(from);
        connected.add(to);
      }
    }
  }
  const isFiltering = focusSlug != null;

  const handleHover = useCallback((slug: string | null) => setHovered(slug), []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-1, #232220)',
      }}
    >
      <style>{AURORA_CSS}</style>

      {/* Warm aurora backdrop */}
      <div
        aria-hidden
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
      >
        {/* Warm radial gradient — bg-glow is the amber haze from the design system */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 50% 40%, var(--bg-glow, #3a2a22) 0%, var(--bg-1, #232220) 70%)',
          }}
        />
        {/* Dot grid — very faint, border-soft tones */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.2 }}
        >
          <defs>
            <pattern id={gridId} width="9" height="9" patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="0.32" fill="var(--fg-3, #5f5c54)" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill={`url(#${gridId})`} />
        </svg>
        {/* Clay aurora blobs */}
        <div
          style={{
            position: 'absolute',
            width: '60%',
            height: '60%',
            left: '10%',
            top: '15%',
            background: 'radial-gradient(circle, rgba(217,119,87,0.08) 0%, transparent 68%)',
            filter: 'blur(34px)',
            animation: 'cw-arch-a 44s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: '54%',
            height: '54%',
            right: '6%',
            bottom: '10%',
            background: 'radial-gradient(circle, rgba(217,119,87,0.055) 0%, transparent 68%)',
            filter: 'blur(32px)',
            animation: 'cw-arch-b 53s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: '42%',
            height: '42%',
            left: '40%',
            top: '50%',
            background: 'radial-gradient(circle, rgba(184,92,62,0.05) 0%, transparent 72%)',
            filter: 'blur(28px)',
            opacity: 0.8,
            animation: 'cw-arch-c 38s ease-in-out infinite',
          }}
        />
      </div>

      {/* SVG field */}
      <svg
        viewBox={`${-halfW} ${-halfH} ${halfW * 2} ${halfH * 2}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          cursor: isPanDragging ? 'grabbing' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          panRef.current = {
            pointerId: e.pointerId,
            px: e.clientX,
            py: e.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = panRef.current;
          if (!d || d.pointerId !== e.pointerId) return;
          const el = containerRef.current;
          if (!el) return;
          const s = Math.max(
            (halfW * 2) / (el.clientWidth || 1),
            (halfH * 2) / (el.clientHeight || 1),
          );
          const dxPx = e.clientX - d.px,
            dyPx = e.clientY - d.py;
          if (!d.moved) {
            if (Math.hypot(dxPx, dyPx) <= 4) return;
            d.moved = true;
            setIsPanDragging(true);
            try {
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            } catch {
              /* noop */
            }
          }
          setPan({ x: d.startPanX + dxPx * s, y: d.startPanY + dyPx * s });
        }}
        onPointerUp={(e) => {
          const d = panRef.current;
          if (!d || d.pointerId !== e.pointerId) return;
          if (d.moved)
            try {
              (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
            } catch {
              /* noop */
            }
          panRef.current = null;
          setIsPanDragging(false);
        }}
        onPointerCancel={() => {
          panRef.current = null;
          setIsPanDragging(false);
        }}
      >
        <defs>
          {/* Warm clay glow filter */}
          <filter id={filterId} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="1.7" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Clay arrow marker */}
          <marker
            id={`${filterId}-arr`}
            markerWidth="4.4"
            markerHeight="4.4"
            refX="3.6"
            refY="2.2"
            orient="auto"
          >
            <path d="M0,0 L0,4.4 L4.4,2.2 z" fill="var(--clay-line, rgba(217,119,87,0.26))" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x} ${pan.y})`}>
          {/* ── Edges ─────────────────────────────────────────── */}
          {edges.map(({ from, to, key }) => {
            const a = bySlug.get(from),
              b = bySlug.get(to);
            if (!a || !b) return null;

            const isHighlit = isFiltering && (from === focusSlug || to === focusSlug);
            const edgeOpacity = isFiltering ? (isHighlit ? 0.6 : 0.05) : 0.3;

            const dxRaw = b.x - a.x,
              dyRaw = b.y - a.y;
            const dist = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw) || 1;
            const ux = dxRaw / dist,
              uy = dyRaw / dist;
            const x1 = a.x + ux * (a.r + 0.3),
              y1 = a.y + uy * (a.r + 0.3);
            const x2 = b.x - ux * (b.r + 0.5),
              y2 = b.y - uy * (b.r + 0.5);

            const h = strHash(key);
            const segLen = Math.max(0.001, dist - a.r - b.r);
            const sign = (h & 1) === 0 ? 1 : -1;
            const mag = (0.12 + (((h >>> 1) & 0xff) / 0xff) * 0.14) * segLen;
            const mx = (x1 + x2) / 2 + -uy * mag * sign;
            const my = (y1 + y2) / 2 + ux * mag * sign;
            const pathD = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
            const pathLen = segLen * 1.05;

            // Directed burst direction
            const activeId = hovered ?? selectedSlug;
            const directedD =
              isHighlit && activeId === to ? `M ${x2} ${y2} Q ${mx} ${my} ${x1} ${y1}` : pathD;

            const h2 = ((h >>> 0) % 1000) / 1000;
            const ambientDur = 2.2 + pathLen * 0.06;
            const ambientDelay = -(h2 * ambientDur);
            const burstDur = 0.9 + pathLen * 0.04;

            return (
              <g key={key} opacity={edgeOpacity} style={{ transition: 'opacity 0.28s' }}>
                <path
                  d={pathD}
                  fill="none"
                  stroke="var(--clay-line, rgba(217,119,87,0.26))"
                  strokeWidth={isHighlit ? 0.22 : 0.13}
                  strokeLinecap="round"
                  strokeDasharray="0.4 1.6"
                  markerEnd={`url(#${filterId}-arr)`}
                  style={{ transition: 'stroke-width 0.25s' }}
                />
                {/* Ambient pulse — invisible on dimmed edges */}
                {edgeOpacity > 0.1 && !isHighlit && (
                  <circle r={0.17} fill="var(--clay, #d97757)" style={{ pointerEvents: 'none' }}>
                    <animateMotion
                      path={pathD}
                      dur={`${ambientDur}s`}
                      begin={`${ambientDelay}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.36;0"
                      dur={`${ambientDur}s`}
                      begin={`${ambientDelay}s`}
                      repeatCount="indefinite"
                      keyTimes="0;0.28;1"
                    />
                  </circle>
                )}
                {/* Directed burst pulses on hover */}
                {isHighlit &&
                  [0, 1].map((i) => (
                    <circle
                      key={i}
                      r={0.26}
                      fill="var(--clay-bright, #e8916f)"
                      style={{ pointerEvents: 'none' }}
                    >
                      <animateMotion
                        path={directedD}
                        dur={`${burstDur}s`}
                        begin={`${-(i / 2) * burstDur}s`}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0;0.68;0"
                        dur={`${burstDur}s`}
                        begin={`${-(i / 2) * burstDur}s`}
                        repeatCount="indefinite"
                        keyTimes="0;0.22;1"
                      />
                    </circle>
                  ))}
              </g>
            );
          })}

          {/* ── Nodes ─────────────────────────────────────────── */}
          {nodes.map((node) => {
            const isSelected = node.slug === selectedSlug;
            const isHovered = node.slug === hovered;
            const active = isSelected || isHovered;
            const isDimmed = isFiltering && !connected.has(node.slug);
            const r = active ? node.r * 1.13 : node.r;

            return (
              <g
                key={node.slug}
                style={{
                  cursor: 'pointer',
                  opacity: isDimmed ? 0.18 : 1,
                  transition: 'opacity 0.22s',
                }}
                onClick={() => onSelect(node.slug)}
                onMouseEnter={() => handleHover(node.slug)}
                onMouseLeave={() => handleHover(null)}
              >
                {/* Clay glow halo */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={active ? r * 2.8 : r * 1.8}
                  fill="var(--clay, #d97757)"
                  opacity={active ? 0.09 : 0.026}
                  filter={`url(#${filterId})`}
                  style={{ transition: 'r 0.32s ease, opacity 0.32s ease' }}
                />
                {/* Main disc */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={
                    isSelected
                      ? 'var(--clay, #d97757)'
                      : isHovered
                        ? 'var(--bg-3, #353330)'
                        : 'var(--bg-2, #2b2a27)'
                  }
                  stroke={active ? 'var(--clay, #d97757)' : 'var(--border, #34322e)'}
                  strokeWidth={active ? 0.16 : 0.1}
                  style={{ transition: 'fill 0.25s ease, r 0.32s ease, stroke 0.25s ease' }}
                />
                {/* Pulsing halo ring on selected */}
                {isSelected && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    fill="none"
                    stroke="var(--clay, #d97757)"
                    strokeWidth="0.14"
                    r={r}
                  >
                    <animate
                      attributeName="r"
                      values={`${r};${r * 2.8};${r * 2.8}`}
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.42;0;0"
                      dur="2s"
                      repeatCount="indefinite"
                      keyTimes="0;0.65;1"
                    />
                  </circle>
                )}
                {/* Label */}
                <text
                  x={node.x}
                  y={isHovered ? node.y - r - 1.3 : node.y}
                  textAnchor="middle"
                  dominantBaseline={isHovered ? 'auto' : 'middle'}
                  fontSize={isHovered ? 1.6 : Math.max(1.0, Math.min(1.4, r * 0.52))}
                  fill={
                    isSelected
                      ? 'var(--bg-0, #1c1b19)'
                      : active
                        ? 'var(--fg-0, #f3f0e7)'
                        : 'var(--fg-1, #c4c0b4)'
                  }
                  fontFamily="var(--font-ui, 'Hanken Grotesk', sans-serif)"
                  fontWeight={active ? '500' : '400'}
                  letterSpacing="0.01em"
                  style={{ pointerEvents: 'none', userSelect: 'none', transition: 'all 0.15s' }}
                >
                  {isHovered
                    ? node.name
                    : node.name.length > 11
                      ? node.name.slice(0, 10) + '…'
                      : node.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Empty state */}
      {cards.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-3, #5f5c54)',
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.04em',
            }}
          >
            NO COMPONENTS
          </span>
          <span
            style={{ fontSize: 10, color: 'var(--fg-3, #5f5c54)', fontFamily: 'var(--font-ui)' }}
          >
            Add a card to begin
          </span>
        </div>
      )}
    </div>
  );
}
