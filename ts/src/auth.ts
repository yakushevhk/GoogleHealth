const RETRY_DELAYS = [500, 1500, 4000];
const EXPIRY_MARGIN_MS = 60_000;
const BASE = "https://health.googleapis.com/v4/users/me";

// ─── Response Cache ──────────────────────────────────────────────────────────

export class ResponseCache {
  private entries = new Map<string, { at: number; value: any }>();
  constructor(private ttlMs: number) {}

  get(key: string): any | undefined {
    const e = this.entries.get(key);
    if (!e || Date.now() - e.at >= this.ttlMs) return undefined;
    return e.value;
  }
  set(key: string, value: any) {
    this.entries.set(key, { at: Date.now(), value });
  }
  clear() {
    this.entries.clear();
  }
}

// ─── Auth State ──────────────────────────────────────────────────────────────

export class AuthState {
  private accessToken = "";
  private expiresAt = 0;
  private refreshPromise: Promise<string> | null = null;
  readonly cache = new ResponseCache(120_000);

  constructor(
    private clientId: string,
    private clientSecret: string,
    private refreshToken: string,
  ) {}

  private isValid(): boolean {
    return this.accessToken !== "" && Date.now() + EXPIRY_MARGIN_MS < this.expiresAt;
  }

  async getToken(): Promise<string> {
    if (this.isValid()) return this.accessToken;
    // Single-flight: reuse in-progress refresh.
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshInner().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshIfStale(stale: string): Promise<string> {
    if (this.accessToken && this.accessToken !== stale) return this.accessToken;
    return this.getToken();
  }

  private async refreshInner(): Promise<string> {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = await resp.json() as any;
    if (!resp.ok) {
      const desc = body.error_description || body.error || "unknown error";
      throw new Error(`OAuth refresh failed (HTTP ${resp.status}): ${desc}`);
    }
    this.accessToken = body.access_token;
    this.expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private async doRequest(method: string, url: string, token: string, payload?: any): Promise<{ status: number; body: any }> {
    const opts: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}` },
    };
    if (payload !== undefined) {
      opts.headers = { ...opts.headers as any, "Content-Type": "application/json" };
      opts.body = JSON.stringify(payload);
    }
    const resp = await fetch(url, opts);
    const text = await resp.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { rawBody: text }; }
    return { status: resp.status, body };
  }

  private async request(method: string, url: string, payload?: any): Promise<any> {
    let lastErr = "";
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      let token: string;
      try {
        token = await this.getToken();
      } catch (e: any) {
        lastErr = e.message;
        if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
        throw new Error(lastErr);
      }

      try {
        let { status, body } = await this.doRequest(method, url, token, payload);

        if (status === 401) {
          const fresh = await this.refreshIfStale(token);
          ({ status, body } = await this.doRequest(method, url, fresh, payload));
        }

        if (status >= 200 && status < 300) return body;

        lastErr = apiErrorMessage(body, status);
        if (status === 429 || status >= 500) {
          if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
        }
        throw new Error(lastErr);
      } catch (e: any) {
        if (e.message === lastErr) throw e;
        lastErr = `Google Health API: ${e.message}`;
        if (attempt < RETRY_DELAYS.length) { await sleep(RETRY_DELAYS[attempt]); continue; }
        throw new Error(lastErr);
      }
    }
    throw new Error(lastErr);
  }

  apiGet(url: string) { return this.request("GET", url); }
  apiPost(url: string, payload: any) { return this.request("POST", url, payload); }
  apiPatch(url: string, payload: any) { return this.request("PATCH", url, payload); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function apiErrorMessage(body: any, status: number): string {
  const msg = body?.error?.message;
  if (msg) return `Google Health API error (HTTP ${status}): ${msg}`;
  const s = JSON.stringify(body, null, 2).slice(0, 500);
  return `Google Health API: HTTP ${status}: ${s}`;
}

export { BASE, RETRY_DELAYS };
