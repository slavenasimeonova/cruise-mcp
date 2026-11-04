import './styles.css';
import { type CruiseStore, storeFromJson } from '../../src/data/store.js';
import { longDate } from './format.js';
import { html } from './html.js';
import { askView } from './views/ask.js';
import { bookingView } from './views/booking.js';
import { overviewView } from './views/overview.js';
import { sailingView } from './views/sailing.js';
import type { View } from './views/view.js';

const app = document.getElementById('app')!;

/** Only "#/..." hashes are routes; others (like the skip link's #app) are in-page anchors. */
const isRouteHash = (hash: string) => hash === '' || hash.startsWith('#/');

function currentPath(): string {
  if (!location.hash.startsWith('#/')) return '/';
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return '/not-found';
  }
}

function route(store: CruiseStore): View {
  const path = currentPath();
  const [, section = '', param = ''] = path.split('/');
  switch (section) {
    case '':
      return overviewView(store);
    case 'sailing':
      return sailingView(store, param.toUpperCase());
    case 'booking':
      return bookingView(store, param);
    case 'ask':
      return askView(store);
    default:
      return {
        title: 'Page not found',
        nav: null,
        body: html`<div class="empty"><h1>Page not found</h1><p><a href="#/">Go to the fleet overview</a></p></div>`,
      };
  }
}

function render(store: CruiseStore, scroll: boolean): void {
  const view = route(store);
  app.innerHTML = view.body.value;
  document.title = `${view.title} · Azure Horizon Cruises Ops`;
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  view.mount?.(app, () => render(store, false));
  if (scroll) window.scrollTo({ top: 0 });
}

async function start(): Promise<void> {
  try {
    const res = await fetch('data/cruise.public.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} loading the dataset`);
    const store = storeFromJson(await res.json(), 'cruise.public.json');
    document.getElementById('as-of')!.textContent = `Data as of ${longDate(store.asOf)}`;
    window.addEventListener('hashchange', () => {
      if (isRouteHash(location.hash)) render(store, true);
    });
    render(store, false);
  } catch (err) {
    app.innerHTML = html`<div class="empty"><h1>Couldn't load the fleet data</h1><p>${(err as Error).message}</p></div>`.value;
  }
}

void start();
