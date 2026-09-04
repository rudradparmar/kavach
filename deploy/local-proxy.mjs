/**
 * The Caddyfile's routing, in Node, for verifying the deployed shape without
 * Docker.
 *
 *   node deploy/local-proxy.mjs           # listens on :8080
 *
 * It does exactly what `handle_path` does in deploy/Caddyfile: match a prefix,
 * strip it, forward the rest. Nothing else. If this and the Caddyfile ever
 * disagree, the Caddyfile is the one that ships -- this exists so the client's
 * path-mounted branch and the services' behaviour behind a prefix-stripping
 * proxy can be exercised on a laptop:
 *
 *   cd kavach-engine && npm run dev       # :8787
 *   cd stt-service && npm run dev         # :8788
 *   cd evidence-service && npm run dev    # :8789
 *   node deploy/local-proxy.mjs           # :8080
 *
 *   cd app
 *   npm run smoke    -- http://localhost:8080/engine
 *   npm run evidence -- http://localhost:8080/evidence
 *   npm run pipeline -- http://localhost:8080/engine http://localhost:8080/stt
 *
 * A deployment shape that is only ever exercised in production is a
 * deployment shape nobody has tested.
 */

import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);

/** Mirrors the three handle_path blocks in deploy/Caddyfile. */
const ROUTES = [
  { prefix: "/engine", port: 8787 },
  { prefix: "/stt", port: 8788 },
  { prefix: "/evidence", port: 8789 },
];

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const route = ROUTES.find((r) => url === r.prefix || url.startsWith(r.prefix + "/") || url.startsWith(r.prefix + "?"));

  if (!route) {
    // Caddy's `handle { respond 404 }`. Nothing else is served.
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // handle_path strips the prefix, so the service never learns it is mounted
  // anywhere. /engine/session -> /session
  const stripped = url.slice(route.prefix.length) || "/";
  const path = stripped.startsWith("/") || stripped.startsWith("?") ? stripped : "/" + stripped;

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: route.port,
      method: req.method,
      path: path.startsWith("?") ? "/" + path : path,
      headers: { ...req.headers, host: `127.0.0.1:${route.port}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unreachable", detail: String(err) }));
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`kavach local-proxy on :${PORT}  (mirrors deploy/Caddyfile)`);
  for (const r of ROUTES) console.log(`  ${r.prefix}/*  ->  127.0.0.1:${r.port}`);
  console.log("\nThis is a verification tool. Caddy is what ships.\n");
});
