(function(){
  "use strict";
  var AGENTS = Array.prototype.map.call(
    document.querySelectorAll('.navbtn[data-target]'),
    function(button){ return button.dataset.target; }
  );
  var current = AGENTS[0];
  var off = {}; // category -> true means hidden
  var searchQuery = "";
  var activeNoteId = null;
  var agentMount = document.getElementById('main');
  var fragmentCache = new Map();
  var fragmentRequests = new Map();
  var navigationToken = 0;
  var readerLoading = false;
  var searchInput = document.getElementById('promptSearch');
  var searchToggle = document.getElementById('togglePromptSearch');
  var searchReturnFocus = null;
  var searchMatches = [];
  var searchIndex = -1;
  var lastSearchQuery = '';
  var searchNavigation = document.getElementById('searchNavigation');
  var chapterDialog = document.getElementById('chapterDialog');
  var chapterTrigger = document.getElementById('openChapterOutline');
  var chapterList = document.getElementById('chapterList');
  var chapterCloseFocus = null;

  function usesCompactSearch(){
    return !!searchToggle && getComputedStyle(searchToggle).display!=='none';
  }

  function agentName(aid){
    var label=document.querySelector('.navbtn[data-target="'+aid+'"] .nb-name');
    return label?label.textContent.trim():aid;
  }

  function renderLoadState(aid,error){
    var state=document.createElement('div');
    state.className='agent-load-state'+(error?' is-error':' is-loading');
    state.setAttribute('role',error?'alert':'status');
    var signal=document.createElement('span');
    signal.className='load-signal'; signal.setAttribute('aria-hidden','true');
    var copy=document.createElement('p');
    var label=document.createElement('b');
    label.textContent=error?'ARCHIVE OFFLINE':'LOADING ARCHIVE NODE';
    var detail=document.createElement('span');
    detail.textContent=error
      ? '无法载入 '+agentName(aid)+'。请通过本地 HTTP 服务访问（例如 make serve），不要直接以 file:// 打开。'
      : '正在按需载入 '+agentName(aid)+' 的完整 Prompt 与批注…';
    copy.append(label,detail); state.append(signal,copy);
    if(error){
      var retry=document.createElement('button');
      retry.type='button'; retry.className='load-retry';
      retry.dataset.retryAgent=aid; retry.textContent='重新载入';
      state.appendChild(retry);
    }
    agentMount.replaceChildren(state);
  }

  function loadAgent(aid){
    if(fragmentCache.has(aid)) return Promise.resolve(fragmentCache.get(aid));
    if(fragmentRequests.has(aid)) return fragmentRequests.get(aid);
    var request=fetch('data/agents/'+encodeURIComponent(aid)+'.html',{headers:{Accept:'text/html'}})
      .then(function(response){
        if(!response.ok) throw new Error('HTTP '+response.status);
        return response.text();
      })
      .then(function(source){
        var template=document.createElement('template');
        template.innerHTML=source.trim();
        var view=template.content.firstElementChild;
        if(!view||view.id!=='view-'+aid||view.dataset.agent!==aid||!view.classList.contains('agentview')||template.content.children.length!==1){
          throw new Error('Invalid agent fragment: '+aid);
        }
        fragmentCache.set(aid,view);
        fragmentRequests.delete(aid);
        return view;
      })
      .catch(function(error){fragmentRequests.delete(aid);throw error;});
    fragmentRequests.set(aid,request);
    return request;
  }

  // move each agent's notes from its pool into its margins, alternating
  function distribute(aid){
    var pool = document.getElementById('pool-'+aid);
    var mL = document.getElementById('mL-'+aid), mR = document.getElementById('mR-'+aid);
    if(!pool || !mL || !mR) return;
    if(pool.dataset.done) return;
    var notes = Array.prototype.slice.call(pool.querySelectorAll('.note'));
    notes.forEach(function(n,i){
      var label=String(i+1).padStart(2,'0');
      n.dataset.linkLabel=label;
      n.id='annotation-'+n.dataset.note;
      if(!n.querySelector('.link-ref')){
        var ref=document.createElement('span');
        ref.className='link-ref'; ref.textContent='↔ '+label; ref.setAttribute('aria-hidden','true');
        n.appendChild(ref);
      }
      document.querySelectorAll('#view-'+aid+' .hl[data-note="'+n.dataset.note+'"]').forEach(function(hl){
        hl.dataset.linkLabel=label;
        hl.setAttribute('role','button'); hl.setAttribute('tabindex','0');
        hl.setAttribute('aria-describedby',n.id);
      });
      (i%2===0?mL:mR).appendChild(n);
    });
    pool.dataset.done = "1";
  }

  function syncDisclosureAnnotations(aid){
    var view=document.getElementById('view-'+aid); if(!view) return;
    view.querySelectorAll('.rawblob').forEach(function(details){
      var ids=new Set(Array.prototype.map.call(details.querySelectorAll('.hl[data-note]'),function(hl){return hl.dataset.note;}));
      var summary=details.querySelector(':scope > summary');
      if(summary){
        var badge=summary.querySelector('.summary-note-count');
        if(ids.size&&!badge){
          badge=document.createElement('span'); badge.className='summary-note-count'; summary.appendChild(badge);
        }
        if(badge) badge.textContent=ids.size+' 条批注';
      }
      ids.forEach(function(id){
        var note=view.querySelector('.note[data-note="'+id+'"]');
        if(note) note.classList.toggle('anchor-collapsed',!details.open);
      });
    });
  }

  function ensureConnector(stage){
    var svg=stage.querySelector(':scope > .annotation-links');
    if(svg) return svg;
    svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('annotation-links'); svg.setAttribute('aria-hidden','true');
    var path=document.createElementNS('http://www.w3.org/2000/svg','path');
    var start=document.createElementNS('http://www.w3.org/2000/svg','circle');
    var end=document.createElementNS('http://www.w3.org/2000/svg','circle');
    start.setAttribute('r','3'); end.setAttribute('r','3');
    svg.append(path,start,end); stage.prepend(svg); return svg;
  }

  function clearConnector(){
    document.querySelectorAll('.annotation-links.visible').forEach(function(svg){svg.classList.remove('visible');});
  }

  function drawConnector(noteId){
    clearConnector();
    if(!noteId||window.innerWidth<1280||!document.body.classList.contains('mode-reader')) return;
    var view=document.getElementById('view-'+current); if(!view) return;
    var note=view.querySelector('.note[data-note="'+noteId+'"]');
    var hl=view.querySelector('.hl[data-note="'+noteId+'"]');
    if(!note||!hl||note.classList.contains('hide')||note.classList.contains('anchor-collapsed')) return;
    var margin=note.closest('.margin'); var stage=view.querySelector('.stage');
    if(!margin||!stage) return;
    var sr=stage.getBoundingClientRect(),hr=hl.getBoundingClientRect(),nr=note.getBoundingClientRect();
    if(!hr.width||!hr.height||!nr.width||!nr.height) return;
    var isLeft=margin.classList.contains('left');
    var x1=(isLeft?hr.left:hr.right)-sr.left;
    var y1=hr.top-sr.top+hr.height/2;
    var x2=(isLeft?nr.right:nr.left)-sr.left;
    var y2=nr.top-sr.top+Math.min(nr.height/2,36);
    var bend=Math.max(26,Math.abs(x2-x1)*.48);
    var c1=isLeft?x1-bend:x1+bend;
    var c2=isLeft?x2+bend:x2-bend;
    var svg=ensureConnector(stage);
    svg.setAttribute('viewBox','0 0 '+sr.width+' '+stage.offsetHeight);
    svg.querySelector('path').setAttribute('d','M '+x1+' '+y1+' C '+c1+' '+y1+', '+c2+' '+y2+', '+x2+' '+y2);
    var circles=svg.querySelectorAll('circle');
    circles[0].setAttribute('cx',x1); circles[0].setAttribute('cy',y1);
    circles[1].setAttribute('cx',x2); circles[1].setAttribute('cy',y2);
    var accent=getComputedStyle(hl).getPropertyValue('--accent').trim();
    if(accent) stage.style.setProperty('--connector-color',accent);
    svg.classList.add('visible');
  }

  function layout(aid){
    var stage = document.querySelector('#view-'+aid+' .stage');
    if(!stage) return;
    syncDisclosureAnnotations(aid);
    stage.querySelectorAll('.hl[data-note]').forEach(function(hl){
      var description=displayedNote(hl.dataset.note);
      if(description) hl.setAttribute('aria-describedby',description.id);
    });
    var stageTop = stage.getBoundingClientRect().top + window.scrollY;
    var cols = {left:[], right:[]};
    var mL = document.getElementById('mL-'+aid), mR = document.getElementById('mR-'+aid);
    [['left',mL],['right',mR]].forEach(function(pair){
      var side=pair[0], m=pair[1]; if(!m) return;
      var notes = Array.prototype.slice.call(m.querySelectorAll('.note')).filter(function(n){return !n.classList.contains('hide')&&!n.classList.contains('anchor-collapsed');});
      notes.forEach(function(n){
        var hl = document.querySelector('#view-'+aid+' .hl[data-note="'+n.dataset.note+'"]');
        var top;
        if(hl){ var r=hl.getBoundingClientRect(); top = r.top + window.scrollY - stageTop; }
        else { top = 0; }
        cols[side].push({n:n, want:top});
      });
      cols[side].sort(function(a,b){return a.want-b.want;});
      var minGap=14, last=-9999;
      cols[side].forEach(function(o){
        var t=o.want;
        if(t < last+minGap) t=last+minGap;
        o.n.style.top = t+'px';
        last = t + o.n.offsetHeight;
      });
    });
    if(aid===current) drawConnector(activeNoteId);
  }

  function relayoutCurrent(){ distribute(current); layout(current); }

  // Shell totals are generated from all fragments; loaded views verify their own count.
  function refreshAgentStats(aid,view){
    var count=view.querySelectorAll('.note').length;
    var nav=document.querySelector('.navbtn[data-target="'+aid+'"] .nb-badge');
    if(nav) nav.textContent=count;
    var card=document.querySelector('.acard[data-target="'+aid+'"] .ac-stats span');
    if(card) card.textContent=count+' 批注';
    var kicker=view.querySelector('.mh-kicker');
    if(kicker) kicker.textContent=kicker.textContent.replace(/\d+\s*批注/,count+' 批注');
  }

  // ---- activation link ----
  function clearActive(){
    document.querySelectorAll('.hl.active').forEach(function(e){e.classList.remove('active');});
    document.querySelectorAll('.note.active,.mobnote.active').forEach(function(e){e.classList.remove('active');});
    activeNoteId=null; clearConnector();
  }
  function displayedNote(noteId){
    var selector=window.innerWidth<1280?'.mobnote':'.note';
    return document.querySelector(selector+'[data-note="'+noteId+'"]');
  }
  function activate(noteId, scrollNote){
    clearActive();
    var hls = document.querySelectorAll('.hl[data-note="'+noteId+'"]');
    var note = displayedNote(noteId);
    hls.forEach(function(h){h.classList.add('active');});
    if(note){ note.classList.add('active','seen');
      if(scrollNote) note.scrollIntoView({behavior:'smooth',block:'center'}); }
    activeNoteId=noteId; drawConnector(noteId);
  }

  document.addEventListener('click', function(e){
    if(e.target.closest('a')) return;
    var retry=e.target.closest('[data-retry-agent]');
    if(retry){ showAgent(retry.dataset.retryAgent,false,false); return; }
    var hl = e.target.closest('.hl');
    if(hl && !hl.classList.contains('dim')){ activate(hl.dataset.note, true); return; }
    var note = e.target.closest('.note,.mobnote');
    if(note){
      var id=note.dataset.note;
      var hl2=document.querySelector('.hl[data-note="'+id+'"]');
      activate(id,false);
      if(hl2) hl2.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
  });

  document.addEventListener('keydown',function(e){
    var hl=e.target.closest&&e.target.closest('.hl');
    if(hl&&!hl.classList.contains('dim')&&(e.key==='Enter'||e.key===' ')){
      e.preventDefault(); activate(hl.dataset.note,true);
    }
  });

  document.addEventListener('pointerover',function(e){
    var pair=e.target.closest&&e.target.closest('.hl,.note');
    if(pair&&pair.dataset.note) drawConnector(pair.dataset.note);
  });
  document.addEventListener('pointerout',function(e){
    var pair=e.target.closest&&e.target.closest('.hl,.note');
    if(pair&&!pair.contains(e.relatedTarget)) drawConnector(activeNoteId);
  });

  // ---- catalogue / reader routing and wheel ----
  function updateWheel(aid,isPreview){
    var focusedNode=document.activeElement;
    var activeIndex=AGENTS.indexOf(aid);
    var selectedIndex=AGENTS.indexOf(current);
    var visibleRange=window.innerWidth<1280?1:2;
    var activeName=agentName(aid);
    document.querySelectorAll('.navbtn').forEach(function(button,index){
      var distance=index-activeIndex;
      if(distance>AGENTS.length/2) distance-=AGENTS.length;
      if(distance<-AGENTS.length/2) distance+=AGENTS.length;
      var visible=Math.abs(distance)<=visibleRange;
      var accessibleName=agentName(button.dataset.target);
      button.dataset.agentLabel=accessibleName;
      button.classList.toggle('wheel-hidden',!visible);
      button.classList.toggle('active',index===selectedIndex);
      button.classList.toggle('preview',!!isPreview&&index===activeIndex);
      if(index===selectedIndex) button.setAttribute('aria-current','true');
      else button.removeAttribute('aria-current');
      button.setAttribute('aria-label',index===selectedIndex?'当前 Agent：'+accessibleName:'切换到 '+accessibleName);
      button.removeAttribute('title');
      if(visible){ button.dataset.slot=String(distance); button.removeAttribute('aria-hidden'); button.tabIndex=index===selectedIndex?0:-1; }
      else { delete button.dataset.slot; button.setAttribute('aria-hidden','true'); button.tabIndex=-1; }
    });
    if(!isPreview&&focusedNode&&focusedNode.matches('.navbtn.wheel-hidden')){
      document.querySelector('.navbtn.active').focus({preventScroll:true});
    }
    if(!isPreview){
      document.getElementById('wheelStatus').textContent='当前 Agent：'+activeName+'，第 '+(activeIndex+1)+' 项，共 '+AGENTS.length+' 项';
      document.getElementById('agentSelect').value=aid;
      searchInput.placeholder=usesCompactSearch()?'搜索内容':'搜索 '+activeName+' 的 Prompt / 批注';
    }
    document.getElementById('wheelCount').textContent=String(activeIndex+1).padStart(2,'0')+' / '+String(AGENTS.length).padStart(2,'0');
    document.getElementById('wheelMode').textContent=isPreview?'松手切换':'切换 Agent';
    document.getElementById('wheelPreview').textContent=activeName;
  }

  function pushRoute(hash){
    if(location.hash===hash) return;
    history.pushState(null,'',hash);
  }

  function showHome(doScroll, updateRoute){
    cancelWheelDrag();
    resetWheelGesture();
    readerLoading=false;
    var focusedReaderControl=document.activeElement.closest('.reader-action,.agent-wheel,#main,#chapterDialog');
    closeChapterOutline(document.getElementById('homeButton'),true);
    closePromptSearch(false);
    navigationToken++;
    document.body.classList.add('mode-home');
    document.body.classList.remove('mode-reader');
    document.body.removeAttribute('data-agent');
    document.querySelectorAll('.agentview').forEach(function(v){v.classList.remove('active');});
    clearActive(); clearSearchMarks();
    syncTopbarHeight();
    if(focusedReaderControl) requestAnimationFrame(function(){
      // Fragment navigation may reset focus after its hashchange handlers run.
      if(document.body.classList.contains('mode-home')) document.getElementById('homeButton').focus({preventScroll:true});
    });
    if(updateRoute) pushRoute('#home');
    if(doScroll) window.scrollTo({top:0,behavior:'smooth'});
  }

  async function showAgent(aid, doScroll, updateRoute){
    if(AGENTS.indexOf(aid)===-1) return;
    cancelWheelDrag();
    closeChapterOutline(document.getElementById('homeButton'),true);
    if(document.body.classList.contains('prompt-search-open')) closePromptSearch(document.activeElement===searchInput);
    var token=++navigationToken;
    document.body.classList.remove('mode-home');
    document.body.classList.add('mode-reader');
    document.body.dataset.agent=aid;
    readerLoading=true;
    chapterTrigger.disabled=true;
    clearSearchMarks();searchMatches=[];searchIndex=-1;updateSearchControls();
    syncTopbarHeight();
    document.querySelectorAll('.agentview').forEach(function(v){v.classList.remove('active');});
    current = aid;
    updateWheel(aid);
    if(updateRoute) pushRoute('#agent='+aid);
    if(!fragmentCache.has(aid)) renderLoadState(aid,false);
    var view;
    try{
      view=await loadAgent(aid);
    }catch(error){
      if(token===navigationToken){readerLoading=false;updateSearchControls();renderLoadState(aid,true);}
      console.error('Failed to load agent fragment',aid,error);
      return;
    }
    if(token!==navigationToken) return;
    agentMount.replaceChildren(view);
    view.classList.add('active');
    readerLoading=false;
    chapterTrigger.disabled=false;
    initializeAgent(aid,view);
    applyFilter();
    applySearch({reset:true,navigate:true});
    // reveal all src in this view immediately-ish then layout
    requestAnimationFrame(function(){
      view.querySelectorAll('.reveal').forEach(function(el){el.classList.add('shown');});
      distribute(aid);
      syncDisclosureAnnotations(aid);
      layout(aid);
      setTimeout(function(){layout(aid);},60);
    });
    if(doScroll){
      var m=view.querySelector('.masthead');
      if(m) m.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }

  var agentWheel=document.getElementById('agentWheel');
  var wheelSuppressClick=false;
  var agentNav=document.getElementById('agentnav');
  var agentSelect=document.getElementById('agentSelect');
  AGENTS.forEach(function(aid){
    var option=document.createElement('option');
    option.value=aid;option.textContent=agentName(aid);agentSelect.appendChild(option);
  });
  agentSelect.addEventListener('change',function(){resetWheelGesture();showAgent(this.value,true,true);});
  document.getElementById('agentnav').addEventListener('click',function(e){
    var b=e.target.closest('.navbtn'); if(!b) return;
    if(wheelSuppressClick&&e.detail!==0){e.preventDefault();return;}
    if(b.dataset.target===current) return;
    showAgent(b.dataset.target, true, true);
  });
  document.getElementById('cardgrid').addEventListener('click',function(e){
    var b=e.target.closest('.acard'); if(!b) return;
    showAgent(b.dataset.target, true, true);
  });
  document.getElementById('homeButton').addEventListener('click',function(){showHome(true,true);});
  document.getElementById('homeAction').addEventListener('click',function(){showHome(true,true);});
  document.addEventListener('click',function(e){
    var link=e.target.closest('.preview-open,.spectrum-link');
    if(!link||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey) return;
    var aid=link.hash.slice('#agent='.length);
    if(AGENTS.indexOf(aid)===-1) return;
    e.preventDefault();
    showAgent(aid,true,true);
  });

  // Search stays local to the lightweight catalogue; no prompt fragment is loaded.
  var catalogInput=document.getElementById('catalogSearch');
  var catalogSort=document.getElementById('catalogSort');
  var catalogCards=Array.from(document.querySelectorAll('.acard'));
  function updateCatalog(){
    var words=catalogInput.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    var count=0;
    catalogCards.forEach(function(card){
      var text=Array.from(card.querySelectorAll('.ac-name,.ac-vendor,.ac-lead')).map(function(el){return el.textContent;}).join(' ').toLocaleLowerCase();
      card.hidden=!words.every(function(word){return text.includes(word);});
      if(!card.hidden) count++;
    });
    var ordered=catalogCards.slice();
    if(catalogSort.value==='name') ordered.sort(function(a,b){return a.querySelector('.ac-name').textContent.localeCompare(b.querySelector('.ac-name').textContent,'en');});
    if(catalogSort.value==='notes') ordered.sort(function(a,b){return parseInt(b.querySelector('.ac-stats span').textContent,10)-parseInt(a.querySelector('.ac-stats span').textContent,10);});
    ordered.forEach(function(card){document.getElementById('cardgrid').appendChild(card);});
    document.getElementById('catalogCount').textContent=count+' / '+catalogCards.length+' 个 Agent';
    document.getElementById('catalogEmpty').hidden=count!==0;
  }
  catalogInput.addEventListener('input',updateCatalog);
  catalogSort.addEventListener('change',updateCatalog);
  document.getElementById('clearCatalogSearch').addEventListener('click',function(){catalogInput.value='';updateCatalog();catalogInput.focus();});
  catalogInput.addEventListener('keydown',function(e){if(e.key==='Escape'){catalogInput.value='';updateCatalog();}});
  updateCatalog();
  function rotateWheel(delta){
    var index=AGENTS.indexOf(current);
    showAgent(AGENTS[(index+delta+AGENTS.length)%AGENTS.length],true,true);
  }

  // A trackpad gesture may emit dozens of inertial events. Consume all of them,
  // accumulate small deltas, and navigate just once until the gesture settles.
  var wheelTravel=0, wheelCommitted=false, wheelIdle=null;
  function resetWheelGesture(){
    clearTimeout(wheelIdle);wheelIdle=null;wheelTravel=0;wheelCommitted=false;
  }
  agentNav.addEventListener('wheel',function(e){
    if(e.ctrlKey) return; // Preserve browser pinch-to-zoom.
    e.preventDefault();
    if(wheelDrag) return;
    clearTimeout(wheelIdle);
    wheelIdle=setTimeout(resetWheelGesture,180);
    if(wheelCommitted) return;
    var amount=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;
    var pixels=amount*(e.deltaMode===1?16:e.deltaMode===2?agentNav.clientHeight:1);
    if(wheelTravel&&Math.sign(pixels)!==Math.sign(wheelTravel)) wheelTravel=0;
    wheelTravel+=pixels;
    if(Math.abs(wheelTravel)<40) return;
    wheelCommitted=true;
    rotateWheel(wheelTravel>0?1:-1);
  },{passive:false});

  // The icon rail is the drag surface; the name menu retains native behavior.
  // Selection, route, ARIA current and live status only change when committed.
  var wheelDrag=null;
  agentNav.addEventListener('pointerdown',function(e){
    if(e.button!==0||e.isPrimary===false) return;
    wheelSuppressClick=false;
    resetWheelGesture();
    wheelDrag={id:e.pointerId,startX:e.clientX,startY:e.clientY,
      horizontal:window.innerWidth<1280,baseIndex:AGENTS.indexOf(current),
      previewIndex:AGENTS.indexOf(current),step:0,moved:false,captured:false};
  });
  agentNav.addEventListener('pointermove',function(e){
    if(!wheelDrag||wheelDrag.id!==e.pointerId) return;
    var movement=wheelDrag.horizontal?wheelDrag.startX-e.clientX:wheelDrag.startY-e.clientY;
    var cross=wheelDrag.horizontal?wheelDrag.startY-e.clientY:wheelDrag.startX-e.clientX;
    if(!wheelDrag.moved){
      if(Math.abs(movement)<=8||Math.abs(movement)<Math.abs(cross)) return;
      wheelDrag.moved=true;
      agentWheel.classList.add('dragging');
      if(agentNav.contains(document.activeElement)) agentNav.focus({preventScroll:true});
      try{agentNav.setPointerCapture(e.pointerId);wheelDrag.captured=agentNav.hasPointerCapture(e.pointerId);}catch(ignore){}
    }
    e.preventDefault();
    var step=Math.max(-6,Math.min(6,Math.round(movement/(wheelDrag.horizontal?64:52))));
    var remainder=Math.max(-18,Math.min(18,-movement+step*(wheelDrag.horizontal?64:52)));
    agentNav.style.setProperty('--drag-offset',remainder+'px');
    if(step!==wheelDrag.step){
      wheelDrag.step=step;
      wheelDrag.previewIndex=(wheelDrag.baseIndex+step+AGENTS.length)%AGENTS.length;
    }
    updateWheel(AGENTS[wheelDrag.previewIndex],true);
  });
  function finishWheelDrag(e,commit){
    if(!wheelDrag||wheelDrag.id!==e.pointerId) return;
    var drag=wheelDrag;wheelDrag=null;
    agentWheel.classList.remove('dragging');
    agentNav.style.removeProperty('--drag-offset');
    if(drag.captured){try{agentNav.releasePointerCapture(drag.id);}catch(ignore){}}
    if(drag.moved){
      wheelSuppressClick=true;
    }
    if(commit&&drag.previewIndex!==drag.baseIndex) showAgent(AGENTS[drag.previewIndex],true,true);
    else updateWheel(current);
    if(document.activeElement===agentNav) agentNav.querySelector('.navbtn.active').focus({preventScroll:true});
  }
  function cancelWheelDrag(){
    if(wheelDrag) finishWheelDrag({pointerId:wheelDrag.id},false);
  }
  agentNav.addEventListener('pointerup',function(e){finishWheelDrag(e,true);});
  agentNav.addEventListener('pointercancel',function(e){finishWheelDrag(e,false);});
  agentNav.addEventListener('lostpointercapture',function(e){
    // Touch starts with implicit capture on the pressed icon. Its capture-loss
    // event bubbles during the handoff to this rail and is not a cancellation.
    if(e.target===agentNav) finishWheelDrag(e,false);
  });
  // A short press can leave the rail before capture begins.
  window.addEventListener('pointerup',function(e){if(wheelDrag&&!wheelDrag.moved) finishWheelDrag(e,false);});
  window.addEventListener('blur',function(){cancelWheelDrag();resetWheelGesture();});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&wheelDrag){e.preventDefault();cancelWheelDrag();}
  });
  agentNav.addEventListener('keydown',function(e){
    var delta=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;
    if(!delta&&e.key!=='Home'&&e.key!=='End') return;
    e.preventDefault();
    e.stopPropagation();
    if(e.repeat) return;
    cancelWheelDrag();resetWheelGesture();
    if(delta) rotateWheel(delta);
    else showAgent(e.key==='Home'?AGENTS[0]:AGENTS[AGENTS.length-1],true,true);
    var active=agentNav.querySelector('.navbtn.active');
    if(active) active.focus({preventScroll:true});
  });

  // ---- category filter ----
  function applyFilter(){
    document.querySelectorAll('.note,.mobnote').forEach(function(n){
      var hidden = off[n.dataset.cat];
      n.classList.toggle('hide', !!hidden);
    });
    document.querySelectorAll('.hl').forEach(function(h){
      var hidden = off[h.dataset.cat];
      h.classList.toggle('dim', !!hidden);
    });
    layout(current);
  }
  document.getElementById('filterbar').addEventListener('click',function(e){
    var c=e.target.closest('.chip'); if(!c) return;
    var cat=c.dataset.cat;
    if(cat==='all'){ off={}; document.querySelectorAll('.chip').forEach(function(x){x.classList.remove('off');}); }
    else {
      off[cat]=!off[cat];
      c.classList.toggle('off', !!off[cat]);
      document.querySelector('.chip.all').classList.remove('off');
    }
    applyFilter();
    applySearch();
  });

  // ---- mobile inline notes ----
  function buildMobile(aid){
    if(window.innerWidth>=1280) return;
    var v=document.getElementById('view-'+aid);
    if(!v||v.dataset.mob) return;
    distribute(aid);
    v.querySelectorAll('.note').forEach(function(n){
      var id=n.dataset.note;
      var hl=v.querySelector('.hl[data-note="'+id+'"]');
      if(!hl) return;
      var mob=n.cloneNode(true);
      mob.classList.add('mobnote'); mob.classList.remove('note');
      mob.id='annotation-mobile-'+id;
      mob.style.top='';
      // insert after the paragraph containing hl
      var block=hl.closest('p,li,h1,h2,h3,h4,h5,h6,pre,details')||hl;
      if(block.parentNode) block.parentNode.insertBefore(mob, block.nextSibling);
    });
    v.dataset.mob="1";
    syncDisclosureAnnotations(aid);
  }

  // ---- current-view search ----
  function clearSearchMarks(){
    document.querySelectorAll('mark.search-hit').forEach(function(mark){
      var parent=mark.parentNode;
      if(!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent),mark);
      parent.normalize();
    });
  }
  function markMatches(root, query){
    if(!query) return 0;
    var count=0;
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
      acceptNode:function(node){
        var p=node.parentElement;
        if(!p || p.closest('script,style,summary,mark.search-hit,.q,.tag,.link-ref,.source-ref')) return NodeFilter.FILTER_REJECT;
        var note=p.closest('.note,.mobnote');
        if(note&&note!==root) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLowerCase().indexOf(query)>=0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
      }
    });
    var nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(node){
      var text=node.nodeValue, lower=text.toLowerCase(), frag=document.createDocumentFragment(), pos=0, idx;
      while((idx=lower.indexOf(query,pos))!==-1){
        frag.appendChild(document.createTextNode(text.slice(pos,idx)));
        var mark=document.createElement('mark'); mark.className='search-hit'; mark.textContent=text.slice(idx,idx+query.length);
        frag.appendChild(mark); count++; pos=idx+query.length;
      }
      frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag,node);
    });
    return count;
  }
  function updateSearchControls(){
    var count=searchMatches.length;
    var counter=document.getElementById('searchCount');
    counter.hidden=usesCompactSearch()&&!searchQuery;
    counter.textContent=searchQuery?(count?(searchIndex+1)+' / '+count:(readerLoading?'载入中':'无结果')):'⌘ K';
    counter.setAttribute('aria-label',searchQuery?(count?'第 '+(searchIndex+1)+' 处，共 '+count+' 处搜索结果':(readerLoading?'正在载入当前 Agent':'未找到匹配内容')):'搜索快捷键 Command 或 Control 加 K');
    searchNavigation.hidden=!searchQuery;
    document.body.classList.toggle('prompt-search-has-query',!!searchQuery);
    document.getElementById('searchPrevious').disabled=!count;
    document.getElementById('searchNext').disabled=!count;
  }
  function revealReaderTarget(target){
    var details=target.closest('details');
    while(details){
      details.open=true;
      details=details.parentElement&&details.parentElement.closest('details');
    }
  }
  function selectSearchResult(index,navigate){
    searchMatches.forEach(function(match){match.mark.classList.remove('search-current');});
    if(!searchMatches.length){searchIndex=-1;updateSearchControls();return;}
    searchIndex=(index+searchMatches.length)%searchMatches.length;
    var selected=searchMatches[searchIndex];
    selected.mark.classList.add('search-current');
    updateSearchControls();
    if(navigate){
      revealReaderTarget(selected.mark);
      if(selected.anchor) revealReaderTarget(selected.anchor);
      var note=selected.mark.closest('.note,.mobnote');
      if(note) note.classList.add('seen');
      syncDisclosureAnnotations(current);
      layout(current);
      selected.mark.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
  }
  function applySearch(options){
    options=options||{};
    var previous=searchMatches[searchIndex];
    var previousKey=previous&&previous.key;
    var previousIndex=searchIndex;
    clearSearchMarks();
    searchMatches=[];
    if(!searchQuery){searchIndex=-1;lastSearchQuery='';updateSearchControls();return;}
    var view=document.getElementById('view-'+current);
    if(view){
      var prose=view.querySelector('.prose-col');
      if(prose){
        markMatches(prose,searchQuery);
        var order=new Map();
        Array.prototype.forEach.call(prose.querySelectorAll('*'),function(node){
          if(!node.closest('.note,.mobnote')) order.set(node,order.size);
        });
        Array.prototype.forEach.call(prose.querySelectorAll('mark.search-hit'),function(mark,index){
          searchMatches.push({mark:mark,key:'source:'+index,order:order.get(mark),anchorOrder:0,within:0});
        });
        var noteSelector=window.innerWidth>=1280?'.note:not(.hide)':'.mobnote:not(.hide)';
        view.querySelectorAll(noteSelector).forEach(function(note){
          var anchor=prose.querySelector('.hl[data-note="'+note.dataset.note+'"]');
          if(!anchor) return;
          var block=anchor.closest('p,li,pre,h1,h2,h3,h4,h5,h6')||anchor;
          var after=order.get(block)||order.get(anchor)||0;
          block.querySelectorAll('*').forEach(function(node){if(order.has(node)) after=Math.max(after,order.get(node));});
          markMatches(note,searchQuery);
          note.querySelectorAll('mark.search-hit').forEach(function(mark,index){
            searchMatches.push({mark:mark,anchor:anchor,key:'note:'+note.dataset.note+':'+index,order:after+.5,anchorOrder:order.get(anchor)||0,within:index});
          });
        });
        searchMatches.sort(function(a,b){return a.order-b.order||a.anchorOrder-b.anchorOrder||a.within-b.within;});
      }
    }
    var reset=options.reset||lastSearchQuery!==searchQuery;
    var retained=reset?-1:searchMatches.findIndex(function(match){return match.key===previousKey;});
    lastSearchQuery=searchQuery;
    selectSearchResult(retained>=0?retained:(reset?0:Math.max(0,Math.min(previousIndex,searchMatches.length-1))),!!options.navigate);
  }
  document.getElementById('searchPrevious').addEventListener('click',function(){selectSearchResult(searchIndex-1,true);});
  document.getElementById('searchNext').addEventListener('click',function(){selectSearchResult(searchIndex+1,true);});
  function setPromptSearchExpanded(expanded){
    document.body.classList.toggle('prompt-search-open',expanded);
    if(searchToggle){
      searchToggle.setAttribute('aria-expanded',String(expanded));
      searchToggle.setAttribute('aria-label',expanded?'关闭搜索':'搜索提示词');
    }
  }
  function focusPromptSearch(){
    if(document.activeElement!==searchInput) searchReturnFocus=document.activeElement;
    setPromptSearchExpanded(usesCompactSearch());
    syncTopbarHeight();
    searchInput.focus({preventScroll:true});
    searchInput.select();
  }
  function closePromptSearch(restoreFocus){
    searchInput.value='';
    searchQuery='';
    setPromptSearchExpanded(false);
    applySearch();
    syncTopbarHeight();
    if(restoreFocus){
      var destination=usesCompactSearch()?searchToggle:searchReturnFocus;
      if(!destination||destination===searchInput||destination===document.body||!destination.isConnected||!destination.getClientRects().length) destination=document.getElementById('homeAction');
      destination.focus({preventScroll:true});
    }
    searchReturnFocus=null;
  }
  function syncPromptSearchViewport(){
    if(!document.body.classList.contains('mode-reader')) return;
    var focused=document.activeElement;
    if(!usesCompactSearch()){
      setPromptSearchExpanded(false);
      if(focused===searchToggle) searchInput.focus({preventScroll:true});
    }else{
      // A visible desktop search stays discoverable when the viewport narrows.
      if(focused===searchInput||searchQuery) setPromptSearchExpanded(true);
      if(focused===document.getElementById('homeAction')) document.getElementById('homeButton').focus({preventScroll:true});
      else if(focused===document.getElementById('copyLink')&&searchToggle) searchToggle.focus({preventScroll:true});
    }
  }
  if(searchToggle) searchToggle.addEventListener('click',function(){
    if(document.body.classList.contains('prompt-search-open')) closePromptSearch(true);
    else focusPromptSearch();
  });
  searchInput.addEventListener('input',function(){
    searchQuery=this.value.trim().toLowerCase();
    applySearch({reset:true,navigate:true});
  });
  searchInput.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.isComposing){e.preventDefault();selectSearchResult(searchIndex+(e.shiftKey?-1:1),true);}
  });

  // The outline is built from real source headings, independent of the Agent hash route.
  function sourceHeadings(view){
    if(!view) return [];
    return Array.prototype.filter.call(view.querySelectorAll('.prose-col h1,.prose-col h2,.prose-col h3'),function(heading){return !heading.closest('.note,.mobnote');});
  }
  function identifyHeadings(aid,view){
    var used=new Set();
    sourceHeadings(view).forEach(function(heading){
      var slug=heading.textContent.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g,'-').replace(/^-|-$/g,'').slice(0,64)||'section';
      var base='reader-'+aid+'-'+slug,id=base,suffix=2;
      while(used.has(id)) id=base+'-'+suffix++;
      used.add(id);heading.id=id;heading.tabIndex=-1;
    });
  }
  function closeChapterOutline(destination,clear){
    if(chapterDialog.open){chapterCloseFocus=destination||chapterTrigger;chapterDialog.close();}
    if(clear){chapterList.replaceChildren();document.getElementById('chapterContext').textContent='';}
  }
  chapterTrigger.addEventListener('click',function(){
    var view=document.getElementById('view-'+current);
    if(readerLoading||!view||!view.classList.contains('active')) return;
    var headings=sourceHeadings(view);
    chapterList.replaceChildren();
    var list=document.createElement('ol');
    headings.forEach(function(heading){
      var item=document.createElement('li');
      var button=document.createElement('button');
      button.type='button';button.className='chapter-option';button.dataset.headingId=heading.id;
      button.textContent=heading.textContent.trim();
      item.dataset.depth=heading.tagName.slice(1);item.appendChild(button);list.appendChild(item);
    });
    if(headings.length) chapterList.appendChild(list);
    else {var empty=document.createElement('p');empty.className='chapter-empty';empty.textContent='这份提示词没有分节标题，可使用搜索定位内容。';chapterList.appendChild(empty);}
    document.getElementById('chapterContext').textContent=agentName(current)+' · '+headings.length+' 个章节';
    cancelWheelDrag();resetWheelGesture();chapterCloseFocus=chapterTrigger;
    chapterDialog.showModal();
  });
  document.getElementById('closeChapterOutline').addEventListener('click',function(){closeChapterOutline(chapterTrigger);});
  chapterDialog.addEventListener('cancel',function(){chapterCloseFocus=chapterTrigger;});
  chapterDialog.addEventListener('close',function(){
    var destination=chapterCloseFocus;chapterCloseFocus=null;
    if(destination&&destination.isConnected&&destination.checkVisibility()) destination.focus({preventScroll:true});
  });
  chapterList.addEventListener('click',function(e){
    var button=e.target.closest('[data-heading-id]');if(!button) return;
    var heading=document.getElementById(button.dataset.headingId);if(!heading) return;
    revealReaderTarget(heading);syncDisclosureAnnotations(current);layout(current);
    closeChapterOutline(heading);
    var filter=document.getElementById('filterbar');
    var inset=document.querySelector('.topbar').offsetHeight+(filter?filter.offsetHeight:0)+20;
    window.scrollTo({top:window.scrollY+heading.getBoundingClientRect().top-inset,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  document.getElementById('copyLink').addEventListener('click',function(){
    var btn=this, label=document.getElementById('copyLabel'), url=location.href;
    navigator.clipboard.writeText(url).then(function(){
      label.textContent='已复制'; btn.setAttribute('aria-label','链接已复制'); setTimeout(function(){label.textContent='复制链接';btn.removeAttribute('aria-label');},1400);
    }).catch(function(){
      label.textContent='复制失败'; btn.setAttribute('aria-label','复制链接失败'); setTimeout(function(){label.textContent='复制链接';btn.removeAttribute('aria-label');},1400);
    });
  });
  document.addEventListener('keydown',function(e){
    if(chapterDialog.open) return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&document.body.classList.contains('mode-home')){e.preventDefault();catalogInput.focus();catalogInput.select();}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&document.body.classList.contains('mode-reader')){e.preventDefault();focusPromptSearch();}
    if(e.key==='Escape'&&(document.activeElement===searchInput||document.activeElement.closest('#searchNavigation')||document.body.classList.contains('prompt-search-open'))){e.preventDefault();closePromptSearch(true);}
    if((e.altKey||e.metaKey)&&(e.key==='ArrowRight'||e.key==='ArrowLeft')&&document.body.classList.contains('mode-reader')&&!e.target.closest('input,textarea,select,[contenteditable="true"]')){
      e.preventDefault();
      if(!e.repeat) rotateWheel(e.key==='ArrowRight'?1:-1);
    }
  });
  function routeFromLocation(){
    var m=location.hash.match(/^#agent=([a-z0-9-]+)$/);
    if(m&&AGENTS.indexOf(m[1])!==-1) showAgent(m[1],false,false);
    else showHome(false,false);
  }
  window.addEventListener('popstate',routeFromLocation);
  window.addEventListener('hashchange',routeFromLocation);

  // ---- scroll reveal (progressive) ----
  var io=new IntersectionObserver(function(ents){
    ents.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('shown'); io.unobserve(en.target);} });
  },{rootMargin:'0px 0px -8% 0px'});
  function observeReveal(aid){
    document.querySelectorAll('#view-'+aid+' .reveal').forEach(function(el){io.observe(el);});
  }

  // seen observer for notes
  var ion=new IntersectionObserver(function(ents){
    ents.forEach(function(en){ if(en.isIntersecting) en.target.classList.add('seen'); });
  },{rootMargin:'0px 0px -20% 0px'});

  function initializeAgent(aid,view){
    if(!view.dataset.initialized){
      distribute(aid);
      refreshAgentStats(aid,view);
      syncDisclosureAnnotations(aid);
      observeReveal(aid);
      view.querySelectorAll('.note').forEach(function(n){ion.observe(n);});
      view.dataset.initialized='1';
    }
    buildMobile(aid);
    identifyHeadings(aid,view);
  }

  // ---- init ----
  function init(){
    syncTopbarHeight();
    routeFromLocation();
    setTimeout(function(){if(document.body.classList.contains('mode-reader')) layout(current);},120);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){if(document.body.classList.contains('mode-reader')) layout(current);});
  }

  function syncTopbarHeight(){
    var bar=document.querySelector('.topbar');
    if(bar) document.documentElement.style.setProperty('--topbar-height',bar.offsetHeight+'px');
  }
  if(window.ResizeObserver) new ResizeObserver(function(){
    syncPromptSearchViewport();
    syncTopbarHeight();
  }).observe(document.querySelector('.topbar'));
  window.addEventListener('resize', function(){ cancelWheelDrag();resetWheelGesture();syncPromptSearchViewport();syncTopbarHeight(); buildMobile(current); updateWheel(current); if(document.body.classList.contains('mode-reader')){layout(current);applySearch();} });
  document.addEventListener('toggle', function(e){
    if(e.target&&e.target.classList&&e.target.classList.contains('rawblob')){
      setTimeout(function(){syncDisclosureAnnotations(current);layout(current);if(searchQuery) applySearch();},30);
    }
  }, true);

  // scroll top
  var toTop=document.getElementById('toTop');
  window.addEventListener('scroll',function(){
    toTop.classList.toggle('show', window.scrollY>600);
    document.querySelector('.topbar').classList.toggle('scrolled',window.scrollY>12);
  });
  toTop.addEventListener('click',function(){ window.scrollTo({top:0,behavior:'smooth'}); });

  window.__archiveDiagnostics={
    loadedAgents:function(){return Array.from(fragmentCache.keys());},
    currentAgent:function(){return current;}
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
