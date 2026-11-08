import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = "/opt/cursor/artifacts";
const port = 9344;

function contentType(file) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json"
  };
  return types[path.extname(file)] || "application/octet-stream";
}

function startServer() {
  const requests = [];
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push({ method: req.method, path: url.pathname });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    rel = rel.replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(data);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, requests: requests, port: server.address().port });
    });
  });
}

function waitForJson(url) {
  return new Promise(function (resolve, reject) {
    let tries = 0;
    const tick = function () {
      fetch(url).then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      }).then(resolve).catch(function (err) {
        tries += 1;
        if (tries > 50) reject(err);
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    this.opened = new Promise(function (resolve, reject) {
      if (ws.readyState === WebSocket.OPEN) resolve();
      else {
        ws.addEventListener("open", function () { resolve(); });
        ws.addEventListener("error", function (event) { reject(event.error || new Error("websocket error")); });
      }
    });
    this.ws.addEventListener("message", function (event) {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }.bind(this));
  }

  async send(method, params) {
    await this.opened;
    const id = ++this.next;
    const ws = this.ws;
    return new Promise(function (resolve, reject) {
      this.pending.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    }.bind(this));
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression: expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  async shot(file) {
    const image = await this.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(image.data, "base64"));
  }
}

test("site review page layout, validation, and mailto behavior", { timeout: 120000 }, async function () {
  const started = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "site-review-chrome-"));
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "about:blank"
  ], { detached: true, stdio: "ignore" });

  let page;
  try {
    await waitForJson("http://127.0.0.1:" + port + "/json/version");
    const created = await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" });
    const target = await created.json();
    page = new Cdp(new WebSocket(target.webSocketDebuggerUrl));
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.send("Page.navigate", { url: "http://127.0.0.1:" + started.port + "/site-review.html" });
    await page.evaluate("document.fonts ? document.fonts.ready : true");
    await page.evaluate("new Promise(function (resolve) { if (document.readyState === 'complete') resolve(true); else window.addEventListener('load', function () { resolve(true); }); })");

    const audit = await page.evaluate(`(function () {
      const unlabeled = [];
      document.querySelectorAll("input, select, textarea").forEach(function (el) {
        const labeled = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
        if (!labeled) unlabeled.push(el.id || el.name || el.type);
      });
      const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(function (el) { return el.tagName + " " + el.textContent.trim().slice(0, 80); });
      const bodyStyle = getComputedStyle(document.body);
      const h1Style = getComputedStyle(document.querySelector("h1"));
      const hintStyle = getComputedStyle(document.querySelector(".hint"));
      const button = document.querySelector("#open-mail");
      const buttonStyle = getComputedStyle(button);
      function rgb(value) {
        const match = value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      }
      function lum(channels) {
        const parts = channels.map(function (channel) {
          const v = channel / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
      }
      function contrast(a, b) {
        const left = lum(rgb(a));
        const right = lum(rgb(b));
        const hi = Math.max(left, right);
        const lo = Math.min(left, right);
        return (hi + 0.05) / (lo + 0.05);
      }
      return {
        title: document.title,
        h1: document.querySelectorAll("h1").length,
        unlabeled: unlabeled,
        headings: headings,
        freeText: document.querySelector(".callout h2").textContent,
        freeSize: getComputedStyle(document.querySelector(".callout h2")).fontSize,
        password: document.querySelectorAll('input[type="password"], input[type="file"]').length,
        destination: document.getElementById("intake-destination").textContent,
        button: button.textContent,
        help: document.getElementById("open-help").textContent,
        contrastH1: contrast(h1Style.color, bodyStyle.backgroundColor),
        contrastHint: contrast(hintStyle.color, bodyStyle.backgroundColor),
        contrastButton: contrast(buttonStyle.color, buttonStyle.backgroundColor),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        api: typeof window.ATBSiteReview
      };
    })()`);

    assert.equal(audit.h1, 1);
    assert.equal(audit.title, "Website security reviews | Around The Block LLC");
    assert.deepEqual(audit.unlabeled, []);
    assert.equal(audit.password, 0);
    assert.equal(audit.destination, "contact@aroundtheblock.us");
    assert.equal(audit.button, "Open in my email app");
    assert.match(audit.help, /does not send the email/);
    assert.equal(audit.freeText, "Free for DigiByte builders.");
    assert.ok(parseFloat(audit.freeSize) >= 26, audit.freeSize);
    assert.ok(audit.contrastH1 >= 4.5, String(audit.contrastH1));
    assert.ok(audit.contrastHint >= 4.5, String(audit.contrastHint));
    assert.ok(audit.contrastButton >= 4.5, String(audit.contrastButton));
    assert.ok(audit.overflow <= 1, String(audit.overflow));
    assert.equal(audit.api, "object");
    assert.ok(audit.headings[0].startsWith("H1 "));
    await page.shot(path.join(artifacts, "screenshot_site_review_desktop.png"));

    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    const mobile = await page.evaluate(`(function () {
      const wide = [];
      document.querySelectorAll("input, select, textarea, button, h1, p").forEach(function (el) {
        const box = el.getBoundingClientRect();
        if (box.width > 390 + 1) wide.push((el.id || el.tagName) + ":" + Math.round(box.width));
      });
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wide: wide
      };
    })()`);
    assert.ok(mobile.overflow <= 1, JSON.stringify(mobile));
    assert.deepEqual(mobile.wide, []);
    await page.evaluate("window.scrollTo(0, 0)");
    await page.shot(path.join(artifacts, "screenshot_site_review_mobile.png"));
    await page.evaluate("document.getElementById('open-mail').scrollIntoView({block:'center'})");
    await page.shot(path.join(artifacts, "screenshot_site_review_mobile_form.png"));

    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    const invalid = await page.evaluate(`(function () {
      window.__mailto = "";
      window.ATB_ON_MAILTO = function (href) { window.__mailto = href; };
      document.getElementById("open-mail").click();
      const errors = document.getElementById("form-errors");
      return {
        hidden: errors.hidden,
        text: errors.textContent,
        draftHidden: document.getElementById("draft").hidden,
        mailto: window.__mailto,
        status: document.getElementById("form-status").textContent,
        focused: document.activeElement && document.activeElement.id
      };
    })()`);
    assert.equal(invalid.hidden, false);
    assert.match(invalid.text, /Enter the site URL/);
    assert.match(invalid.text, /Enter your name/);
    assert.match(invalid.text, /not authorization to test/);
    assert.equal(invalid.draftHidden, true);
    assert.equal(invalid.mailto, "");
    assert.equal(invalid.status, "");
    assert.equal(invalid.focused, "form-errors");
    assert.doesNotMatch(invalid.text, /thank you|has been sent|received your/i);
    await page.evaluate("document.getElementById('form-errors').scrollIntoView({block:'center'})");
    await page.shot(path.join(artifacts, "screenshot_site_review_validation.png"));

    const conditional = await page.evaluate(`(function () {
      const role = document.getElementById("role");
      role.value = "authorized";
      role.dispatchEvent(new Event("change", { bubbles: true }));
      const yes = document.querySelector('input[name="digibyte-builder"][value="yes"]');
      yes.checked = true;
      yes.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        ownerHidden: document.getElementById("owner-fields").hidden,
        ownerDisabled: document.getElementById("owner-name").disabled,
        linkHidden: document.getElementById("builder-link").hidden,
        linkDisabled: document.getElementById("project-link").disabled
      };
    })()`);
    assert.equal(conditional.ownerHidden, false);
    assert.equal(conditional.ownerDisabled, false);
    assert.equal(conditional.linkHidden, false);
    assert.equal(conditional.linkDisabled, false);

    const prepared = await page.evaluate(`(function () {
      window.__mailto = "";
      document.getElementById("site-url").value = "https://example.com/path?q=1&x=2";
      document.getElementById("other-hosts").value = "www.example.com";
      document.getElementById("requester-name").value = "Ann\\nBcc: evil@example.com";
      document.getElementById("contact-email").value = "ada@example.com";
      document.getElementById("project-name").value = "North & Bridge";
      document.getElementById("owner-name").value = "Grace Hopper";
      document.getElementById("owner-contact").value = "grace@example.com";
      document.getElementById("project-link").value = "https://github.com/example/digibyte-project";
      document.getElementById("exclusions").value = "Do not test the admin area or payment flows.";
      document.getElementById("confirm-authority").checked = true;
      document.getElementById("open-mail").click();
      return {
        status: document.getElementById("form-status").textContent,
        href: window.__mailto,
        draft: document.getElementById("draft-text").value,
        to: document.getElementById("draft-to").textContent,
        draftHidden: document.getElementById("draft").hidden,
        location: location.href
      };
    })()`);
    assert.equal(prepared.draftHidden, false);
    assert.equal(prepared.to, "contact@aroundtheblock.us");
    assert.match(prepared.status, /email app should open/);
    assert.match(prepared.status, /It has not been sent\./);
    assert.doesNotMatch(prepared.status, /thank you|has been sent|we received/i);
    assert.match(prepared.href, /^mailto:contact@aroundtheblock\.us\?/);
    assert.equal(prepared.location.indexOf("mailto:"), -1);
    const parsed = new URL(prepared.href);
    assert.equal(parsed.protocol, "mailto:");
    assert.equal(parsed.pathname, "contact@aroundtheblock.us");
    assert.deepEqual(Array.from(parsed.searchParams.keys()), ["subject", "body"]);
    assert.match(parsed.searchParams.get("body"), /Bcc: evil@example.com/);
    assert.match(parsed.searchParams.get("body"), /not permission to test/);
    assert.doesNotMatch(prepared.href, /[?&]bcc=/i);
    await page.evaluate("document.getElementById('draft').scrollIntoView({block:'center'})");
    await page.shot(path.join(artifacts, "screenshot_site_review_draft.png"));

    const fallback = await page.evaluate(`(function () {
      document.getElementById("copy-draft").click();
      return document.getElementById("form-status").textContent;
    })()`);
    assert.match(fallback, /It has not been sent\./);
    assert.doesNotMatch(fallback, /has been sent|thank you/i);

    const spam = await page.evaluate(`(function () {
      window.__mailto = "";
      document.getElementById("atb-leave-blank").value = "https://spam.example";
      document.getElementById("open-mail").click();
      return {
        mailto: window.__mailto,
        text: document.getElementById("form-errors").textContent,
        draftHidden: document.getElementById("draft").hidden
      };
    })()`);
    assert.equal(spam.mailto, "");
    assert.equal(spam.draftHidden, true);
    assert.match(spam.text, /The draft was not prepared/);
    assert.doesNotMatch(spam.text, /https:\/\/spam\.example/);

    const posts = started.requests.filter(function (item) { return item.method !== "GET" && item.method !== "HEAD"; });
    assert.deepEqual(posts, []);
    await page.send("Page.navigate", { url: "http://127.0.0.1:" + started.port + "/site-review/" });
    let nested = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        nested = await page.evaluate(`(function () {
          const script = document.querySelector('script[src*="site-review-intake"]');
          return {
            api: typeof window.ATBSiteReview,
            destination: document.getElementById("intake-destination") && document.getElementById("intake-destination").textContent,
            script: script ? script.getAttribute("src") : ""
          };
        })()`);
      } catch (err) {
        nested = null;
      }
      if (nested && nested.script === "../assets/site-review-intake.js" && nested.api === "object") break;
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    assert.equal(nested && nested.api, "object");
    assert.equal(nested && nested.destination, "contact@aroundtheblock.us");
    assert.equal(nested && nested.script, "../assets/site-review-intake.js");

    ["screenshot_site_review_desktop.png", "screenshot_site_review_mobile.png", "screenshot_site_review_mobile_form.png", "screenshot_site_review_validation.png", "screenshot_site_review_draft.png"].forEach(function (name) {
      const file = path.join(artifacts, name);
      const stat = fs.statSync(file);
      assert.ok(stat.size > 1000, name);
    });
  } finally {
    try { if (page && page.ws) page.ws.close(); } catch (err) { /* already closed */ }
    try { process.kill(-chrome.pid, "SIGKILL"); } catch (err) { try { chrome.kill("SIGKILL"); } catch (e) { /* already gone */ } }
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    started.server.close();
    started.server.unref();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
