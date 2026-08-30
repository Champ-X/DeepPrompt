#!/usr/bin/env node
/** Browser smoke test with Chrome DevTools Protocol and no npm dependencies. */

import { spawn } from "node:child_process";
import { readFile, readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.DEEPPROMPT_CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const requestedUrl = process.argv[2];
const annotationAudit = JSON.parse(
  readFileSync(join(root, "data", "annotation-audit.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(join(root, "data", "manifest.json"), "utf8"),
);
const expectedAnnotations = annotationAudit.expectedAnnotationCount;
const expectedAgents = manifest.agents.length;
const maxVisualGapPixels = 4000;
const profile = mkdtempSync(join(tmpdir(), "deepprompt-browser-qa-"));
let localServer;
const agentIds = manifest.agents.map(agent => agent.id);

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

function browserSocketUrl() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error("Chrome CDP startup timed out")), 10000);
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", chunk => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("exit", code => reject(new Error(`Chrome exited early (${code})`)));
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveArchive() {
  localServer = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const filePath = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    readFile(filePath, (error, payload) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
      response.end(payload);
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    localServer.once("error", rejectListen);
    localServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = localServer.address();
  return `http://127.0.0.1:${address.port}/#agent=claude-code`;
}

async function main() {
  const targetUrl = requestedUrl || await serveArchive();
  const socket = new WebSocket(await browserSocketUrl());
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let requestId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const waitForExpression = async (expression, timeoutMs = 6000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const evaluation = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
      }, sessionId);
      if (evaluation.result.value) return evaluation.result.value;
      await delay(50);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const waitForAgent = agentId => waitForExpression(
    `document.querySelector('.agentview.active')?.dataset.agent === ${JSON.stringify(agentId)}`,
  );

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const viewports = [
    { name: "wide", width: 1920, height: 1080, mobile: false },
    { name: "desktop", width: 1440, height: 900, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ];
  const results = [];
  const homeResults = [];
  const visualCoverage = [];

  for (const viewport of viewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    }, sessionId);
    await send("Page.navigate", { url: targetUrl }, sessionId);
    await waitForAgent("claude-code");
    await delay(200);
    const evaluation = await send("Runtime.evaluate", {
      expression: `(() => ({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        annotations: Number(document.getElementById('s-ann')?.textContent || 0),
        activeAgent: document.querySelector('.agentview.active')?.dataset.agent || null,
        bodyAgent: document.body.dataset.agent || null,
        highlights: document.querySelectorAll('.agentview.active .hl').length,
        notes: document.querySelectorAll('.agentview.active .note').length,
        inlineNotes: document.querySelectorAll('.agentview.active .mobnote').length,
        philosophyCards: document.querySelectorAll('.mh-philosophy[data-philosophy-agent]').length,
        activePhilosophyCards: document.querySelectorAll('.agentview.active .mh-philosophy').length,
        philosophyAxes: document.querySelectorAll('.axiscard').length,
        mode: document.body.classList.contains('mode-reader') ? 'reader' : 'home',
        wheelVisible: getComputedStyle(document.getElementById('agentWheel')).display !== 'none',
        wheel: (() => {
          const wheel = document.getElementById('agentWheel');
          const rect = wheel.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visibleItems: Array.from(wheel.querySelectorAll('.navbtn')).filter(node => !node.classList.contains('wheel-hidden')).length,
            tabStops: Array.from(wheel.querySelectorAll('.navbtn')).filter(node => node.tabIndex === 0).length,
            uniqueNodeColors: new Set(Array.from(wheel.querySelectorAll('.navbtn')).map(node => getComputedStyle(node).getPropertyValue('--node-color').trim()).filter(Boolean)).size,
            visibleLabels: Array.from(wheel.querySelectorAll('.nb-name,.nb-sub,.nb-badge')).filter(node => getComputedStyle(node).display !== 'none').length,
            instructionNodes: wheel.querySelectorAll('.wheel-heading,.wheel-hint,.wheel-index,.wheel-control').length
          };
        })(),
        topbar: (() => {
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const tools = document.querySelector('.top-tools').getBoundingClientRect();
          const targets = Array.from(document.querySelectorAll('.topbar button,.topbar a,.topbar .searchbox')).filter(node => getComputedStyle(node).display !== 'none');
          return {
            height: Math.round(bar.height),
            right: Math.round(tools.right),
            minTargetHeight: Math.round(Math.min(...targets.map(node => node.getBoundingClientRect().height)))
          };
        })(),
        sideGeometry: (() => {
          if (innerWidth < 1280) return null;
          const view = document.querySelector('.agentview.active');
          const prose = view?.querySelector('.prose-col')?.getBoundingClientRect();
          const left = view?.querySelector('.margin.left')?.getBoundingClientRect();
          const right = view?.querySelector('.margin.right')?.getBoundingClientRect();
          if (!prose || !left || !right) return null;
          const leftGap = prose.left - left.right;
          const rightGap = right.left - prose.right;
          return {
            leftGap: Math.round(leftGap),
            rightGap: Math.round(rightGap),
            overlaps: Number(leftGap < 0) + Number(rightGap < 0)
          };
        })(),
        homeSynthesisVisible: getComputedStyle(document.querySelector('.philosophy-atlas')).display !== 'none',
        collapsedBadges: document.querySelectorAll('.rawblob:not([open]) .summary-note-count').length,
        collapsedAnnotations: document.querySelectorAll('.note.anchor-collapsed').length,
        screenshotOneResolved: (() => {
          const details = document.querySelector('.agentview.active .rawblob:not([open]):has(.hl[data-note])');
          const anchor = details?.querySelector('.hl[data-note]');
          const note = anchor && document.querySelector('.agentview.active .note[data-note="' + anchor.dataset.note + '"]');
          return Boolean(note?.classList.contains('anchor-collapsed') && details.querySelector('.summary-note-count'));
        })(),
        collapsedMarginOrphans: Array.from(document.querySelectorAll('.agentview.active .note:not(.anchor-collapsed):not(.hide)')).filter(note => {
          const anchor = document.querySelector('.agentview.active .hl[data-note="' + note.dataset.note + '"]');
          return note.offsetParent && (!anchor || !anchor.getClientRects().length);
        }).length,
        philosophyEvidenceNotes: Array.from(document.querySelectorAll('.note p')).filter(
          node => node.textContent.includes('哲学层（推断）')
        ).length,
        loadedAgents: window.__archiveDiagnostics?.loadedAgents().length || 0
      }))()`,
      returnByValue: true,
    }, sessionId);
    const metrics = evaluation.result.value;
    if (viewport.name === "wide") {
      const centerOf = async selector => (await send("Runtime.evaluate", {
        expression: `(() => { const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? {x:r.left+r.width/2,y:r.top+r.height/2} : null; })()`,
        returnByValue: true,
      }, sessionId)).result.value;
      const clickAt = async point => {
        await send("Input.dispatchMouseEvent", {type:"mousePressed",x:point.x,y:point.y,button:"left",buttons:1,clickCount:1}, sessionId);
        await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:point.x,y:point.y,button:"left",buttons:0,clickCount:1}, sessionId);
        await delay(320);
      };
      const activeAgent = async () => (await send("Runtime.evaluate", {
        expression: "document.querySelector('.agentview.active')?.dataset.agent || null",
        returnByValue: true,
      }, sessionId)).result.value;

      await clickAt(await centerOf('.navbtn[data-target="antigravity"]'));
      await waitForAgent("antigravity");
      const clickedTo = await activeAgent();
      await send("Runtime.evaluate", {expression:"document.querySelector('.navbtn[data-target=\"claude-code\"]')?.click()"}, sessionId);
      await waitForAgent("claude-code");
      const resetTo = await activeAgent();

      const dragGeometry = (await send("Runtime.evaluate", {
        expression: `(() => {
          const active=document.querySelector('.navbtn.active').getBoundingClientRect();
          const start={x:active.left+active.width/2,y:active.top+active.height/2};
          return {start,end:{x:start.x,y:start.y-50}};
        })()`,
        returnByValue: true,
      }, sessionId)).result.value;
      await send("Input.dispatchMouseEvent", {type:"mousePressed",x:dragGeometry.start.x,y:dragGeometry.start.y,button:"left",buttons:1,clickCount:1}, sessionId);
      await send("Input.dispatchMouseEvent", {type:"mouseMoved",x:(dragGeometry.start.x+dragGeometry.end.x)/2,y:(dragGeometry.start.y+dragGeometry.end.y)/2,button:"left",buttons:1}, sessionId);
      await send("Input.dispatchMouseEvent", {type:"mouseMoved",x:dragGeometry.end.x,y:dragGeometry.end.y,button:"left",buttons:1}, sessionId);
      await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:dragGeometry.end.x,y:dragGeometry.end.y,button:"left",buttons:0,clickCount:1}, sessionId);
      await waitForAgent("antigravity");
      const draggedTo = await activeAgent();

      await send("Runtime.evaluate", {expression:"document.querySelector('.navbtn.active')?.focus({preventScroll:true})"}, sessionId);
      await send("Input.dispatchKeyEvent", {type:"rawKeyDown",key:"ArrowLeft",code:"ArrowLeft"}, sessionId);
      await send("Input.dispatchKeyEvent", {type:"keyUp",key:"ArrowLeft",code:"ArrowLeft"}, sessionId);
      await waitForAgent("claude-code");
      const keyboardReturnedTo = await activeAgent();
      const interactionState = (await send("Runtime.evaluate", {
        expression: `({draggingClassCleared:!document.getElementById('agentWheel').classList.contains('dragging')})`,
        returnByValue: true,
      }, sessionId)).result.value;
      metrics.wheelInteraction = {clickedTo,resetTo,draggedTo,keyboardReturnedTo,...interactionState};
      await send("Runtime.evaluate", {expression:"window.scrollTo(0,0)"}, sessionId);
      await delay(120);
    }
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, sessionId);
    writeFileSync(`/tmp/deepprompt-${viewport.name}.png`, screenshot.data, "base64");
    if (viewport.name === "wide") {
      for (const agentId of agentIds) {
        await send("Runtime.evaluate", {
          expression: `document.querySelector('.navbtn[data-target="${agentId}"]')?.click()`,
        }, sessionId);
        await waitForAgent(agentId);
        const coverageEvaluation = await send("Runtime.evaluate", {
          expression: `(() => {
            const view = document.getElementById('view-${agentId}');
            const prose = view?.querySelector('.prose-col');
            if (!prose) return null;
            const proseTop = prose.getBoundingClientRect().top;
            const marks = Array.from(view.querySelectorAll('.hl')).map(node => {
              const rect = node.getBoundingClientRect();
              return { id: node.dataset.note, y: rect.top - proseTop + rect.height / 2, visible: rect.height > 0 };
            }).filter(mark => mark.visible).sort((a, b) => a.y - b.y);
            const points = [{id: 'START', y: 0}, ...marks, {id: 'END', y: prose.scrollHeight}];
            let largest = {pixels: 0, from: null, to: null};
            for (let index = 1; index < points.length; index += 1) {
              const pixels = Math.round(points[index].y - points[index - 1].y);
              if (pixels > largest.pixels) largest = {pixels, from: points[index - 1].id, to: points[index].id};
            }
            return {
              agent: '${agentId}',
              proseHeight: Math.round(prose.scrollHeight),
              visibleHighlights: marks.length,
              philosophyCards: view.querySelectorAll('.mh-philosophy').length,
              philosophyEvidenceNotes: Array.from(view.querySelectorAll('.note p')).filter(node => node.textContent.includes('哲学层（推断）')).length,
              ...largest
            };
          })()`,
          returnByValue: true,
        }, sessionId);
        visualCoverage.push(coverageEvaluation.result.value);
      }
      await send("Runtime.evaluate", {
        expression: "document.querySelector('.navbtn[data-target=\"claude-code\"]')?.click()",
      }, sessionId);
      await waitForAgent("claude-code");
      metrics.lazyLoadCoverage = (await send("Runtime.evaluate", {
        expression: "window.__archiveDiagnostics?.loadedAgents().length || 0",
        returnByValue: true,
      }, sessionId)).result.value;
      writeFileSync(
        "/tmp/deepprompt-visual-coverage.json",
        JSON.stringify(visualCoverage, null, 2),
      );
    }
    await send("Runtime.evaluate", {
      expression: `(() => {
        const card = document.querySelector('.agentview.active .mh-philosophy');
        if (card) window.scrollTo(0, card.getBoundingClientRect().top + scrollY - 280);
      })()`,
    }, sessionId);
    await delay(500);
    const philosophyScreenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, sessionId);
    writeFileSync(
      `/tmp/deepprompt-philosophy-${viewport.name}.png`,
      philosophyScreenshot.data,
      "base64",
    );
    results.push({ ...viewport, ...metrics });

    if (viewport.name === "wide") {
      const connectorEvaluation = await send("Runtime.evaluate", {
        expression: `(() => {
          const anchor = Array.from(document.querySelectorAll('.agentview.active .hl')).find(node => node.getClientRects().length);
          anchor?.click();
          return anchor?.dataset.note || null;
        })()`,
        returnByValue: true,
      }, sessionId);
      await delay(500);
      const connectorState = await send("Runtime.evaluate", {
        expression: `(() => ({
          note: ${JSON.stringify(connectorEvaluation.result.value)},
          visible: Boolean(document.querySelector('.agentview.active .annotation-links.visible path')?.getAttribute('d'))
        }))()`,
        returnByValue: true,
      }, sessionId);
      results[results.length - 1].connector = connectorState.result.value;
      const connectorScreenshot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      }, sessionId);
      writeFileSync("/tmp/deepprompt-connector-wide.png", connectorScreenshot.data, "base64");
      await send("Runtime.evaluate", {
        expression: `document.querySelector('.navbtn[data-target="codex"]')?.click()`,
      }, sessionId);
      await waitForAgent("codex");
      await send("Runtime.evaluate", {
        expression: `document.querySelector('.hl[data-note="codex-53"]')?.closest('.rawblob')?.querySelector('summary')?.scrollIntoView({ block: 'center' })`,
      }, sessionId);
      await delay(300);
      const collapsedState = await send("Runtime.evaluate", {
        expression: `(() => {
          const anchor=document.querySelector('.hl[data-note="codex-53"]');
          const note=document.querySelector('.note[data-note="codex-53"]');
          const details=anchor?.closest('.rawblob');
          return Boolean(note?.classList.contains('anchor-collapsed') && details && !details.open && details.querySelector('.summary-note-count'));
        })()`,
        returnByValue: true,
      }, sessionId);
      results[results.length - 1].collapsedDisclosure = collapsedState.result.value;
      const collapsedScreenshot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      }, sessionId);
      writeFileSync("/tmp/deepprompt-collapsed-wide.png", collapsedScreenshot.data, "base64");
    }

    const homeUrl = targetUrl.replace(/#.*$/, "");
    await send("Page.navigate", { url: homeUrl }, sessionId);
    await waitForExpression("document.body?.classList.contains('mode-home')");
    const homeEvaluation = await send("Runtime.evaluate", {
      expression: `(() => ({
        mode: document.body.classList.contains('mode-home') ? 'home' : 'reader',
        activeAgent: document.querySelector('.agentview.active')?.dataset.agent || null,
        cards: document.querySelectorAll('.acard').length,
        spectrumLinks: document.querySelectorAll('.spectrum-link').length,
        uniqueSpectrumColors: new Set(Array.from(document.querySelectorAll('.spectrum-link')).map(node => getComputedStyle(node).getPropertyValue('--node-color').trim()).filter(Boolean)).size,
        wheelVisible: getComputedStyle(document.getElementById('agentWheel')).display !== 'none',
        readerVisible: getComputedStyle(document.getElementById('main')).display !== 'none',
        philosophyVisible: getComputedStyle(document.querySelector('.philosophy-atlas')).display !== 'none',
        synthesisVisible: getComputedStyle(document.querySelector('.synth')).display !== 'none',
        loadedAgents: window.__archiveDiagnostics?.loadedAgents().length || 0,
        brand: (() => {
          const button = document.getElementById('homeButton');
          const title = button?.querySelector('.brand-title');
          return {
            buttonWidth: Math.round(button?.getBoundingClientRect().width || 0),
            titleWidth: Math.round(title?.getBoundingClientRect().width || 0),
            after: title ? getComputedStyle(title, '::after').content : null
          };
        })()
      }))()`,
      returnByValue: true,
    }, sessionId);
    homeResults.push({ ...viewport, ...homeEvaluation.result.value });
    const homeScreenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, sessionId);
    writeFileSync(`/tmp/deepprompt-home-${viewport.name}.png`, homeScreenshot.data, "base64");
  }

  console.log(JSON.stringify(results, null, 2));
  console.log("Homepage states:");
  console.log(JSON.stringify(homeResults, null, 2));
  if (visualCoverage.length) {
    console.log("Visual annotation gaps:");
    console.log(JSON.stringify(visualCoverage, null, 2));
  }
  const failures = results.filter(result =>
    result.scrollWidth > result.innerWidth ||
    result.bodyScrollWidth > result.innerWidth ||
    result.annotations !== expectedAnnotations ||
    result.mode !== "reader" ||
    !result.wheelVisible ||
    result.wheel.visibleLabels !== 0 ||
    result.wheel.instructionNodes !== 0 ||
    result.wheel.tabStops !== 1 ||
    result.wheel.uniqueNodeColors !== expectedAgents ||
    result.topbar.right > result.innerWidth ||
    result.topbar.minTargetHeight < 42 ||
    (result.width >= 1280 && (!result.sideGeometry || result.sideGeometry.overlaps !== 0 || result.sideGeometry.leftGap < 16 || result.sideGeometry.rightGap < 16)) ||
    (result.name === "wide" && (result.wheelInteraction?.clickedTo !== "antigravity" || result.wheelInteraction?.resetTo !== "claude-code" || result.wheelInteraction?.draggedTo !== "antigravity" || result.wheelInteraction?.keyboardReturnedTo !== "claude-code" || !result.wheelInteraction?.draggingClassCleared)) ||
    (result.width >= 1280 && (result.wheel.width < 108 || result.wheel.width > 116 || result.wheel.height < 280 || result.wheel.height > 330 || result.wheel.left !== 0 || result.wheel.top > 180 || result.wheel.visibleItems !== 5)) ||
    (result.width < 1280 && result.wheel.visibleItems !== 3) ||
    result.homeSynthesisVisible ||
    result.collapsedMarginOrphans !== 0 ||
    result.activeAgent !== "claude-code" ||
    result.bodyAgent !== result.activeAgent ||
    result.highlights === 0 ||
    result.highlights !== result.notes ||
    result.philosophyCards !== 1 ||
    result.activePhilosophyCards !== 1 ||
    result.philosophyAxes !== 7 ||
    result.philosophyEvidenceNotes !== 2 ||
    result.loadedAgents !== 1 ||
    (result.name === "wide" && result.lazyLoadCoverage !== expectedAgents) ||
    (result.width < 1280 && result.inlineNotes !== result.notes) ||
    (result.width >= 1280 && result.inlineNotes !== 0)
  );
  if (!results.find(result => result.name === "wide")?.connector?.visible) failures.push({ connector: "missing" });
  if (!results.find(result => result.name === "wide")?.collapsedDisclosure) failures.push({ collapsedDisclosure: "missing" });
  const homeFailures = homeResults.filter(result =>
    result.mode !== "home" ||
    result.activeAgent !== null ||
    result.cards !== expectedAgents ||
    result.spectrumLinks !== expectedAgents ||
    result.uniqueSpectrumColors !== expectedAgents ||
    result.wheelVisible ||
    result.readerVisible ||
    result.loadedAgents !== 0 ||
    !result.philosophyVisible ||
    !result.synthesisVisible
  );
  const visualFailures = visualCoverage.filter(result =>
    !result || result.pixels > maxVisualGapPixels ||
    result.philosophyCards !== 1 || result.philosophyEvidenceNotes !== 2
  );
  if (failures.length || homeFailures.length || visualFailures.length) process.exitCode = 1;
  socket.close();
}

try {
  await main();
} finally {
  const waitForChromeExit = timeoutMs => {
    if (chrome.exitCode !== null) return Promise.resolve(true);
    return new Promise(resolveExit => {
      const onExit = () => { clearTimeout(timer); resolveExit(true); };
      const timer = setTimeout(() => { chrome.off("exit", onExit); resolveExit(false); }, timeoutMs);
      chrome.once("exit", onExit);
    });
  };
  if (chrome.exitCode === null) chrome.kill("SIGTERM");
  if (!await waitForChromeExit(3000)) {
    chrome.kill("SIGKILL");
    await waitForChromeExit(2000);
  }
  if (localServer) {
    localServer.closeAllConnections?.();
    await new Promise(resolveClose => localServer.close(resolveClose));
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4 || !["ENOTEMPTY", "EBUSY"].includes(error.code)) throw error;
      await delay(200 * (attempt + 1));
    }
  }
}
