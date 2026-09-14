import { loadIndex, loadProvince, personCandidacies, findProvince } from '../data';
import { esc, fmt, pct, title, regionLabel, hrefProvince, hrefTown, hrefPerson, posLabel, personName, sexMark } from '../util';
import { crumbs, loading, failed, slugOf, resultBadge } from './shared';

export async function person(root: HTMLElement, provSlug: string, pid: string) {
    loading(root);
    try {
        const [index, shard] = await Promise.all([loadIndex(), loadProvince(provSlug)]);
        const p = shard.persons[pid];
        const found = findProvince(index, provSlug);
        if (!p || !found) { failed(root, 'No such person'); return; }
        const runs = personCandidacies(shard, pid);
        const wins = runs.filter(r => r.cand[3]).length;
        const years = runs.map(r => r.contest.year);
        const parties = [...new Set(runs.map(r => r.cand[1]).filter(Boolean))];
        const posts = [...new Set(runs.filter(r => r.cand[3]).map(r => posLabel(r.contest.position)))];
        const sameSurname = Object.entries(shard.persons).filter(([id, q]) => id !== pid && q[0] === p[0] && !q[7]).sort((a, b) => b[1][6] - a[1][6]).slice(0, 20);
        const weak = runs.filter(r => r.cand[5] === 'weak').length;
        const name = personName(p[0], p[1], p[2], p[3]);
        root.innerHTML = `<div class="page">${crumbs([{ label: 'Philippines', href: '/' }, { label: title(shard.name), href: hrefProvince(provSlug) }, { label: name }])}
  <div class="page-h"><div><div class="kicker">${esc(title(shard.name))} · ${esc(regionLabel(shard.region))} ${sexMark(p[4])}</div><h1>${esc(name)}</h1>
  <div class="mono mute">${runs.length} run${runs.length === 1 ? '' : 's'} · ${wins} won · ${runs.length - wins} lost · ${Math.min(...years)}–${Math.max(...years)}${posts.length ? ' · ' + esc(posts.join(', ')) : ''}${parties.length ? ' · ' + esc(parties.join(', ')) : ''}</div></div></div>
  <div class="cols"><div class="main">
    <h2>Election record</h2>
    <table class="list"><thead><tr><th>Year</th><th>Office</th><th>Place</th><th>Party</th><th class="num">Votes</th><th class="num">Share</th><th class="num">Rank</th><th>Result</th></tr></thead><tbody>
    ${runs.map(({ contest: k, cand: c }) => `<tr class="${c[3] ? 'won' : ''}"><td>${k.year}</td><td><b>${esc(posLabel(k.position))}</b>${k.district ? `<small class="mute"> · ${esc(title(k.district))} district</small>` : ''}</td><td>${k.city ? `<a href="${hrefTown(provSlug, slugOf(shard, k.city), k.year)}">${esc(title(k.city))}</a>` : `<a href="${hrefProvince(provSlug, k.year)}">${esc(title(shard.name))}</a>`}</td><td class="mute">${esc(c[1] || '—')}</td><td class="num">${fmt(c[2])}</td><td class="num mute">${k.total && c[2] != null ? pct(c[2] / k.total) : '–'}</td><td class="num mute">${c[4] != null ? `${c[4]} of ${k.c.length}` : '–'}</td><td>${resultBadge(c, k)}${c[5] === 'weak' ? ' <span class="tag warn" title="Matched to this person by a nickname or partial first name">?</span>' : ''}</td></tr>`).join('')}</tbody></table>
    ${weak ? `<p class="note">${weak} of these rows were matched to this person by a nickname or partial first name in the same town. Names on ballots vary between elections, so treat those as probable rather than certain.</p>` : ''}
    <p class="note">Winners before 2010 come from the official winners list without vote counts. Some 2010 and 2013 towns are missing from the vote counts entirely.</p>
  </div><aside class="side">
    ${sameSurname.length ? `<div class="card pad"><div class="kicker">Other ${esc(title(p[0]))}s in ${esc(title(shard.name))}</div><ol class="plain">${sameSurname.map(([id, q]) => `<li><a href="${hrefPerson(provSlug, id)}">${esc(personName(q[0], q[1], '', q[3]))}</a> <span class="mono mute">${q[6]}/${q[5]}</span></li>`).join('')}</ol><a class="mono" href="/dynasties">See surname blocs →</a></div>` : ''}
    <div class="card pad"><div class="kicker">About this record</div><p class="mute">People are matched across elections by surname, first name and middle name within a province. Two candidates with the same name in different towns are kept apart. Person id <code>${esc(pid)}</code>.</p></div>
  </aside></div></div>`;
    } catch (e) { failed(root, e); }
}
