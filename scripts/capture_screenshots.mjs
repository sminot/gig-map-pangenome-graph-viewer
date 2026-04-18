// Capture the README overview screenshot against the built viewer/dist bundle.
//
// Usage:
//   npm run build --prefix viewer
//   npm install --no-save puppeteer        (installs a bundled Chromium)
//   node scripts/capture_screenshots.mjs
//
// To use puppeteer from a different install location, set PUPPETEER_PATH to
// its ESM entry (…/puppeteer/lib/esm/puppeteer/puppeteer.js).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const PUPPETEER_PATH = process.env.PUPPETEER_PATH;
const puppeteerModule = PUPPETEER_PATH
  ? await import(PUPPETEER_PATH)
  : await import("puppeteer");
const puppeteer = puppeteerModule.default ?? puppeteerModule;

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "..", "viewer", "dist");
const OUT_DIR = resolve(here, "..", "docs", "screenshots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".arrow": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function mimeFor(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot) : "";
  return MIME[ext] || "application/octet-stream";
}

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let filePath = url.pathname;
      if (filePath.endsWith("/")) filePath += "index.html";
      const full = join(DIST, filePath.replace(/^\/+/, ""));
      if (!full.startsWith(DIST)) {
        res.statusCode = 403;
        return res.end("forbidden");
      }
      const body = await readFile(full);
      res.statusCode = 200;
      res.setHeader("content-type", mimeFor(full));
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

async function waitForLoad(page) {
  try {
    await page.waitForFunction(
      () => {
        const s = document.getElementById("status");
        return s && /\d+ nodes, \d+ edges/.test(s.textContent || "");
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    const statusText = await page.evaluate(
      () => document.getElementById("status")?.textContent,
    );
    console.error("waitForLoad timed out. current status =", JSON.stringify(statusText));
    throw err;
  }
  // Let FA2 / layout settle a bit after initial paint.
  await new Promise((r) => setTimeout(r, 800));
}

async function main() {
  const { server, url } = await startServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
    ],
  });
  try {
    await (await import("node:fs/promises")).mkdir(OUT_DIR, { recursive: true });
    const page = await browser.newPage();
    page.on("console", (msg) => console.log("[page]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.log("[page error]", err.message));
    page.on("requestfailed", (req) =>
      console.log("[req failed]", req.url(), req.failure()?.errorText),
    );
    page.on("response", (res) => {
      if (res.status() >= 400) console.log("[http", res.status() + "]", res.url());
    });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

    // Overview — default demo, partition-colored bins so the core/shell/cloud
    // radial structure of the radial-spectral layout reads at a glance.
    await page.goto(url, { waitUntil: "networkidle0" });
    await waitForLoad(page);
    await page.select("#bin-color", "partition");
    await page.select("#bin-palette", "category");
    await page.select("#genome-color", "clade");
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: join(OUT_DIR, "overview.png"),
      fullPage: false,
    });
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
