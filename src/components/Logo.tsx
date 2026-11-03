/** Wordmark: a few uneven bars (a little burst of noise) plus the name. */
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  const bars = [0.45, 0.9, 0.6, 1, 0.35, 0.75];
  const h = big ? 28 : 18;
  return (
    <div className="flex items-center gap-2.5" aria-label="Random Noise">
      <svg width={bars.length * (big ? 6 : 4)} height={h} aria-hidden="true">
        {bars.map((b, i) => (
          <rect
            key={i}
            x={i * (big ? 6 : 4)}
            y={h - h * b}
            width={big ? 4 : 2.5}
            height={h * b}
            rx={big ? 2 : 1.25}
            className="fill-accent"
          />
        ))}
      </svg>
      <span
        className={`font-extrabold tracking-[0.18em] text-ink ${big ? "text-2xl" : "text-sm"}`}
      >
        RANDOM NOISE
      </span>
    </div>
  );
}
