import { esc } from '../util';
import { crumbs } from './shared';

const ROUTES: [string, string][] = [
    ['/api/v1', 'This list of endpoints'],
    ['/api/v1/stats', 'Totals and the year range'],
    ['/api/v1/coverage', 'Per election: winners, candidates, contests, towns, and how many winners have vote counts'],
    ['/api/v1/places', 'Regions with their provinces'],
    ['/api/v1/places/{province}', 'A province with its towns and per-election counts'],
    ['/api/v1/places/{province}/{town}', 'A town with per-election counts and the district seats it votes in'],
    ['/api/v1/contests?year&province&town&position&district&candidates=1&page&limit', 'Races. A town query includes the district seats the town votes in; candidates=1 embeds every candidate'],
    ['/api/v1/contests/{id}', 'One race with candidates, margin and, for district seats, member towns'],
    ['/api/v1/persons?q=marcos', 'Search by surname, or "Surname, First name"; optional province'],
    ['/api/v1/persons?province&min_runs&sort=wins|runs|losses&page', 'Repeat politicians'],
    ['/api/v1/persons/{id}', 'Full record: every candidacy and the surname blocs the person belongs to'],
    ['/api/v1/national/{year}', 'President, vice president, senators and party list'],
    ['/api/v1/national/{year}/provinces/{province}', 'The same races inside one province'],
    ['/api/v1/blocs?year=2025|all&province&region&min=2&surname&members=1&page', 'Surname blocs, the dynasty analysis'],
    ['/api/v1/blocs/{id}', 'One bloc with members, linked surnames in the province, and the same surname elsewhere'],
    ['/api/v1/compare?province&town&position&district', 'Winners of one seat across every election, and who won it more than once'],
];
const EXAMPLES = ['/api/v1/blocs?province=cebu&year=2025&min=3', '/api/v1/compare?province=cebu&town=cebu&position=mayor', '/api/v1/contests?province=abra&town=bangued&year=2025&candidates=1', '/api/v1/persons?q=bersamin&province=abra', '/api/v1/national/2025/provinces/cebu', '/api/v1/coverage'];
const TOOLS: [string, string][] = [
    ['search_officials', 'Find politicians by surname or "Surname, First name"; returns ids'],
    ['get_official', 'Full election record of one politician with match confidence and bloc memberships'],
    ['list_contests', 'Races in a province or town, optionally by year or position, with candidates on request'],
    ['get_contest', 'One race by id, or by year, province, position, town and district'],
    ['get_blocs', 'Surname blocs by province or region, for a year or all elections, filtered by rule or surname'],
    ['compare_elections', 'Who held a seat across every election, and who won it more than once'],
    ['get_national_results', 'President, vice president, senate and party-list totals, nationally or per province'],
    ['get_coverage', 'What each election contains and the known gaps'],
];

export function developers(root: HTMLElement) {
    const origin = location.origin;
    root.innerHTML = `<div class="page narrow">${crumbs([{ label: 'Philippines', href: '/regional' }, { label: 'API & MCP' }])}
  <h1>API and MCP</h1>
  <p class="lede">Everything on this site is available as a read-only JSON API and as a Model Context Protocol server for AI assistants. No key needed, CORS open, cached at the edge for a day.</p>
  <div class="card pad"><div class="kicker">Base URL</div><code class="block">${esc(origin)}</code></div>

  <h2>REST, <code>/api/v1</code></h2>
  <p class="prose">Every response is an envelope: <code>{ "data": …, "meta": { "api_version", "data_vintage", "elections", "source", "license", "docs" } }</code>. Places accept a slug (<code>cebu</code>, <code>lapu-lapu</code>) or a name; positions accept <code>governor</code>, <code>vice governor</code>, <code>representative</code>, <code>board member</code>, <code>mayor</code>, <code>vice mayor</code>, <code>councilor</code>. Contest ids look like <code>2025-cebu-cebu-first-rep</code>.</p>
  <table class="list api"><thead><tr><th>Endpoint</th><th>Returns</th></tr></thead><tbody>${ROUTES.map(([r, d]) => `<tr><td><code>${esc(r)}</code></td><td class="mute">${esc(d)}</td></tr>`).join('')}</tbody></table>
  <h3>Try it</h3>
  <ul class="prose links">${EXAMPLES.map(e => `<li><a href="${esc(e)}" target="_blank" rel="noopener">${esc(e)}</a></li>`).join('')}</ul>

  <h2>MCP, <code>POST /mcp</code></h2>
  <p class="prose">A Model Context Protocol server over streamable HTTP: stateless JSON responses, no server-sent events. Add it to any MCP client as a remote server:</p>
  <pre class="block"><code>{ "mcpServers": { "dynasties": { "url": "${esc(origin)}/mcp" } } }</code></pre>
  <table class="list api"><thead><tr><th>Tool</th><th>Does</th></tr></thead><tbody>${TOOLS.map(([t, d]) => `<tr><td><code>${esc(t)}</code></td><td class="mute">${esc(d)}</td></tr>`).join('')}</tbody></table>
  <p class="prose">Each tool result carries the source citation and data vintage. The server tells the model that shared surnames indicate, not prove, kinship, and that vote counts exist only from 2010. Raw JSON-RPC works too:</p>
  <pre class="block"><code>curl -s ${esc(origin)}/mcp -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_blocs","arguments":{"province":"cebu","year":"2025","min_members":3}}}'</code></pre>

  <h2>Reading the fields</h2>
  <ul class="prose">
    <li><code>match_confidence</code> on a candidacy is how it was attached to its person: <code>exact</code>, <code>strong</code>, <code>weak</code> or <code>new</code> (first record).</li>
    <li><code>vote_link</code> is how a winner met its vote row: <code>exact</code>, <code>surname</code>, <code>prefix</code>, <code>winner-only</code> (no votes), <code>inferred</code> (winner taken from vote order), <code>votes-only</code> (a losing candidate).</li>
    <li>A bloc's <code>share</code> is its members over all officials in the province for that scope; <code>via_middle_name</code> counts members carrying the surname as a middle name.</li>
  </ul>
  <h2>Not exposed</h2>
  <p class="prose">The per-town breakdown of national votes, party-list nominees (not in the source), and anything about a person beyond what the ballot printed: names, party, sex and votes.</p>
  <p class="note">Cite <a href="/about#openhalalan">Open Halalan</a> for election figures and the PSA for poverty incidence. Derived data is CC0 by BetterGov.ph. Full documentation: <a href="https://github.com/bettergovph/officials-network-graph/blob/main/docs/api.md" target="_blank" rel="noopener noreferrer">docs/api.md</a>.</p>
</div>`;
}
