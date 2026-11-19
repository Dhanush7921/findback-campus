import { createApp } from './app';
import { seedDemo } from './devSeed';
import type { Env } from './env';
import { AppsScriptStore } from './store/appsScript';
import { MemoryStore } from './store/memory';
import type { Store } from './store/types';

let cached: { key: string; handle: (r: Request) => Promise<Response> } | null = null;
let devStore: MemoryStore | null = null;

async function getHandler(env: Env) {
  const key = [env.GAS_URL, env.APP_ENV, env.ALLOWED_ORIGINS, env.STAFF_EMAILS, env.GOOGLE_CLIENT_ID].join('|');
  if (cached?.key === key) return cached.handle;
  let store: Store | null = null;
  if (env.GAS_URL && env.GAS_SHARED_SECRET) {
    store = new AppsScriptStore(env.GAS_URL, env.GAS_SHARED_SECRET);
  } else if (env.APP_ENV === 'development' && env.PIN_PEPPER) {
    if (!devStore) {
      devStore = new MemoryStore();
      await seedDemo(devStore, env.PIN_PEPPER);
    }
    store = devStore;
  }
  cached = { key, handle: createApp({ env, store }) };
  return cached.handle;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return (await getHandler(env))(req);
  },
};
