// backlink-generator.js (final v6.1)
// - Fix: popup/tab with "Reuse same window/tab" now truly reuses the same window in ARCHIVE_TLDS variant runner
// - Generalized archive.* per-URL variant logic (stop after first success)
// - Robust Stop (runToken guards, timers cleared, close popups/iframes), strict timeout handling
// - Blogger-safe ENCODE handling, CORS Ping first-success, 'Welcome to nginx' detection for archive.*

let backlinkTemplates = ['https://www.facebook.com/sharer/sharer.php?u=[ENCODE_URL]', 'https://twitter.com/intent/tweet?url=[ENCODE_URL]&text=[ENCODE_TITLE]'],
    youtubeBacklinkTemplates = ['https://video.ultra-zone.net/watch.en.html.gz?v=[ID]', 'https://video.ultra-zone.net/watch.en.html.gz?v={{ID}}'],
    corsProxiesTemplates = ['https://api.allorigins.win/raw?url=[ENCODE_URL]'];

const ARCHIVE_TLDS = ["archive.today","archive.li","archive.vn","archive.fo","archive.md","archive.ph","archive.is"];

// Run control for Stop
let runToken = 0;
let rerunTimer = null;
const activeIframes = new Set();
const activeWindows = new Set();

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
  } catch(e){console.warn('Failed to load remote templates:', e);}
}

function normalizeUrl(raw){
  try{
    let u = raw.trim();
    if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const p = new URL(u);
    p.hostname = p.hostname.replace(/^www\./i,'');
    if(!p.pathname || p.pathname === '/') p.pathname = '';
    return p.toString();
  } catch {return null;}
}

function buildMap(url, vid) {
  const p = new URL(url);
  const parts = p.hostname.split('.');
  const ln = parts.length;

 /**
   * buildMap creates a dictionary of reusable placeholders for template replacement.
   *
   * Example for URL: https://www.example.co.uk/path/page?x=1#section
   * -------------------------------------------------------------
   * PROTOCOL         → "https:"
   * SUBDOMAIN        → "www."
   * DOMAINNAME       → "example"
   * TLD              → "co.uk"
   * HOST             → "www.example.co.uk"
   * PORT             → "" or ":8080" if defined
   * PATH             → "/path/page"
   * QUERY            → "?x=1"
   * PARAMS           → "x=1"
   * FRAGMENT         → "#section"
   * URL              → "https://www.example.co.uk/path/page?x=1#section"
   * DOMAIN           → "www.example.co.uk"
   * NOPROTOCOL_URL   → "www.example.co.uk/path/page?x=1#section"
   * NOSUBDOMAIN_URL  → "example.co.uk/path/page?x=1#section"
   * ID               → YouTube video ID if extracted externally
   */
    
  const hostnameNoWWW = p.hostname.replace(/^www\./i,'');
  let map = {
    PROTOCOL: p.protocol,
    SUBDOMAIN: ln > 2 ? parts.slice(0, ln - 2).join('.') + '.' : '',
    DOMAINNAME: parts[ln - 2] || '',
    TLD: parts[ln - 1] || '',
    HOST: p.hostname,
    PORT: p.port ? ':' + p.port : '',
    PATH: p.pathname,
    QUERY: p.search,
    PARAMS: p.search ? p.search.slice(1) : '',
    FRAGMENT: p.hash,
    URL: url,
    DOMAIN: p.hostname,
    NOPROTOCOL_URL: `${p.hostname}${p.pathname}${p.search}${p.hash}`,
    NOSUBDOMAIN_URL: `${hostnameNoWWW}${p.pathname}${p.search}${p.hash}`
  };
  if (vid) map.ID = vid;

  Object.keys(map).forEach(k=>{
    try{map['ENCODE_'+k]=encodeURIComponent(map[k]);}
    catch{map['ENCODE_'+k]='';}
  });
  return map;
}

function replacePlaceholders(tpl, map) {
  return tpl.replace(/(\{\{|\[)\s*(ENCODE_)?([A-Z0-9_]+)\s*(\}\}|\])/gi,
    (match,open,encPrefix,key,close,offset,fullStr)=>{
      if(!key)return'';
      key=key.toUpperCase();
      const wantsEncode=!!encPrefix;
      if(wantsEncode){
        const encodedKey='ENCODE_'+key;
        if(map.hasOwnProperty(encodedKey))return map[encodedKey];
        try{return encodeURIComponent(map[key]||'');}catch{return'';}
      }
      if(key==='URL'){
        const before=fullStr.slice(Math.max(0,offset-30),offset).toLowerCase();
        if(/\burl\s*=\s*$/.test(before)||/\burl\s*=\s*/i.test(fullStr)){
          try{return encodeURIComponent(map['URL']||'');}catch{return map['URL']||'';}
        }
      }
      return map[key]||'';
  });
}

function generateUrl(tpl, normUrl, vid){
  if(!tpl)return'';
  tpl=tpl
    .replace(/%5B\s*(ENCODE_)?([A-Z0-9_]+)\s*%5D/gi,'[$1$2]')
    .replace(/&#(?:x5b|91);\s*(ENCODE_)?([A-Z0-9_]+)\s*&#(?:x5d|93);/gi,'[$1$2]')
    .replace(/\{\{\s*(ENCODE_)?([A-Z0-9_]+)\s*\}\}/gi,'[$1$2]')
    .replace(/%7B%7B\s*(ENCODE_)?([A-Z0-9_]+)\s*%7D%7D/gi,'[$1$2]');
  const map=buildMap(normUrl,vid);
  return replacePlaceholders(tpl,map);
}

// === Generalized ARCHIVE_TLDS helpers ===
function isArchiveHost(hostname){
  const h = (hostname||'').toLowerCase();
  return ARCHIVE_TLDS.includes(h);
}

function buildArchiveUrlVariants(finalUrl){
  try{
    const u = new URL(finalUrl);
    if(!isArchiveHost(u.hostname)) return null;
    return ARCHIVE_TLDS.map(tld => {
      const v = new URL(finalUrl);
      v.hostname = tld;
      return v.toString();
    });
  }catch{return null;}
}

// Settings & UI wires
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
      resultsUl=document.getElementById('results'),
      externalLink=document.getElementById('externalLink');

function updateReuseToggleState() {
  reuseToggle.disabled = !(modeSelect.value === 'popup' || modeSelect.value === 'tab');
}
modeSelect.addEventListener('change', updateReuseToggleState);

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

async function fetchWithTimeout(resource, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(resource, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    return { ok: false, __error: err };
  }
}

function isActive(slot){ return running && slot && slot.token === runToken; }

// Try a list of archive variant URLs, stop after first success (per-task)
async function tryArchiveVariantUrls(slot, variantUrls, mode) {
  for (let i=0;i<variantUrls.length;i++){
    if(!isActive(slot)) return false;
    const finalUrl = variantUrls[i];

    const li = document.createElement('li');
    li.innerHTML = `<a href="${finalUrl}" target="_blank" rel="noreferrer noopener">${finalUrl}</a> <span class="status loading">⏳</span>`;
    resultsUl.appendChild(li);
    const statusSpan = li.querySelector('.status');
    const markThis = ok => { if(!isActive(slot)) return; statusSpan.innerHTML=ok?'✔️':'✖️'; statusSpan.className='status '+(ok?'success':'failure'); };

    if (mode === 'iframe') {
      const ifr = document.createElement('iframe');
      ifr.classList.add('hidden-iframe');
      document.body.appendChild(ifr);
      activeIframes.add(ifr);
      let completed = false;
      let resolver = null;
      const cleanup = () => { try { ifr.remove(); } catch(e){} activeIframes.delete(ifr); };

      ifr.onload = () => {
        if (completed || !isActive(slot)) return;
        try {
          const frameTitle = ifr.contentDocument ? ifr.contentDocument.title : '';
          if (frameTitle && frameTitle.trim().toLowerCase() === 'welcome to nginx') {
            completed = true; markThis(false); cleanup(); if (resolver) resolver(); return;
          }
        } catch (e) { /* cross-origin; treat onload as success */ }
        completed = true; markThis(true); cleanup(); if (resolver) resolver();
      };

      await new Promise(resolve => {
        resolver = resolve;
        try { ifr.src = finalUrl; } catch(e){}
        slot.timeoutId = setTimeout(() => {
          if (!completed && isActive(slot)) { markThis(false); cleanup(); }
          resolve();
        }, 8000);
      });

      if (statusSpan.classList.contains('success')) return true;
      continue;
    }

    if (mode === 'popup' || mode === 'tab') {
      const specs = mode === 'popup' ? 'width=600,height=400' : '';
      const reuse = (reuseToggle && reuseToggle.value === 'reuse');

      if (reuse) {
        // Reuse the same named window/tab per slot
        if (!slot.ref || slot.ref.closed) {
          slot.ref = window.open('about:blank', 'slot-'+slot.id, specs);
          if (!slot.ref) { markThis(false); continue; }
          activeWindows.add(slot.ref);
        }
        let loaded = false;
        try { slot.ref.onload = () => { loaded = true; }; } catch(eAssign) {}
        try { slot.ref.location.href = finalUrl; } catch(eSet) {}

        await new Promise(resolve => {
          slot.timeoutId = setTimeout(() => {
            if (!isActive(slot)) return resolve();
            if (!loaded) { markThis(false); return resolve(); }
            try {
              const t = slot.ref.document ? slot.ref.document.title : '';
              if (t && t.trim().toLowerCase() === 'welcome to nginx') { markThis(false); }
              else { markThis(true); }
            } catch (eDoc) {
              // Cross-origin but onload fired: success
              markThis(true);
            }
            resolve();
          }, 8000);
        });

        if (statusSpan.classList.contains('success')) return true;
      } else {
        // Fresh window per attempt, then close
        try {
          const w = window.open('about:blank', '_blank', specs);
          if (!w) {
            markThis(false);
          } else {
            activeWindows.add(w);
            let loaded = false;
            try { w.onload = () => { loaded = true; }; } catch(eAssign){}
            try { w.location.href = finalUrl; } catch(eSet){}

            await new Promise(resolve => {
              slot.timeoutId = setTimeout(() => {
                if (!isActive(slot)) { try { w.close(); } catch{} activeWindows.delete(w); return resolve(); }
                if (!loaded) { try { w.close(); } catch{} activeWindows.delete(w); markThis(false); return resolve(); }
                try {
                  const t = w.document ? w.document.title : '';
                  if (t && t.trim().toLowerCase() === 'welcome to nginx') { markThis(false); }
                  else { markThis(true); }
                  try { w.close(); } catch{}
                } catch (eDoc) {
                  markThis(true);
                  try { w.close(); } catch{}
                }
                activeWindows.delete(w);
                resolve();
              }, 8000);
            });

            if (statusSpan.classList.contains('success')) return true;
          }
        } catch { markThis(false); }
      }
      continue;
    }

    if (mode === 'ping') {
      let ok = false;
      for (const proxyTpl of corsProxiesTemplates) {
        if (!isActive(slot)) return false;
        try {
          const proxyUrl = generateUrl(proxyTpl, finalUrl);
          if (!proxyUrl) continue;
          try {
            const res = await fetchWithTimeout(proxyUrl, 5000);
            if (res && res.ok) { ok = true; break; }
          } catch {}
        } catch {}
      }
      markThis(ok);
      if (ok) return true;
      continue;
    }

    // Fallback direct fetch
    try {
      const res = await fetchWithTimeout(finalUrl, 5000);
      const ok = !!(res && res.ok);
      markThis(ok);
      if (ok) return true;
    } catch {
      markThis(false);
    }
  }
  return false;
}

async function launchSlot(slot){
  if(!isActive(slot)) return;
  const task = queue.shift();
  if(!task){
    if(slots.every(s=>!s.busy)) finishRun();
    return;
  }
  slot.busy=true;

  // Archive variant group task
  if (task.archiveVariants && task.archiveVariants.length){
    try { await tryArchiveVariantUrls(slot, task.archiveVariants, task.mode); } catch {}
    if (!isActive(slot)) return;
    doneCount++; updateProgress(); slot.busy=false; if (isActive(slot)) launchSlot(slot);
    return;
  }

  // Normal task
  const {mode,url} = task;
  const li=document.createElement('li'); li.innerHTML=`<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a><span class="status loading">⏳</span>`; resultsUl.appendChild(li);
  const mark = ok => { if (!isActive(slot)) return; clearTimeout(slot.timeoutId); slot.busy=false; doneCount++; const span=li.querySelector('.status'); span.innerHTML=ok?'✔️':'✖️'; span.className='status '+(ok?'success':'failure'); updateProgress(); if (isActive(slot)) launchSlot(slot); };

  if (mode === 'iframe') {
    const ifr = document.createElement('iframe');
    ifr.classList.add('hidden-iframe');
    document.body.appendChild(ifr);
    activeIframes.add(ifr);
    const cleanup = () => { try{ ifr.remove(); }catch(e){} activeIframes.delete(ifr); };
    ifr.onload = () => { if (isActive(slot)) { clearTimeout(slot.timeoutId); cleanup(); mark(true); } else { cleanup(); } };
    slot.timeoutId = setTimeout(() => { cleanup(); mark(false); }, 8000);
    ifr.src = url;
    return;
  } else if(mode==='popup' || mode==='tab'){
    const specs = mode==='popup' ? 'width=600,height=400' : '';
    if(reuseToggle.value==='fresh'){
      const w = window.open('about:blank','_blank',specs); if(!w){ alert('Pop-up blocked!'); mark(false); return; }
      activeWindows.add(w);
      w.location.href = url;
      slot.timeoutId = setTimeout(()=>{ try{ w.close(); }catch(e){} activeWindows.delete(w); mark(true); },8000);
    } else {
      if(!slot.ref || slot.ref.closed){
        slot.ref = window.open('about:blank','slot-'+slot.id,specs);
        if(!slot.ref){ alert('Pop-up blocked!'); mark(false); return; }
      }
      activeWindows.add(slot.ref);
      slot.ref.location.href = url;
      slot.timeoutId = setTimeout(()=>{ activeWindows.delete(slot.ref); mark(true); },8000);
    }

  } else if(mode==='ping'){
    const PROXY_TIMEOUT = 5000;
    let ok=false;
    for (const tpl of corsProxiesTemplates) {
      if (!isActive(slot)) return;
      try {
        const proxyUrl = generateUrl(tpl, url);
        if (!proxyUrl) continue;
        try {
          const res = await fetchWithTimeout(proxyUrl, PROXY_TIMEOUT);
          if (res && res.ok) { ok = true; break; }
        } catch {}
      } catch {}
    }
    mark(ok);
  } else {
    try {
      const res = await fetchWithTimeout(url, 5000);
      mark(res && res.ok);
    } catch (e) {
      mark(false);
    }
  }
}

function startRun(){
  const raw = urlInput.value.trim()||location.search.slice(1);
  const norm = normalizeUrl(raw); if(!norm){ alert('Invalid URL'); return; }
  setExternalLink("Open URL", raw);
  urlInput.value = norm; saveSettings();

  // Reset run state
  runToken++;
  const thisToken = runToken;
  running=true; queue=[];
  slots.forEach(s=>{ try{ s.ref && s.ref.close(); }catch(e){}; });
  resultsUl.innerHTML=''; totalTasks=0; doneCount=0;

  if (rerunTimer) { clearTimeout(rerunTimer); rerunTimer = null; }

  const vid = new URL(norm).searchParams.get('v');
  let templates = vid ? [...youtubeBacklinkTemplates,'https://web.archive.org/save/[URL]'] : backlinkTemplates.slice();
  if (shuffleCheckbox.checked) templates.sort(()=>Math.random()-0.5);

  // NEW: avoid duplicate archive groups (same path+query across archive TLDs)
  const archiveGroupKeys = new Set();

  // Build queue with generalized archive variant grouping
  const mode = modeSelect.value;
  for (const tpl of templates){
    try {
      const finalUrl = generateUrl(tpl, norm, vid);
      if (!finalUrl || !finalUrl.trim()) continue;

      let isArchive = false, u = null;
      try { u = new URL(finalUrl); isArchive = isArchiveHost(u.hostname); } catch {}

      if (isArchive) {
        // Key = protocol + path + search + hash, but WITHOUT hostname (so TLD variants are the same group)
        const groupKey = `${u.protocol}//${u.pathname}${u.search}${u.hash}`;
        if (archiveGroupKeys.has(groupKey)) {
          // duplicate group → skip
          continue;
        }
        archiveGroupKeys.add(groupKey);

        const variants = buildArchiveUrlVariants(finalUrl);
        if (variants && variants.length) {
          queue.push({ mode, archiveVariants: variants });
          continue;
        }
      }

      // Non-archive or no variants built
      queue.push({ mode, url: finalUrl });
    } catch {}
  }

  totalTasks = queue.length;
  updateProgress();
  newUrlInput.value = location.origin + '?' + norm;
  window.history.replaceState(null, '', location.pathname + '?' + norm);
  slots = Array.from({length:+concurrencyRange.value},(_,i)=>({id:i,busy:false,ref:null,timeoutId:null,token:thisToken}));
  slots.forEach(s=>launchSlot(s)); startBtn.textContent='Stop';
}


function finishRun(){
  if (!running) return;
  running=false; startBtn.textContent='Generate Backlinks';
  slots.forEach(s=>{ try{ s.ref && s.ref.close(); }catch(e){}; s.timeoutId && clearTimeout(s.timeoutId); s.timeoutId=null; });
  if(rerunCheckbox.checked){
    rerunTimer = setTimeout(startRun,500);
  }
}

function stopRun(){
  running=false; queue=[]; startBtn.textContent='Generate Backlinks';
  if (rerunTimer) { clearTimeout(rerunTimer); rerunTimer=null; }
  slots.forEach(s=>{
    if (s.timeoutId){ try{ clearTimeout(s.timeoutId); }catch(e){}; s.timeoutId=null; }
    try { s.ref && s.ref.close(); } catch(e){}
  });
  activeWindows.forEach(w=>{ try{ w.close(); }catch(e){} });
  activeWindows.clear();
  activeIframes.forEach(ifr=>{ try{ ifr.remove(); }catch(e){} });
  activeIframes.clear();
}

downloadBtn.addEventListener('click',()=>{
  const raw = urlInput.value.trim(), norm = normalizeUrl(raw); if(!norm){ alert('Invalid URL'); return; }
  const vid=new URL(norm).searchParams.get('v');
  let templates = vid ? [...youtubeBacklinkTemplates,'https://web.archive.org/save/[URL]'] : backlinkTemplates.slice();
  if(shuffleCheckbox.checked) templates.sort(()=>Math.random()-0.5);
  const urls = templates.map(tpl => {
    try { return generateUrl(tpl, norm, vid); } catch { return ''; }
  }).filter(Boolean);
  const blob=new Blob([urls.join('\n')],{type:'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='backlinks.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
  } else {
    const here = window.location.href.split('#')[0];
    const testUrl = here + (here.includes('?') ? '&' : '?') + here;
    setExternalLink("Open Test", testUrl);
  }
});

function setExternalLink(txt, href){
  const linkEl = externalLink || document.getElementById('externalLink');
  if(!linkEl) return;
  linkEl.href = href;
  linkEl.style.display = "inline-block";
  try { linkEl.innerHTML = "🔗 " + txt + " → " + (new URL(href)).hostname; } catch { linkEl.innerHTML = "🔗 " + txt; }
}

 /**
   * Spawn a hidden iframe that hits the Wayback Save API for the given URL.
   * The iframe is appended directly to document.body and removed after 3 minutes.
   * @param {string} targetUrl - The URL to archive (defaults to window.location.href)
   */
  function spawnWaybackSaver(targetUrl) {
    const url = (typeof targetUrl === "string" && targetUrl.trim()) ? targetUrl.trim() : window.location.href;

    // Create the hidden iframe
    const iframe = document.createElement("iframe");
    iframe.title = "Background Wayback Saver";
    iframe.referrerPolicy = "no-referrer-when-downgrade";

    iframe.className = "hidden-iframe";
   
    /*
    // Apply inline styles (completely invisible but functional)
    Object.assign(iframe.style, {
      position: "fixed",
      width: "0",
      height: "0",
      border: "0",
      left: "0",
      bottom: "0",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "-1"
    });
    */

    // Build Wayback Save URL
    //const waybackUrl = "https://web.archive.org/save/" + encodeURIComponent(url);
    const waybackUrl = "https://web.archive.org/save/" + url;

    // Append to the body and load
    document.body.appendChild(iframe);
    iframe.src = waybackUrl;

    // Auto-remove after 3 minutes (180000 ms)
    const ttl = setTimeout(() => {
      try { iframe.remove(); } catch (_) {}
      clearTimeout(ttl);
    }, 180000);
  }

  /**
   * Hook into your existing Start button (id="startStopBtn").
   * Each press spawns a background iframe that auto-closes after 3 minutes.
   */
  function wireStartButton() {
    const btn = document.getElementById("startBtn");
    if (!btn) return;
    if (btn.dataset.bgWaybackWired === "1") return;
    btn.dataset.bgWaybackWired = "1";

    btn.addEventListener("click", () => {
        if(!running) {
              spawnWaybackSaver(window.location.href);
        }
    });
  }

  // Initialize once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireStartButton, { once: true });
  } else {
    wireStartButton();
  }

  // Expose function globally for manual triggering
  window.spawnWaybackSaver = spawnWaybackSaver;
