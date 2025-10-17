// backlink-generator.js (patched drop-in)
// Robust ENCODE_* handling and unified URL generation

let backlinkTemplates = ['https://www.facebook.com/sharer/sharer.php?u=[ENCODE_URL]','https://twitter.com/intent/tweet?url=[ENCODE_URL]&text=[ENCODE_TITLE]'],
    youtubeBacklinkTemplates = ['https://video.ultra-zone.net/watch.en.html.gz?v=[ID]','https://video.ultra-zone.net/watch.en.html.gz?v={{ID}}'],
    corsProxiesTemplates = ['https://api.allorigins.win/raw?url=[ENCODE_URL]'];

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

function buildMap(url, vid) {
  const p = new URL(url);
  const parts = p.hostname.split('.');
  const ln = parts.length;
  const map = {
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
    try {
      map['ENCODE_' + k] = encodeURIComponent(map[k]);
    } catch {
      map['ENCODE_' + k] = '';
    }
  });

  return map;
}

/**
 * replacePlaceholders
 * - supports both [KEY] and {{KEY}} forms
 * - recognizes optional ENCODE_ prefix and returns encoded value
 * - prefers precomputed map['ENCODE_'+KEY] if present, otherwise encodes map[KEY] at runtime
 */
function replacePlaceholders(tpl, map) {
  return tpl.replace(/(\{\{|\[)\s*(ENCODE_)?([A-Z0-9_]+)\s*(\}\}|\])/gi, function(match, open, encPrefix, key){
    if(!key) return '';
    key = key.toUpperCase();
    const wantsEncode = !!encPrefix;

    if (wantsEncode) {
      const encodedKey = 'ENCODE_' + key;
      // prefer precomputed ENCODE_<KEY>
      if (map.hasOwnProperty(encodedKey) && map[encodedKey] !== undefined) {
        return String(map[encodedKey]);
      }
      // fallback: encode base value at runtime
      const base = map.hasOwnProperty(key) && map[key] !== undefined ? String(map[key]) : '';
      try {
        return encodeURIComponent(base);
      } catch {
        return base;
      }
    } else {
      // non-encoded placeholder => return raw value
      return map.hasOwnProperty(key) && map[key] !== undefined ? String(map[key]) : '';
    }
  });
}

/**
 * generateUrl - unified builder for template -> final url
 * uses buildMap + replacePlaceholders and logs debug info
 */
function generateUrl(tpl, normUrl, vid) {
  const map = buildMap(normUrl, vid);
  const final = replacePlaceholders(tpl, map);
  if (window && window.console && console.debug) {
    console.debug('[BacklinkGen] template -> final:', tpl, '->', final, '\n map:', map);
  }
  return final;
}

// --- UI / Settings / bindings (kept compatible with your existing HTML) ---
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

async function launchSlot(slot){
  if(!running || slot.busy) return;
  const task = queue.shift();
  if(!task){ if(slots.every(s=>!s.busy)) finishRun(); return; }
  slot.busy=true;
  const {mode,url}=task;
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
      slot.timeoutId = setTimeout(()=>{ w.close(); mark(true); },8000);
    } else {
      if(!slot.ref || slot.ref.closed){
        slot.ref = window.open('about:blank','slot-'+slot.id,specs);
        if(!slot.ref){ alert('Pop-up blocked!'); mark(false); return; }
      }
      slot.ref.location.href = url;
      slot.timeoutId = setTimeout(()=>{ mark(true); },8000);
    }
  } else if(mode==='ping'){
    let ok=false;
    for(const tpl of corsProxiesTemplates){
      try{
        const proxyUrl = generateUrl(tpl, url); // url may be the backlink target; generateUrl will encode correctly
        const res = await fetch(proxyUrl);
        if(res.ok){ ok=true; break; }
      }catch{}
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

  // Build queue using generateUrl to guarantee encoding
  templates.forEach(tpl => {
    try {
      const finalUrl = generateUrl(tpl, norm, vid);
      if(finalUrl && finalUrl.trim()){
        queue.push({mode:modeSelect.value, url: finalUrl});
      } else {
        console.warn('[BacklinkGen] generated empty URL from template:', tpl);
      }
    } catch(e){
      console.error('[BacklinkGen] error generating url for tpl:', tpl, e);
    }
  });

  totalTasks = queue.length;
  updateProgress();
  newUrlInput.value = location.origin + '?' + norm;
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
  const linkEl = document.getElementById("externalLink");
  linkEl.href = href;
  linkEl.style.display = "inline-block";
  try { linkEl.textContent = "🔗 " + txt + " → " + (new URL(href)).hostname; } catch { linkEl.textContent = "🔗 " + txt; }
}
