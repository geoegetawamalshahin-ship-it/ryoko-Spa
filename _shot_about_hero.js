const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");

const chromePath =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = __dirname;
const outDir = path.join(root, "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = urlPath === "/" ? "/about.html" : urlPath;
      const filePath = path.join(
        root,
        rel.replace(/^\//, "").replace(/\//g, path.sep)
      );
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": mime[ext] || "application/octet-stream",
        });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function waitJson(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find(
          (t) => t.type === "page" && t.webSocketDebuggerUrl
        );
        if (page) return page;
      }
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("No page target");
}

class Cdp {
  constructor(wsUrl) {
    this.ws = null;
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", reject);
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timeout " + method));
        }
      }, 60000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function captureHero({ baseUrl, width, height, outName, mobile }) {
  const port = 9500 + Math.floor(Math.random() * 200);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-about-hero2-${width}-${Date.now()}`
  );
  fs.mkdirSync(userData, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${userData}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const page = await waitJson(port);
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}about.html` });
    await sleep(3500);
    await cdp.send("Runtime.evaluate", {
      expression: `document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,0);`,
    });
    await sleep(400);

    const metrics = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const hero = document.querySelector('.about-hero');
        const header = document.querySelector('.site-header');
        const img = document.querySelector('.about-hero__media img');
        if (!hero) return null;
        const hr = hero.getBoundingClientRect();
        const hdr = header ? header.getBoundingClientRect().height : 0;
        return {
          headerHeight: Math.round(hdr),
          heroHeight: Math.round(hr.height),
          total: Math.round(hdr + hr.height),
          overflow: document.documentElement.scrollWidth > ${width} + 1,
          h1: document.querySelector('#about-hero-heading')?.textContent.trim(),
          h1Count: document.querySelectorAll('h1').length,
          h1OneLine: (() => {
            const el = document.querySelector('#about-hero-heading');
            if (!el) return null;
            return el.scrollHeight <= el.getBoundingClientRect().height + 2
              && el.scrollWidth <= el.clientWidth + 2;
          })(),
          imgSrc: img?.currentSrc || img?.src || null,
          objectPosition: img ? getComputedStyle(img).objectPosition : null,
          hasOverlay: !!document.querySelector('.about-hero__overlay'),
          hasScroll: !!document.querySelector('.about-hero__scroll')
        };
      })()`,
    });

    const info = metrics.result.value;
    console.log(outName, info);
    if (!info) throw new Error("hero missing");

    const clipH = info.total;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: Math.max(height, clipH + 40),
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await sleep(250);

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: clipH, scale: 1 },
    });
    const outFile = path.join(outDir, outName);
    fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
    console.log("wrote", outFile, fs.statSync(outFile).size);
    cdp.close();
  } finally {
    try {
      chrome.kill();
    } catch (_) {}
  }
}

(async () => {
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/`;
  try {
    await captureHero({
      baseUrl,
      width: 1440,
      height: 900,
      outName: "about-hero-desktop-1440.png",
      mobile: false,
    });
    await captureHero({
      baseUrl,
      width: 390,
      height: 900,
      outName: "about-hero-mobile-390.png",
      mobile: true,
    });
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
