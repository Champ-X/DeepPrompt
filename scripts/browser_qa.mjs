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
const annotations = JSON.parse(readFileSync(join(root, "data", "annotations.json"), "utf8")).annotations;
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
  const runtimeErrors = [];
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      runtimeErrors.push(message.params.args.map(arg => arg.value || arg.description).join(" "));
    }
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

  const evaluate = async expression => {
    const evaluation = await send("Runtime.evaluate", {expression,returnByValue:true}, sessionId);
    if (evaluation.exceptionDetails) throw new Error(evaluation.result.description || evaluation.exceptionDetails.text);
    return evaluation.result.value;
  };
  const centerOf = selector => evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()`);
  const clickAt = async point => {
    if (!point) throw new Error("Cannot click a missing control");
    await send("Input.dispatchMouseEvent", {type:"mousePressed",x:point.x,y:point.y,button:"left",buttons:1,clickCount:1}, sessionId);
    await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:point.x,y:point.y,button:"left",buttons:0,clickCount:1}, sessionId);
    await delay(320);
  };
  const keyPress = async (key,modifiers=0) => {
    const windowsVirtualKeyCode={ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,Enter:13,Escape:27,Tab:9,k:75}[key];
    const code=key.length===1?`Key${key.toUpperCase()}`:key;
    await send("Input.dispatchKeyEvent", {type:key==='Enter'?"keyDown":"rawKeyDown",key,code,windowsVirtualKeyCode,modifiers,...(key==='Enter'?{text:"\r"}:{})}, sessionId);
    await send("Input.dispatchKeyEvent", {type:"keyUp",key,code,windowsVirtualKeyCode,modifiers}, sessionId);
  };

  const readerNavigationChecks = async viewport => {
    const checks={};
    const agent=await evaluate("document.querySelector('.agentview.active').dataset.agent");
    const originalHash=await evaluate("location.hash");
    const headingIds=await evaluate("Array.from(document.querySelectorAll('.agentview.active .prose-col h1,.agentview.active .prose-col h2,.agentview.active .prose-col h3')).filter(h=>!h.closest('.note,.mobnote')).map(h=>h.id)");
    await clickAt(await centerOf('#openChapterOutline'));
    checks.outlineReflectsSource=await evaluate(`document.getElementById('chapterDialog').open && document.querySelectorAll('#chapterList button').length===${headingIds.length} && ${JSON.stringify(headingIds)}.every(id=>id && document.getElementById(id)) && new Set(${JSON.stringify(headingIds)}).size===${headingIds.length}`);
    await keyPress('Escape');
    await waitForExpression("!document.getElementById('chapterDialog').open");
    checks.outlineEscapeReturnsFocus=await evaluate("document.activeElement.id==='openChapterOutline'");
    await clickAt(await centerOf('#openChapterOutline'));
    const targetId=headingIds[Math.min(5,headingIds.length-1)];
    await evaluate(`document.querySelector('[data-heading-id="${targetId}"]').scrollIntoView({behavior:'instant',block:'center'})`);
    await clickAt(await centerOf(`[data-heading-id="${targetId}"]`));
    await waitForExpression(`document.activeElement.id===${JSON.stringify(targetId)} && !document.getElementById('chapterDialog').open`);
    checks.chapterJumpFocusAndRoute=await evaluate(`document.activeElement.checkVisibility() && location.hash===${JSON.stringify(originalHash)}`);
    await clickAt(await centerOf('#openChapterOutline'));
    await clickAt(await centerOf('#closeChapterOutline'));
    await waitForExpression("!document.getElementById('chapterDialog').open");
    checks.outlineCloseReturnsFocus=await evaluate("document.activeElement.id==='openChapterOutline'");

    const query=await evaluate(`(() => {
      const text=Array.from(document.querySelectorAll('.agentview.active .prose-col .src')).filter(node=>!node.closest('.note,.mobnote')).map(node=>node.textContent).join(' ').toLowerCase();
      const counts=new Map();(text.match(/[a-z]{4,12}/g)||[]).forEach(word=>counts.set(word,(counts.get(word)||0)+1));
      return Array.from(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    })()`);
    const typeQuery=async text => {
      // Clear only establishes the starting state; query entry and navigation are real browser input.
      await evaluate("document.getElementById('promptSearch').value='';document.getElementById('promptSearch').dispatchEvent(new Event('input',{bubbles:true}))");
      await keyPress('k',4);
      await send('Input.insertText',{text},sessionId);
    };
    await typeQuery(query);
    await waitForExpression("document.querySelectorAll('mark.search-hit').length>1");
    const total=await evaluate("Number(document.getElementById('searchCount').textContent.split('/')[1])");
    checks.searchFirstIsVisible=await evaluate("document.getElementById('searchCount').textContent.startsWith('1 /') && document.querySelectorAll('mark.search-current').length===1 && document.querySelector('mark.search-current').checkVisibility()");
    checks.quotedSourceNotDuplicated=await evaluate("!document.querySelector('.q mark.search-hit')");
    await keyPress('Enter');
    checks.searchEnterAdvances=await evaluate("document.getElementById('searchCount').textContent.startsWith('2 /')");
    await keyPress('Enter',8);
    checks.searchShiftEnterReverses=await evaluate("document.getElementById('searchCount').textContent.startsWith('1 /')");
    await keyPress('Enter',8);
    checks.searchPreviousWraps=await evaluate(`document.getElementById('searchCount').textContent==='${total} / ${total}'`);
    await keyPress('Enter');
    checks.searchNextWraps=await evaluate("document.getElementById('searchCount').textContent.startsWith('1 /')");
    await clickAt(await centerOf('#searchNext'));
    checks.searchNextButton=await evaluate("document.getElementById('searchCount').textContent.startsWith('2 /')");
    await clickAt(await centerOf('#searchPrevious'));
    checks.searchPreviousButton=await evaluate("document.getElementById('searchCount').textContent.startsWith('1 /')");

    const alternate=viewport.mobile?{width:1440,height:900,mobile:false}:{width:390,height:844,mobile:true};
    if(!viewport.mobile) await evaluate("document.getElementById('homeAction').focus({preventScroll:true})");
    await send('Emulation.setDeviceMetricsOverride',{...alternate,deviceScaleFactor:1},sessionId);
    await waitForExpression(`innerWidth===${alternate.width}`);
    if(!viewport.mobile){
      await waitForExpression("document.activeElement.id==='homeButton'");
      checks.compactHomeActionFocus=await evaluate("document.activeElement.checkVisibility()");
    }
    checks.searchResponsiveCountStable=await evaluate(`document.getElementById('searchCount').textContent==='1 / ${total}' && !document.querySelector(${JSON.stringify(alternate.mobile?'.note mark.search-hit':'.mobnote mark.search-hit')})`);
    await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,mobile:viewport.mobile,deviceScaleFactor:1},sessionId);
    await waitForExpression(`innerWidth===${viewport.width}`);
    checks.searchReturnViewportStable=await evaluate(`document.getElementById('searchCount').textContent==='1 / ${total}'`);
    await typeQuery('no-matching-archive-result-92817');
    checks.searchEmptyState=await evaluate("document.getElementById('searchCount').textContent==='无结果' && document.getElementById('searchNext').disabled && document.getElementById('searchPrevious').disabled && !document.querySelector('mark.search-hit')");
    await keyPress('Escape');
    checks.searchClearRestoresFocus=await evaluate("!document.querySelector('mark.search-hit') && document.getElementById('searchNavigation').hidden && document.activeElement.checkVisibility()");

    const hiddenQuery=await evaluate(`(() => {
      const details=document.querySelector('.agentview.active details.rawblob:not([open])');if(!details)return null;
      const walker=document.createTreeWalker(details,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){
        if(node.parentElement.closest('summary,.note,.mobnote'))continue;
        const line=node.nodeValue.split(String.fromCharCode(10)).map(value=>value.trim()).find(value=>value.length>40);
        if(line){details.dataset.qaSearchTarget='true';return line.slice(0,55);}
      }
      return null;
    })()`);
    if(hiddenQuery){
      await typeQuery(hiddenQuery);
      await waitForExpression("document.querySelectorAll('mark.search-hit').length>0");
      checks.searchReachesFoldedSource=await evaluate("document.querySelector('mark.search-current').checkVisibility() && document.querySelector('[data-qa-search-target]').open");
      await evaluate("document.querySelector('[data-qa-search-target]').open=false");
      // Wait for the queued native toggle event and its layout refresh, not scrolling animation.
      await delay(100);
      checks.searchDoesNotReopenOnRefresh=await evaluate("!document.querySelector('[data-qa-search-target]').open");
      await keyPress('Enter');
      checks.searchOpensSelectedFoldedHit=await evaluate("document.querySelector('mark.search-current').checkVisibility()");
      await evaluate("document.querySelector('[data-qa-search-target]').removeAttribute('data-qa-search-target')");
    }
    await keyPress('Escape');
    await clickAt(await centerOf('#openChapterOutline'));
    const nextAgent=agentIds.find(id=>id!==agent);
    await evaluate(`location.hash='#agent=${nextAgent}'`);
    await waitForAgent(nextAgent);
    checks.routeClosesOutline=await evaluate("!document.getElementById('chapterDialog').open && !document.querySelector('#chapterList button')");
    await clickAt(await centerOf('#openChapterOutline'));
    checks.routeRebuildsOutline=await evaluate(`Array.from(document.querySelectorAll('#chapterList button')).every(button=>button.dataset.headingId.startsWith('reader-${nextAgent}-')) && document.querySelectorAll('#chapterList button').length>0`);
    await evaluate(`location.hash='#agent=${agent}'`);
    await waitForAgent(agent);
    checks.chapterIdsStable=await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.agentview.active .prose-col h1,.agentview.active .prose-col h2,.agentview.active .prose-col h3')).filter(h=>!h.closest('.note,.mobnote')).map(h=>h.id))===${JSON.stringify(JSON.stringify(headingIds))}`);
    await clickAt(await centerOf('#openChapterOutline'));
    await evaluate("location.hash='#home'");
    await waitForExpression("document.body.classList.contains('mode-home')");
    checks.homeClosesOutline=await evaluate("!document.getElementById('chapterDialog').open && !document.querySelector('#chapterList button')");
    if(viewport.name==='wide'){
      // A fresh document makes the next Agent uncached; explicitly hold its request.
      await send('Page.navigate',{url:'about:blank'},sessionId);
      await waitForExpression("document.URL==='about:blank'");
      await send('Page.navigate',{url:targetUrl},sessionId);
      await waitForAgent(agent);
      await typeQuery(query);
      await evaluate(`(() => {
        const original=window.fetch;
        window.fetch=function(...args){
          if(String(args[0]).endsWith('/${nextAgent}.html')) return new Promise(resolve=>{
            window.__qaResumeAgent=()=>{window.fetch=original;resolve(original.apply(window,args));};
          });
          return original.apply(window,args);
        };
        location.hash='#agent=${nextAgent}';
      })()`);
      await waitForExpression("typeof window.__qaResumeAgent==='function'");
      checks.loadingClearsOldNavigation=await evaluate("document.getElementById('openChapterOutline').disabled && document.getElementById('searchNext').disabled && document.getElementById('searchPrevious').disabled && !document.querySelector('mark.search-hit')");
      await clickAt(await centerOf('#openChapterOutline'));
      checks.loadingCannotOpenEmptyOutline=await evaluate("!document.getElementById('chapterDialog').open");
      await evaluate("window.__qaResumeAgent()");
      await waitForAgent(nextAgent);
      checks.loadedAgentRestoresNavigation=await evaluate(`(() => {
        const current=document.querySelector('mark.search-current');
        const count=document.getElementById('searchCount').textContent;
        const validResult=current ? current.checkVisibility() && count.startsWith('1 /') : count==='无结果' && document.getElementById('searchNext').disabled && document.getElementById('searchPrevious').disabled;
        return !document.getElementById('openChapterOutline').disabled && document.getElementById('promptSearch').value===${JSON.stringify(query)} && validResult;
      })()`);
    }
    // Keep failed optional DOM lookups visible in JSON diagnostics rather than dropping undefined.
    Object.keys(checks).forEach(key=>{checks[key]=checks[key]===true;});
    return checks;
  };

  const viewports = [
    { name: "wide", width: 1920, height: 1080, mobile: false },
    { name: "desktop", width: 1440, height: 900, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ];
  const results = [];
  const homeResults = [];
  const catalogueChecks = [];
  const visualCoverage = [];
  const readerChecks = [];

  for (const viewport of viewports) {
    // Each viewport starts from a fresh document, including after in-page navigation.
    await send("Page.navigate", {url:"about:blank"}, sessionId);
    await waitForExpression("document.URL === 'about:blank'");
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    }, sessionId);
    await send("Emulation.setTouchEmulationEnabled", {enabled:viewport.mobile}, sessionId);
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
            minTargetSize: Math.min(...Array.from(wheel.querySelectorAll('.navbtn:not(.wheel-hidden)')).map(node => {const r=node.getBoundingClientRect();return Math.min(r.width,r.height);})),
            currentMarkers: wheel.querySelectorAll('.navbtn[aria-current="true"]').length,
            selectValue: wheel.querySelector('#agentSelect')?.value,
            selectOptions: wheel.querySelectorAll('#agentSelect option').length,
            selectVisible: Boolean(wheel.querySelector('#agentSelect')?.getClientRects().length),
            countText: wheel.querySelector('#wheelCount')?.textContent.trim(),
            withinViewport: rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight
          };
        })(),
        topbar: (() => {
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          const tools = document.querySelector('.top-tools').getBoundingClientRect();
          const targets = Array.from(document.querySelectorAll('.topbar button,.topbar a,.topbar .searchbox')).filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
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
    const initialWheelScreenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},sessionId);
    writeFileSync(`/tmp/deepprompt-wheel-initial-${viewport.name}.png`,initialWheelScreenshot.data,"base64");
    if (viewport.name === "wide" || viewport.mobile) {
      const activeAgent = () => evaluate("document.querySelector('.agentview.active')?.dataset.agent || null");
      // Programmatic clicks only establish a known starting point; every tested gesture uses CDP input.
      const resetAgent = async (id="claude-code") => {
        await evaluate(`document.querySelector('.navbtn[data-target="${id}"]')?.click()`);
        await waitForAgent(id);
        await delay(360);
      };
      const pointerDrag = async (point,travel) => {
        await send("Input.dispatchMouseEvent", {type:"mousePressed",x:point.x,y:point.y,button:"left",buttons:1,clickCount:1}, sessionId);
        await send("Input.dispatchMouseEvent", {type:"mouseMoved",x:point.x,y:point.y-travel/2,button:"left",buttons:1}, sessionId);
        await send("Input.dispatchMouseEvent", {type:"mouseMoved",x:point.x,y:point.y-travel,button:"left",buttons:1}, sessionId);
      };
      const releasePointer = (point,travel) => send("Input.dispatchMouseEvent", {type:"mouseReleased",x:point.x,y:point.y-travel,button:"left",buttons:0,clickCount:1}, sessionId);
      const previewState = () => evaluate(`({agent:document.querySelector('.agentview.active')?.dataset.agent,
        current:document.querySelector('.navbtn[aria-current="true"]')?.dataset.target,
        active:document.querySelector('.navbtn.active')?.dataset.target,
        preview:document.querySelector('.navbtn.preview')?.dataset.target,
        select:document.getElementById('agentSelect')?.value})`);
      const checks = {};

      if (viewport.name === "wide") {
        const hoverBefore=await centerOf('.navbtn.active');
        await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:hoverBefore.x,y:hoverBefore.y},sessionId);
        await delay(280);
        const hoverAfter=await centerOf('.navbtn.active');
        checks.hoverStableTarget=Math.hypot(hoverAfter.x-hoverBefore.x,hoverAfter.y-hoverBefore.y)<2;
        await clickAt(await centerOf('.navbtn[data-target="antigravity"]'));
        await waitForAgent("antigravity");
        checks.neighborClick = await activeAgent()==="antigravity";
        await resetAgent("dsh");
        await resetAgent();

        const wheelPoint=await centerOf('.navbtn.active');
        const wheelEvent=amount=>send("Input.dispatchMouseEvent",{type:"mouseWheel",x:wheelPoint.x,y:wheelPoint.y,deltaX:0,deltaY:amount},sessionId);
        await evaluate("window.scrollTo({top:450,behavior:'instant'})");
        await delay(100);
        const scrollBefore=await evaluate("scrollY");
        const historyBefore=await evaluate("history.length");
        for(let index=0;index<7;index++){await wheelEvent(5);await delay(18);}
        checks.smallWheelAccumulation = await activeAgent()==="claude-code" && Math.abs(await evaluate("scrollY")-scrollBefore)<2;
        await wheelEvent(5);
        // Keep the same burst active while scrolling settles, including momentum beyond the old 260ms lock.
        for(let index=0;index<18;index++){await wheelEvent(70);await delay(35);}
        await waitForAgent("dsh");
        const lockedScroll=await evaluate("scrollY");
        for(let index=0;index<6;index++){await wheelEvent(70);await delay(35);}
        checks.wheelMomentumSingleStep = await activeAgent()==="dsh" && await evaluate("history.length")===historyBefore+1;
        checks.wheelMomentumNoPageScroll = Math.abs(await evaluate("scrollY")-lockedScroll)<2;
        await delay(230);
        await wheelEvent(-45);
        await waitForAgent("claude-code");
        checks.wheelNewGesture = await activeAgent()==="claude-code";
        await delay(360);

        let point=await centerOf('.navbtn.active');
        const historyBeforeCancel=await evaluate("history.length");
        await pointerDrag(point,60);
        const preview=await previewState();
        checks.dragPreview = preview.agent==="claude-code" && preview.current==="claude-code" && preview.active==="claude-code" && preview.select==="claude-code" && preview.preview==="dsh";
        await keyPress("Escape");
        await releasePointer(point,60);
        await delay(200);
        checks.dragEscapeCancel = await activeAgent()==="claude-code" && await evaluate("history.length")===historyBeforeCancel && await evaluate("!document.querySelector('.navbtn.preview') && !document.getElementById('agentWheel').classList.contains('dragging')");
        point=await centerOf('.navbtn.active');
        await pointerDrag(point,60);
        await releasePointer(point,60);
        await waitForAgent("dsh");
        checks.dragReleaseCommit = await activeAgent()==="dsh";
        await delay(200);

        await evaluate("document.querySelector('.navbtn.active').focus({preventScroll:true})");
        await keyPress("ArrowLeft");
        await waitForAgent("claude-code");
        checks.keyboardArrow = await evaluate("document.activeElement===document.querySelector('.navbtn.active')");
        await keyPress("ArrowRight",1);
        await waitForAgent("dsh");
        checks.keyboardModifiedSingleStep=await activeAgent()==="dsh";
        await keyPress("Home");
        const firstId=await evaluate("document.querySelector('.navbtn').dataset.target");
        await waitForAgent(firstId);
        checks.keyboardHome = await activeAgent()===firstId;
        await keyPress("End");
        const lastId=await evaluate("Array.from(document.querySelectorAll('.navbtn')).at(-1).dataset.target");
        await waitForAgent(lastId);
        checks.keyboardEnd = await activeAgent()===lastId;
        await send("Input.dispatchKeyEvent", {type:"rawKeyDown",key:"ArrowRight",code:"ArrowRight",autoRepeat:true}, sessionId);
        await send("Input.dispatchKeyEvent", {type:"keyUp",key:"ArrowRight",code:"ArrowRight"}, sessionId);
        checks.keyboardRepeatIgnored = await activeAgent()===lastId;
        await resetAgent();

        await evaluate("document.querySelector('.navbtn.active').focus({preventScroll:true})");
        await keyPress("Tab");
        checks.nativeSelectTabFocus=await evaluate("document.activeElement.id==='agentSelect'");
        // Headless Chrome on macOS does not dispatch CDP keys into the OS select popup.
        // Tab focus is real input; value/change below verifies the browser integration contract.
        await evaluate(`(() => {const select=document.getElementById('agentSelect');select.value=${JSON.stringify(firstId)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await waitForAgent(firstId);
        checks.nativeSelectIntegration = await evaluate(`document.getElementById('agentSelect').value===${JSON.stringify(firstId)} && document.querySelector('.navbtn.active').dataset.target===${JSON.stringify(firstId)}`);
        await resetAgent();
      } else {
        const touch = (type,point) => send("Input.dispatchTouchEvent", {type,touchPoints:point?[{x:point.x,y:point.y,id:1,radiusX:6,radiusY:6,force:1}]:[]},sessionId);
        let point=await centerOf('.navbtn.active');
        await touch("touchStart",point);
        await delay(40);
        await touch("touchMove",{x:point.x-36,y:point.y});
        await delay(40);
        await touch("touchMove",{x:point.x-72,y:point.y});
        await delay(60);
        const preview=await previewState();
        checks.touchPreview = preview.agent==="claude-code" && preview.current==="claude-code" && preview.preview==="dsh";
        if(!checks.touchPreview) console.error("Unexpected touch preview:",preview);
        await touch("touchEnd");
        await waitForAgent("dsh");
        checks.touchCommit = await activeAgent()==="dsh";
        await delay(220);
        await resetAgent();
        point=await centerOf('.navbtn.active');
        const historyBeforeCancel=await evaluate("history.length");
        await touch("touchStart",point);
        await delay(40);
        await touch("touchMove",{x:point.x-72,y:point.y});
        await delay(60);
        await touch("touchCancel");
        await delay(160);
        checks.touchCancel = await activeAgent()==="claude-code" && await evaluate("history.length")===historyBeforeCancel && await evaluate("!document.querySelector('.navbtn.preview') && !document.getElementById('agentWheel').classList.contains('dragging')");
      }
      checks.draggingClassCleared = await evaluate("!document.getElementById('agentWheel').classList.contains('dragging')");
      metrics.wheelInteraction=checks;
      await evaluate("window.scrollTo({top:0,behavior:'instant'})");
      await delay(120);
    }
    if (viewport.mobile) {
      const searchChecks={};
      const inputVisible="Boolean(document.getElementById('promptSearch').getClientRects().length)";
      const focusedSearch="document.activeElement.id==='promptSearch'";
      const visibleToggle="document.activeElement.id==='togglePromptSearch' && Boolean(document.activeElement.getClientRects().length)";
      const closedSearch=`!(${inputVisible}) && document.getElementById('promptSearch').value==='' && !document.querySelector('mark.search-hit') && document.getElementById('togglePromptSearch').getAttribute('aria-expanded')==='false'`;
      const closedHeight=await evaluate("document.querySelector('.topbar').getBoundingClientRect().height");
      searchChecks.initiallyCollapsed=await evaluate(`!(${inputVisible}) && document.getElementById('togglePromptSearch').getBoundingClientRect().height>=44`);
      await clickAt(await centerOf('#togglePromptSearch'));
      await waitForExpression(`${inputVisible} && ${focusedSearch}`);
      searchChecks.openSecondRow=await evaluate(`(() => {
        const box=document.getElementById('promptSearchBox').getBoundingClientRect();
        const toggle=document.getElementById('togglePromptSearch').getBoundingClientRect();
        return box.top>=toggle.bottom && box.width>innerWidth*.85 && box.right<=innerWidth && document.getElementById('togglePromptSearch').getAttribute('aria-expanded')==='true';
      })()`);
      await send("Input.insertText",{text:"tool"},sessionId);
      await waitForExpression("document.querySelectorAll('mark.search-hit').length>0");
      searchChecks.inputFindsText=await evaluate("parseInt(document.getElementById('searchCount').textContent)>0");
      const searchScreenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},sessionId);
      writeFileSync('/tmp/deepprompt-search-mobile.png',searchScreenshot.data,'base64');
      await keyPress('Escape');
      await waitForExpression(`${closedSearch} && ${visibleToggle}`);
      searchChecks.escapeClearsAndRestoresFocus=await evaluate(`Math.abs(document.querySelector('.topbar').getBoundingClientRect().height-${closedHeight})<2`);
      await keyPress('k',4);
      searchChecks.commandKOpens=Boolean(await waitForExpression(`${inputVisible} && ${focusedSearch}`));
      await send("Input.insertText",{text:"tool"},sessionId);
      await clickAt(await centerOf('#togglePromptSearch'));
      searchChecks.buttonClearsAndRestoresFocus=Boolean(await waitForExpression(`${closedSearch} && ${visibleToggle}`));
      await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false},sessionId);
      searchChecks.widenKeepsVisibleFocus=Boolean(await waitForExpression(`${inputVisible} && ${focusedSearch} && !document.getElementById('togglePromptSearch').getClientRects().length`));
      await send("Input.insertText",{text:"tool"},sessionId);
      await send("Emulation.setDeviceMetricsOverride",{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:true},sessionId);
      searchChecks.narrowPreservesVisibleQuery=Boolean(await waitForExpression(`${inputVisible} && ${focusedSearch} && document.getElementById('togglePromptSearch').getAttribute('aria-expanded')==='true' && document.getElementById('promptSearch').value==='tool'`));
      await evaluate("location.hash='#agent=codex'");
      await waitForAgent('codex');
      searchChecks.agentRouteClearsWithoutHiddenFocus=Boolean(await waitForExpression(`${closedSearch} && ${visibleToggle}`));
      await keyPress('k',2);
      searchChecks.controlKOpens=Boolean(await waitForExpression(`${inputVisible} && ${focusedSearch}`));
      await evaluate("location.hash='#home'");
      searchChecks.homeRouteRestoresVisibleFocus=Boolean(await waitForExpression(`document.body.classList.contains('mode-home') && document.activeElement.id==='homeButton' && Boolean(document.activeElement.getClientRects().length) && !(${inputVisible}) && !document.getElementById('togglePromptSearch').getClientRects().length`));
      metrics.searchInteraction=searchChecks;
      await evaluate("location.hash='#agent=claude-code'");
      await waitForAgent('claude-code');
      await evaluate("window.scrollTo({top:0,behavior:'instant'})");
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
            const excessiveGaps = [];
            for (let index = 1; index < points.length; index += 1) {
              const pixels = Math.round(points[index].y - points[index - 1].y);
              if (pixels > ${maxVisualGapPixels}) excessiveGaps.push({pixels, from: points[index - 1].id, to: points[index].id});
              if (pixels > largest.pixels) largest = {pixels, from: points[index - 1].id, to: points[index].id};
            }
            return {
              agent: '${agentId}',
              proseHeight: Math.round(prose.scrollHeight),
              visibleHighlights: marks.length,
              excessiveGaps,
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
    const philosophySelector='.agentview.active details.mh-philosophy';
    const sourceLinksVisible=`(() => {
      const links=Array.from(document.querySelectorAll('.agentview.active .mh-evidence a'));
      return links.length>0 && links.every(link=>link.checkVisibility() && link.href);
    })()`;
    const philosophyChecks={};
    philosophyChecks.initiallyCollapsed=await evaluate(`(() => {
      const card=document.querySelector(${JSON.stringify(philosophySelector)});
      return Boolean(card && !card.open && card.querySelector('summary')?.checkVisibility() && !card.querySelector('.ph-content')?.checkVisibility());
    })()`);
    philosophyChecks.closedSourceLinksVisible=await evaluate(sourceLinksVisible);
    await evaluate(`document.querySelector(${JSON.stringify(philosophySelector+' summary')})?.scrollIntoView({behavior:'instant',block:'center'})`);
    await clickAt(await centerOf(philosophySelector+' summary'));
    await waitForExpression(`Boolean(document.querySelector(${JSON.stringify(philosophySelector)})?.open)`);
    philosophyChecks.expandShowsReading=await evaluate(`(() => {
      const content=document.querySelector(${JSON.stringify(philosophySelector+' .ph-content')});
      return Boolean(content?.checkVisibility() && content.querySelector('p')?.textContent.trim());
    })()`);
    philosophyChecks.expandShowsEvidence=await evaluate(`(() => {
      const links=Array.from(document.querySelectorAll(${JSON.stringify(philosophySelector+' .ph-content a')}));
      return links.length>0 && links.every(link=>link.checkVisibility() && link.href);
    })()`);
    const philosophyScreenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, sessionId);
    writeFileSync(
      `/tmp/deepprompt-philosophy-${viewport.name}.png`,
      philosophyScreenshot.data,
      "base64",
    );
    await keyPress('Enter');
    await waitForExpression(`!document.querySelector(${JSON.stringify(philosophySelector)})?.open`);
    philosophyChecks.keyboardCollapse=await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(philosophySelector+' summary')}) && !document.querySelector(${JSON.stringify(philosophySelector+' .ph-content')})?.checkVisibility()`);
    philosophyChecks.sourceLinksSurviveCollapse=await evaluate(sourceLinksVisible);
    metrics.philosophyDisclosure=philosophyChecks;
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

    // Verify each generated annotation after lazy loading and mobile cloning.
    for (const agentId of agentIds) {
      await send("Runtime.evaluate", {
        expression: `document.querySelector('.navbtn[data-target="${agentId}"]').click()`,
      }, sessionId);
      await waitForAgent(agentId);
      const expectedNotes = annotations.filter(note => note.agent === agentId).map(note => ({
        id: note.id, anchor: note.anchor, title: note.title, body: note.body,
      }));
      const state = (await send("Runtime.evaluate", {
        expression: `(() => {
          const view=document.querySelector('.agentview.active');
          const expected=${JSON.stringify(expectedNotes)};
          const ids=Array.from(document.querySelectorAll('[id]')).map(node=>node.id);
          const selector=innerWidth<1280?'.mobnote':'.note';
          const mismatches=expected.filter(item=>{
            const hl=view.querySelector('.hl[data-note="'+item.id+'"]');
            const note=view.querySelector(selector+'[data-note="'+item.id+'"]');
            const body=note?.querySelector('p')?.cloneNode(true);
            body?.querySelector('.source-ref')?.remove();
            const expectedBody=document.createElement('p');
            expectedBody.innerHTML=item.body;
            return !hl || !note || hl.textContent!==item.anchor || note.querySelector('.q')?.textContent!==item.anchor ||
              note.querySelector('h3')?.textContent!==item.title || body?.innerHTML.trim()!==expectedBody.innerHTML.trim() ||
              hl.getAttribute('aria-describedby')!==note.id || !note.querySelector('.source-ref')?.href.includes(${JSON.stringify(manifest.source.commit)});
          });
          return {agent:'${agentId}',viewport:'${viewport.name}',overflow:document.documentElement.scrollWidth>innerWidth,
            duplicateIds:ids.length-new Set(ids).size,mismatches:mismatches.map(item=>item.id),
            hiddenNavVisible:Array.from(document.querySelectorAll('.navbtn.wheel-hidden')).some(node=>{
              const style=getComputedStyle(node);return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)>0;
            }),
            noteCount:view.querySelectorAll(selector).length,expectedCount:expected.length};
        })()`, returnByValue: true,
      }, sessionId)).result.value;
      readerChecks.push(state);
      if (['mimo','openclaw','claude-tag'].includes(agentId) && viewport.name !== 'desktop') {
        await send("Runtime.evaluate", {
          expression: "document.querySelector('.agentview.active .hl').scrollIntoView({block:'center'})",
        }, sessionId);
        await delay(300);
        const shot=await send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false}, sessionId);
        writeFileSync(`/tmp/deepprompt-review-${agentId}-${viewport.name}.png`,shot.data,"base64");
      }
    }
    await send("Runtime.evaluate", {expression:"document.querySelector('.navbtn[data-target=\"claude-code\"]').click()"}, sessionId);
    await waitForAgent("claude-code");
    const interaction = (await send("Runtime.evaluate", {
      expression: `(() => {
        const view=document.querySelector('.agentview.active');
        document.querySelector('.chip[data-cat="safety"]').click();
        const filtered=Array.from(view.querySelectorAll('.note[data-cat="safety"],.mobnote[data-cat="safety"]')).every(note=>note.classList.contains('hide'));
        document.querySelector('.chip[data-cat="all"]').click();
        const input=document.getElementById('promptSearch');
        input.value='permission';input.dispatchEvent(new Event('input',{bubbles:true}));
        const searched=view.querySelectorAll('mark.search-hit').length>0;
        input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
        const restored=view.querySelectorAll('mark.search-hit').length===0;
        const hl=Array.from(view.querySelectorAll('.hl')).find(node=>node.getClientRects().length);
        hl.click();
        const activeNote=view.querySelector(innerWidth<1280?'.mobnote.active':'.note.active');
        return {filtered,searched,restored,activated:activeNote?.dataset.note===hl.dataset.note};
      })()`, returnByValue:true,
    }, sessionId)).result.value;
    results[results.length-1].annotationInteraction=interaction;
    results[results.length-1].navigationInteraction=await readerNavigationChecks(viewport);

    const homeUrl = targetUrl.replace(/#.*$/, "");
    await send("Page.navigate", { url: homeUrl }, sessionId);
    await waitForExpression(`(() => {
      if (!document.body?.classList.contains('mode-home')) return false;
      const wheel = document.getElementById('agentWheel');
      const reader = document.getElementById('main');
      const links = Array.from(document.querySelectorAll('.spectrum-link'));
      return wheel && reader && getComputedStyle(wheel).display === 'none' &&
        getComputedStyle(reader).display === 'none' && links.length === ${expectedAgents} &&
        links.every(node => getComputedStyle(node).getPropertyValue('--node-color').trim());
    })()`);
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
    const catalogue = await send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.getElementById('catalogSearch');
        const sort = document.getElementById('catalogSort');
        const cards = () => Array.from(document.querySelectorAll('.acard:not([hidden])'));
        const query = text => { input.value=text; input.dispatchEvent(new Event('input', {bubbles:true})); };
        const changeSort = value => { sort.value=value; sort.dispatchEvent(new Event('change', {bubbles:true})); };
        query('openai');
        const vendorSearch = cards().length===1 && cards()[0].dataset.target==='codex';
        query('no-agent-matches-this-query');
        const emptyState = cards().length===0 && !document.getElementById('catalogEmpty').hidden;
        document.getElementById('clearCatalogSearch').click();
        const reset = cards().length===${expectedAgents} && document.activeElement===input;
        changeSort('name');
        const names=cards().map(card=>card.querySelector('.ac-name').textContent);
        const nameSort=names.every((name,index)=>!index || names[index-1].localeCompare(name,'en')<=0);
        changeSort('notes');
        const counts=cards().map(card=>parseInt(card.querySelector('.ac-stats span').textContent,10));
        const noteSort=counts.every((count,index)=>!index || counts[index-1]>=count);
        changeSort('default');
        const preview=document.querySelector('.preview-source blockquote');
        const source=document.querySelector('.preview-source>a');
        return {vendorSearch,emptyState,reset,nameSort,noteSort,
          previewQuote:preview?.textContent,
          previewSource:source?.href,
          overflow:document.documentElement.scrollWidth>innerWidth,
          loadedAgents:window.__archiveDiagnostics.loadedAgents().length};
      })()`, returnByValue:true,
    }, sessionId);
    catalogueChecks.push({viewport:viewport.name,...catalogue.result.value});
    await send("Runtime.evaluate", {expression:"document.activeElement.blur();document.getElementById('catalog').scrollIntoView({behavior:'instant',block:'start'})"}, sessionId);
    const catalogueShot=await send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false}, sessionId);
    writeFileSync(`/tmp/deepprompt-catalogue-${viewport.name}.png`, catalogueShot.data, "base64");
    // The mobile preview is below the fold; entering a reader must reset its position.
    await send("Runtime.evaluate", {expression:"document.querySelector('.preview-open').scrollIntoView({behavior:'instant'});document.querySelector('.preview-open').click()"}, sessionId);
    await waitForAgent('codex');
    await waitForExpression(`(() => {const r=document.querySelector('.agentview.active .masthead').getBoundingClientRect();return r.top>=60 && r.top<innerHeight/2;})()`);
    catalogueChecks.at(-1).previewNavigation=true;
  }

  console.log(JSON.stringify(results, null, 2));
  console.log("Homepage states:");
  console.log(JSON.stringify(homeResults, null, 2));
  console.log("Catalogue interaction checks:");
  console.log(JSON.stringify(catalogueChecks, null, 2));
  console.log("Per-Agent reader checks:");
  console.log(JSON.stringify(readerChecks, null, 2));
  if (runtimeErrors.length) console.error("Browser runtime errors:", runtimeErrors);
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
    result.wheel.tabStops !== 1 ||
    result.wheel.currentMarkers !== 1 ||
    result.wheel.minTargetSize < 44 ||
    result.wheel.selectValue !== "claude-code" ||
    result.wheel.selectOptions !== expectedAgents ||
    !result.wheel.selectVisible ||
    !result.wheel.withinViewport ||
    !new RegExp(`^02\\s*/\\s*${expectedAgents}$`).test(result.wheel.countText) ||
    result.wheel.uniqueNodeColors !== expectedAgents ||
    result.topbar.right > result.innerWidth ||
    result.topbar.minTargetHeight < 42 ||
    (result.width >= 1280 && (!result.sideGeometry || result.sideGeometry.overlaps !== 0 || result.sideGeometry.leftGap < 16 || result.sideGeometry.rightGap < 16)) ||
    ((result.name === "wide" || result.name === "mobile") && (!result.wheelInteraction || Object.values(result.wheelInteraction).some(passed => passed !== true))) ||
    (result.mobile && (!result.searchInteraction || Object.values(result.searchInteraction).some(passed => passed !== true))) ||
    (!result.philosophyDisclosure || Object.values(result.philosophyDisclosure).some(passed => passed !== true)) ||
    (result.width >= 1280 && (Math.abs(result.wheel.width-128)>2 || Math.abs(result.wheel.height-352)>4 || result.wheel.left!==12 || result.wheel.top>180 || result.wheel.visibleItems!==5)) ||
    (result.width < 1280 && (result.wheel.visibleItems!==3 || Math.abs(result.wheel.width-232)>2 || Math.abs(result.wheel.height-108)>4)) ||
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
    !['filtered','searched','restored','activated'].every(key=>result.annotationInteraction?.[key]) ||
    (!result.navigationInteraction || Object.values(result.navigationInteraction).some(passed=>passed!==true)) ||
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
  const readerFailures=readerChecks.filter(result=>!result || result.overflow || result.duplicateIds || result.hiddenNavVisible || result.mismatches.length || result.noteCount!==result.expectedCount);
  const previewNote=annotations.find(note=>note.id==='codex-25');
  const previewAgent=manifest.agents.find(agent=>agent.id==='codex');
  const catalogueFailures=catalogueChecks.filter(result=>
    !['vendorSearch','emptyState','reset','nameSort','noteSort','previewNavigation'].every(key=>result[key]) ||
    result.overflow || result.loadedAgents!==0 || result.previewQuote!==previewNote.anchor ||
    result.previewSource!==previewAgent.sourceUrl+'#L'+previewNote.startLine+'-L'+previewNote.endLine);
  if (failures.length || homeFailures.length || visualFailures.length || readerFailures.length || catalogueFailures.length || runtimeErrors.length) {
    const interactionFailures=results.flatMap(result=>['wheelInteraction','searchInteraction','philosophyDisclosure','annotationInteraction','navigationInteraction'].flatMap(group=>
      Object.entries(result[group]||{}).filter(([,passed])=>passed!==true).map(([check,passed])=>({viewport:result.name,group,check,result:passed===undefined?'undefined':passed}))));
    console.error("Failed checks:",JSON.stringify({interactionFailures,failures,homeFailures,visualFailures,readerFailures,catalogueFailures,runtimeErrors}));
    process.exitCode = 1;
  }
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
  // Chrome descendants can retain this pipe after the browser exits.
  // Release our read side so a completed QA run can terminate normally.
  chrome.stderr.destroy();
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
