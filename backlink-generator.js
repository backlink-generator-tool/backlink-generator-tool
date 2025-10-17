let backlinkTemplates=['https://www.facebook.com/sharer/sharer.php?u=[ENCODE_URL]','https://twitter.com/intent/tweet?url=[ENCODE_URL]&text=[ENCODE_TITLE]'],
      youtubeBacklinkTemplates=['https://video.ultra-zone.net/watch.en.html.gz?v=[ID]','https://video.ultra-zone.net/watch.en.html.gz?v={{ID}}'],
      corsProxiesTemplates=['https://api.allorigins.win/raw?url=[ENCODE_URL]'];

  async function loadTemplates(){
    try {
      const [r1,r2,r3]=await Promise.all([
        fetch('https://backlink-generator-tool.github.io/backlink-generator-tool/backlink-templates.json'),
        fetch('https://backlink-generator-tool.github.io/backlink-generator-tool/youtube-backlink-templates.json'),
        fetch('https://backlink-generator-tool.github.io/backlink-generator-tool/cors-proxies.json')
      ]);
      if(r1.ok) backlinkTemplates=await r1.json();
      if(r2.ok) youtubeBacklinkTemplates=await r2.json();
      if(r3.ok) corsProxiesTemplates=await r3.json();
    } catch{}
  }
  
  function normalizeUrl(raw){
    try{ let u=raw.trim(); if(!/^https?:\/\//i.test(u)) u='https://'+u; const p=new URL(u); p.hostname=p.hostname.replace(/^www\./i,''); if(!p.pathname||p.pathname==='/' ) p.pathname=''; return p.toString(); }catch{return null;}
  }
  function buildMap(url,vid){
    const p=new URL(url),parts=p.hostname.split('.'),ln=parts.length;
    let map={PROTOCOL:p.protocol,SUBDOMAIN:ln>2?parts.slice(0,ln-2).join('.')+'.':'',DOMAINNAME:parts[ln-2]||'',TLD:parts[ln-1]||'',HOST:p.hostname,PORT:p.port?':'+p.port:'',PATH:p.pathname,QUERY:p.search,PARAMS:p.search?p.search.slice(1):'',FRAGMENT:p.hash,URL:url,DOMAIN:p.hostname};
    if(vid) map.ID=vid; Object.keys(map).forEach(k=>map['ENCODE_'+k]=encodeURIComponent(map[k])); return map;
  }
  // --- Robust placeholder replacer: handles [URL], [ENCODE_URL], {{URL}}, {{ENCODE_URL}} ---
	function replacePlaceholders(tpl, map) {
	  return tpl.replace(/\{\{(ENCODE_)?([A-Z_]+)\}\}|\[(ENCODE_)?([A-Z_]+)\]/g, (_, e1, k1, e2, k2) => {
	    const key = k1 || k2;
	    const needsEncode = e1 || e2;
	    let val = map[key];
	    if (val == null) return '';
	    if (needsEncode && !key.startsWith('ENCODE_')) {
	      try { val = encodeURIComponent(val); } catch { /* ignore */ }
	    }
	    return val;
	  });
	}



  function saveSettings(){ const s={mode:modeSelect.value,reuse:reuseToggle.value,conc:concurrencyRange.value,rerun:rerunCheckbox.checked,shuffle:shuffleCheckbox.checked}; document.cookie='bg='+encodeURIComponent(JSON.stringify(s))+';path=/;max-age=31536000'; }
  function loadSettings(){
    const c=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('bg='));
    if(c) try{const s=JSON.parse(decodeURIComponent(c.slice(3)));modeSelect.value=s.mode||'iframe';reuseToggle.value=s.reuse||'fresh';concurrencyRange.value=s.conc||5;rerunCheckbox.checked=s.rerun!==false;shuffleCheckbox.checked=s.shuffle!==false;concurrentCount.textContent=concurrencyRange.value;return;}catch{}
    modeSelect.value='iframe';reuseToggle.value='fresh';concurrencyRange.value=5;rerunCheckbox.checked=false;shuffleCheckbox.checked=true;concurrentCount.textContent=5;saveSettings();
  }

  const urlInput=document.getElementById('urlInput'),
        startBtn=document.getElementById('startBtn'),
        toggleAdv=document.getElementById('toggleAdvancedBtn'),
        advPanel=document.getElementById('advancedPanel'),
        modeSelect=document.getElementById('modeSelect'),
        reuseToggle=document.getElementById('reuseToggle'),
        concurrencyRange=document.getElementById('concurrencyRange'),
        concurrentCount=document.getElementById('concurrentCount'),
        rerunCheckbox=document.getElementById('rerunCheckbox'),
        shuffleCheckbox=document.getElementById('shuffleCheckbox'),
        newUrlInput=document.getElementById('newUrl'),
        copyBtn=document.getElementById('copyBtn'),
        downloadBtn=document.getElementById('downloadBtn'),
        progressBar=document.getElementById('progressBar'),
        progressText=document.getElementById('progressText'),
        resultsUl=document.getElementById('results');

	// ——— Add this below your existing UI refs ———
	function updateReuseToggleState() {
	  // Enable reuseToggle only when in popup/tab mode
	  reuseToggle.disabled = !(modeSelect.value === 'popup' || modeSelect.value === 'tab');
	}

	// Fire on startup and whenever mode changes
	modeSelect.addEventListener('change', updateReuseToggleState);
	//updateReuseToggleState();

  [modeSelect,reuseToggle,concurrencyRange,rerunCheckbox,shuffleCheckbox].forEach(el=>el.addEventListener('change',saveSettings));
  concurrencyRange.addEventListener('input',()=>{ concurrentCount.textContent=concurrencyRange.value; saveSettings(); });
  toggleAdv.addEventListener('click',()=>{ advPanel.style.display = advPanel.style.display==='none' ? 'block' : 'none'; });
  startBtn.addEventListener('click',()=> running ? stopRun() : startRun());
  copyBtn.addEventListener('click',()=>{ newUrlInput.select(); document.execCommand('copy'); });

  let running=false, queue=[], slots=[], totalTasks=0, doneCount=0;
  function updateProgress(){
    const pct = totalTasks ? Math.round(doneCount/totalTasks*100) : 0;
    progressBar.style.width = pct + '%';
    progressText.textContent = `${doneCount}/${totalTasks} (${pct}%)`;
  }

  async function launchSlot(slot){
    if(!running || slot.busy) return;
    const task = queue.shift();
    if(!task){ if(slots.every(s=>!s.busy)) finishRun(); return; }
    slot.busy=true;
    const {mode,url}=task;
    const li=document.createElement('li'); li.innerHTML=`<a href="${url}" target="_blank">${url}</a><span class="status loading">⏳</span>`; resultsUl.appendChild(li);
    const mark = ok => { clearTimeout(slot.timeoutId); slot.busy=false; doneCount++; const span=li.querySelector('.status'); span.textContent=ok?'✔︎':'✖︎'; span.className='status '+(ok?'success':'failure'); updateProgress(); launchSlot(slot); };

    if (mode === 'iframe') {
  const ifr = document.createElement('iframe');
	    
  //ifr.style.display = 'none';
  ifr.classList.add('hidden-iframe');
  /*
  if (classExists('hidden-iframe')) {
    ifr.classList.add('hidden-iframe');
  } else {
    ifr.style.display = 'none';
  }
  */
	    
  document.body.appendChild(ifr);

  // Helper to clean up the iframe
  const cleanup = () => ifr.remove();

  // On load, clear the timeout, remove the iframe, and mark success
  ifr.onload = () => {
    clearTimeout(slot.timeoutId);
    cleanup();
    mark(true);
  };

  // If we hit the timeout, remove the iframe and mark failure
  slot.timeoutId = setTimeout(() => {
    cleanup();
    mark(false);
  }, 8000);

  // Kick off the navigation
  ifr.src = url;

  return;  // skip the rest of the switch
} else if(mode==='popup' || mode==='tab'){
      const specs = mode==='popup' ? 'width=600,height=400' : '';
      if(reuseToggle.value==='fresh'){
        const w = window.open('about:blank','_blank',specs); if(!w){ alert('Pop-up blocked!'); mark(false); return; }
        w.location.href = url;
        slot.timeoutId = setTimeout(()=>{
          w.close(); mark(true);
        },8000);

      } else {
        if(!slot.ref || slot.ref.closed){
          slot.ref = window.open('about:blank','slot-'+slot.id,specs);
          if(!slot.ref){ alert('Pop-up blocked!'); mark(false); return; }
        }
        slot.ref.location.href = url;
        slot.timeoutId = setTimeout(()=>{
          mark(true);
        },8000);
      }

    } else if(mode==='ping'){
      let ok=false;
      for(const tpl of corsProxiesTemplates){
        try{ const proxyUrl = replacePlaceholders(tpl, buildMap(url)); const res = await fetch(proxyUrl); if(res.ok){ ok=true; break; }}catch{}
      }
      mark(ok);
    }
  }

  function startRun(){
    const raw = urlInput.value.trim()||location.search.slice(1);
    const norm = normalizeUrl(raw); if(!norm){ alert('Invalid URL'); return; }
    setExternalLink("Open URL", raw);
    urlInput.value = norm; saveSettings();
    running=true; queue=[]; slots.forEach(s=>s.ref&&s.ref.close()); resultsUl.innerHTML=''; totalTasks=0; doneCount=0;
    const vid=new URL(norm).searchParams.get('v');
    let templates = vid ? [...youtubeBacklinkTemplates,'https://web.archive.org/save/[URL]'] : backlinkTemplates.slice();
    if(shuffleCheckbox.checked) templates.sort(()=>Math.random()-0.5);
    templates.forEach(tpl=> queue.push({mode:modeSelect.value, url:replacePlaceholders(tpl, buildMap(norm,vid))}));
	
    totalTasks=queue.length; 
    updateProgress();
    //newUrlInput.value = location.origin+location.pathname+'?'+norm;
    newUrlInput.value = location.origin+'?'+norm;
	
      // update browser’s query string without reloading
      window.history.replaceState(null, '', location.pathname + '?' + norm);
	
    slots = Array.from({length:+concurrencyRange.value},(_,i)=>({id:i,busy:false,ref:null,timeoutId:null}));
    slots.forEach(s=>launchSlot(s)); startBtn.textContent='Stop';
  }

  function finishRun(){
    running=false; startBtn.textContent='Generate Backlinks'; slots.forEach(s=>s.ref&&s.ref.close()); if(rerunCheckbox.checked) setTimeout(startRun,500);
  }
  function stopRun(){
    running=false; queue=[]; startBtn.textContent='Generate Backlinks'; slots.forEach(s=>s.ref&&s.ref.close());
  }

  downloadBtn.addEventListener('click',()=>{
    const raw = urlInput.value.trim(), norm = normalizeUrl(raw); if(!norm){ alert('Invalid URL'); return; }
    const vid=new URL(norm).searchParams.get('v');
    let templates = vid ? [...youtubeBacklinkTemplates,'https://web.archive.org/save/[URL]'] : backlinkTemplates.slice();
    if(shuffleCheckbox.checked) templates.sort(()=>Math.random()-0.5);
    const urls = templates.map(tpl=>replacePlaceholders(tpl,buildMap(norm,vid)));
    const blob=new Blob([urls.join('\n')],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='backlinks.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  window.addEventListener('DOMContentLoaded', async()=>{
    loadSettings(); await loadTemplates();
    updateReuseToggleState();
    const param=location.search.slice(1);

    if(param){ 
        const norm=normalizeUrl(param); 
        if(norm){ 
            urlInput.value=norm;
            startRun(); 
        } else alert('Invalid URL'); 
    }else {
	const here = window.location.href.split('#')[0];
	const testUrl = here + (here.includes('?') ? '&' : '?') + here;
	setExternalLink("Open Test", testUrl);
    }
  });

function setExternalLink(txt, href){
    	const linkEl = document.getElementById("externalLink");
	linkEl.href = href;
	linkEl.style.display = "inline-block";
	linkEl.textContent = "🔗 "+txt+" → " + (new URL(href)).hostname;
}
