import { DEBUG } from '../config';
import { pause } from '../util/schedulers';
import { clearAssetCache, respondWithCache, respondWithCacheNetworkFirst } from './assetCache';

declare const self: ServiceWorkerGlobalScope;

const CACHE_FIRST_ASSET_EXTENSIONS = 'js|css|woff2?|svg|png|jpe?g|tgs|json|wasm';
const RE_NETWORK_FIRST_ASSETS = /\.(wasm|html)$/;
const RE_CACHE_FIRST_ASSETS = new RegExp(
  `(?:/assets/[^/]+|/(?:[^/]+\\.)?worker|/index)-[\\w-]{8}`
  + `\\.(${CACHE_FIRST_ASSET_EXTENSIONS})$`,
);

const ACTIVATE_TIMEOUT = 3000;

self.addEventListener('install', (e) => {
  if (DEBUG) console.log('ServiceWorker installed');
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  if (DEBUG) console.log('ServiceWorker activated');

  e.waitUntil(
    Promise.race([
      pause(ACTIVATE_TIMEOUT),
      Promise.all([
        clearAssetCache(),
        self.clients.claim(),
      ]),
    ]),
  );
});

self.addEventListener('fetch', (e: FetchEvent) => {
  const { url } = e.request;
  const { scope } = self.registration;

  if (!url.startsWith(scope)) return;

  const { pathname, protocol } = new URL(url);
  const { pathname: scopePathname } = new URL(scope);

  if (protocol === 'http:' || protocol === 'https:') {
    if (pathname === scopePathname || pathname.match(RE_NETWORK_FIRST_ASSETS)) {
      e.respondWith(respondWithCacheNetworkFirst(e));
      return;
    }

    if (pathname.match(RE_CACHE_FIRST_ASSETS)) {
      e.respondWith(respondWithCache(e));
    }
  }
});