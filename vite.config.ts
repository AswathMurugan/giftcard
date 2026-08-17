import fs from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { LOCAL_DEV_CONFIG } from "./src/config/local-dev"
import { spawn } from "child_process"
import httpProxy from "http-proxy"
import { selectiveGeneratedTypeImportsPlugin } from "./scripts/selective-generated-type-imports"

const isBackendManagedCloudPreview = process.env.BOOTSTRAP_MODE === 'cloud'

// https://vite.dev/config/
export default defineConfig({
  plugins: [selectiveGeneratedTypeImportsPlugin(), react(), tailwindcss(), appTitleHtmlPlugin(), jiffyHmrControlPlugin(), envAwareProxyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Pre-transform the modules that load on EVERY preview boot, at server
    // start, so their first request isn't a cold (~1s on the remote editor)
    // TS+JSX+tailwind transform. Feature pages are intentionally NOT listed —
    // they're lazy-loaded per route (see PrivateApp.tsx) and warming them would
    // defeat the code-splitting. Keep this to the shared shell only.
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/routes/index.tsx',
        './src/PrivateApp.tsx',
        './src/layouts/DefaultLayout.tsx',
        './src/components/ui/button.tsx',
        './src/components/ui/card.tsx',
        './src/components/ui/input.tsx',
      ],
    },
    fs: {
      // node_modules is symlinked from the starter location to the
      // workspace under /tmp. Vite's default fs.allow only includes the
      // workspace root, so font/asset requests from packages like
      // @fontsource-variable fail with "outside of Vite serving allow
      // list". Set strict: false to let Vite serve files from anywhere
      // the symlinks point to.
      strict: false,
    },
    watch: {
      // In backend-managed cloud workers we do not want chokidar driving
      // reloads at all. The backend explicitly POSTs /__jiffy/reload when
      // it wants the iframe to refresh, so ignoring everything keeps Vite
      // from reacting to agent writes or background fetch/test output.
      //
      // Local developer mode watches `src/` normally so edits hot-reload.
      //
      // The starter shipped `**/src/**` in this list, which disables HMR for
      // the ENTIRE app source: chokidar never sees a change, so an edit only
      // appears after killing Vite and clearing `node_modules/.vite`. That is
      // intentional for the CLOUD codegen flow — the agent writes many files
      // over several seconds and the backend POSTs /__jiffy/reload once the
      // generation settles — but it makes hand-editing locally very painful.
      // The cloud path is already covered by the `['**/*']` branch above, so
      // watching src here doesn't affect it.
      //
      // Generated/noisy artifacts stay ignored so a background test run or a
      // codegen refetch doesn't trigger reload storms.
      ignored: isBackendManagedCloudPreview
        ? ['**/*']
        : ['**/test-results/**', '**/.sessions/**'],
    },
  },
})


/**
 * Jiffy codegen HMR control plugin.
 *
 * The codegen agent writes many files over many seconds while generating a
 * page. If chokidar fires HMR on each individual write, the iframe flickers
 * through several broken intermediate states (route imported before the file
 * exists, etc.).
 *
 * To avoid that we tell chokidar to ignore the agent's write paths (see
 * `server.watch.ignored` below) and instead expose a `/__jiffy/reload`
 * endpoint that the Jiffy backend POSTs once — after the full generation has
 * settled on disk.
 *
 * Two modes, chosen by the POST body:
 *
 *   { files: ["src/pages/..."] }  → TARGETED HMR. Each file is resolved to
 *       its module(s) via `moduleGraph.getModulesByFile()` and refreshed with
 *       `server.reloadModule()` — Vite invalidates just that module and sends
 *       an `update` (React Fast Refresh) over the existing websocket. The
 *       browser patches in place: no full page reload, no re-fetch of the
 *       whole unbundled module graph. This matters hugely for remote users —
 *       a full dev-mode reload costs ~graph-depth × RTT (≈15s India→US);
 *       an HMR patch is one websocket push. Files not present in the module
 *       graph (e.g. a brand-new page) are skipped — their changed importer
 *       (PrivateApp.tsx) pulls them in fresh. If NOTHING resolves, fall back
 *       to full-reload. Vite itself also auto-falls-back to a full reload
 *       when a patch isn't HMR-applicable (non-component exports, etc.).
 *
 *   {} / no files                 → legacy FULL RELOAD. Because chokidar
 *       doesn't see writes, Vite's transformed-module cache is stale — we
 *       MUST `moduleGraph.invalidateAll()` before `full-reload`, otherwise
 *       the browser gets cached stale JS. Used by the code-editor flow,
 *       delete_file turns, and as the fallback above.
 *
 * No-op when the starter is run directly (the endpoint just sits unused).
 */
// NOTE: `entities.generated.ts` is a frozen snapshot the data hooks still
// depend on for compile-time field-name safety. As of PHX-3583, the agent's
// primary entity source is the live tenant data fetched at workspace
// bootstrap into `src/types/entities/<entity>.ts`. We deliberately do NOT
// wire the live fetch as a vite plugin because a dynamic
// `import('./scripts/...ts')` inside a plugin makes vite treat the script
// as a config-watched file, which then triggers `"... changed, restarting
// server..."` immediately after fresh-bootstrapped workspaces touch the file
// on disk. That restart drops the iframe's HMR socket, sends one
// ERR_EMPTY_RESPONSE, and the iframe never recovers — users see a permanent
// white screen. The backend bootstrap spawns the fetch script as a separate
// process to side-step this entirely.

// The 9 bootstrap codegens, in dependency order (mirrors new-session.sh and
// backend-node/src/bootstrap/codegens.ts — keep all three in sync). Timeouts
// match codegens.ts. Used by the /__jiffy/refetch endpoint below. NOTE: this
// MUST cover every generated artifact that `cleanGeneratedTypes` wipes — a
// refetch first removes ALL generated types, so each must be rebuilt here
// (incl. related-screens, previously missing).
const REFETCH_STEPS: ReadonlyArray<{ key: string; script: string; timeoutMs: number }> = [
  { key: 'enumerations',   script: 'scripts/fetch-enumerations.ts',    timeoutMs: 30_000 },
  { key: 'entities',       script: 'scripts/fetch-entities.ts',        timeoutMs: 30_000 },
  { key: 'savedQueries',   script: 'scripts/fetch-saved-queries.ts',   timeoutMs: 60_000 },
  { key: 'workflows',      script: 'scripts/fetch-workflows.ts',       timeoutMs: 45_000 },
  { key: 'partnerModules', script: 'scripts/fetch-partner-modules.ts', timeoutMs: 60_000 },
  { key: 'application',    script: 'scripts/fetch-application.ts',     timeoutMs: 10_000 },
  { key: 'preferences',    script: 'scripts/fetch-preferences.ts',     timeoutMs: 15_000 },
  { key: 'tenantRefs',     script: 'scripts/fetch-tenant-refs.ts',     timeoutMs: 15_000 },
  { key: 'relatedScreens', script: 'scripts/fetch-related-screens.ts', timeoutMs: 15_000 },
  { key: 'skills',         script: 'scripts/fetch-skills.ts',          timeoutMs: 30_000 },
];

/**
 * Remove ALL generated tenant types under `<root>/src/types` so a refetch is a
 * true clean slate — stale or bad data from a previous fetch cannot survive.
 * The codegens that run next rewrite everything fresh.
 *
 * Removes:
 *   - per-item generated dirs: entities / saved-queries / enumerations /
 *     workflows / partner-modules (each holds per-app-foldered modules)
 *   - top-level generated registries: `*.generated.ts`
 *   - generated catalogs: `catalogs/*` EXCEPT the hand-authored `ENTITY.md`
 *
 * Preserves hand-authored files: `entity.ts`, `dynamic-query.ts`, and
 * `catalogs/ENTITY.md`. Returns a short summary string for logging.
 */
function cleanGeneratedTypes(root: string): string {
  const typesDir = path.resolve(root, 'src/types');
  let dirs = 0;
  let files = 0;

  // 1. Per-item generated directories (recursive).
  for (const d of [
    'entities',
    'saved-queries',
    'enumerations',
    'workflows',
    'partner-modules',
  ]) {
    const p = path.resolve(typesDir, d);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      dirs++;
    }
  }

  // 2. Top-level generated registries (`*.generated.ts`).
  try {
    for (const f of fs.readdirSync(typesDir)) {
      if (f.endsWith('.generated.ts')) {
        fs.rmSync(path.resolve(typesDir, f), { force: true });
        files++;
      }
    }
  } catch {
    /* typesDir missing — nothing to clean */
  }

  // 3. Generated catalogs (keep the hand-authored ENTITY.md).
  const catalogsDir = path.resolve(typesDir, 'catalogs');
  try {
    for (const f of fs.readdirSync(catalogsDir)) {
      if (f === 'ENTITY.md') continue;
      fs.rmSync(path.resolve(catalogsDir, f), { force: true });
      files++;
    }
  } catch {
    /* no catalogs dir */
  }

  return `${dirs} dir(s) + ${files} file(s) removed (kept entity.ts, dynamic-query.ts, catalogs/ENTITY.md)`;
}

function jiffyHmrControlPlugin() {
  // Track an in-flight vitest run so overlapping reload pings don't spawn
  // duplicate child processes. We don't queue — if a run is already going,
  // the next reload just waits on the same promise.
  let inFlight: Promise<void> | null = null;

  // Single-flight guard for /__jiffy/refetch — a refetch takes up to ~3min
  // worst case; a second click must not spawn a duplicate set of children.
  let refetchInFlight = false;

  // Run the vitest suite once and resolve when it exits. Failing tests don't
  // reject — they still produce a `test-results/results.json` snapshot, which
  // is what the TestResultsPage actually renders, so we always proceed.
  function runTestsInBackground(): Promise<void> {
    console.log('runTestsInBackground');
    if (inFlight) return inFlight;

    console.log('spawn vitest');
    inFlight = new Promise<void>((resolveRun) => {
      const child = spawn(
        'npx',
        [
          'vitest',
          'run',
          '--reporter=default',
          '--reporter=json',
          '--outputFile=./test-results/results.json',
        ],
        { cwd: __dirname, stdio: 'inherit', shell: false },
      );
      child.on('exit', () => resolveRun());
      child.on('error', (err) => {
        console.error('[jiffy-hmr-control] vitest spawn failed:', err);
        resolveRun();
      });
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    name: 'jiffy-hmr-control',
    configureServer(server: any) {
      // CloudFront's WebSocket idle timeout is a non-adjustable 600s, and it
      // only tracks origin→viewer bytes — a client-side ping never resets it.
      // Between chat turns this HMR socket can sit silent well past that (a
      // user just reading the generated app), so CloudFront drops the
      // connection out from under Vite. The client's own `vite:ws:disconnect`
      // handler then polls until the server responds and does a hard
      // `location.reload()` — the "sudden reload" users see. Fix: push a
      // `{ type: 'ping' }` frame — a real HMR payload type (see
      // types/hmrPayload.d.ts) that the client's dist/client/client.mjs
      // handles with a guaranteed no-op (`case "ping": break`, verified
      // against the installed vite@7.3.1) — often enough that CloudFront
      // never sees the origin side go idle. Mirrors the
      // SSE heartbeat in `routes/chat.ts` (15s, vs. CloudFront's ~60s SSE idle
      // cutoff) — same problem class, same fix, longer interval for the much
      // longer WS timeout.
      const HEARTBEAT_MS = 4 * 60 * 1000;
      const heartbeat = setInterval(() => {
        server.ws.send({ type: 'ping' });
      }, HEARTBEAT_MS);
      server.httpServer?.once('close', () => clearInterval(heartbeat));

      server.middlewares.use('/__jiffy/reload', (req: any, res: any) => {
        // Read the (optional) JSON body: { files?: string[] }.
        let raw = '';
        req.on('data', (chunk: any) => { raw += chunk; });
        req.on('end', async () => {
          let files: string[] = [];
          try {
            const body = raw ? JSON.parse(raw) : {};
            if (Array.isArray(body?.files)) {
              files = body.files.filter((f: unknown) => typeof f === 'string');
            }
          } catch {
            // Malformed body → treat as legacy full reload.
          }

          let mode = 'full-reload';
          if (files.length > 0) {
            // Targeted HMR: refresh exactly the modules whose files changed.
            // reloadModule() invalidates the module and pushes an `update`
            // over the HMR websocket (React Fast Refresh applies it).
            let reloaded = 0;
            for (const rel of files) {
              // Resolve against the server's runtime root (NOT __dirname — the
              // config is bundled to a temp file, so __dirname can lie).
              const abs = path.resolve(server.config.root, rel);
              const mods = server.moduleGraph.getModulesByFile(abs);
              console.log(`[jiffy-hmr-control] ${rel} -> ${abs}: ${mods ? mods.size : 0} module(s)`);
              if (!mods || mods.size === 0) continue; // new file — importer covers it
              for (const mod of mods) {
                try {
                  await server.reloadModule(mod);
                  reloaded++;
                } catch (err) {
                  console.warn('[jiffy-hmr-control] reloadModule failed for', rel, err);
                }
              }
            }
            if (reloaded > 0) {
              mode = `hmr:${reloaded}`;
            } else {
              // None of the listed files map to a known module — the page
              // structure changed in a way HMR can't express. Full reload.
              server.moduleGraph.invalidateAll();
              server.ws.send({ type: 'full-reload' });
            }
          } else {
            // Legacy/explicit full reload: throw away Vite's cached transforms
            // first so the reload re-reads source from disk.
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
          }

          console.log(`[jiffy-hmr-control] reload mode=${mode} (files=${files.length})`);
          res.statusCode = 200;
          res.setHeader('content-type', 'text/plain');
          res.end(mode);

        // Second pass: kick off the test suite in the background. When it
        // finishes (pass OR fail), `test-results/results.json` has changed on
        // disk. Rather than a SECOND full page reload (which the user sees as a
        // double reload), notify the client over a custom HMR channel.
        // TestResultsPage listens for `jiffy:tests-updated` and re-fetches
        // results.json in place; every other page ignores it. One visible
        // reload per turn, test page still updates live.
        runTestsInBackground()
          .then(() => {
            server.ws.send({ type: 'custom', event: 'jiffy:tests-updated' });
          })
          .catch((err) => {
            console.error('[jiffy-hmr-control] background test run errored:', err);
          });
        });
      });

      // Manual "refetch tenant data" trigger (PHX-4117). POST /__jiffy/refetch
      // re-runs the 7 bootstrap codegens in dependency order so a session can
      // pick up tenant changes (new entities, saved queries, roles…) without
      // a restart. Triggered from the HelperMenu (Ctrl/Cmd+H) in the preview.
      // Same-origin from the iframe — works identically local and cloud.
      //
      // After the scripts finish, src/types/** has been broadly rewritten —
      // this is the one case where invalidateAll + full-reload is exactly
      // right (the targeted-HMR path stays reserved for agent page edits).
      server.middlewares.use('/__jiffy/refetch', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        if (refetchInFlight) {
          res.statusCode = 409;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'refetch already running' }));
          return;
        }
        refetchInFlight = true;

        const root = server.config.root;
        const runStep = (step: { key: string; script: string; timeoutMs: number }) =>
          new Promise<{ key: string; ok: boolean; ms: number; error?: string }>((resolveStep) => {
            const t0 = Date.now();
            const scriptAbs = path.resolve(root, step.script);
            if (!fs.existsSync(scriptAbs)) {
              resolveStep({ key: step.key, ok: false, ms: 0, error: 'script missing in workspace' });
              return;
            }
            const child = spawn('npx', ['tsx', step.script], {
              cwd: root,
              stdio: ['ignore', 'inherit', 'inherit'],
              shell: false,
            });
            const timer = setTimeout(() => {
              child.kill('SIGKILL');
            }, step.timeoutMs);
            child.on('exit', (code) => {
              clearTimeout(timer);
              const ms = Date.now() - t0;
              resolveStep(
                code === 0
                  ? { key: step.key, ok: true, ms }
                  : { key: step.key, ok: false, ms, error: `exit ${code ?? 'killed (timeout)'}` },
              );
            });
            child.on('error', (err) => {
              clearTimeout(timer);
              resolveStep({ key: step.key, ok: false, ms: Date.now() - t0, error: String(err) });
            });
          });

        (async () => {
          // CLEAN SLATE FIRST. The user clicks "Refetch tenant data" precisely
          // because the existing generated types are stale/bad — so wipe ALL
          // generated tenant types before regenerating, leaving nothing old to
          // linger. Hand-authored files (entity.ts, dynamic-query.ts,
          // catalogs/ENTITY.md) are preserved. The codegens below rebuild
          // everything fresh.
          const cleaned = cleanGeneratedTypes(root);
          console.log(`[jiffy-refetch] cleaned generated types: ${cleaned}`);

          const results: Array<{ key: string; ok: boolean; ms: number; error?: string }> = [];
          for (const step of REFETCH_STEPS) {
            console.log(`[jiffy-refetch] running ${step.key}…`);
            // Sequential — order matters (enums before entities before queries…).
            // Soft-fail per step: one failing codegen shouldn't block the rest.
            results.push(await runStep(step));
          }
          const okCount = results.filter((r) => r.ok).length;
          console.log(
            `[jiffy-refetch] done: ${okCount}/${results.length} ok — ` +
              results.map((r) => `${r.key}=${r.ok ? 'ok' : 'FAIL'}(${r.ms}ms)`).join(' '),
          );

          // Generated types changed broadly — stale-cache rules apply (see the
          // full-reload mode docs above): invalidate everything, then reload.
          server.moduleGraph.invalidateAll();
          server.ws.send({ type: 'full-reload' });

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: okCount === results.length, steps: results }));
        })()
          .catch((err) => {
            console.error('[jiffy-refetch] errored:', err);
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          })
          .finally(() => {
            refetchInFlight = false;
          });
      });
    },
  };
}

/**
 * Inject the deployed app's label into the static `index.html` <title> at
 * serve + build time, so the browser tab shows the app name (from the generated
 * app metadata) even before the React app boots — instead of the generic
 * "JiffyAI" placeholder. Source of truth is `src/types/app.generated.ts`
 * (the same `APPLICATION.label` main.tsx reads at runtime); falls back to the
 * `src/types/catalogs/app.md` table, then leaves the placeholder when neither
 * carries a label (e.g. the un-provisioned starter, where APPLICATION is null).
 */
function appTitleHtmlPlugin() {
  let root = process.cwd();
  return {
    name: "jiffy-app-title",
    configResolved(resolved: { root: string }) {
      root = resolved.root;
    },
    transformIndexHtml(html: string) {
      const label = readAppLabel(root);
      if (!label) return html;
      return html.replace(
        /<title>[\s\S]*?<\/title>/,
        `<title>${escapeHtml(label)}</title>`,
      );
    },
  };
}

/** App label from the generated metadata, or null when unavailable. */
function readAppLabel(root: string): string | null {
  // 1. Typed const (canonical — what APPLICATION.label resolves to at runtime).
  try {
    const gen = fs.readFileSync(
      path.resolve(root, "src/types/app.generated.ts"),
      "utf8",
    );
    const m = gen.match(/"label"\s*:\s*"([^"]*)"/);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* missing / unreadable — fall through */
  }
  // 2. Agent-facing markdown mirror: `| `label` | `<value>` |`.
  try {
    const md = fs.readFileSync(
      path.resolve(root, "src/types/catalogs/app.md"),
      "utf8",
    );
    const m = md.match(/\|\s*`label`\s*\|\s*`([^`]*)`\s*\|/);
    const value = m?.[1]?.trim();
    if (value && value !== "—") return value;
  } catch {
    /* missing / unreadable */
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

function resolveEnvFromHost(reqHost: string | undefined): string {
  if (reqHost) {
    const hostname = reqHost.split(':')[0];
    const match3 = hostname.match(/^[^-]+-[^-]+-([^.]+)\.localhost$/);
    if (match3) return match3[1];
  }
  return LOCAL_DEV_CONFIG.env;
}

function envAwareProxyPlugin() {
  // `/doc/` is the document-generation service (POST /doc/pdf/from-html/).
  // It must be listed separately from `/docproc` — `startsWith('/docproc')`
  // does not match `/doc/pdf/...`, so without this the request falls through
  // to Vite and returns the SPA's index.html instead of a PDF.
  const proxyPaths = ['/api', '/data/', '/workflow', '/drive', '/doc/', '/docproc', '/agentframework', '/events'];
  const proxyCache = new Map<string, any>();

  function getProxy(env: string) {
    if (proxyCache.has(env)) return proxyCache.get(env);
    // The API host is per-TENANT, not a fixed `jiffy` host: this app's data
    // plane lives at giftcards.us.sandbox.phoenix.jiffy.ai. Derive it from
    // LOCAL_DEV_CONFIG.tenant so repointing the app at another tenant is a
    // one-line change in src/config/local-dev.ts.
    const target = `https://${LOCAL_DEV_CONFIG.tenant}.us.${env}.phoenix.jiffy.ai`;
    const proxy = httpProxy.createProxyServer({ target, changeOrigin: true, secure: true });
    proxy.on('error', (err: any, _req: any, res: any) => {
      console.error(`[Proxy Error] ${env}:`, err.message);
      if (res.writeHead) { res.writeHead(502); res.end('Proxy error'); }
    });
    proxyCache.set(env, proxy);
    return proxy;
  }

  // Editor-backend proxy (LOCAL DEV only in practice): the /review scaffolding
  // page fetches /codegen/api/review/* — same-origin in cloud (the backend
  // fronts Vite), but locally the iframe talks to Vite :3001 directly, so
  // forward /codegen to the backend on :8001. Never hit in cloud (requests
  // to /codegen are consumed by Fastify before reaching Vite).
  const codegenProxy = httpProxy.createProxyServer({
    target: 'http://localhost:8001',
    changeOrigin: true,
  });
  codegenProxy.on('error', (_err: any, _req: any, res: any) => {
    if (res.writeHead) { res.writeHead(502); res.end('editor backend unreachable'); }
  });

  return {
    name: 'env-aware-proxy',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url.startsWith('/codegen')) {
          codegenProxy.web(req, res);
          return;
        }
        const shouldProxy = proxyPaths.some(p => url.startsWith(p));
        if (!shouldProxy) return next();
        const env = resolveEnvFromHost(req.headers.host);
        const proxy = getProxy(env);
        proxy.web(req, res);
      });
    },
  };
}

// NOTE: The dev-mode global error capture + toast that used to live here as
// a transformIndexHtml plugin has moved into real TypeScript at
// `src/utils/dev-error-toast.ts`, mounted from `src/main.tsx`. See that
// module for the runtime behaviour.
