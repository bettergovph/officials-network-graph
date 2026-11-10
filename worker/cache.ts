/// <reference types="@cloudflare/workers-types" />

// Cache data, never the MCP transport envelope (which contains a caller's RPC id).
// Each deployment and data release gets its own namespace; entries expire after a day.
const TTL = 86400;

function stableKey(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return Object.fromEntries(Object.entries(item).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)));
        }
        return item;
    });
}

export class ResultCache {
    private hits = 0;
    private misses = 0;
    private staticResults = 0;
    private origin: string;
    private revision: string | null;
    private ctx: ExecutionContext;

    constructor(origin: string, revision: string | null, ctx: ExecutionContext) {
        this.origin = origin;
        this.revision = revision;
        this.ctx = ctx;
    }

    markStatic() { this.staticResults++; }

    private async key(kind: string, args: unknown): Promise<Request | null> {
        if (!this.revision) return null;
        const bytes = new TextEncoder().encode(stableKey([this.revision, kind, args]));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        return new Request(`${this.origin}/__result-cache/${hash}`);
    }

    private async read(key: Request | null): Promise<Response | undefined> {
        if (!key) return undefined;
        try { return await caches.default.match(key); }
        catch { console.warn('Result cache read failed; using origin'); return undefined; }
    }

    private write(key: Request | null, response: Response) {
        if (!key) return;
        // Cache outages must not turn a successful query into an API error.
        this.ctx.waitUntil((async () => {
            try { await caches.default.put(key, response); }
            catch { console.warn('Result cache write failed'); }
        })());
    }

    async json<T>(operation: string, args: unknown, produce: () => Promise<T>): Promise<T> {
        const key = await this.key(`data:${operation}`, args);
        const cached = await this.read(key);
        if (cached) {
            try {
                const value = await cached.json<T>();
                this.hits++;
                return value;
            } catch { console.warn('Invalid cached result; using origin'); }
        }
        if (key) this.misses++;
        const value = await produce(); // Rejections are never cached.
        this.write(key, new Response(JSON.stringify(value), {
            headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL}` },
        }));
        return value;
    }

    async response(kind: string, args: unknown, produce: () => Promise<Response>): Promise<Response> {
        const key = await this.key(kind, args);
        const cached = await this.read(key);
        if (cached) { this.hits++; return this.annotate(cached); }
        if (key) this.misses++;
        const response = await produce();
        // In particular, don't retain the generic HTML fallback after a D1 failure.
        if (response.status === 200 && !/no-store|private/i.test(response.headers.get('cache-control') ?? '') && !response.headers.has('set-cookie')) {
            this.write(key, response.clone());
        }
        return this.annotate(response);
    }

    annotate(response: Response): Response {
        const headers = new Headers(response.headers);
        headers.set('x-result-cache', this.hits ? (this.misses ? 'MIXED' : 'HIT') : (this.misses ? 'MISS' : 'BYPASS'));
        if (this.staticResults) {
            headers.set('x-result-cache', this.hits || this.misses ? 'MIXED' : 'STATIC');
            headers.set('x-data-source', this.hits || this.misses ? 'mixed' : 'static');
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
}
