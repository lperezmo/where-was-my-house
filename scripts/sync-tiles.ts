/**
 * Uploads the deeptime paleo map tiles to Cloudflare R2.
 *
 * The tiles are 1.4 GB across 110 ages and about 37,500 PNGs, far too much for
 * the repo or a Vercel deployment, so they live in object storage and are
 * fetched per tile. R2 is used rather than S3 because egress is free, which is
 * the whole cost of serving a map.
 *
 * Credentials come from the environment, never the command line:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * Run with: bun run sync-tiles [--check] [--dry] [--from <dir>]
 *   --check  round-trip one small object to prove the credentials work
 *   --dry    count the tiles without uploading anything
 */
import { S3Client } from "bun";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_SOURCE = "D:/Python/deeptime-open/web/public/tiles";
const CONCURRENCY = 24;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const check = args.includes("--check");
const fromIndex = args.indexOf("--from");
const source = fromIndex >= 0 ? args[fromIndex + 1] : DEFAULT_SOURCE;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Set the four R2 variables first:\n` +
        `  python ~/.claude/hooks/env_tool.py set R2_ACCOUNT_ID\n` +
        `  python ~/.claude/hooks/env_tool.py set R2_ACCESS_KEY_ID\n` +
        `  python ~/.claude/hooks/env_tool.py set R2_SECRET_ACCESS_KEY\n` +
        `  python ~/.claude/hooks/env_tool.py set R2_BUCKET`,
    );
    process.exit(1);
  }
  return value;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".png")) yield full;
  }
}

/** Proves the four credentials work before committing to a 37,000 file upload. */
async function preflight(client: S3Client) {
  const key = "tiles/.preflight";
  const stamp = `ok ${new Date().toISOString()}`;
  await client.write(key, stamp, { type: "text/plain", acl: "public-read" });
  const back = await client.file(key).text();
  if (back !== stamp) throw new Error("wrote an object but read back something else");
  console.log("credentials work: wrote and read tiles/.preflight");

  const base = process.env.R2_PUBLIC_BASE;
  if (!base) {
    console.log("R2_PUBLIC_BASE is not set, so the public URL was not checked.");
    return;
  }
  const url = `${base.replace(/\/$/, "")}/${key}`;
  const res = await fetch(url).catch(() => null);
  if (res?.ok) console.log(`public read works: ${url}`);
  else
    console.log(
      `NOT public yet (${res?.status ?? "no response"}): ${url}\n` +
        "Enable the r2.dev public URL or attach a custom domain, then re-run --check.",
    );
}

async function main() {
  if (check) {
    const client = new S3Client({
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: requireEnv("R2_BUCKET"),
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    });
    await preflight(client);
    return;
  }

  if (!(await stat(source).catch(() => null))) {
    console.error(`No tiles at ${source}. Pass --from <dir>.`);
    process.exit(1);
  }

  const client = dry
    ? null
    : new S3Client({
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
        bucket: requireEnv("R2_BUCKET"),
        endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      });

  const files: string[] = [];
  for await (const file of walk(source)) files.push(file);
  const bytes = files.length ? (await stat(files[0])).size : 0;
  console.log(`${files.length} tiles from ${source}${dry ? "  (dry run)" : ""}`);
  if (dry) {
    console.log(`first: ${relative(source, files[0]).replaceAll("\\", "/")}  ~${bytes} bytes`);
    console.log(`last:  ${relative(source, files[files.length - 1]).replaceAll("\\", "/")}`);
    return;
  }

  let done = 0;
  let failed = 0;
  const queue = [...files];

  async function worker() {
    for (;;) {
      const file = queue.pop();
      if (!file) return;
      const key = `tiles/${relative(source, file).replaceAll("\\", "/")}`;
      try {
        await client!.write(key, Bun.file(file), {
          type: "image/png",
          // Tiles for a fixed age never change, so they can be cached forever.
          acl: "public-read",
        });
        done += 1;
        if (done % 500 === 0) console.log(`${done}/${files.length}`);
      } catch (err) {
        failed += 1;
        console.error(`${key}: ${(err as Error).message}`);
        if (failed > 20) {
          console.error("too many failures, stopping");
          process.exit(1);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`uploaded ${done}, failed ${failed}`);
}

await main();
