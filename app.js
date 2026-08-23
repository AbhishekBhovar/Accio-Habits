const DATA = {};
const stateKey = 'hpFitnessRpgSave_v1';

async function loadData(){
  const [levels,collectibles,config,identity] = await Promise.all([
    fetch('./levels.json').then(r=>r.json()),
    fetch('./collectibles.json').then(r=>r.json()),
    fetch('./game-config.json').then(r=>r.json()),
    fetch('./identity-rules.json').then(r=>r.json())
  ]);
  Object.assign(DATA,{levels,collectibles,config,identity});
}

function defaultState(){return {version:1,totalXP:0,currentLevel:0,owned:{},eventLog:[],legendaryPityCounter:0,bankedRewardSlots:0,completedBooks:[]};}
function loadState(){try{return {...defaultState(),...JSON.parse(localStorage.getItem(stateKey)||'{}')}}catch{return defaultState()}}
let save=loadState();
function persist(){localStorage.setItem(stateKey,JSON.stringify(save));}

function cumulativeXpForLevel(level){return DATA.levels.slice(0,level).reduce((n,l)=>n+l.xpRequired,0)}
function xpIntoCurrent(){return save.totalXP-cumulativeXpForLevel(save.currentLevel)}
function nextLevelRow(){return DATA.levels[save.currentLevel]||null}
function currentRow(){return save.currentLevel?DATA.levels[save.currentLevel-1]:null}

function visibleName(card){
  const rule=DATA.identity.find(r=>r.collectible===card.name);
  if(!rule || !rule.revealLevel || save.currentLevel>=Number(rule.revealLevel)) return card.name;
  return rule.visibleBeforeReveal || card.name;
}
function cardStatus(card){
  if(save.owned[card.id]) return 'owned';
  return save.currentLevel>=card.firstEligibleLevel?'eligible':'locked';
}
function grantGuaranteedAt(level){
  const granted=[];
  for(const c of DATA.collectibles){
    if(c.firstEligibleLevel===level && c.delivery==='Guaranteed' && !save.owned[c.id]){
      save.owned[c.id]={discoveredLevel:level}; granted.push(c);
    }
  }
  return granted;
}
function logEvent(level,title,kind='story'){save.eventLog.unshift({level,title,kind,ts:Date.now()});save.eventLog=save.eventLog.slice(0,60)}

function levelUp(level){
  const row=DATA.levels[level-1];
  const granted=grantGuaranteedAt(level);
  logEvent(level,row.storyBeat,'level');
  for(const c of granted) logEvent(level,`Discovered: ${visibleName(c)} [${c.rarity}]`,'discovery');
  for(const x of row.revelations) logEvent(level,x,'revelation');
  for(const x of row.evolutions) logEvent(level,x,'evolution');
  if(DATA.config.bookCompletionLevels.includes(level) && !save.completedBooks.includes(row.book)) save.completedBooks.push(row.book);
  showLevelDialog(row,granted);
}

function addXP(amount){
  save.totalXP+=amount;
  while(save.currentLevel<168){
    const threshold=cumulativeXpForLevel(save.currentLevel+1);
    if(save.totalXP<threshold) break;
    save.currentLevel++;
    levelUp(save.currentLevel);
  }
  persist(); render();
}

function showLevelDialog(row,granted){
  const d=document.querySelector('#levelDialog');
  document.querySelector('#dialogTitle').textContent=`Level ${row.level} — ${row.storyBeat}`;
  document.querySelector('#dialogStory').textContent=`${row.bookName} • Checkpoint ${row.checkpoint}`;
  const groups=[];
  if(granted.length) groups.push(['Guaranteed discoveries',granted.map(c=>`${visibleName(c)} — ${c.rarity}`)]);
  if(row.evolutions.length) groups.push(['Evolutions',row.evolutions]);
  if(row.revelations.length) groups.push(['Revelations',row.revelations]);
  if(row.momentCards.length) groups.push(['Moment cards',row.momentCards]);
  document.querySelector('#dialogRewards').innerHTML=groups.map(([h,items])=>`<div class="reward-group"><h4>${escapeHtml(h)}</h4>${items.map(x=>`<p>${escapeHtml(x)}</p>`).join('')}</div>`).join('')||'<p class="muted">Story progression unlocked.</p>';
  if(!d.open) d.showModal();
}

function renderHome(){
  const row=currentRow(), next=nextLevelRow();
  document.querySelector('#levelOrb').textContent=save.currentLevel;
  document.querySelector('#levelTitle').textContent=save.currentLevel?`Level ${save.currentLevel}`:'Level 0';
  document.querySelector('#storyBeat').textContent=row?.storyBeat||'Your journey is ready to begin.';
  document.querySelector('#bookLabel').textContent=row?`BOOK ${row.book} • ${row.bookName}`:'BEFORE HOGWARTS';
  const xpNeed=next?.xpRequired||0, inside=xpIntoCurrent();
  const pct=save.currentLevel>=168?100:Math.max(0,Math.min(100,(inside/xpNeed)*100));
  document.querySelector('#xpBar').style.width=`${pct}%`;
  document.querySelector('#xpText').textContent=save.currentLevel>=168?'Saga complete':`${inside.toLocaleString()} / ${xpNeed.toLocaleString()} XP`;
  document.querySelector('#checkpointText').textContent=row?`Checkpoint ${row.checkpoint}`:'Checkpoint 1';
  const owned=Object.keys(save.owned).length;
  document.querySelector('#ownedCount').textContent=`${owned} / ${DATA.collectibles.length}`;
  document.querySelector('#sagaPct').textContent=`${((save.currentLevel/168)*100).toFixed(1)}%`;
  const log=document.querySelector('#eventLog');
  log.innerHTML=save.eventLog.length?save.eventLog.slice(0,10).map(e=>`<div class="event">${escapeHtml(e.title)}<small>Level ${e.level}</small></div>`).join(''):'<p class="muted">No events yet.</p>';
}
function renderJourney(){
  document.querySelector('#journeyList').innerHTML=DATA.levels.map(l=>{
    const cls=l.level<save.currentLevel?'done':l.level===save.currentLevel?'current':'locked';
    return `<div class="journey-level ${cls}"><div class="level-num">${l.level}</div><div><strong>${escapeHtml(l.storyBeat)}</strong><p>Book ${l.book}: ${escapeHtml(l.bookName)} • CP ${l.checkpoint}</p></div><span class="rarity ${cls==='done'?'Rare':''}">${cls==='done'?'✓':cls==='current'?'NOW':'🔒'}</span></div>`
  }).join('');
}
function renderCollection(){
  const cat=document.querySelector('#categoryFilter').value, rar=document.querySelector('#rarityFilter').value, st=document.querySelector('#statusFilter').value;
  const cards=DATA.collectibles.filter(c=>(cat==='all'||c.category===cat)&&(rar==='all'||c.rarity===rar)&&(st==='all'||cardStatus(c)===st));
  document.querySelector('#collectionGrid').innerHTML=cards.map(c=>{
    const status=cardStatus(c), display=status==='locked'?'Locked collectible':visibleName(c);
    return `<article class="collectible ${status}"><span class="rarity ${c.rarity}">${c.rarity}</span><h4>${escapeHtml(display)}</h4><p>${escapeHtml(c.category)}</p><p>${status==='owned'?`Discovered Lv ${save.owned[c.id].discoveredLevel}`:status==='eligible'?`Eligible since Lv ${c.firstEligibleLevel}`:`Unlocks from Lv ${c.firstEligibleLevel}`}</p></article>`
  }).join('') || '<p class="muted">No collectibles match these filters.</p>';
}
function render(){renderHome();renderJourney();renderCollection();}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}

function setupUI(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));
    if(b.dataset.view==='collection') renderCollection();
  });
  document.querySelectorAll('[data-xp]').forEach(b=>b.onclick=()=>addXP(Number(b.dataset.xp)));
  document.querySelector('#closeDialog').onclick=()=>document.querySelector('#levelDialog').close();
  ['categoryFilter','rarityFilter','statusFilter'].forEach(id=>document.querySelector(`#${id}`).onchange=renderCollection);
  const cats=[...new Set(DATA.collectibles.map(c=>c.category))];
  document.querySelector('#categoryFilter').innerHTML='<option value="all">All categories</option>'+cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  document.querySelector('#exportSave').onclick=()=>{
    const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='hp-fitness-rpg-save.json';a.click();URL.revokeObjectURL(a.href);
  };
  document.querySelector('#importSave').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{save={...defaultState(),...JSON.parse(await f.text())};persist();render();alert('Save imported.')}catch{alert('That save file could not be read.')}};
  document.querySelector('#resetSave').onclick=()=>{if(confirm('Reset all local Harry Potter RPG progress on this device?')){save=defaultState();persist();render();}};
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  document.querySelector('#installState').textContent=standalone?'Installed: running in standalone Home Screen mode.':'Not installed yet: use Safari → Share → Add to Home Screen.';
}

function updateNetwork(){const b=document.querySelector('#networkBadge');b.textContent=navigator.onLine?'Online':'Offline ready';b.style.color=navigator.onLine?'#86efac':'#c4b5fd'}
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);

await loadData(); setupUI(); render(); updateNetwork();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));}
