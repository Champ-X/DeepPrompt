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
    document.querySelectorAll('.note.active').forEach(function(e){e.classList.remove('active');});
    activeNoteId=null; clearConnector();
  }
  function activate(noteId, scrollNote){
    clearActive();
    var hls = document.querySelectorAll('.hl[data-note="'+noteId+'"]');
    var note = document.querySelector('.note[data-note="'+noteId+'"]');
    hls.forEach(function(h){h.classList.add('active');});
    if(note){ note.classList.add('active','seen');
      if(scrollNote) note.scrollIntoView({behavior:'smooth',block:'center'}); }
    activeNoteId=noteId; drawConnector(noteId);
  }

  document.addEventListener('click', function(e){
    var retry=e.target.closest('[data-retry-agent]');
    if(retry){ showAgent(retry.dataset.retryAgent,false,false); return; }
    var hl = e.target.closest('.hl');
    if(hl && !hl.classList.contains('dim')){ activate(hl.dataset.note, true); return; }
    var note = e.target.closest('.note');
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
    if(hl&&(e.key==='Enter'||e.key===' ')){
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
    var activeIndex=AGENTS.indexOf(aid);
    var visibleRange=window.innerWidth<1280?1:2;
    var activeButton=document.querySelector('.navbtn[data-target="'+aid+'"] .nb-name');
    var activeName=activeButton?activeButton.textContent.trim():aid;
    document.querySelectorAll('.navbtn').forEach(function(button,index){
      var distance=index-activeIndex;
      if(distance>AGENTS.length/2) distance-=AGENTS.length;
      if(distance<-AGENTS.length/2) distance+=AGENTS.length;
      var visible=Math.abs(distance)<=visibleRange;
      var name=button.querySelector('.nb-name');
      var accessibleName=name?name.textContent.trim():button.dataset.target;
      button.dataset.agentLabel=accessibleName;
      button.classList.toggle('wheel-hidden',!visible);
      button.classList.toggle('active',index===activeIndex);
      button.toggleAttribute('aria-current',index===activeIndex);
      button.setAttribute('aria-label',index===activeIndex?'当前 Agent：'+accessibleName:'切换到 '+accessibleName);
      button.title=accessibleName;
      if(visible){ button.dataset.slot=String(distance); button.removeAttribute('aria-hidden'); button.tabIndex=index===activeIndex?0:-1; }
      else { delete button.dataset.slot; button.setAttribute('aria-hidden','true'); button.tabIndex=-1; }
    });
    var status=document.getElementById('wheelStatus');
    if(status) status.textContent=(isPreview?'预览 Agent：':'当前 Agent：')+activeName+'，第 '+(activeIndex+1)+' 项，共 '+AGENTS.length+' 项';
    var wheel=document.getElementById('agentWheel');
    if(wheel) wheel.dataset.index=String(activeIndex+1).padStart(2,'0')+' / '+String(AGENTS.length).padStart(2,'0');
    var promptSearch=document.getElementById('promptSearch');
    if(promptSearch&&!isPreview) promptSearch.placeholder='搜索 '+activeName+' 的 Prompt / 批注';
  }

  function pushRoute(hash){
    if(location.hash===hash) return;
    history.pushState(null,'',hash);
  }

  function showHome(doScroll, updateRoute){
    navigationToken++;
    document.body.classList.add('mode-home');
    document.body.classList.remove('mode-reader');
    document.body.removeAttribute('data-agent');
    document.querySelectorAll('.agentview').forEach(function(v){v.classList.remove('active');});
    clearActive(); clearSearchMarks();
    if(updateRoute) pushRoute('#home');
    if(doScroll) window.scrollTo({top:0,behavior:'smooth'});
  }

  async function showAgent(aid, doScroll, updateRoute){
    if(AGENTS.indexOf(aid)===-1) return;
    var token=++navigationToken;
    document.body.classList.remove('mode-home');
    document.body.classList.add('mode-reader');
    document.body.dataset.agent=aid;
    document.querySelectorAll('.agentview').forEach(function(v){v.classList.remove('active');});
    current = aid;
    updateWheel(aid);
    if(updateRoute) pushRoute('#agent='+aid);
    if(!fragmentCache.has(aid)) renderLoadState(aid,false);
    var view;
    try{
      view=await loadAgent(aid);
    }catch(error){
      if(token===navigationToken) renderLoadState(aid,true);
      console.error('Failed to load agent fragment',aid,error);
      return;
    }
    if(token!==navigationToken) return;
    agentMount.replaceChildren(view);
    view.classList.add('active');
    initializeAgent(aid,view);
    applyFilter();
    applySearch();
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
  document.getElementById('agentnav').addEventListener('click',function(e){
    var b=e.target.closest('.navbtn'); if(!b) return;
    if(wheelSuppressClick){e.preventDefault();return;}
    if(b.dataset.target===current) return;
    showAgent(b.dataset.target, true, true);
  });
  document.getElementById('cardgrid').addEventListener('click',function(e){
    var b=e.target.closest('.acard'); if(!b) return;
    showAgent(b.dataset.target, true, true);
  });
  document.getElementById('homeButton').addEventListener('click',function(){showHome(true,true);});
  document.getElementById('homeAction').addEventListener('click',function(){showHome(true,true);});
  function rotateWheel(delta){
    var index=AGENTS.indexOf(current);
    showAgent(AGENTS[(index+delta+AGENTS.length)%AGENTS.length],true,true);
    agentWheel.classList.remove('is-rotating');
    requestAnimationFrame(function(){agentWheel.classList.add('is-rotating');});
    setTimeout(function(){agentWheel.classList.remove('is-rotating');},360);
  }
  var wheelLock=false;
  agentWheel.addEventListener('wheel',function(e){
    var amount=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;
    if(Math.abs(amount)<8||wheelLock) return;
    e.preventDefault(); wheelLock=true; rotateWheel(amount>0?1:-1);
    setTimeout(function(){wheelLock=false;},260);
  },{passive:false});

  // Dragging previews the spectrum rail; releasing commits one navigation change.
  var wheelDrag=null;
  agentWheel.addEventListener('pointerdown',function(e){
    if(e.pointerType==='mouse'&&e.button!==0) return;
    wheelDrag={
      id:e.pointerId,
      startX:e.clientX,
      startY:e.clientY,
      baseIndex:AGENTS.indexOf(current),
      previewIndex:AGENTS.indexOf(current),
      step:0,
      moved:false,
      captured:false
    };
    agentWheel.classList.add('dragging');
  });
  agentWheel.addEventListener('pointermove',function(e){
    if(!wheelDrag||wheelDrag.id!==e.pointerId) return;
    var travel=Math.hypot(e.clientX-wheelDrag.startX,e.clientY-wheelDrag.startY);
    if(travel>8&&!wheelDrag.moved){
      wheelDrag.moved=true;
      try{
        agentWheel.setPointerCapture(e.pointerId);
        wheelDrag.captured=agentWheel.hasPointerCapture(e.pointerId);
      }catch(ignore){}
    }
    var step;
    if(window.innerWidth<1280) step=Math.round((wheelDrag.startX-e.clientX)/52);
    else step=Math.round((wheelDrag.startY-e.clientY)/44);
    step=Math.max(-6,Math.min(6,step));
    if(step!==wheelDrag.step){
      wheelDrag.step=step;
      wheelDrag.previewIndex=(wheelDrag.baseIndex+step+AGENTS.length)%AGENTS.length;
      updateWheel(AGENTS[wheelDrag.previewIndex],true);
    }
    if(wheelDrag.moved) e.preventDefault();
  });
  function finishWheelDrag(e,commit){
    if(!wheelDrag||wheelDrag.id!==e.pointerId) return;
    var drag=wheelDrag;
    wheelDrag=null;
    agentWheel.classList.remove('dragging');
    if(drag.captured){try{agentWheel.releasePointerCapture(e.pointerId);}catch(ignore){}}
    if(drag.moved){
      wheelSuppressClick=true;
      setTimeout(function(){wheelSuppressClick=false;},120);
    }
    if(commit&&drag.previewIndex!==drag.baseIndex){
      showAgent(AGENTS[drag.previewIndex],true,true);
      agentWheel.classList.add('is-rotating');
      setTimeout(function(){agentWheel.classList.remove('is-rotating');},360);
    }else updateWheel(current);
  }
  agentWheel.addEventListener('pointerup',function(e){finishWheelDrag(e,true);});
  agentWheel.addEventListener('pointercancel',function(e){finishWheelDrag(e,false);});
  agentWheel.addEventListener('lostpointercapture',function(e){
    if(wheelDrag&&wheelDrag.id===e.pointerId) finishWheelDrag(e,false);
  });
  agentWheel.addEventListener('keydown',function(e){
    var delta=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;
    if(!delta) return;
    e.preventDefault();
    rotateWheel(delta);
    requestAnimationFrame(function(){
      var active=agentWheel.querySelector('.navbtn.active');
      if(active) active.focus({preventScroll:true});
    });
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
        if(!p || p.closest('script,style,summary,mark.search-hit')) return NodeFilter.FILTER_REJECT;
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
  function applySearch(){
    clearSearchMarks();
    var counter=document.getElementById('searchCount');
    if(!searchQuery){ counter.textContent='⌘ K'; return; }
    var view=document.getElementById('view-'+current);
    var count=0;
    if(view){
      var prose=view.querySelector('.prose-col');
      if(prose) count+=markMatches(prose,searchQuery);
      var noteSelector=window.innerWidth>=1280?'.note:not(.hide):not(.anchor-collapsed)':'.mobnote:not(.hide)';
      view.querySelectorAll(noteSelector).forEach(function(n){ count+=markMatches(n,searchQuery); });
    }
    counter.textContent=count+' 处';
    var first=view&&view.querySelector('mark.search-hit');
    if(first) first.scrollIntoView({behavior:'smooth',block:'center'});
  }
  var searchInput=document.getElementById('promptSearch');
  searchInput.addEventListener('input',function(){
    searchQuery=this.value.trim().toLowerCase();
    applySearch();
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
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&document.body.classList.contains('mode-reader')){e.preventDefault();searchInput.focus();searchInput.select();}
    if(e.key==='Escape'&&document.activeElement===searchInput){searchInput.value='';searchQuery='';applySearch();searchInput.blur();}
    if((e.altKey||e.metaKey)&&e.key==='ArrowRight'&&document.body.classList.contains('mode-reader')){e.preventDefault();rotateWheel(1);}
    if((e.altKey||e.metaKey)&&e.key==='ArrowLeft'&&document.body.classList.contains('mode-reader')){e.preventDefault();rotateWheel(-1);}
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
  window.addEventListener('resize', function(){ syncTopbarHeight(); buildMobile(current); updateWheel(current); if(document.body.classList.contains('mode-reader')){layout(current);applySearch();} });
  document.addEventListener('toggle', function(e){
    if(e.target&&e.target.classList&&e.target.classList.contains('rawblob')){
      setTimeout(function(){syncDisclosureAnnotations(current);layout(current);},30);
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
