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
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = path.join(root, rel.replace(/^\//, "").replace(/\//g, path.sep));
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
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function waitJson(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
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

async function capture({ baseUrl, width, height, outName, mobile }) {
  const port = 9800 + Math.floor(Math.random() * 80);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-loc3-${width}-${Date.now()}`
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
    await cdp.send("Page.navigate", { url: baseUrl });
    await sleep(2500);

    await cdp.send("Runtime.evaluate", {
      expression: `document.documentElement.style.scrollBehavior = 'auto';`,
    });

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const section = document.querySelector('.home-location');
        if (section) section.scrollIntoView({ block: 'center' });
      })()`,
    });
    await sleep(6500);

    const metrics = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('.home-location');
        const h2 = document.getElementById('location-title');
        if (!section || !h2) return { ok: false };
        const rect = section.getBoundingClientRect();
        const y = Math.max(0, rect.top + window.pageYOffset);
        return {
          ok: true,
          x: 0,
          y: Math.round(y),
          width: Math.round(window.innerWidth),
          height: Math.round(rect.height),
          sectionHeight: Math.round(rect.height),
          title: h2.innerText.replace(/\\s+/g, ' ').trim()
        };
      })()`,
    });

    const info = metrics.result.value;
    console.log(outName, info);
    if (!info.ok) throw new Error("section not found for " + outName);

    // Expand page height enough for full-page clip coordinates
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: Math.max(height, info.y + info.height + 80),
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await sleep(400);

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: info.x,
        y: info.y,
        width: info.width,
        height: info.height,
        scale: 1,
      },
    });

    const outFile = path.join(outDir, outName);
    fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
    console.log("wrote", outFile, fs.statSync(outFile).size, "h=", info.sectionHeight);
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
  console.log("serving", baseUrl);
  try {
    await capture({
      baseUrl,
      width: 1440,
      height: 1100,
      outName: "location-compact-desktop-1440.png",
      mobile: false,
    });
    await capture({
      baseUrl,
      width: 390,
      height: 1400,
      outName: "location-compact-mobile-390.png",
      mobile: true,
    });
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
