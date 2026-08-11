/**
 * Client island utilities: formatting, count-up, sparklines,
 * error handling, scroll reveal, date events.
 */

export function $(sel: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(sel);
}

/**
 * HTML escaping: data from Google Health (exercise names, food,
 * devices) is inserted via innerHTML — without escaping this is stored XSS.
 */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Client-side GET memoization + single-flight deduplication.
 *
 * Several cards request the same type independently (e.g. heart-rate intraday
 * with different windows), and date switches/auto-refresh trigger re-fetch of
 * overlapping URLs. Short-TTL caching plus single-flight keeps duplicate
 * requests off the server: identical concurrent calls share one promise,
 * and identical repeats within TTL reuse the cached body.
 *
 * Errors are never cached — a failed fetch is retried on the next call.
 */
const GET_CACHE_TTL_MS = 6_000;
type Cached = { value: unknown; expires: number };
const getCache = new Map<string, Cached>();
const inflight = new Map<string, Promise<unknown>>();

export interface FetchOpts {
  /** Disable memoization for this call (skip cache + single-flight). Default false. */
  bypassCache?: boolean;
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  if (!opts.bypassCache) {
    const hit = getCache.get(url);
    if (hit && Date.now() < hit.expires) return hit.value as T;

    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;

    const promise = doFetch(url)
      .then((value) => {
        getCache.set(url, { value, expires: Date.now() + GET_CACHE_TTL_MS });
        inflight.delete(url);
        return value;
      })
      .catch((err) => {
        inflight.delete(url);
        throw err;
      });

    inflight.set(url, promise);
    return promise;
  }
  return doFetch(url);
}

/** One real request with the 60s timeout. */
async function doFetch<T>(url: string): Promise<T> {
  // 60 s: cold load makes ~60 requests to Google through the pool,
  // late ones wait in queue; server retries itself, but can't wait forever
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    const body = (await resp.json().catch(() => ({}))) as T & { error?: string };
    if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Current dashboard date (YYYY-MM-DD), set by TopBar. */
export function getDate(): string {
  return document.documentElement.dataset.ghDate ?? todayLocal();
}

export function todayLocal(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysClient(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Subscribe to date change. Immediately calls cb with current date. */
export function onDate(cb: (date: string) => void): void {
  window.addEventListener('gh:date', ((e: CustomEvent<{ date: string }>) =>
    cb(e.detail.date)) as EventListener);
  cb(getDate());
}

// ─── Formatting ──────────────────────────────────────────────────────────

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Nothing OS dot format: 28.07.2026 (digits only — for Doto font). */
export function fmtDateDot(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(totalSec: number | null): string {
  if (totalSec === null || Number.isNaN(totalSec)) return '—';
  // First round to whole minutes, then split:
  // otherwise 3599 s → "60 min", 7140 s → "1 h 60 min".
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Relative time: "5 min ago", "2 h ago", "yesterday". */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

// ─── Count-up ────────────────────────────────────────────────────────────────

/** User prefers reduced motion (OS/browser setting). */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function countUp(
  el: HTMLElement,
  to: number | null | undefined,
  opts: { digits?: number; duration?: number } = {},
): void {
  const { digits = 0, duration = 600 } = opts;
  if (to === null || to === undefined || Number.isNaN(to)) {
    el.textContent = '—';
    el.classList.add('empty');
    return;
  }
  el.classList.remove('empty');
  const from = Number.parseFloat(el.dataset.v ?? '0');
  el.dataset.v = String(to);
  // With reduced motion — immediate final value, no rAF animation.
  if (prefersReducedMotion()) {
    el.textContent = fmt(to, digits);
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased, digits);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── Sparklines (hand-drawn inline SVG) ──────────────────────────────────────

export function sparkline(
  values: (number | null)[],
  opts: { color?: string; w?: number; h?: number; fill?: boolean; id?: string } = {},
): string {
  const { color = '#8a8a8a', w = 120, h = 26, fill = true, id } = opts;
  const pts = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const coords: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null || Number.isNaN(v)) return;
    coords.push([i * step, h - 2 - ((v - min) / span) * (h - 4)]);
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = fill
    ? `<path d="${line}L${coords[coords.length - 1][0].toFixed(1)},${h}L${coords[0][0].toFixed(1)},${h}Z" fill="${color}" opacity="0.12"/>`
    : '';
  const idAttr = id ? ` id="${id}"` : '';
  return (
    `<svg class="vital-spark"${idAttr} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `${area}<path d="${line}" pathLength="1" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** Delta to previous day: "▲ +5%" / "▼ −3%". */
export function deltaHtml(
  cur: number | null | undefined,
  prev: number | null | undefined,
  opts: { digits?: number; unit?: string; goodDown?: boolean } = {},
): string {
  if (cur == null || prev == null || prev === 0) return '';
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) return '<span>±0</span>';
  const pct = (diff / Math.abs(prev)) * 100;
  const up = diff > 0;
  const good = opts.goodDown ? !up : up;
  const cls = good ? 'up' : 'down';
  const sign = up ? '+' : '−';
  return `<span class="${cls}">${up ? '▲' : '▼'} ${sign}${fmt(Math.abs(pct))}%</span>`;
}

// ─── Errors and skeletons ──────────────────────────────────────────────────────

/** Connection failure (no token / network / 5xx): shown calmly, without raw text.
 *  NOTE: intentionally NO bare \btoken\b — it falsely matches data parsing errors
 *  like "unexpected token in JSON", hiding a real bug under "no connection".
 *  Real connection strings with token are already covered via oauth/revoked/refresh/expired. */
const CONN_RE =
  /oauth|revoked|refresh|expired|fetch failed|failed to fetch|network\s?error|aborted|timeout|http 5\d\d|http 401|http 403/i;

export function isConnError(msg: string): boolean {
  return CONN_RE.test(msg);
}

/**
 * Error block in card. Connection failures render as calm neutral
 * "no connection" block (raw message in title for diagnostics), others —
 * red card-error. "Retry" button is always nearby.
 */
export function showError(host: HTMLElement, msg: string, retry: () => void): void {
  host.innerHTML = '';
  const conn = isConnError(msg);
  const div = document.createElement('div');
  div.className = conn ? 'card-empty' : 'card-error';
  div.title = msg;
  if (conn) {
    div.innerHTML =
      '<span class="card-empty-dot"></span>' +
      '<span class="card-empty-text">No connection to Google Health</span>';
  } else {
    div.textContent = msg;
  }
  const btn = document.createElement('button');
  btn.className = 'retry-btn';
  btn.textContent = 'Retry';
  btn.addEventListener('click', retry);
  div.appendChild(btn);
  host.appendChild(div);
}

/** Short flash on value change (auto-refresh). */
export function flash(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // animation restart
  el.classList.add('flash');
}

/**
 * Update the textual, screen-reader-visible summary of a chart.
 *
 * ECharts canvas is invisible to assistive technology; each chart container
 * that has `role="img"` should carry an `aria-label`, and — where useful —
 * a `.visually-hidden` element updated with real data once loaded. This helper
 * finds that element under the host and sets its text, so a screen reader
 * announces the actual values instead of an empty label.
 */
export function setChartSummary(host: Element | null, text: string): void {
  if (!host) return;
  const el = host.querySelector('.chart-sr');
  if (el) el.textContent = text;
}

// ─── Scroll reveal ───────────────────────────────────────────────────────────

export function initReveal(): void {
  const els = document.querySelectorAll<HTMLElement>('.reveal');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('on');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.08 },
  );
  els.forEach((el) => io.observe(el));
}
