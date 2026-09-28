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
      const rel = urlPath === "/" ? "/index.html" : urlPath;
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

async function captureWhy({ baseUrl, width, height, outName, mobile, hover, focus }) {
  const port = 9300 + Math.floor(Math.random() * 200);
  const userData = path.join(
    require("os").tmpdir(),
    `ryoko-why-${width}-${hover ? "hover" : "rest"}-${Date.now()}`
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
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}index.html` });
    await sleep(2800);

    const metrics = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('.home-why');
        if (!section) return null;
        section.scrollIntoView({ block: 'start' });
        const rect = section.getBoundingClientRect();
        const cards = Array.from(section.querySelectorAll('.home-why__card'));
        const nums = cards.map((c) => {
          const n = c.querySelector('.home-why__number');
          const cs = getComputedStyle(n);
          return {
            text: n.textContent.trim(),
            opacity: cs.opacity,
            transform: cs.transform,
          };
        });
        return {
          y: Math.max(0, Math.round(window.pageYOffset + rect.top)),
          height: Math.round(rect.height),
          overflow: document.documentElement.scrollWidth > ${width} + 1,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          cardCount: cards.length,
          nums,
        };
      })()`,
    });

    const info = metrics.result.value;
    console.log(outName, "pre", JSON.stringify(info, null, 2));
    if (!info) throw new Error("why section missing");

    if (hover) {
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('.home-why__card');
          if (!card) return;
          card.classList.add('is-shot-hover');
          const style = document.createElement('style');
          style.textContent = \`
            .home-why__card.is-shot-hover {
              background: #fffdf9 !important;
              transform: translateY(-6px) !important;
              box-shadow: 0 24px 55px rgba(16, 32, 51, 0.12) !important;
              z-index: 1 !important;
            }
            .home-why__card.is-shot-hover::after {
              opacity: 1 !important;
              transform: scaleX(1) !important;
            }
            .home-why__card.is-shot-hover .home-why__number {
              opacity: 1 !important;
              transform: translateX(0) !important;
            }
            .home-why__card.is-shot-hover .home-why__icon-wrap {
              background: #cd7e49 !important;
              color: #ffffff !important;
              transform: rotate(-6deg) !important;
            }
          \`;
          document.head.appendChild(style);
        })()`,
      });
      await sleep(450);
    } else if (focus) {
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelectorAll('.home-why__card')[1];
          if (card) card.focus();
        })()`,
      });
      await sleep(400);
    }

    const after = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('.home-why');
        const rect = section.getBoundingClientRect();
        const cards = Array.from(section.querySelectorAll('.home-why__card'));
        const nums = cards.map((c) => {
          const n = c.querySelector('.home-why__number');
          const cs = getComputedStyle(n);
          return {
            text: n.textContent.trim(),
            opacity: cs.opacity,
            transform: cs.transform,
          };
        });
        return {
          y: Math.max(0, Math.round(window.pageYOffset + rect.top)),
          height: Math.round(rect.height),
          overflow: document.documentElement.scrollWidth > ${width} + 1,
          scrollWidth: document.documentElement.scrollWidth,
          nums,
        };
      })()`,
    });
    const shotInfo = after.result.value;
    console.log(outName, "post", JSON.stringify(shotInfo, null, 2));

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: Math.max(height, shotInfo.y + shotInfo.height + 40),
      deviceScaleFactor: 1,
      mobile: !!mobile,
    });
    await sleep(250);

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: shotInfo.y,
        width,
        height: shotInfo.height,
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
    await captureWhy({
      baseUrl,
      width: 1440,
      height: 1100,
      outName: "why-choose-desktop-1440-before.png",
      mobile: false,
      hover: false,
      focus: false,
    });
    await captureWhy({
      baseUrl,
      width: 1440,
      height: 1100,
      outName: "why-choose-desktop-1440-hover.png",
      mobile: false,
      hover: true,
      focus: false,
    });
    await captureWhy({
      baseUrl,
      width: 390,
      height: 1100,
      outName: "why-choose-mobile-390-before.png",
      mobile: true,
      hover: false,
      focus: false,
    });
    await captureWhy({
      baseUrl,
      width: 390,
      height: 1100,
      outName: "why-choose-mobile-390-focus.png",
      mobile: true,
      hover: false,
      focus: true,
    });
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
