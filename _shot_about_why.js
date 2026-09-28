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

async function withChrome(baseUrl, width, height, mobile, fn) {
  const port = 9500 + Math.floor(Math.random() * 200);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-about-why-${width}-${Date.now()}`
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
    await fn(cdp, width, height, mobile);
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
    await withChrome(baseUrl, 1440, 1100, false, async (cdp, width) => {
      const metrics = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const why = document.getElementById('about-why');
          const exp = document.querySelector('.about-experience');
          const appr = document.querySelector('.about-approach');
          const team = document.getElementById('about-team');
          const atmos = document.querySelector('.about-atmosphere');
          const order = [...document.querySelectorAll('main > section, body > section, .about-page > section, main section')];
          const sections = [...document.querySelectorAll('section')].map(s => s.id || s.className.split(' ')[0]);
          const fullH = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          );
          return {
            whyTitle: why?.querySelector('h2')?.innerText.replace(/\\s+/g,' ').trim(),
            whyEyebrow: why?.querySelector('.home-why__eyebrow')?.textContent.trim(),
            cards: why?.querySelectorAll('.home-why__card').length || 0,
            hasExperience: !!exp,
            hasApproach: !!appr,
            teamNext: team?.nextElementSibling?.id || team?.nextElementSibling?.className,
            whyNext: why?.nextElementSibling?.className,
            sections,
            fullH,
            overflow: document.documentElement.scrollWidth > ${width} + 1,
          };
        })()`,
      });
      const info = metrics.result.value;
      console.log("verify", JSON.stringify(info, null, 2));
      if (!info.whyTitle || info.hasExperience || info.hasApproach) {
        throw new Error("structure mismatch");
      }

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: Math.min(info.fullH + 40, 12000),
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(400);
      const full = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width,
          height: info.fullH,
          scale: 1,
        },
      });
      const fullPath = path.join(outDir, "about-full-desktop-1440.png");
      fs.writeFileSync(fullPath, Buffer.from(full.data, "base64"));
      console.log("wrote", fullPath, fs.statSync(fullPath).size);

      const whyMetrics = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const why = document.getElementById('about-why');
          why.scrollIntoView({ block: 'start' });
          const rect = why.getBoundingClientRect();
          return {
            y: Math.max(0, Math.round(window.pageYOffset + rect.top)),
            height: Math.round(rect.height),
          };
        })()`,
      });
      const w = whyMetrics.result.value;
      await sleep(200);
      const close = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: w.y,
          width,
          height: w.height,
          scale: 1,
        },
      });
      const closePath = path.join(outDir, "about-why-desktop-1440.png");
      fs.writeFileSync(closePath, Buffer.from(close.data, "base64"));
      console.log("wrote", closePath, fs.statSync(closePath).size);
    });
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
