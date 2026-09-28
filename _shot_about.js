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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
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
      }, 90000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function captureFull({ baseUrl, width, height, outName, mobile }) {
  const port = 9700 + Math.floor(Math.random() * 200);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-about-${width}-${Date.now()}`
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
      expression: `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0,0);`,
    });
    await sleep(400);

    const metrics = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const doc = document.documentElement;
        const body = document.body;
        const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim());
        const schemas = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
          try { return JSON.parse(s.textContent); } catch(e) { return null; }
        });
        const types = schemas.map(s => s && s['@type']).filter(Boolean);
        const overflow = Math.max(doc.scrollWidth, body.scrollWidth) > ${width} + 1;
        return {
          scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
          scrollHeight: Math.max(doc.scrollHeight, body.scrollHeight),
          clientWidth: doc.clientWidth,
          h1Count: h1s.length,
          h1s,
          schemaTypes: types,
          hasHeader: !!document.getElementById('site-header'),
          hasFooter: !!document.querySelector('.site-footer'),
          hasNavToggle: !!document.getElementById('nav-toggle'),
          aboutActive: !!document.querySelector('.nav-link.is-active[aria-current="page"][href="about.html"]'),
          wa: !!document.querySelector('a[href*="wa.me/971566483278"][href*="know%20more"]'),
          call: !!document.querySelector('a[href="tel:+971566483278"]'),
          maps: !!document.querySelector('a[href*="maps.app.goo.gl/ixboUYek2DTowj8m9"]'),
          overflow,
          lang: document.documentElement.lang,
          dir: document.documentElement.getAttribute('dir') || 'ltr',
          title: document.title
        };
      })()`,
    });

    console.log("raw metrics", JSON.stringify(metrics).slice(0, 800));
    const info = (metrics && metrics.result && metrics.result.value) || metrics;
    if (!info || !info.scrollHeight) {
      throw new Error("Failed to read page metrics: " + JSON.stringify(metrics));
    }
    console.log(outName, JSON.stringify(info, null, 2));

    const fullH = Math.min(Math.ceil(info.scrollHeight) + 40, 16000);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: fullH,
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await sleep(500);

    const fullShot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height: Math.ceil(info.scrollHeight),
        scale: 1,
      },
    });
    const fullFile = path.join(outDir, outName);
    fs.writeFileSync(fullFile, Buffer.from(fullShot.data, "base64"));
    console.log("wrote", fullFile, fs.statSync(fullFile).size);

    // Top viewport
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `window.scrollTo(0,0)`,
    });
    await sleep(300);
    const topShot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const topName = outName.replace(".png", "-top.png");
    fs.writeFileSync(
      path.join(outDir, topName),
      Buffer.from(topShot.data, "base64")
    );

    // Bottom / footer
    await cdp.send("Runtime.evaluate", {
      expression: `window.scrollTo(0, document.body.scrollHeight)`,
    });
    await sleep(400);
    const bottomShot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const bottomName = outName.replace(".png", "-bottom.png");
    fs.writeFileSync(
      path.join(outDir, bottomName),
      Buffer.from(bottomShot.data, "base64")
    );

    cdp.close();
    return info;
  } finally {
    try {
      chrome.kill();
    } catch (_) {}
  }
}

(async () => {
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log("serving", baseUrl);
  try {
    await captureFull({
      baseUrl,
      width: 1440,
      height: 900,
      outName: "about-desktop-1440.png",
      mobile: false,
    });
    await captureFull({
      baseUrl,
      width: 390,
      height: 844,
      outName: "about-mobile-390.png",
      mobile: true,
    });
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
