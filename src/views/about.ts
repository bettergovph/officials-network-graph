import { loadIndex } from '../data';
import { fmt } from '../util';
import { crumbs } from './shared';

export async function about(root: HTMLElement) {
    const index = await loadIndex().catch(() => null);
    const first = index?.years[0] ?? 2001, last = index?.years[index.years.length - 1] ?? 2025;
    root.innerHTML = `<div class="page narrow">${crumbs([{ label: 'Philippines', href: '/regional' }, { label: 'About' }])}
  <h1>About Dynasty</h1>
  <p class="lede">Dynasty is the political map of the Philippines: every candidate for local office from ${first} to ${last}, who won, who lost, who keeps coming back, and which surnames hold the seats. It is built and maintained by volunteers at <a href="https://bettergov.ph" target="_blank" rel="noopener noreferrer">BetterGov.ph</a>, and the code and data pipeline are open source.</p>
  ${index ? `<div class="stats wide"><div class="stat"><b>${fmt(index.totals.persons)}</b><span>people</span></div><div class="stat"><b>${fmt(index.totals.candidacies)}</b><span>candidacies</span></div><div class="stat"><b>${fmt(index.totals.contests)}</b><span>contests</span></div><div class="stat"><b>${index.totals.provinces}</b><span>provinces</span></div><div class="stat"><b>${fmt(index.totals.cities)}</b><span>cities &amp; towns</span></div><div class="stat"><b>${index.years.length}</b><span>elections</span></div></div>` : ''}

  <h2>What you can do here</h2>
  <ul class="prose">
    <li><b>Dynasties</b> groups officials in a province who share a surname as last name <em>or</em> middle name into a "bloc", and shows where blocs hold seats on an atlas, as a network, or in a ledger. The rule (2, 3 or 5 seats) sets how large a family name has to be to count.</li>
    <li><b>Regional</b> lists every region, province and town with each contest, its candidates, votes, vote shares, margins and results.</li>
    <li><b>Officials Search</b> finds any politician by name and holds one record per politician with their full election history, and lists repeat politicians by wins, runs and losses.</li>
    <li><b>National</b> shows presidential, vice presidential, senate and party-list totals, and each province's share on its page.</li>
  </ul>

  <h2>Sources</h2>
  <p>Please cite the original sources when you reuse numbers from this site.</p>
  <ol class="prose cite">
    <li><b>Election results.</b> Robert R. Leung, <em>Open Halalan: The Philippine National and Local Election Dataset</em>. <a href="https://robertrleung.github.io/OpenHalalan/" target="_blank" rel="noopener noreferrer">robertrleung.github.io/OpenHalalan</a>. Two files from the rolling <code>data-latest</code> release are used: the winners list (<code>NLE_Winners_2004-2025.csv</code>, local winners 2001-2025 with names, party and sex) and the vote counts (<code>NLE_Vote_Counts_2007-2025.csv.gz</code>, every candidate with votes per locality, usable from 2010). The project publishes citable frozen snapshots on Zenodo; use those for academic work.</li>
    <li><b>Poverty incidence.</b> Philippine Statistics Authority, OpenSTAT, <em>Full Year Official Poverty Statistics</em>: poverty incidence among population by province. <a href="https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1E__FY/?tablelist=true" target="_blank" rel="noopener noreferrer">openstat.psa.gov.ph</a>.</li>
    <li><b>Boundaries.</b> Jan Faeldon, <em>philippines-json-maps</em>, GeoJSON of Philippine administrative boundaries following the 2023 Philippine Standard Geographic Code (PSGC). <a href="https://github.com/faeldon/philippines-json-maps" target="_blank" rel="noopener noreferrer">github.com/faeldon/philippines-json-maps</a>. Simplified here for the web.</li>
    <li><b>Base map.</b> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, under the Open Database License.</li>
    <li><b>Earlier versions</b> of this project (2004-2016) drew on the Ateneo Policy Center's political dynasty dataset, published through <a href="https://www.inclusivedemocracy.ph/data-and-infographics" target="_blank" rel="noopener noreferrer">Inclusive Democracy</a>.</li>
  </ol>

  <h2>Method and caveats</h2>
  <ul class="prose">
    <li>Province-wide races are reported per town in the source and summed here; national races are summed per province. Winners missing from the winners list are inferred from vote order using the seat count seen in other years.</li>
    <li>People are matched across elections by surname, first name and middle name within a province. Two candidates with the same name in different towns are kept apart. Ballot nicknames ("Chris" for Christopher) are matched when they are a prefix; otherwise they create a separate record, marked with a "?" on the person page.</li>
    <li>Votes exist only from 2010, and about half of 2010 and a quarter of 2013 winners have none because their towns are missing from the vote file.</li>
    <li>A shared surname is a signal, not proof of kinship. Political families also intermarry, split, and use different surnames; middle names catch some of that but not all.</li>
    <li>The full coverage report is in <a href="https://github.com/bettergovph/officials-network-graph/blob/main/docs/coverage.md" target="_blank" rel="noopener noreferrer">docs/coverage.md</a>, and the pipeline that produces every number on this site is <a href="https://github.com/bettergovph/officials-network-graph" target="_blank" rel="noopener noreferrer">on GitHub</a>.</li>
  </ul>

  <h2 id="bettergov">About BetterGov.ph</h2>
  <p class="prose"><a href="https://bettergov.ph" target="_blank" rel="noopener noreferrer">BetterGov.ph</a> describes itself as "a volunteer-led tech initiative committed to creating #civictech projects aimed at making government more transparent, efficient, and accessible to citizens." Its volunteers build open-source tools for the Philippines, from a better national government website to dashboards over procurement, budget and infrastructure records, and publish the code under open licenses on <a href="https://github.com/bettergovph" target="_blank" rel="noopener noreferrer">github.com/bettergovph</a>.</p>
  <p class="prose">Dynasty is one of those projects. If you spot a wrong match, a missing town, or want to help, open an issue on GitHub or write to <a href="mailto:volunteers@bettergov.ph">volunteers@bettergov.ph</a>.</p>
</div>`;
}
