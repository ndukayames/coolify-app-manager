// Plain decimals ("0.35 vCPU", "1 vCPU") rather than millicores, which clients don't read easily.
export const formatCores = (cores: number): string => {
  if (cores > 0 && cores < 0.01) return "<0.01 vCPU";
  return `${Number(cores.toFixed(2))} vCPU`;
};

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

export const formatRate = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`;

// Minimal inline chart: enough to see the shape of usage without a charting library.
export function Sparkline({ points }: { points: [number, number][] }) {
  if (points.length < 2) return <div className="sparkline sparkline-empty" />;
  const width = 240;
  const height = 48;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const spanX = Math.max(...xs) - minX || 1;
  const maxY = Math.max(...ys) || 1;
  const path = points
    .map(([x, y], index) => `${index ? "L" : "M"}${(((x - minX) / spanX) * width).toFixed(1)},${(height - (y / maxY) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L${width},${height} L0,${height} Z`} className="sparkline-fill" />
      <path d={path} className="sparkline-line" />
    </svg>
  );
}
