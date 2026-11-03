# Dynasties API and MCP server

Base URL: `https://officials.bettergov.ph` (the site itself is at `https://dynasties.bettergov.ph`; the same routes also answer there). Read-only, no authentication, CORS open. Successful data results are cached at the edge for up to a day; the data changes once per election.

## Result caching

The Worker uses Cloudflare's Cache API before querying D1. REST (including legacy routes) and MCP share entries for the same data operation and parsed arguments on the same hostname. Query-string ordering and unused parameters do not affect these entries. Search caches both the people and place lookups. MCP caches only tool data: each response retains the current request's JSON-RPC id and `Cache-Control: no-store`.

Data results and sitemaps have a 24-hour edge TTL; rendered HTML has a one-hour edge TTL. Cache contents are local to a Cloudflare data center and may be evicted sooner, so a miss still queries D1. Simultaneous cold requests can also query D1 independently. There is no KV or additional storage service.

Responses include `X-Result-Cache`: `HIT` when all performed lookups hit, `MISS` when all missed, `MIXED` when some hit and some missed (for example a search or MCP batch), and `BYPASS` when no cache lookup was performed. Errors, 404 pages, and generic HTML returned after a database failure are not stored. Cache read/write failures fall back to normal request handling.

Keys include the Worker deployment id, the built data vintage, and `CACHE_VERSION` from `wrangler.jsonc`. Each deployment starts a fresh cache namespace, including HTML referencing new frontend assets. After updating D1 in place, bump `CACHE_VERSION` and deploy; do not rely on expiry to publish corrections. Coordinate database imports and deployment because the existing import script replaces tables in place. Browser-cached responses can remain for their advertised lifetime (one hour for REST, ten minutes for HTML). Missing deployment metadata or an unreadable data vintage disables result caching until metadata is available.

Every REST response is an envelope:

```json
{ "data": { ... }, "meta": { "api_version": "1.0.0", "data_vintage": "2026-09-14", "elections": [2001, ..., 2025], "source": "Leung, Robert R. Open Halalan ...", "license": "...", "docs": "..." } }
```

Cite Open Halalan for election figures and the PSA for poverty incidence. Person matching and surname blocs are our derivation; each candidacy carries `match_confidence` (`exact`, `strong`, `weak`, `new`) and `vote_link` (`exact`, `surname`, `prefix`, `winner-only`, `inferred`, `votes-only`), and `/api/v1/coverage` says what each election contains.

## REST, `/api/v1`

| Endpoint | What it returns |
|---|---|
| `GET /api/v1` | This list |
| `GET /api/v1/stats` | Totals and the year range |
| `GET /api/v1/coverage` | Per-election counts of winners, candidates, contests, towns, and how many winners have votes |
| `GET /api/v1/places` | Regions with their provinces |
| `GET /api/v1/places/{province}` | Province with towns and per-election counts |
| `GET /api/v1/places/{province}/{town}` | Town with per-election counts and the district seats it votes in |
| `GET /api/v1/contests?year&province&town&position&district&candidates=1&page&limit` | Races. A town query includes the district seats the town votes in. `candidates=1` embeds every candidate |
| `GET /api/v1/contests/{id}` | One race with candidates, margin and, for district seats, the member towns |
| `GET /api/v1/persons?q=marcos` or `?q=duterte,%20sara` | Search by surname or "Surname, First name"; optional `province` |
| `GET /api/v1/persons?province&min_runs&sort=wins\|runs\|losses&page` | Repeat politicians |
| `GET /api/v1/persons/{id}` | Full record: every candidacy and the surname blocs the person belongs to |
| `GET /api/v1/national/{year}` | President, vice president, senators, party list |
| `GET /api/v1/national/{year}/provinces/{province}` | The same race's votes inside one province |
| `GET /api/v1/blocs?year=2025\|all&province&region&min=2&surname&members=1&page` | Surname blocs, the dynasty analysis |
| `GET /api/v1/blocs/{id}` | One bloc with members, linked surnames in the province, and the same surname elsewhere |
| `GET /api/v1/compare?province&town&position&district` | Winners of one seat across every election, and who won it more than once |

Places accept a slug (`cebu`, `lapu-lapu`) or the name. Positions accept `governor`, `vice governor`, `representative`, `board member`, `mayor`, `vice mayor`, `councilor`. Contest ids look like `2025-cebu-cebu-first-rep`.

Examples:

```
/api/v1/blocs?province=cebu&year=2025&min=3
/api/v1/compare?province=cebu&town=cebu&position=mayor
/api/v1/contests?province=abra&town=bangued&year=2025&candidates=1
/api/v1/persons?q=bersamin&province=abra
```

## MCP, `POST /mcp`

A Model Context Protocol server over streamable HTTP (JSON responses, stateless, no server-sent events). Add it to an MCP client as a remote server:

```json
{ "mcpServers": { "dynasties": { "url": "https://officials.bettergov.ph/mcp" } } }
```

Tools: `search_officials`, `get_official`, `list_contests`, `get_contest`, `get_blocs`, `compare_elections`, `get_national_results`, `get_coverage`. Each result carries the source citation and data vintage; the server instructions tell the model that shared surnames indicate, not prove, kinship, and that votes exist only from 2010.

Raw JSON-RPC example:

```bash
curl -s https://officials.bettergov.ph/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_blocs","arguments":{"province":"cebu","year":"2025","min_members":3}}}'
```

## Not exposed

The per-town breakdown of national votes (2 million rows), party-list nominees (not in the source), and anything about a person beyond what the ballot printed: names, party, sex and votes.
