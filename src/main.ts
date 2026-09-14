import './styles.css';
import { home, region, province, town } from './views/places';
import { person } from './views/person';
import { search } from './views/search';
import { national } from './views/national';
import { people } from './views/people';
import { regions } from './views/regions';
import { mountDynasties } from './views/dynasties';

type View = (root: HTMLElement, params: string[], query: URLSearchParams) => void | Promise<void> | (() => void);
const routes: { pattern: RegExp; view: View; nav?: string }[] = [
    { pattern: /^\/$/, view: root => mountDynasties(root), nav: 'dynasties' },
    { pattern: /^\/map\/?$/, view: root => home(root), nav: 'map' },
    { pattern: /^\/regions\/?$/, view: root => regions(root), nav: 'regions' },
    { pattern: /^\/national(?:\/(\d{4}))?\/?$/, view: (root, [y]) => national(root, y), nav: 'national' },
    { pattern: /^\/region\/([^/]+)\/?$/, view: (root, [s]) => region(root, s!), nav: 'map' },
    { pattern: /^\/province\/([^/]+)\/?$/, view: (root, [s], q) => province(root, s!, q), nav: 'map' },
    { pattern: /^\/province\/([^/]+)\/([^/]+)\/?$/, view: (root, [s, c], q) => town(root, s!, c!, q), nav: 'map' },
    { pattern: /^\/person\/([^/]+)\/([^/]+)\/?$/, view: (root, [s, id]) => person(root, s!, id!), nav: 'people' },
    { pattern: /^\/people\/?$/, view: (root, _p, q) => people(root, q), nav: 'people' },
    { pattern: /^\/search\/?$/, view: (root, _p, q) => search(root, q), nav: 'search' },
    { pattern: /^\/dynasties\/?$/, view: root => mountDynasties(root), nav: 'dynasties' },
];

const view = document.getElementById('view')!;
let cleanup: (() => void) | null = null;

async function render() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(location.search);
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.classList.toggle('full', path === '/' || path === '/dynasties');
    for (const r of routes) {
        const m = path.match(r.pattern);
        if (!m) continue;
        document.querySelectorAll<HTMLAnchorElement>('nav.topnav a').forEach(a => a.setAttribute('aria-current', String(a.dataset['nav'] === r.nav)));
        const result = await r.view(view, m.slice(1) as string[], query);
        if (typeof result === 'function') cleanup = result;
        if (!location.hash) view.scrollTop = 0;
        return;
    }
    view.innerHTML = `<div class="page"><div class="empty"><b>Page not found</b><a href="/map">Back to the map</a></div></div>`;
}

document.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target === '_blank' || a.origin !== location.origin || e.metaKey || e.ctrlKey || e.shiftKey || a.hasAttribute('download')) return;
    e.preventDefault();
    if (a.href !== location.href) history.pushState(null, '', a.href);
    render();
});
window.addEventListener('popstate', render);

// Theme: dark by default, remembered per browser. Views that paint with canvas or Leaflet listen for 'themechange'.
const themeBtn = document.getElementById('theme') as HTMLButtonElement;
function applyTheme(t: 'dark' | 'light') {
    if (t === 'light') document.documentElement.dataset['theme'] = 'light'; else delete document.documentElement.dataset['theme'];
    themeBtn.textContent = t === 'light' ? '☀' : '☾';
    try { localStorage.setItem('theme', t); } catch { /* ignore */ }
    window.dispatchEvent(new Event('themechange'));
}
let storedTheme: string | null = null;
try { storedTheme = localStorage.getItem('theme'); } catch { /* ignore */ }
applyTheme(storedTheme === 'light' ? 'light' : 'dark');
themeBtn.addEventListener('click', () => applyTheme(document.documentElement.dataset['theme'] === 'light' ? 'dark' : 'light'));

const form = document.getElementById('topsearch') as HTMLFormElement;
form.addEventListener('submit', e => {
    e.preventDefault();
    const q = (form.querySelector('input') as HTMLInputElement).value.trim();
    history.pushState(null, '', `/search?q=${encodeURIComponent(q)}`);
    render();
});

render();
