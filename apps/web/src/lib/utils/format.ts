export function truncateAddress(address: string): string {
  if (!address || address.length < 8) return address ?? '';
  return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

export function shortAddress(addr: string, prefix = 6, suffix = 4): string {
  if (!addr || addr.length < prefix + suffix + 2) return addr ?? '–';
  return `${addr.slice(0, prefix)}…${addr.slice(-suffix)}`;
}

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPnl(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${USD_FORMATTER.format(Math.round(abs))}`;
}

export function formatUsd(value: number | string | null | undefined, opts: { precise?: boolean } = {}): string {
  if (value === null || value === undefined) return '–';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (opts.precise) {
    return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(abs < 1 ? 4 : 0)}`;
}

export function pnlSignClass(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'k-pnl-positive' : 'k-pnl-negative';
}

export function formatPct(value: number | string | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

export function formatNumber(
  value: number | string | null | undefined,
  fractionDigits = 2,
): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Weekly trade average → "12 / wk", "0.4 / wk", "—". Compact: integer at ≥10,
 *  one decimal below. */
export function formatTradesPerWeek(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0 / wk';
  if (value >= 1000) return `${Math.round(value / 1000)}k / wk`;
  if (value >= 10) return `${Math.round(value)} / wk`;
  return `${value.toFixed(1)} / wk`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatRelativeTime(input: Date | string | null | undefined, now: number = Date.now()): string {
  if (!input) return '—';
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(ts)) return '—';
  const delta = now - ts;
  if (delta < 0) return 'just now';
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / WEEK)}w ago`;
  if (delta < 365 * DAY) return `${Math.floor(delta / (30 * DAY))}mo ago`;
  return `${Math.floor(delta / (365 * DAY))}y ago`;
}

export function effigyUrl(address: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${address.toLowerCase()}`;
}

export function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'k-score-weak';
  if (score >= 70) return 'k-score-strong';
  if (score >= 40) return 'k-score-mid';
  return 'k-score-weak';
}
