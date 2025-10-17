// backlink-generator.js (updated)
// - Removed console.debug lines
// - Skipped archive submit templates are shown with ✔︎ and counted as done

let backlinkTemplates = ['https://www.facebook.com/sharer/sharer.php?u=[ENCODE_URL]','https://twitter.com/intent/tweet?url=[ENCODE_URL]&text=[ENCODE_TITLE]'],
    youtubeBacklinkTemplates = ['https://video.ultra-zone.net/watch.en.html.gz?v=[ID]','https://video.ultra-zone.net/watch.en.html.gz?v={{ID}}'],
    corsProxiesTemplates = ['https://api.allorigins.win/raw?url=[ENCODE_URL]'];

// ---------- Archive-TLD handling ----------
const ARCHIVE_TLDS = ["archive.today","archive.li","archive.vn","archive.fo","archive.md","archive.ph","archive.is"];
let archiveSubmitSucceeded = false; // reset each run

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
  } catch(e){
    console.warn('Failed to load remote templates:', e);
  }
}

function normalizeUrl(raw){
  try{
    let u = raw.trim();
    if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const p = new URL(u);
    p.hostname = p.hostname.replace(/^www\./i,'');
    if(!p.pathname || p.pathname === '/') p.pathname = '';
    return p.toString();
  } catch {
    return null;
  }
}

function buildMap(url, vid){
  const p = new URL(url);
  const parts = p.hostname.split('.');
  const ln = parts.length;
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
    DOMAIN: p.hostname
  };
  if (vid) map.ID = vid;

  // precompute ENCODE_* copies for compatibility
  Object.keys(map).forEach(k => {
    try { map['ENCODE_' + k] = encodeURIComponent(map[k]); } catch { map['ENCODE_' + k] = ''; }
  });

  return map;
}

function replacePlaceholders(tpl, map) {
  return tpl.replace(/(\{\{|\[)\s*(ENCODE_)?([A-Z0-9_]+)\s*(\}\}|\])/gi, function(match, open, encPrefix, key){
    if(!key) return '';
    key = key.toUpperCase();
    const wantsEncode = !!encPrefix;

    if (wantsEncode) {
      const encodedKey = 'ENCODE_' + key;
      if (map.hasOwnProperty(encodedKey) && map[encodedKey] !== undefined) {
        return String(map[encodedKey]);
      }
      const base = map.hasOwnProperty(key) && map[key] !== undefined ? String(map[key]) : '';
      try { return encodeURIComponent(base); } catch { return base; }
    } else {
      return map.hasOwnProperty(key) && map[key] !== undefined ? String(map[key]) : '';
    }
  });
}

function generateUrl(tpl, normUrl, vid) {
  const map = buildMap(normUrl, vid);
  const final = replacePlaceholders(tpl, map);
  // debug removed as requested
  return final;
}

function buildArchiveVariants(tpl) {
  const found = ARCHIVE_TLDS.find(h => tpl.toLowerCase().includes(h));
  if (!found) return [tpl];
  return ARCHIVE_TLDS.map(tld => tpl.replace(new RegExp(found, 'ig'), tld));
}

// ---------- UI / Settings / bindings ----------
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
    throw err;
  }
}

async function tryArchiveVariants(slot, task) {
  if (archiveSubmitSucceeded) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>Archive Submit</strong> - skipped (one succeeded earlier). Tried: ${ARCHIVE_TLDS.join(', ')} <span class="status success">✔︎</span>`;
    resultsUl.appendChild(li);
    // We do not increment doneCount here because the caller of this helper (launchSlot)
    // will increment doneCount for the composite summary item.
    return true;
  }

  const variants = buildArchiveVariants(task.template);

  for (const varTpl of variants) {
    const finalUrl = generateUrl(varTpl, task.norm, task.vid);
    const li = document.createElement('li');
    li.innerHTML = `<a href="${finalUrl}" target="_blank" rel="noreferrer noopener">${finalUrl}</a> <span class="status loading">⏳</span>`;
    resultsUl.appendChild(li);
    const statusSpan = li.querySelector('.status');

    const markThis = ok => {
      statusSpan.textContent = ok ? '✔︎' : '✖︎';
      statusSpan.className = 'status ' + (ok ? 'success' : 'failure');
    };

    if (task.mode === 'iframe') {
      const ifr = document.createElement('iframe');
      ifr.classList.add('hidden-iframe');
      document.body.appendChild(ifr);
      let completed = false;
      const cleanup = () => { try { ifr.remove(); } catch(e){} };
      ifr.onload = () => { if (!completed) { completed = true; archiveSubmitSucceeded = true; markThis(true); cleanup(); } };
      await new Promise(resolve => {
        try { ifr.src = finalUrl; } catch(e){}
        slot.timeoutId = setTimeout(() => {
          if (!completed) { markThis(false); cleanup(); resolve(); } else resolve();
        }, 8000);
      });
      if (archiveSubmitSucceeded) return true;
      continue;
    }

    if (task.mode === 'popup' || task.mode === 'tab') {
      const specs = task.mode === 'popup' ? 'width=600,height=400' : '';
      try {
        const w = window.open('about:blank', '_blank', specs);
        if (!w) {
          markThis(false);
          console.warn('[BacklinkGen] popup blocked for', finalUrl);
        } else {
          w.location.href = finalUrl;
          await new Promise(resolve => {
            slot.timeoutId = setTimeout(() => {
              try { w.close(); } catch(e){}
              archiveSubmitSucceeded = true;
              markThis(true);
              resolve();
            }, 8000);
          });
          if (archiveSubmitSucceeded) return true;
        }
      } catch (e) {
        markThis(false);
      }
      continue;
    }

    if (task.mode === 'ping') {
      let ok = false;
      for (const proxyTpl of corsProxiesTemplates) {
        try {
          const proxyUrl = generateUrl(proxyTpl, finalUrl);
          if (!proxyUrl) continue;
          try {
            const res = await fetchWithTimeout(proxyUrl, 5000);
            if (res && res.ok) { ok = true; break; }
          } catch (fetchErr) {
            // proxy failed -> try next
            continue;
          }
        } catch (err) {
          continue;
        }
      }
      markThis(ok);
      if (ok) { archiveSubmitSucceeded = true; return true; }
      continue;
    }

    try {
      const res = await fetchWithTimeout(finalUrl, 5000).catch(()=>null);
      const ok = res && res.ok;
      markThis(!!ok);
      if (ok) { archiveSubmitSucceeded = true; return true; }
    } catch (e) {
      markThis(false);
    }
  }

  return false;
}

async function launchSlot(slot){
  if(!running || slot.busy) return;
  const task = queue.shift();
  if(!task){ if(slots.every(s=>!s.busy)) finishRun(); return; }
  slot.busy=true;

  if (task.isArchiveSubmit) {
    const summaryLi = document.createElement('li');
    summaryLi.innerHTML = `<strong>Archive Submit</strong> - trying variants... <span class="status loading">⏳</span>`;
    resultsUl.appendChild(summaryLi);

    let ok = false;
    try {
      ok = await tryArchiveVariants(slot, { mode: task.mode, template: task.template, norm: task.norm, vid: task.vid });
    } catch (e) {
      console.error('[BacklinkGen] tryArchiveVariants error', e);
      ok = false;
    }

    const span = summaryLi.querySelector('.status');
    span.textContent = ok ? '✔︎' : '✖︎';
    span.className = 'status ' + (ok ? 'success' : 'failure');

    doneCount++;
    updateProgress();
    slot.busy=false;
    launchSlot(slot);
    return;
  }

  const {mode,url} = task;
  const li=document.createElement('li'); li.innerHTML=`<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a><span class="status loading">⏳</span>`; resultsUl.appendChild(li);
  const mark = ok => { clearTimeout(slot.timeoutId); slot.busy=false; doneCount++; const span=li.querySelector('.status'); span.textContent=ok?'✔︎':'✖︎'; span.className='status '+(ok?'success':'failure'); updateProgress(); launchSlot(slot); };

  if (mode === 'iframe') {
    const ifr = document.createElement('iframe');
    ifr.classList.add('hidden-iframe');
    document.body.appendChild(ifr);
    const cleanup = () => ifr.remove();
    ifr.onload = () => { clearTimeout(slot.timeoutId); cleanup(); mark(true); };
    slot.timeoutId = setTimeout(() => { cleanup(); mark(false); }, 8000);
    ifr.src = url;
    return;
  } else if(mode==='popup' || mode==='tab'){
    const specs = mode==='popup' ? 'width=600,height=400' : '';
    if(reuseToggle.value==='fresh'){
      const w = window.open('about:blank','_blank',specs); if(!w){ alert('Pop-up blocked!'); mark(false); return; }
      w.location.href = url;
      slot.timeoutId = setTimeout(()=>{ try{ w.close(); }catch(e){}; mark(true); },8000);
    } else {
      if(!slot.ref || slot.ref.closed){
        slot.ref = window.open('about:blank','slot-'+slot.id,specs);
        if(!slot.ref){ alert('Pop-up blocked!'); mark(false); return; }
      }
      slot.ref.location.href = url;
      slot.timeoutId = setTimeout(()=>{ mark(true); },8000);
    }

  } else if(mode==='ping'){
    const PROXY_TIMEOUT = 5000;
    let ok=false;
    for (const tpl of corsProxiesTemplates) {
      try {
        const proxyUrl = generateUrl(tpl, url);
        if (!proxyUrl) continue;
        try {
          const res = await fetchWithTimeout(proxyUrl, PROXY_TIMEOUT);
          if (res && res.ok) { ok = true; break; }
        } catch (fetchErr) {
          continue;
        }
      } catch (err) {
        continue;
      }
    }
    mark(ok);
  } else {
    try {
      const res = await fetchWithTimeout(url, 5000).catch(()=>null);
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
  running=true; queue=[]; slots.forEach(s=>s.ref&&s.ref.close()); resultsUl.innerHTML=''; totalTasks=0; doneCount=0;
  archiveSubmitSucceeded = false; // reset flag at start of each run

  const vid=new URL(norm).searchParams.get('v');
  let templates = vid ? [...youtubeBacklinkTemplates,'https://web.archive.org/save/[URL]'] : backlinkTemplates.slice();
  if(shuffleCheckbox.checked) templates.sort(()=>Math.random()-0.5);

  // Deduplicate archive submit templates: add exactly one composite task for the submit pattern
  let archiveSubmitCompositeAdded = false;

  templates.forEach(tpl => {
    try {
      if (/\/submit\/\?anyway=1&url=/i.test(tpl) && ARCHIVE_TLDS.some(h => tpl.toLowerCase().includes(h))) {
        if (!archiveSubmitCompositeAdded) {
          queue.push({
            mode: modeSelect.value,
            isArchiveSubmit: true,
            template: tpl,
            norm: norm,
            vid: vid
          });
          archiveSubmitCompositeAdded = true;
        } else {
          // Skip duplicate archive submit templates (we already have one composite that will try all TLDs)
          const li = document.createElement('li');
          li.innerHTML = `<strong>Archive Submit</strong> - skipped duplicate template <span class="status success">✔︎</span>`;
          resultsUl.appendChild(li);
          // Count skipped duplicates as done so progress is accurate
          doneCount++;
        }
      } else {
        const finalUrl = generateUrl(tpl, norm, vid);
        if (finalUrl && finalUrl.trim()) {
          queue.push({ mode: modeSelect.value, url: finalUrl });
        } else {
          console.warn('[BacklinkGen] generated empty URL from template:', tpl);
        }
      }
    } catch (e) {
      console.error('[BacklinkGen] error generating url for tpl:', tpl, e);
    }
  });

  totalTasks=queue.length;
  updateProgress();
  newUrlInput.value = location.origin+'?'+norm;
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
  try { linkEl.textContent = "🔗 " + txt + " → " + (new URL(href)).hostname; } catch { linkEl.textContent = "🔗 " + txt; }
}
