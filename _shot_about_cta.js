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
  ".jpeg": "image/jpeg",
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
      }, 60000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function capture(baseUrl, width, height, mobile, outName) {
  const port = 9900 + Math.floor(Math.random() * 200);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-cta-${width}-${Date.now()}`
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

    const metrics = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('.about-cta');
        section.scrollIntoView({ block: 'start' });
        const rect = section.getBoundingClientRect();
        const img = section.querySelector('.about-cta__media img');
        const wa = section.querySelector('.about-cta__btn');
        const tel = section.querySelector('a[href^="tel:"]');
        const row = section.querySelector('.about-cta__row');
        const rowCs = row ? getComputedStyle(row) : null;
        return {
          y: Math.max(0, Math.round(window.pageYOffset + rect.top)),
          height: Math.round(rect.height),
          overflow: document.documentElement.scrollWidth > ${width} + 1,
          scrollWidth: document.documentElement.scrollWidth,
          h1: document.querySelectorAll('h1').length,
          h2: section.querySelector('h2')?.innerText.replace(/\\s+/g,' ').trim(),
          btnText: wa?.innerText.replace(/\\s+/g,' ').trim(),
          waHref: wa?.getAttribute('href') || null,
          waTarget: wa?.getAttribute('target') || null,
          waRel: wa?.getAttribute('rel') || null,
          telHref: tel?.getAttribute('href') || null,
          telText: tel?.textContent.trim() || null,
          rowDisplay: rowCs?.display || null,
          rowDir: rowCs?.flexDirection || null,
          heightCss: getComputedStyle(section).height,
          padLeft: getComputedStyle(section.querySelector('.about-cta__inner')).paddingLeft,
        };
      })()`,
    });
    const info = metrics.result.value;
    console.log(outName, JSON.stringify(info, null, 2));

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: Math.max(height, info.y + info.height + 40),
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await sleep(300);

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: info.y,
        width,
        height: info.height,
        scale: 1,
      },
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
    await capture(baseUrl, 1440, 1100, false, "about-cta-desktop-1440.png");
    await capture(baseUrl, 390, 1100, true, "about-cta-mobile-390.png");
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
