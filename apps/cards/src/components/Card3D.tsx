"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import type { Condition } from "@/lib/types";
import { gradeValue, wearProfile, type Assessment } from "@/lib/wear";
import { slabClass } from "./Slab";

/**
 * A card as the object it is: a face that tilts under the pointer and
 * catches the light, worn as far as its grade says, and for a graded card,
 * sealed in an acrylic slab. Built from CSS transforms and one inline SVG,
 * so it works on any picture, including a provider's, and needs no library.
 *
 * The marks are decided by `wearProfile` from the card's id, so a card
 * always looks the same; the tilt is only cosmetic and is skipped when the
 * viewer asks for reduced motion.
 */
export function Card3D({
  src,
  name,
  seed,
  grade,
  condition,
  gradingCompany,
  certNumber,
  assessment,
  interactive = false,
  compact = false,
}: {
  src: string | null;
  name: string;
  seed: number;
  grade: string | null;
  condition: Condition;
  gradingCompany?: string | null;
  certNumber?: string | null;
  assessment?: Assessment | null;
  /** Tilt towards the pointer; only the detail page does, not a grid of tiles. */
  interactive?: boolean;
  /** Sized by height inside a tile, rather than by width in a column. */
  compact?: boolean;
}) {
  const graded = Boolean(grade);
  const value = gradeValue(grade, condition);
  const profile = useMemo(() => wearProfile({ seed, grade: value, assessment }), [seed, value, assessment]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = query.matches;
    const onChange = () => (reduced.current = query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body || reduced.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    body.dataset.tilting = "";
    body.style.setProperty("--ry", `${((px - 0.5) * 20).toFixed(2)}deg`);
    body.style.setProperty("--rx", `${((0.5 - py) * 20).toFixed(2)}deg`);
    body.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    body.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const body = bodyRef.current;
    if (!body) return;
    delete body.dataset.tilting;
    for (const v of ["--rx", "--ry", "--mx", "--my"]) body.style.removeProperty(v);
  };

  const face = <Face src={src} name={name} profile={profile} compact={compact} />;
  return (
    <div
      className={`card3d-scene ${compact ? "card3d-scene-compact" : ""}`}
      data-grade={value}
      onPointerMove={interactive ? move : undefined}
      onPointerLeave={interactive ? leave : undefined}
    >
      <div ref={bodyRef} className="card3d-body" style={{ "--gloss": profile.gloss } as React.CSSProperties}>
        {graded ? (
          <div className={`slab3d ${slabClass(gradingCompany)}`}>
            <div className="slab3d-back" aria-hidden />
            <div className="slab3d-inner">
              <div className={`slab-label flex items-baseline justify-between gap-2 ${compact ? "text-[9px] leading-tight" : "text-xs"}`}>
                <span className="truncate">{gradingCompany ?? "Graded"}</span>
                <span className="shrink-0 font-bold">{grade}</span>
              </div>
              <div className="slab3d-window">{face}</div>
              {!compact && certNumber && <div className="px-1 pt-1 text-center text-[10px] tracking-wide text-neutral-500">CERT {certNumber}</div>}
            </div>
            <div className="slab3d-front" aria-hidden />
          </div>
        ) : (
          face
        )}
      </div>
    </div>
  );
}

function Face({ src, name, profile, compact }: { src: string | null; name: string; profile: ReturnType<typeof wearProfile>; compact: boolean }) {
  const { dx, dy } = profile.centering;
  const offCentre = dx || dy ? { transform: `scale(1.03) translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%)` } : undefined;
  // A played card has lost some of its colour along with its shine.
  const filters = [
    profile.wear > 0.5 ? `saturate(${(1 - (profile.wear - 0.5) * 0.4).toFixed(2)})` : "",
    profile.toning > 0 ? `sepia(${(profile.toning * 0.6).toFixed(2)})` : "",
  ].filter(Boolean);
  const faded = filters.length ? { filter: filters.join(" ") } : undefined;
  return (
    <div className={`card3d-face ${compact ? "card3d-face-compact" : ""}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="card3d-art" loading={compact ? "lazy" : undefined} style={{ ...offCentre, ...faded }} />
      ) : (
        <div className="card3d-blank">No image</div>
      )}
      <div className="card3d-sheen" aria-hidden />
      <Wear profile={profile} />
    </div>
  );
}

const CORNER = [
  [0, 0],
  [100, 0],
  [100, 140],
  [0, 140],
] as const;

/** The marks, drawn over the card in its own 100 × 140 space. */
function Wear({ profile }: { profile: ReturnType<typeof wearProfile> }) {
  const id = useId();
  const fade = `${id}-fade`;
  const smudge = `${id}-smudge`;
  const stain = `${id}-stain`;
  return (
    <svg className="card3d-wear" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden data-wear-count={profile.count}>
      <defs>
        <radialGradient id={fade}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={smudge}>
          <stop offset="0" stopColor="#5a5248" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#5a5248" stopOpacity="0.2" />
          <stop offset="1" stopColor="#5a5248" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={stain}>
          <stop offset="0" stopColor="#7a4f1c" stopOpacity="0.55" />
          <stop offset="0.7" stopColor="#7a4f1c" stopOpacity="0.3" />
          <stop offset="1" stopColor="#7a4f1c" stopOpacity="0" />
        </radialGradient>
      </defs>
      {profile.corners.map((c) => (
        <circle key={`c${c.corner}`} cx={CORNER[c.corner][0]} cy={CORNER[c.corner][1]} r={4 + c.size * 6} fill={`url(#${fade})`} />
      ))}
      {profile.edges.map((e, i) => {
        const a = e.start * (e.side % 2 === 0 ? 100 : 140);
        const b = (e.start + e.length) * (e.side % 2 === 0 ? 100 : 140);
        const line = e.side === 0 ? [a, 0.6, b, 0.6] : e.side === 1 ? [99.4, a, 99.4, b] : e.side === 2 ? [a, 139.4, b, 139.4] : [0.6, a, 0.6, b];
        return <line key={`e${i}`} x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity={e.strength} />;
      })}
      {profile.scratches.map((s, i) => (
        <line key={`s${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#fff" strokeWidth="0.45" strokeLinecap="round" opacity={s.opacity} />
      ))}
      {profile.creases.map((c, i) => (
        <g key={`f${i}`}>
          <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#000" strokeWidth="0.9" opacity="0.35" />
          <line x1={c.x1 + 0.5} y1={c.y1 + 0.5} x2={c.x2 + 0.5} y2={c.y2 + 0.5} stroke="#fff" strokeWidth="0.5" opacity="0.55" />
        </g>
      ))}
      {profile.printLines.map((l, i) => (
        <line key={`p${i}`} x1="0" y1={l.y} x2="100" y2={l.y} stroke="#fff" strokeWidth="0.3" opacity={l.opacity} />
      ))}
      {profile.dust.map((d, i) => (
        <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill={d.dark ? "#000" : "#fff"} opacity={d.dark ? 0.3 : 0.55} />
      ))}
      {/* A ding: the shadow its lower lip casts, and the light its upper edge catches. */}
      {profile.dents.map((d, i) => (
        <g key={`n${i}`}>
          <path d={`M ${d.x - d.r} ${d.y} A ${d.r} ${d.r} 0 0 0 ${d.x + d.r} ${d.y}`} fill="none" stroke="#000" strokeWidth={d.r * 0.5} strokeLinecap="round" opacity="0.28" />
          <path d={`M ${d.x - d.r * 0.8} ${d.y - d.r * 0.2} A ${d.r} ${d.r} 0 0 1 ${d.x + d.r * 0.8} ${d.y - d.r * 0.2}`} fill="none" stroke="#fff" strokeWidth={d.r * 0.35} strokeLinecap="round" opacity="0.5" />
        </g>
      ))}
      {/* The greasy and the stained sit into the print rather than on top of it. */}
      <g style={{ mixBlendMode: "multiply" }}>
        {profile.toning > 0 && <rect x="0" y="0" width="100" height="140" fill="#c9a24a" opacity={profile.toning * 0.5} />}
        {profile.smudges.map((m, i) => (
          <ellipse key={`m${i}`} cx={m.x} cy={m.y} rx={m.rx} ry={m.ry} transform={`rotate(${m.angle.toFixed(1)} ${m.x} ${m.y})`} fill={`url(#${smudge})`} opacity={m.opacity * 2} />
        ))}
        {profile.stains.map((t, i) => (
          <ellipse key={`t${i}`} cx={t.x} cy={t.y} rx={t.rx} ry={t.ry} transform={`rotate(${t.angle.toFixed(1)} ${t.x} ${t.y})`} fill={`url(#${stain})`} opacity={t.opacity * 2} />
        ))}
      </g>
    </svg>
  );
}
