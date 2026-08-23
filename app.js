const DATA = {};
const stateKey = 'hpFitnessRpgSave_v3';
const legacyStateKeys = ['hpFitnessRpgSave_v2','hpFitnessRpgSave_v1'];
const APP_VERSION = '3.26.0';
const BUILD_SIGNATURE='phase-3.26-cache-bust-activity-stats';
const PARAMS = new URLSearchParams(location.search);
const DEV_MODE = PARAMS.get('dev') === '1';
const FRESH_PREVIEW = PARAMS.get('fresh') === '1';
const CATEGORY_META = {
  'Character': {icon:'🧙',title:'Characters',subtitle:'Witches, wizards, friends and foes'},
  'Creature': {icon:'🐉',title:'Creatures',subtitle:'A magical field guide'},
  'Object / Artefact': {icon:'🏆',title:'Objects & Artefacts',subtitle:'Relics, tools and legendary objects'},
  'Location': {icon:'🏰',title:'Locations',subtitle:'Places across the Wizarding World'},
  'Spell / Magic': {icon:'✨',title:'Magic',subtitle:'Spells, potions and magical abilities'},
  'Moment': {icon:'🎞️',title:'Moments',subtitle:'Memories from your journey'}
};
const BOOK_NAMES = ['','Philosopher\'s Stone','Chamber of Secrets','Prisoner of Azkaban','Goblet of Fire','Order of the Phoenix','Half-Blood Prince','Deathly Hallows'];

let ui = {journeyBook:1, collectionCategory:null, collectionBook:null, revealQueue:[], revealActive:false};
let audioContext = null;

async function loadData(){
  const [levels,collectibles,config,identity,habits] = await Promise.all([
    fetch('./levels.json').then(checkJson),
    fetch('./collectibles.json').then(checkJson),
    fetch('./game-config.json').then(checkJson),
    fetch('./identity-rules.json').then(checkJson),
    fetch('./habit-config.json').then(checkJson)
  ]);
  Object.assign(DATA,{levels,collectibles,config,identity,habits});
}
function checkJson(response){if(!response.ok) throw new Error(`Could not load ${response.url}`); return response.json();}

function defaultState(){
  return {
    version:3,appVersion:APP_VERSION,totalXP:0,currentLevel:0,owned:{},eventLog:[],legendaryPityCounter:0,
    bankedRewardSlots:0,completedBooks:[],daily:{},weekly:{},sportBank:0,
    streak:{current:0,best:0,lastFinalizedDate:null},
    achievements:{perfectRoutineDays:0,perfectDays:0,exceptionalDays:0,perfectWeeks:0,optimalSleepWeeks:0},
    sleep:{highestStage:1},lastWeekKey:null,soundEnabled:true,pendingRevealIds:[]
  };
}
function loadState(){
  try{
    const current=JSON.parse(localStorage.getItem(stateKey)||'null');
    if(current) return mergeState(current);
    for(const key of legacyStateKeys){
      const legacy=JSON.parse(localStorage.getItem(key)||'null');
      if(legacy){
        const migrated=mergeState({...legacy,version:3,appVersion:APP_VERSION});
        const recent=Object.entries(migrated.owned||{}).sort((a,b)=>(b[1].discoveredLevel||0)-(a[1].discoveredLevel||0)).slice(0,6).map(([id])=>id);
        migrated.pendingRevealIds=recent;
        localStorage.setItem(stateKey,JSON.stringify(migrated));
        return migrated;
      }
    }
  }catch(err){console.warn('Save load failed',err)}
  return defaultState();
}
function mergeState(raw){
  const base=defaultState();
  const merged={
    ...base,...raw,version:3,
    streak:{...base.streak,...(raw.streak||{})},
    achievements:{...base.achievements,...(raw.achievements||{})},
    sleep:{...base.sleep,...(raw.sleep||{})},
    daily:raw.daily||{},weekly:raw.weekly||{},owned:raw.owned||{},eventLog:raw.eventLog||[],
    pendingRevealIds:raw.pendingRevealIds||[]
  };
  // Rename the old nuts habit without losing today's/history completion.
  for(const day of Object.values(merged.daily)){
    if(day?.habits?.nuts && !day.habits.almonds) day.habits.almonds=day.habits.nuts;
  }
  return merged;
}
let save=loadState();
function persist(){save.appVersion=APP_VERSION;localStorage.setItem(stateKey,JSON.stringify(save));}

// ---------- date/week helpers ----------
function localDateKey(date=new Date()){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function parseDateKey(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12,0,0);}
function addDays(date,days){const x=new Date(date);x.setDate(x.getDate()+days);return x;}
function mondayOf(date=new Date()){const x=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);const day=x.getDay();x.setDate(x.getDate()+(day===0?-6:1-day));return x;}
function weekKey(date=new Date()){return localDateKey(mondayOf(date));}
function prettyDate(key){return parseDateKey(key).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'});}
function weekEndFromKey(key){return addDays(parseDateKey(key),6);}
function avg(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function getDaily(key=localDateKey()){
  if(!save.daily[key]) save.daily[key]={habits:{},sleep:null,finalized:false,disciplineScore:null,perfectRoutine:false,perfectDay:false,exceptionalDay:false,weeklyCreditsToday:0};
  return save.daily[key];
}
function displayDaily(key=localDateKey()){
  if(FRESH_PREVIEW && key===localDateKey()) return {habits:{},sleep:null,finalized:false,disciplineScore:null,perfectRoutine:false,perfectDay:false,exceptionalDay:false,weeklyCreditsToday:0};
  return getDaily(key);
}
function normalizeWeek(week){
  return Object.assign(week,{weights:week.weights||0,weightDays:week.weightDays||[],cardio:week.cardio||0,cardioLog:week.cardioLog||[],sportActual:week.sportActual||0,sportBankUsed:week.sportBankUsed||0,sportDueRemaining:Number.isFinite(week.sportDueRemaining)?week.sportDueRemaining:3,sauna:week.sauna||0,saunaLog:week.saunaLog||[],saunaXpDays:week.saunaXpDays||[],finalized:!!week.finalized});
}
function ensureCurrentWeek(){
  const currentKey=weekKey();
  if(save.lastWeekKey && save.lastWeekKey!==currentKey){finalizeWeek(save.lastWeekKey);}
  if(!save.weekly[currentKey]){
    const usedFromBank=Math.min(3,save.sportBank||0);save.sportBank=(save.sportBank||0)-usedFromBank;
    save.weekly[currentKey]={weights:0,weightDays:[],cardio:0,cardioLog:[],sportActual:0,sportBankUsed:usedFromBank,sportDueRemaining:3-usedFromBank,sauna:0,saunaLog:[],saunaXpDays:[],createdAt:Date.now(),finalized:false};
  }
  normalizeWeek(save.weekly[currentKey]);save.lastWeekKey=currentKey;return save.weekly[currentKey];
}
function finalizePastDays(){
  const today=localDateKey();
  for(const key of Object.keys(save.daily).sort()) if(key<today && !save.daily[key].finalized) finalizeDay(key);
  if(save.streak.lastFinalizedDate){
    let cursor=addDays(parseDateKey(save.streak.lastFinalizedDate),1),yesterday=addDays(parseDateKey(today),-1);
    while(cursor<=yesterday){const key=localDateKey(cursor);if(!save.daily[key])getDaily(key);if(!save.daily[key].finalized)finalizeDay(key);cursor=addDays(cursor,1);}
  }
}
function finalizeDay(key){
  const day=getDaily(key),status=calculateDayStatus(key);day.finalized=true;Object.assign(day,{disciplineScore:status.discipline,perfectRoutine:status.perfectRoutine,perfectDay:status.perfectDay,exceptionalDay:status.exceptionalDay});
  if(status.discipline>=DATA.habits.achievements.disciplineStreakThreshold)save.streak.current+=1;else save.streak.current=0;
  save.streak.best=Math.max(save.streak.best,save.streak.current);save.streak.lastFinalizedDate=key;
  if(status.perfectRoutine)save.achievements.perfectRoutineDays+=1;if(status.perfectDay)save.achievements.perfectDays+=1;if(status.exceptionalDay)save.achievements.exceptionalDays+=1;persist();
}
function weekStatusForKey(key){
  const week=save.weekly[key];if(!week)return null;normalizeWeek(week);
  const dates=Array.from({length:7},(_,i)=>localDateKey(addDays(parseDateKey(key),i))),statuses=dates.map(k=>calculateDayStatus(k));
  const avgDiscipline=avg(statuses.map(s=>s.discipline)),routineDays=statuses.filter(s=>s.perfectRoutine).length,sleepRows=dates.map(k=>save.daily[k]?.sleep).filter(s=>s?.mainHours>0),sleepAvg=sleepRows.length===7?avg(sleepRows.map(s=>s.mainHours)):0;
  return {avgDiscipline,routineDays,perfectWeek:avgDiscipline>=.9&&week.weights>=4&&week.cardio>=4&&week.sportDueRemaining===0&&week.sauna>=5&&routineDays>=3,optimalSleepWeek:sleepRows.length===7&&sleepAvg>=8&&sleepAvg<=9};
}
function finalizeWeek(key){const week=save.weekly[key];if(!week||week.finalized)return;const status=weekStatusForKey(key);week.finalized=true;week.finalStats=status;if(status?.perfectWeek)save.achievements.perfectWeeks++;if(status?.optimalSleepWeek)save.achievements.optimalSleepWeeks++;}

// ---------- audio / non-blocking feedback ----------
function ensureAudio(){if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();}
function playChime(kind='success'){
  if(!save.soundEnabled)return;try{ensureAudio();const map={success:[523,659],level:[392,523,659],Rare:[523,659],Epic:[523,659,784],Legendary:[392,523,659,988],Mythic:[330,494,659,988,1319],perfect:[523,659,784,1047]};const notes=map[kind]||map.success;notes.forEach((freq,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.0001,audioContext.currentTime+i*.09);g.gain.exponentialRampToValueAtTime(.10,audioContext.currentTime+i*.09+.02);g.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+i*.09+.23);o.connect(g).connect(audioContext.destination);o.start(audioContext.currentTime+i*.09);o.stop(audioContext.currentTime+i*.09+.25);});}catch(err){console.warn('Sound failed',err)}
}
let toastTimer;
function toast(message,kind='success'){const el=document.querySelector('#toast');el.textContent=message;el.className=`toast show ${kind}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',2200);}

// ---------- Harry Journey ----------
function cumulativeXpForLevel(level){return DATA.levels.slice(0,level).reduce((n,l)=>n+l.xpRequired,0);}
function xpIntoCurrent(){return save.totalXP-cumulativeXpForLevel(save.currentLevel);}
function nextLevelRow(){return DATA.levels[save.currentLevel]||null;}
function currentRow(){return save.currentLevel?DATA.levels[save.currentLevel-1]:null;}
function visibleName(card){const rule=DATA.identity.find(r=>r.collectible===card.name);if(!rule||!rule.revealLevel||save.currentLevel>=Number(rule.revealLevel))return card.name;return rule.visibleBeforeReveal||card.name;}
function cardStatus(card){if(save.owned[card.id])return'owned';return save.currentLevel>=card.firstEligibleLevel?'eligible':'locked';}
function grantGuaranteedAt(level){const granted=[];for(const c of DATA.collectibles){if(c.firstEligibleLevel===level&&c.delivery==='Guaranteed'&&!save.owned[c.id]){save.owned[c.id]={discoveredLevel:level,discoveredAt:Date.now()};granted.push(c);}}return granted;}
function logEvent(level,title,kind='story'){save.eventLog.unshift({level,title,kind,ts:Date.now()});save.eventLog=save.eventLog.slice(0,100);}
function levelUp(level){
  const row=DATA.levels[level-1],granted=grantGuaranteedAt(level);logEvent(level,row.storyBeat,'level');
  ui.revealQueue.push({type:'level',row});
  for(const c of granted){logEvent(level,`Discovered: ${visibleName(c)} [${c.rarity}]`,'discovery');ui.revealQueue.push({type:'collectible',card:c});}
  for(const x of row.revelations)logEvent(level,x,'revelation');for(const x of row.evolutions)logEvent(level,x,'evolution');
  if(DATA.config.bookCompletionLevels.includes(level)&&!save.completedBooks.includes(row.book)){save.completedBooks.push(row.book);ui.revealQueue.push({type:'book',row});}
}
function addXP(amount,source='Activity'){
  const safeAmount=Math.max(0,Math.round(Number(amount)||0));if(!safeAmount)return;
  save.totalXP+=safeAmount;logEvent(save.currentLevel,`+${safeAmount} XP — ${source}`,'xp');
  while(save.currentLevel<168){const threshold=cumulativeXpForLevel(save.currentLevel+1);if(save.totalXP<threshold)break;save.currentLevel++;levelUp(save.currentLevel);}
  persist();render();runRevealQueue();
}
function queueMigratedReveals(){
  if(!save.pendingRevealIds?.length)return;
  const ids=[...save.pendingRevealIds];save.pendingRevealIds=[];persist();
  ui.revealQueue.push({type:'restored',count:ids.length});
  for(const id of ids){const card=DATA.collectibles.find(c=>c.id===id);if(card)ui.revealQueue.push({type:'collectible',card,restored:true});}
  setTimeout(runRevealQueue,450);
}
function revealArtForCard(card){return CATEGORY_META[card.category]?.icon||'✦';}
function runRevealQueue(){if(ui.revealActive||!ui.revealQueue.length)return;ui.revealActive=true;const item=ui.revealQueue.shift(),overlay=document.querySelector('#revealOverlay');overlay.hidden=false;overlay.className='reveal-overlay active';const art=document.querySelector('#revealArt'),rar=document.querySelector('#revealRarity'),eye=document.querySelector('#revealEyebrow'),title=document.querySelector('#revealTitle'),text=document.querySelector('#revealText');
  if(item.type==='level'){eye.textContent='LEVEL UNLOCKED';art.textContent=`${item.row.level}`;art.className='reveal-art level-art';rar.textContent=`BOOK ${item.row.book} • CHECKPOINT ${item.row.checkpoint}`;rar.className='reveal-rarity';title.textContent=item.row.storyBeat;text.textContent=item.row.bookName;playChime('level');}
  else if(item.type==='collectible'){const c=item.card;eye.textContent=item.restored?'COLLECTIBLE REVEAL RESTORED':'COLLECTIBLE DISCOVERED';art.textContent=revealArtForCard(c);art.className=`reveal-art card-art ${c.rarity}`;rar.textContent=c.rarity.toUpperCase();rar.className=`reveal-rarity ${c.rarity}`;title.textContent=visibleName(c);text.textContent=`${c.category} • Discovered at Level ${save.owned[c.id]?.discoveredLevel||c.firstEligibleLevel}`;playChime(c.rarity);}
  else if(item.type==='book'){eye.textContent='BOOK COMPLETE';art.textContent='🏆';art.className='reveal-art book-art';rar.textContent=`BOOK ${item.row.book} OF 7`;rar.className='reveal-rarity Legendary';title.textContent=item.row.bookName;text.textContent='Journey complete. Your next chapter awaits.';playChime('Legendary');}
  else {eye.textContent='YOUR COLLECTION';art.textContent='✨';art.className='reveal-art';rar.textContent='UPGRADE REWARD';title.textContent=`${item.count} discoveries restored`;text.textContent='This update now gives your existing discoveries the reveal they deserved.';playChime('Epic');}
}
function closeReveal(skip=false){document.querySelector('#revealOverlay').className='reveal-overlay';document.querySelector('#revealOverlay').hidden=true;ui.revealActive=false;if(skip)ui.revealQueue=[];else setTimeout(runRevealQueue,140);}

// ---------- daily habits ----------
function sleepTargetForLevel(level=save.currentLevel){const p=Math.max(0,Math.min(1,(Math.max(1,level)-1)/167));return Math.round((6+2*p)*4)/4;}
function sleepMissionComplete(day=displayDaily()){return Number(day.sleep?.mainHours||0)>=sleepTargetForLevel()&&Number(day.sleep?.napHours||0)>=1;}
function sleepXP(hours){hours=Number(hours)||0;const target=sleepTargetForLevel();if(hours<DATA.habits.sleep.zeroBelowHours)return 0;if(hours>=target)return 50;return Math.round((hours/target)*50);}
function completeHabit(id){
  ensureAudio();const habit=DATA.habits.dailyHabits.find(h=>h.id===id);if(!habit||habit.input==='sleep')return;const day=getDaily();if(day.habits[id]?.completed)return;
  day.habits[id]={completed:true,xpAwarded:habit.xp,ts:Date.now()};const wasPerfect=calculateDayStatus().perfectRoutine;addXP(habit.xp,habit.name);const now=calculateDayStatus();playChime('success');toast(`${habit.name} complete • +${habit.xp} XP`);
  if(!wasPerfect&&now.perfectRoutine){playChime('perfect');toast('✨ All daily missions complete!','perfect');}
}
function saveSleep(){
  if(FRESH_PREVIEW)return toast('Fresh-day preview is view-only. Your real progress is unchanged.','warn');
  ensureAudio();const day=getDaily(),main=Math.max(0,Number(document.querySelector('#sleepHours').value)||0),nap=Math.max(0,Number(document.querySelector('#napHours').value)||0);if(main<=0){toast('Enter your main sleep hours first.','warn');return;}
  const before=calculateDayStatus(),newXp=sleepXP(main),oldXp=day.sleep?.xpAwarded||0,delta=Math.max(0,newXp-oldXp);day.sleep={mainHours:main,napHours:nap,xpAwarded:Math.max(oldXp,newXp),scoreXp:newXp,savedAt:Date.now()};updateHighestSleepStage();if(delta)addXP(delta,'Sleep');else{persist();render();}const after=calculateDayStatus();toast(sleepMissionComplete(day)?'🌙 Sleep mission complete!':'Sleep saved');if(!before.perfectDay&&after.perfectDay){playChime('perfect');toast('🌟 PERFECT DAY achieved!','perfect');}}

function calculateDayStatus(key=localDateKey()){
  const day=displayDaily(key);let earned=0,max=DATA.habits.dailyMaxXP;
  for(const h of DATA.habits.dailyHabits){if(h.id==='sleep'){earned+=day.sleep?.scoreXp||0;continue;}const entry=day.habits[h.id];if(entry?.completed)earned+=entry.xpAwarded||h.xp;}
  const controllable=DATA.habits.dailyHabits.filter(h=>h.id!=='sleep'),perfectRoutine=controllable.every(h=>day.habits[h.id]?.completed===true),perfectDay=perfectRoutine&&sleepMissionComplete(day),exceptionalDay=perfectDay&&(day.weeklyCreditsToday||0)>=DATA.habits.achievements.exceptionalDayWeeklyCredits;
  return {earned,max,discipline:max?earned/max:0,perfectRoutine,perfectDay,exceptionalDay};
}

// ---------- weekly missions ----------
function logWeights(){ensureAudio();const week=ensureCurrentWeek(),date=localDateKey();if(week.weights>=4)return toast('Weights target already complete this week.','warn');if(week.weightDays.includes(date))return toast('Weights already credited today.','warn');week.weights++;week.weightDays.push(date);getDaily().weeklyCreditsToday++;addXP(100,'Gym Weight Lifting');toast(`Weights complete • ${week.weights}/4 • +100 XP`);}
function logCardio(){ensureAudio();const week=ensureCurrentWeek(),date=localDateKey();if(week.cardio>=4)return toast('Incline Walk / StairMaster target already complete this week.','warn');if((week.cardioLog||[]).some(x=>x.date===date))return toast('Incline Walk / StairMaster already completed today.','warn');week.cardio++;week.cardioLog.push({date,credits:1});getDaily().weeklyCreditsToday++;addXP(40,'Incline Walk / StairMaster');toast(`Incline Walk / StairMaster • ${week.cardio}/4 • +40 XP`);}
function logSport(){ensureAudio();const week=ensureCurrentWeek();week.sportActual++;getDaily().weeklyCreditsToday++;if(week.sportDueRemaining>0)week.sportDueRemaining--;else save.sportBank++;addXP(50,'Sport / Outdoor Activity');toast(`Adventure logged • +50 XP • ${3-week.sportDueRemaining}/3`);}
function logSauna(credits){
  ensureAudio();const week=ensureCurrentWeek(),date=localDateKey(),remaining=Math.max(0,5-week.sauna),accepted=Math.min(credits,remaining);if(accepted<=0)return toast('Sauna target already complete this week.','warn');
  const firstXpToday=!week.saunaXpDays.includes(date);week.sauna+=accepted;week.saunaLog.push({date,credits:accepted});getDaily().weeklyCreditsToday+=accepted;if(firstXpToday){week.saunaXpDays.push(date);addXP(35,'Sauna');toast(`Sauna +${accepted} credit${accepted>1?'s':''} • +35 XP${accepted===2?' • second 30 min carries forward':''}`);}else{persist();render();toast(`Extra sauna credit carried forward • +${accepted} credit • 0 extra XP`);}
}
function sportProgressText(week=ensureCurrentWeek()){return `${3-week.sportDueRemaining}/3 weekly target • ${save.sportBank} banked`;}

// ---------- sleep stats ----------
function sleepEntries(days=7){const today=parseDateKey(localDateKey()),arr=[];for(let i=days-1;i>=0;i--){const key=localDateKey(addDays(today,-i)),s=save.daily[key]?.sleep;if(s?.mainHours>0)arr.push({key,...s});}return arr;}
function sleepStageForAverage(a){let stage=1;for(const s of DATA.habits.sleep.stages)if(a>=s.minAverage)stage=s.stage;return stage;}
function stageRoman(n){return ['','I','II','III','IV','V'][n]||String(n);}
function updateHighestSleepStage(){const entries=sleepEntries(14);if(entries.length<14)return;save.sleep.highestStage=Math.max(save.sleep.highestStage,sleepStageForAverage(avg(entries.map(x=>x.mainHours))));persist();}
function sleepSummary(){const seven=sleepEntries(7),sevenAvg=avg(seven.map(x=>x.mainHours)),stage=sleepStageForAverage(sevenAvg),recovery=seven.reduce((n,x)=>n+(x.napHours||0)+Math.max(0,x.mainHours-8),0),shortfall=seven.reduce((n,x)=>n+Math.max(0,8-x.mainHours),0);return {sevenAvg,stage,count:seven.length,recovery,shortfall};}
function currentWeekDates(offsetWeeks=0){const start=addDays(mondayOf(),offsetWeeks*7);return Array.from({length:7},(_,i)=>localDateKey(addDays(start,i)));}
function currentWeekStatus(){const week=ensureCurrentWeek(),today=localDateKey(),elapsed=currentWeekDates().filter(k=>k<=today),statuses=elapsed.map(k=>calculateDayStatus(k)),avgDiscipline=statuses.length?avg(statuses.map(s=>s.discipline)):0,routineDays=statuses.filter(s=>s.perfectRoutine).length,ss=sleepSummary();return {week,avgDiscipline,routineDays,perfectWeek:avgDiscipline>=.9&&week.weights>=4&&week.cardio>=4&&week.sportDueRemaining===0&&week.sauna>=5&&routineDays>=3,optimalSleepWeek:ss.count===7&&ss.sevenAvg>=8&&ss.sevenAvg<=9};}

function currentBookProgress(){
  const level=Math.max(1,save.currentLevel||1),book=bookForLevel(level),bookStart=(book-1)*24+1,bookDone=Math.max(0,Math.min(24,save.currentLevel-(bookStart-1))),checkpoint=Math.max(1,Math.min(6,Math.ceil(Math.max(1,bookDone)/4)));
  return {book,bookDone,checkpoint};
}
function miniBookRouteHtml(){
  const {book,bookDone,checkpoint}=currentBookProgress();
  return `<div class="mini-book-route" aria-label="Book ${book} progress"><div class="mini-route-head"><span>BOOK ${book} ROUTE</span><b>${bookDone}/24</b></div><div class="mini-route-line">${Array.from({length:6},(_,i)=>{const cp=i+1,state=cp<checkpoint?'done':cp===checkpoint?'current':'locked';return `<i class="${state}"><em>${cp}</em></i>`;}).join('')}</div></div>`;
}
function simplifyTodaySectionChrome(){
  const clean=(selector,label,removeInnerTitle=false)=>{
    const el=document.querySelector(selector);if(!el)return;const host=el.closest('section,.card,.dashboard-card,.weekly-panel,.daily-panel,.sleep-card')||el.parentElement;if(!host)return;
    const prev=host.previousElementSibling;
    if(prev&&/build your week|today.?s routine|recovery/i.test(prev.textContent||''))prev.classList.add('redundant-zone-heading');
    let compact=host.querySelector(':scope > .compact-zone-label');if(!compact){compact=document.createElement('span');compact.className='compact-zone-label';host.prepend(compact);}compact.textContent=label;
    const head=host.querySelector('.section-head');if(head){const eyebrow=head.querySelector('.eyebrow,.section-label');if(eyebrow)eyebrow.classList.add('redundant-eyebrow');const title=head.querySelector('h2,h3');if(title&&removeInnerTitle)title.classList.add('redundant-inner-title');}
  };
  clean('#weeklyMissionList','WEEKLY MISSIONS',true);
  clean('#dailyHabitList','DAILY MISSIONS',false);
  clean('#sleepHours','SLEEP',true);
}
// ---------- render Today ----------
function renderHome(){
  const topDashboard=document.querySelector('#statusZone');
  if(topDashboard){topDashboard.hidden=true;topDashboard.style.display='none';}

  const row=currentRow(),next=nextLevelRow();document.querySelector('#levelOrb').textContent=save.currentLevel;document.querySelector('#levelTitle').textContent=save.currentLevel?`Level ${save.currentLevel}`:'Level 0';document.querySelector('#storyBeat').textContent=row?.storyBeat||'Your journey is ready to begin.';document.querySelector('#bookLabel').textContent=row?`BOOK ${row.book} • ${row.bookName} • LEVEL ${save.currentLevel}`:'BEFORE HOGWARTS';
  const xpNeed=next?.xpRequired||0,inside=xpIntoCurrent(),pct=save.currentLevel>=168?100:Math.max(0,Math.min(100,(inside/xpNeed)*100));document.querySelector('#xpBar').style.width=`${pct}%`;document.querySelector('#xpText').textContent=save.currentLevel>=168?'Saga complete':`${inside.toLocaleString()} / ${xpNeed.toLocaleString()} XP`;document.querySelector('#checkpointText').textContent=row?`Checkpoint ${row.checkpoint}`:'Checkpoint 1';
  const owned=Object.keys(save.owned).length,today=calculateDayStatus();document.querySelector('#ownedCount').textContent=`${owned} / ${DATA.collectibles.length}`;document.querySelector('#sagaPct').textContent=`${((save.currentLevel/168)*100).toFixed(1)}% saga`;const dailyHabits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep'),todayDay=displayDaily(),dailyDone=dailyHabits.filter(h=>todayDay.habits[h.id]?.completed).length,dailyLeft=Math.max(0,dailyHabits.length-dailyDone);document.querySelector('#todayScore').textContent=`${dailyDone} / ${dailyHabits.length}`;document.querySelector('#todayXp').textContent=dailyLeft===0?'All tasks done':`${dailyLeft} task${dailyLeft===1?'':'s'} left`;
  const journeyText=document.querySelector('#streakText'),journeySub=document.querySelector('#bestStreakText');
  if(journeyText){journeyText.textContent=`${save.currentLevel} / 168`;let box=journeyText.parentElement;while(box&&journeySub&&!box.contains(journeySub))box=box.parentElement;const label=box?[...box.querySelectorAll('span,small,p')].find(el=>/streak/i.test(el.textContent||'')):null;if(label)label.textContent='Journey';}
  if(journeySub)journeySub.textContent=`${((save.currentLevel/168)*100).toFixed(1)}% saga`;
  const banner=document.querySelector('#victoryBanner'),statusZone=document.querySelector('#statusZone');if(statusZone){statusZone.hidden=true;statusZone.style.display='none';}
  if(banner) banner.hidden=true;
  statusZone.classList.toggle('is-perfect',today.perfectDay);
  statusZone.classList.toggle('is-routine-complete',today.perfectRoutine&&!today.perfectDay);
  if(statusZone){let route=statusZone.querySelector('.mini-book-route');if(!route){const summary=statusZone.querySelector('.status-summary');route=document.createElement('div');route.innerHTML=miniBookRouteHtml();const node=route.firstElementChild;summary?summary.after(node):statusZone.append(node);}else route.outerHTML=miniBookRouteHtml();}
  renderWeekly();renderDailyHabits();renderSleep();renderAchievements();decorateTodayZones();simplifyTodaySectionChrome();
  const log=document.querySelector('#eventLog');
  if(log){
    log.innerHTML=homeStoryPreviewHtml();
    log.classList.add('story-preview-host');
    const card=log.closest('.card, .dashboard-card, section');
    if(card)card.classList.add('today-story-shell');
    const heading=card?.querySelector('h3');
    if(heading)heading.textContent='Your Story';
    const sub=card?.querySelector('.muted');
    if(sub&&/latest|event|journey/i.test(sub.textContent||''))sub.textContent='A glimpse of what Harry is moving toward next.';
    // Story is the primary reward: keep it directly under the level/victory dashboard,
    // before the mission-management sections.
    const statusZone=document.querySelector('#statusZone');if(statusZone)statusZone.classList.add('today-status-hidden');
    if(card&&statusZone&&statusZone.parentNode===card.parentNode){statusZone.before(card);}
  }
  document.body.classList.toggle('fresh-preview',FRESH_PREVIEW);
  let preview=document.querySelector('#freshPreviewNotice');
  if(FRESH_PREVIEW){
    if(!preview){preview=document.createElement('div');preview.id='freshPreviewNotice';preview.className='fresh-preview-notice';preview.innerHTML='<strong>Fresh-day preview</strong><span>Showing Today with no daily missions or sleep logged. Your real progress is unchanged.</span>';const story=document.querySelector('#eventLog')?.closest('.card, .dashboard-card, section');story?.before(preview);}
  }else preview?.remove();
}

function eventTimelineHtml(e,i){
  const title=String(e.title||''),lower=title.toLowerCase();let type='story',icon='✦',label='JOURNEY';
  if(e.kind==='xp'||/\+\d+\s*xp|xp$/i.test(title)){type='xp';icon='⚡';label='XP EARNED';}
  else if(/discover/i.test(title)){type='discovery';icon='✨';label=/mythic/i.test(title)?'MYTHIC DISCOVERY':'DISCOVERY';}
  else if(/level/i.test(title)){type='level';icon='⚡';label='LEVEL UP';}
  else if(/perfect|checkpoint|book complete/i.test(lower)){type='milestone';icon='🏆';label='MILESTONE';}
  const when=new Date(e.ts),time=when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}),meta=e.level?`Level ${e.level} • ${time}`:time;
  return `<article class="timeline-event ${type}"><div class="timeline-rail"><span>${icon}</span>${i<7?'<i></i>':''}</div><div class="timeline-copy"><small>${label}</small><strong>${escapeHtml(title)}</strong><em>${escapeHtml(meta)}</em></div></article>`;
}

function habitRowsHtml(habits,day){return habits.map(h=>{const entry=day.habits[h.id],done=entry?.completed,sub=done?`Completed • +${entry.xpAwarded||h.xp} XP`:h.rule;return `<button class="habit-row ${done?'done':''}" data-habit="${h.id}" ${done?'disabled':''}><span class="habit-icon">${h.icon}</span><span class="habit-copy"><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(sub)}</small></span><span class="habit-xp">${done?'✓':`+${h.xp}`}</span></button>`;}).join('');}
function renderDailyHabits(){
  const day=displayDaily(),list=document.querySelector('#dailyHabitList'),habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep'),completed=habits.filter(h=>day.habits[h.id]?.completed).length;document.querySelector('#routineBadge').textContent=`${completed} / ${habits.length}`;document.querySelector('#todayDateLabel').textContent=prettyDate(localDateKey());
  const panel=list.closest('.daily-panel');
  if(completed===habits.length){list.innerHTML=`<div class="routine-complete-strip"><span>✨</span><div><strong>All ${habits.length} daily missions complete</strong><small>Your checklist is tucked away for the rest of today.</small></div></div><details class="completed-details"><summary>View completed missions</summary><div class="completed-list">${habitRowsHtml(habits,day)}</div></details>`;panel?.classList.add('routine-is-complete');}
  else {list.innerHTML=habitRowsHtml(habits,day);panel?.classList.remove('routine-is-complete');}
  list.querySelectorAll('[data-habit]').forEach(b=>{if(FRESH_PREVIEW){b.disabled=true;b.classList.add('preview-disabled')}else b.onclick=()=>completeHabit(b.dataset.habit)});
}
function renderSleep(){
  const day=displayDaily(),s=day.sleep,card=document.querySelector('#sleepHours')?.closest('.sleep-card');if(!card)return;
  if(document.activeElement!==document.querySelector('#sleepHours'))document.querySelector('#sleepHours').value=s?.mainHours??'';
  if(document.activeElement!==document.querySelector('#napHours'))document.querySelector('#napHours').value=s?.napHours??'';
  const target=sleepTargetForLevel(),done=sleepMissionComplete(day);card.classList.toggle('sleep-mission-complete',done);
  document.querySelector('#sleepXpPreview').textContent=`Target ${target}h main + 1h nap`;
  const avg=document.querySelector('#sleep7Day'),stage=document.querySelector('#sleepStage'),high=document.querySelector('#sleepHighest');if(avg)avg.hidden=true;if(stage)stage.hidden=true;if(high)high.hidden=true;
  let strip=card.querySelector('.sleep-complete-strip');if(done){if(!strip){strip=document.createElement('div');strip.className='sleep-complete-strip';card.append(strip);}strip.innerHTML=`<span>🌙</span><div><strong>Sleep mission complete</strong><small>${Number(s.mainHours).toFixed(1)}h main sleep • ${Number(s.napHours).toFixed(1)}h nap</small></div><b>✓</b>`;}else strip?.remove();
}
function missionProgressDots(value,target){return Array.from({length:target},(_,i)=>`<span class="mission-dot ${i<value?'filled':''}"></span>`).join('');}
function weeklyDoneToday(type){const week=ensureCurrentWeek(),date=localDateKey();if(type==='weights')return (week.weightDays||[]).includes(date);if(type==='cardio')return (week.cardioLog||[]).some(x=>x.date===date);if(type==='sport')return (week.sportLog||[]).some(x=>x.date===date);if(type==='sauna')return (week.saunaLog||[]).some(x=>x.date===date);return false;}
function renderWeekly(){
  const week=ensureCurrentWeek(),sportDone=3-week.sportDueRemaining;document.querySelector('#weekLabel').textContent=`${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`;
  const row=(icon,title,sub,count,target,done,actions)=>`<div class="weekly-mission ${done||count>=target?'done-today':''}"><div class="weekly-info"><span class="weekly-icon">${icon}</span><div><strong>${done||count>=target?'✓ ':''}${title}</strong><small>${sub}</small><div class="mission-dots">${missionProgressDots(count,target)}</div></div></div><div class="weekly-action"><b>${count}/${target}</b>${actions}</div></div>`;
  document.querySelector('#weeklyMissionList').innerHTML=`${row('🏋️','Gym','4 sessions • 100 XP each',week.weights,4,weeklyDoneToday('weights'),weeklyDoneToday('weights')?'':`<button id="logWeights" ${week.weights>=4?'disabled':''}>+ Session</button>`)}${row('🏃','Incline Walk / StairMaster','4 sessions • 40 XP each',week.cardio,4,weeklyDoneToday('cardio'),weeklyDoneToday('cardio')?'':`<button id="logCardio" ${week.cardio>=4?'disabled':''}>+ Session</button>`)}${row('⚽','Sport / Outdoor','3 sessions • 50 XP each',sportDone,3,weeklyDoneToday('sport')||sportDone>=3,`<button id="logSport" ${sportDone>=3?'disabled':''}>+ Activity</button>`)}${row('🧖','Sauna','5 sessions × 30 min • 35 XP',week.sauna,5,weeklyDoneToday('sauna')||week.sauna>=5,`<div class="tiny-buttons"><button id="logSauna1" ${week.sauna>=5?'disabled':''}>+30m</button><button id="logSauna2" ${week.sauna>=5?'disabled':''}>+60m</button></div>`)}`;
  const a=document.querySelector('#logWeights');if(a)a.onclick=logWeights;const b=document.querySelector('#logCardio');if(b)b.onclick=logCardio;const c=document.querySelector('#logSport');if(c)c.onclick=logSport;const d=document.querySelector('#logSauna1');if(d)d.onclick=()=>logSauna(1);const e=document.querySelector('#logSauna2');if(e)e.onclick=()=>logSauna(2);
}
function achievementChips(){
  const status=calculateDayStatus(),week=currentWeekStatus();
  return [
    [status.discipline>=.8,'🔥','Discipline Day',`${Math.round(status.discipline*100)}% / 80%`],
    [status.perfectRoutine,'⭐','Daily Missions','All missions complete'],
    [status.perfectDay,'🌟','Perfect Day','Routine + 8–9h sleep'],
    [status.exceptionalDay,'👑','Exceptional','Perfect + 2 weekly credits'],
    [week.perfectWeek,'🏆','Perfect Week','Weekly targets + consistency'],
    [week.optimalSleepWeek,'🌙','Sleep Week','7-day avg 8–9h']
  ];
}

function renderAchievements(){
  const host=document.querySelector('#achievementStatus');
  if(!host)return;
  const card=host.closest('.card,.dashboard-card,section')||host.parentElement;
  if(card)card.hidden=true;
  host.innerHTML='';
}


function decorateTodayZones(){
  const zones=[
    ['#eventLog','zone-story','📖'],
    ['#weeklyMissionList','zone-weekly','⚡'],
    ['#dailyHabitList','zone-daily','✓'],
    ['#sleepHours','zone-recovery','☾'],
  ];
  for(const [selector,cls,mark] of zones){
    const el=document.querySelector(selector);if(!el)continue;
    const host=el.closest('section,.card,.dashboard-card,.weekly-panel,.daily-panel,.sleep-card')||el.parentElement;
    if(!host)continue;
    host.classList.add('today-zone',cls);
    host.dataset.zoneMark=mark;
  }
}

// ---------- narrative journey layer ----------
const STORY_TEASERS = {
  1:{hook:'A child survives the impossible.',mystery:'Why did the killing curse fail on Harry Potter?',cliff:'The wizarding world celebrates — but Harry knows none of it.',icon:'⚡'},
  2:{hook:'Ten quiet years pass at Number Four.',mystery:'Why do the Dursleys fear anything unusual about Harry?',cliff:'Strange things keep happening around him.',icon:'🏠'},
  3:{hook:'A letter arrives for someone who should not receive mail.',mystery:'Who knows Harry sleeps in the cupboard under the stairs?',cliff:'The Dursleys will do anything to stop him reading it.',icon:'✉️'},
  4:{hook:'The truth cannot be hidden forever.',mystery:'What have the Dursleys concealed about Harry and his parents?',cliff:'Someone is coming to tell Harry who he really is.',icon:'🛖'},
  5:{hook:'A hidden world opens in the middle of London.',mystery:'What kind of place has Harry belonged to all along?',cliff:'Every shop seems to know his name.',icon:'🧱'},
  6:{hook:'Deep beneath a wizarding bank lies something Hagrid must collect.',mystery:'What is in the tiny package from the high-security vault?',cliff:'Hagrid refuses to tell Harry why it matters.',icon:'🏦'},
  7:{hook:'A wand chooses its wizard.',mystery:'Why does Harry’s wand share something with the wand that gave him his scar?',cliff:'Even Ollivander finds the connection remarkable.',icon:'🪄'},
  8:{hook:'Harry meets a boy who already knows exactly what kind of wizard he wants to be.',mystery:'What does Slytherin mean — and why does Harry dislike what he hears?',cliff:'A choice is quietly beginning to form.',icon:'🐍'},
  9:{hook:'A hidden platform leads away from Harry’s old life.',mystery:'What awaits at the end of the Hogwarts Express?',cliff:'For the first time, Harry is travelling somewhere he might belong.',icon:'🚂'},
 10:{hook:'A train compartment becomes the beginning of something important.',mystery:'Who will Harry trust in this unfamiliar world?',cliff:'New friendships — and rivalries — are forming before Hogwarts even appears.',icon:'🍫'},
 11:{hook:'The castle finally rises out of the darkness.',mystery:'What kind of place is Hogwarts — and what will it make of Harry?',cliff:'Hundreds of candles, four Houses, and one ceremony remain between Harry and his new life.',icon:'🏰'},
 12:{hook:'The Sorting Hat must decide where Harry belongs.',mystery:'Will Harry become the kind of wizard Draco expects him to be?',cliff:'Harry makes a choice before the Hat makes its own.',icon:'🎩'},
 13:{hook:'Harry discovers that the air feels more natural than the ground.',mystery:'Why does flying seem to come so easily to him?',cliff:'One reckless catch is about to change his first year.',icon:'🧹'},
 14:{hook:'Harry is given a place on the Gryffindor Quidditch team.',mystery:'Can a first-year really become Hogwarts’ youngest Seeker in a century?',cliff:'A brand-new broom is waiting.',icon:'🏆'},
 15:{hook:'A forbidden corridor hides a three-headed secret.',mystery:'What could Hogwarts possibly need a creature like Fluffy to guard?',cliff:'Whatever lies beneath the trapdoor is worth protecting.',icon:'🐕'},
 16:{hook:'A troll is loose inside the castle.',mystery:'Will Harry and Ron reach Hermione before it does?',cliff:'Three classmates are about to become something more.',icon:'🧌'},
 17:{hook:'Harry’s first real Quidditch match turns dangerous.',mystery:'Who is trying to make Harry fall from his broom?',cliff:'The Trio think they know who to suspect.',icon:'🧹'},
 18:{hook:'Christmas brings Harry a gift with no sender.',mystery:'Who left him an invisibility cloak — and why?',cliff:'The castle has secrets that can only be explored unseen.',icon:'🧥'},
 19:{hook:'A mirror shows Harry something he has wanted his entire life.',mystery:'Is the Mirror of Erised showing truth, possibility, or desire?',cliff:'Dumbledore knows more about it than he first says.',icon:'🪞'},
 20:{hook:'A name finally unlocks the mystery beneath the trapdoor.',mystery:'Why would anyone want the Philosopher’s Stone badly enough to infiltrate Hogwarts?',cliff:'The Trio now know what Fluffy is guarding.',icon:'💎'},
 21:{hook:'Hagrid’s latest secret has scales, wings and a tendency to breathe fire.',mystery:'How can the Trio protect Hagrid from the consequences of an illegal dragon?',cliff:'Their solution will lead them somewhere far more dangerous.',icon:'🐉'},
 22:{hook:'Something is drinking unicorn blood in the Forbidden Forest.',mystery:'What kind of creature would choose a cursed half-life to stay alive?',cliff:'The threat inside Hogwarts is suddenly much closer to Harry.',icon:'🌲'},
 23:{hook:'The protection around the Stone is being breached.',mystery:'Can three first-years get through Hogwarts’ defences before the thief does?',cliff:'At the end of the trials, Harry may have to continue alone.',icon:'♟️'},
 24:{hook:'Harry reaches the final chamber.',mystery:'Was the Trio right about who wanted the Stone?',cliff:'The answer reaches all the way back to the night Harry received his scar.',icon:'⚡'}
};


const STORY_PASSAGES = {
  1:{
    title:'The night everything changed',
    passage:'Before Harry could remember anything, the wizarding world already knew his name. One terrible night ended with his parents gone, Voldemort vanished, and Harry alive with a lightning-shaped scar. By morning, he was being carried away from magic and toward a childhood in which nobody would willingly tell him the truth.',
    knows:'Almost nothing. Harry believes his parents died in a car crash. The Dursleys refuse to answer his questions, and he has no idea that he belongs to another world.',
    mystery:'Why did Harry survive? Voldemort killed his parents, yet the curse failed against Harry. No one yet knows what protected him — or why Voldemort disappeared.'
  },
  2:{
    title:'Number Four, Privet Drive',
    passage:'Ten years later, Harry has learned to expect very little from life with the Dursleys. He is treated as an inconvenience, kept away from anything unusual, and given almost no connection to the parents he barely remembers. Yet strange accidents seem to happen around him whenever fear, anger or desperation take over.',
    knows:'Harry believes his parents died in a car crash and has no idea why odd things happen around him.',
    mystery:'What are the Dursleys so determined to stop Harry discovering?'
  },
  3:{
    title:'A letter that should not exist',
    passage:'The ordinary rules of Privet Drive are beginning to break. A letter arrives addressed to Harry with impossible precision — even identifying the cupboard where he sleeps. The harder the Dursleys try to keep it away from him, the more determined the mysterious sender becomes.',
    knows:'Someone outside the Dursley household knows exactly who Harry is and where he lives.',
    mystery:'Who is writing to Harry, and why is Uncle Vernon so frightened of the message?'
  },
  4:{
    title:'The truth comes knocking',
    passage:'Running from the letters has only delayed the inevitable. Far from home, with the Dursleys convinced they have finally escaped whatever is pursuing Harry, someone is still coming. The story Harry has been told about his parents is about to collide with a much larger truth.',
    knows:'The Dursleys have lied about more than they admit, and the letters are connected to Harry himself.',
    mystery:'Who was Harry before the Dursleys decided what he was allowed to know?'
  }
};
function storyPassage(level){
  const t=storyTeaser(level),row=DATA.levels[level-1];
  return STORY_PASSAGES[level]||{
    title:row?.storyBeat||'A page from the journey',
    passage:`Harry’s story has reached ${row?.storyBeat||'another turning point'}. The people, places and clues already uncovered are beginning to connect, but the full meaning of this chapter is still taking shape.`,
    knows:`Harry knows only what has been revealed up to Level ${level}.`,
    mystery:t.mystery
  };
}
function genericStoryTeaser(row){
  if(!row)return {hook:'The story is waiting.',mystery:'What happens next?',cliff:'Complete your missions to continue.',icon:'✦'};
  const s=String(row.storyBeat||'').toLowerCase();
  let icon='✦',hook='The next chapter is taking shape.',mystery='What will Harry discover next?',cliff='The answer waits beyond the next level.';
  if(/chamber|basilisk|heir|voice|petrif/.test(s)){icon='🐍';hook='Something inside Hogwarts is moving in the shadows.';mystery='Who — or what — is behind the danger?';cliff='Every new clue makes the castle feel less safe.';}
  else if(/sirius|pettigrew|scabbers|marauder|azkaban/.test(s)){icon='🌙';hook='The truth about Harry’s past is becoming harder to recognise.';mystery='Who can Harry actually trust?';cliff='Old names are beginning to mean something very different.';}
  else if(/tournament|task|goblet|cedric|graveyard/.test(s)){icon='🔥';hook='The Tournament keeps becoming more dangerous.';mystery='Why was Harry entered — and who benefits from keeping him in the competition?';cliff='Someone appears to be guiding events from the shadows.';}
  else if(/umbridge|prophecy|ministry|department|sirius/.test(s)){icon='🔮';hook='The wizarding world is refusing to believe what Harry knows.';mystery='What is Voldemort searching for — and why does Harry keep seeing through his eyes?';cliff='The truth is being hidden by more than one side.';}
  else if(/horcrux|riddle|memory|slughorn|dumbledore|cave/.test(s)){icon='🧩';hook='Dumbledore is finally showing Harry how Voldemort became what he is.';mystery='What secret could make Voldemort nearly impossible to kill?';cliff='Every memory reveals another piece of the plan.';}
  else if(/hallow|locket|gringotts|hogwarts|battle|snape|forest|nagini/.test(s)){icon='△';hook='The endgame is closing in around Harry.';mystery='Which path matters most now — Hallows, Horcruxes, or the people still fighting?';cliff='Every choice is narrowing the road to Voldemort.';}
  return {hook,mystery,cliff,icon};
}
function storyTeaser(level){const row=DATA.levels[level-1];return STORY_TEASERS[level]||genericStoryTeaser(row);}
function xpRemainingForNext(){const next=nextLevelRow();return next?Math.max(0,next.xpRequired-xpIntoCurrent()):0;}
function checkpointRows(level=Math.max(1,save.currentLevel||1)){const cp=DATA.levels[Math.max(0,level-1)]?.checkpoint||1;return DATA.levels.filter(r=>r.checkpoint===cp);}
function checkpointAccordionHtml(level=Math.max(1,save.currentLevel||1)){
  const rows=checkpointRows(level),cp=rows[0]?.checkpoint||1;
  return `<details class="checkpoint-levels"><summary><span>📜 Checkpoint ${cp}</span><b>View ${rows.length} levels</b></summary><div class="checkpoint-level-list">${rows.map(r=>{const done=r.level<save.currentLevel,current=r.level===save.currentLevel,future=r.level>save.currentLevel;const title=future?'???':r.storyBeat;return `<div class="checkpoint-level ${done?'done':current?'current':'locked'}"><span>${done?'✓':r.level}</span><div><strong>Level ${r.level}${current?' • CURRENT':''}</strong><small>${escapeHtml(title)}</small></div></div>`;}).join('')}</div></details>`;
}
function homeStoryPreviewHtml(){
  const level=Math.max(1,save.currentLevel||1),row=DATA.levels[level-1],t=storyTeaser(level);
  if(!row)return `<div class="story-preview-complete"><span>⚡</span><strong>Your journey is ready.</strong></div>`;
  return `<section class="story-preview current-story"><div class="story-preview-top"><span class="story-seal">${t.icon}</span><div><small>KNOWLEDGE UNLOCKED • LEVEL ${level}</small><h3>${escapeHtml(row.storyBeat)}</h3></div></div><p class="story-hook">${escapeHtml(t.hook)} ${escapeHtml(t.cliff)}</p><div class="current-mystery"><span>CURRENT MYSTERY</span><strong>${escapeHtml(t.mystery)}</strong></div></section>`;
}

// ---------- Journey map ----------
function bookForLevel(level){return Math.min(7,Math.max(1,Math.ceil(level/24)));}
function journeyArchiveDetailHtml(level){
  const row=DATA.levels[level-1];if(!row||level>save.currentLevel)return '';
  const teaser=storyTeaser(level);
  const discoveries=DATA.collectibles.filter(c=>Number(c.firstEligibleLevel)===Number(level)&&save.owned[c.id]);
  return `<article class="journey-earned-detail">
    <span class="eyebrow">LEVEL ${level} • KNOWLEDGE EARNED</span>
    <h3>${escapeHtml(row.storyBeat)}</h3>
    <p>${escapeHtml(teaser.hook)}</p>
    ${discoveries.length?`<div class="earned-discoveries"><small>DISCOVERED AT THIS LEVEL</small><div>${discoveries.map(c=>`<span>${CATEGORY_META[c.category]?.icon||'✦'} ${escapeHtml(visibleName(c))}</span>`).join('')}</div></div>`:`<small class="no-discoveries">No permanent collectible was added at this level.</small>`}
  </article>`;
}
function renderJourney(){
  if(!ui.journeyBook)ui.journeyBook=bookForLevel(Math.max(1,save.currentLevel));
  const activeBook=bookForLevel(Math.max(1,save.currentLevel||1));
  const currentLevel=Math.max(1,save.currentLevel||1);
  const rows=DATA.levels.filter(l=>l.book===ui.journeyBook);
  const explored=rows.filter(l=>l.level<=save.currentLevel).length;
  const bookStart=(ui.journeyBook-1)*24+1;
  const withinBook=Math.max(1,Math.min(24,currentLevel-bookStart+1));
  const cp=Math.max(1,Math.min(6,Math.ceil(withinBook/4)));
  const cpStart=bookStart+(cp-1)*4,cpEnd=cpStart+3;
  const withinCp=Math.max(1,Math.min(4,currentLevel-cpStart+1));
  const isActive=ui.journeyBook===activeBook;
  const next=nextLevelRow();

  document.querySelector('#bookTabs').innerHTML=Array.from({length:7},(_,i)=>{const b=i+1;return `<button data-book="${b}" class="${ui.journeyBook===b?'active':''}"><span>${b}</span><small>${BOOK_NAMES[b]}</small></button>`;}).join('');
  document.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{ui.journeyBook=Number(b.dataset.book);renderJourney();});

  const route=Array.from({length:4},(_,i)=>{
    const absolute=cpStart+i,state=i+1<withinCp?'done':i+1===withinCp?'current':'locked';
    return `<div class="journey-level-node ${state}"><i>${absolute}</i><small>${state==='current'?'YOU ARE HERE':state==='done'?'UNLOCKED':'LOCKED'}</small></div>`;
  }).join('<span class="journey-node-link"></span>');

  const unlockedRows=rows.filter(l=>l.level<=save.currentLevel);
  const archive=unlockedRows.length?unlockedRows.map(l=>`<button class="journey-review-level ${l.level===currentLevel?'current':''}" data-review-level="${l.level}"><b>${l.level}</b><span>${escapeHtml(l.storyBeat)}</span><small>${l.level===currentLevel?'Current level':'Unlocked'}</small></button>`).join(''):`<div class="journey-book-locked"><span>🔒</span><strong>This book is still hidden.</strong><small>Continue your current journey to reach it.</small></div>`;

  const nextReveal=isActive&&next?`<section class="journey-reveal-lock">
      <div class="reveal-lock-icon">✦</div>
      <div><span class="eyebrow">NEXT REVEAL • LEVEL ${next.level}</span><h3>${xpRemainingForNext().toLocaleString()} XP remaining</h3><p>New story knowledge and discoveries stay hidden until you unlock the level.</p></div>
      <span class="lock-mark">🔒</span>
    </section>`:'';

  const map=document.querySelector('#journeyMap');
  map.style.height='auto';
  map.innerHTML=`
    <section class="journey-book-banner journey-book-simple">
      <div class="journey-book-art">🏰<i>ARTWORK<br>PLACEHOLDER</i></div>
      <div><h2>${escapeHtml(BOOK_NAMES[ui.journeyBook])}</h2><span>${explored}/24 levels unlocked</span></div>
    </section>
    ${isActive?`<section class="journey-position-card">
      <div class="position-head"><div><span class="eyebrow">CURRENT CHAPTER • LEVELS ${cpStart}–${cpEnd}</span><h3>Level ${withinCp} of 4</h3></div><strong>${currentLevel}</strong></div>
      <div class="journey-visual-route">${route}</div>
    </section>${nextReveal}`:''}
    <section class="journey-archive-card">
      <div class="section-head"><div><span class="eyebrow">YOUR STORY ARCHIVE</span><h3>${unlockedRows.length?'Unlocked levels':'Nothing unlocked here yet'}</h3></div><small>Tap a level to revisit what you earned</small></div>
      <div class="journey-level-archive">${archive}</div>
      <div id="journeyArchiveDetail" hidden></div>
    </section>`;

  map.querySelectorAll('[data-review-level]').forEach(btn=>btn.onclick=()=>{
    const detail=map.querySelector('#journeyArchiveDetail'),level=Number(btn.dataset.reviewLevel);
    const wasSame=detail.dataset.level===String(level)&&!detail.hidden;
    detail.hidden=wasSame;
    if(wasSame)return;
    detail.dataset.level=String(level);detail.innerHTML=journeyArchiveDetailHtml(level);detail.hidden=false;
    detail.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  const detail=document.querySelector('#journeyNodeDetail');if(detail){detail.hidden=true;detail.innerHTML='';}
}

function checkpointInlineHtml(cp){
  const rows=DATA.levels.filter(l=>l.book===ui.journeyBook&&Number(l.checkpoint)===Number(cp));
  if(!rows.length)return '';
  const first=rows[0], locked=first.level>save.currentLevel+1;
  if(locked){
    return `<div class="journey-inline-detail locked"><span>🔒</span><div><strong>Checkpoint ${cp} is still hidden</strong><small>Reach Level ${first.level} to reveal this chapter.</small></div></div>`;
  }
  return `<div class="journey-inline-detail"><div class="inline-levels">${rows.map(l=>{
    const known=l.level<=save.currentLevel,next=l.level===save.currentLevel+1;
    return `<div class="inline-level ${known?'known':next?'next':'locked'}"><b>${l.level}</b><div><strong>${known?escapeHtml(l.storyBeat):next?'Next chapter':'Locked'}</strong><small>${known?'Explored':next?`${xpRemainingForNext().toLocaleString()} XP to reveal`:`Reach Level ${l.level}`}</small></div></div>`;
  }).join('')}</div></div>`;
}
function toggleJourneyCheckpoint(button){
  const stops=button.closest('.journey-stops');if(!stops)return;
  const cp=Number(button.dataset.checkpoint);
  const existing=stops.querySelector('.journey-inline-detail[data-open-cp]');
  if(existing&&Number(existing.dataset.openCp)===cp){existing.remove();button.classList.remove('expanded');return;}
  if(existing)existing.remove();
  stops.querySelectorAll('.journey-stop.expanded').forEach(x=>x.classList.remove('expanded'));
  button.classList.add('expanded');
  const wrap=document.createElement('div');
  wrap.innerHTML=checkpointInlineHtml(cp);
  const detail=wrap.firstElementChild;
  if(!detail)return;
  detail.dataset.openCp=cp;
  button.after(detail);
}

function storyChapterPanel(level){
  const l=DATA.levels[level-1];
  if(!l||level>save.currentLevel)return `<article class="journey-earned-detail locked"><span class="eyebrow">LEVEL ${level}</span><h3>Hidden</h3><p>This story knowledge has not been unlocked yet.</p></article>`;
  const teaser=storyTeaser(level);
  const discoveries=DATA.collectibles.filter(c=>Number(c.firstEligibleLevel)===Number(level)&&save.owned[c.id]);
  return `<article class="journey-earned-detail">
    <span class="eyebrow">FROM THE STORY • LEVEL ${level}</span>
    <h3>${escapeHtml(l.storyBeat)}</h3>
    <p>${escapeHtml(teaser.hook)}</p>
    ${discoveries.length?`<div class="earned-discoveries"><small>DISCOVERED AT THIS LEVEL</small><div>${discoveries.map(c=>`<span>${CATEGORY_META[c.category]?.icon||'✦'} ${escapeHtml(visibleName(c))}</span>`).join('')}</div></div>`:''}
  </article>`;
}
function showJourneyNode(level){
  const detail=document.querySelector('#journeyNodeDetail');
  if(!detail)return;
  detail.hidden=false;
  detail.innerHTML=storyChapterPanel(level);
  detail.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ---------- Collection museum ----------
function cardBook(card){return bookForLevel(card.firstEligibleLevel);}
function collectionCardHtml(c){const status=cardStatus(c),owned=status==='owned',name=owned?visibleName(c):(status==='eligible'?'Undiscovered':'?'),meta=CATEGORY_META[c.category],art=owned?meta.icon:'✦';return `<article class="museum-card ${status} ${c.rarity}"><div class="museum-art"><span>${art}</span><i>${owned?escapeHtml(visibleName(c).slice(0,1)):'?'}</i></div><div class="museum-copy"><span class="rarity ${c.rarity}">${c.rarity}</span><h4>${escapeHtml(name)}</h4><p>${owned?`Discovered Lv ${save.owned[c.id].discoveredLevel}`:status==='eligible'?`Eligible since Lv ${c.firstEligibleLevel}`:'Undiscovered'}</p></div></article>`;}
function recentCollectionCardHtml(c){const meta=CATEGORY_META[c.category];return `<article class="recent-mini ${c.rarity}"><div class="recent-mini-art"><span>${meta.icon}</span><i>ART</i></div><small>${c.rarity.toUpperCase()}</small><strong>${escapeHtml(visibleName(c))}</strong></article>`;}
function renderCollection(){
  document.querySelector('#view-collection')?.classList.add('magical-collection');
  const hub=document.querySelector('#collectionHub'),ownedCards=DATA.collectibles.filter(c=>save.owned[c.id]).sort((a,b)=>(save.owned[b.id].discoveredLevel||0)-(save.owned[a.id].discoveredLevel||0));
  if(!ui.collectionCategory){
    const recent=ownedCards.slice(0,5);hub.innerHTML=`<section class="archive-hub"><div class="archive-hero"><div><span>THE MAGICAL ARCHIVE</span><h2>${ownedCards.length} <em>/ 385</em></h2><p>Every discovery adds another piece to your wizarding world.</p></div><div class="archive-spark">✦</div></div>${recent.length?`<div class="recent-section compact"><div class="section-head"><h3>✨ Recently discovered</h3><small>Recent unlocks</small></div><div class="recent-shelf compact">${recent.map(recentCollectionCardHtml).join('')}</div></div>`:''}<div class="archive-doors">${Object.entries(CATEGORY_META).map(([cat,m],i)=>{const all=DATA.collectibles.filter(c=>c.category===cat),owned=all.filter(c=>save.owned[c.id]).length;return `<button class="archive-door archive-${i}" data-gallery="${escapeHtml(cat)}"><div class="archive-door-art"><span>${m.icon}</span><i>IMAGE<br>PLACEHOLDER</i></div><div><h3>${m.title}</h3><span>${owned} / ${all.length}</span><div class="gallery-progress"><i style="width:${all.length?owned/all.length*100:0}%"></i></div></div><b>›</b></button>`;}).join('')}</div></section>`;
    hub.querySelectorAll('[data-gallery]').forEach(b=>b.onclick=()=>{ui.collectionCategory=b.dataset.gallery;ui.collectionBook=Math.min(7,Math.max(1,bookForLevel(Math.max(1,save.currentLevel))));renderCollection();window.scrollTo({top:0,behavior:'smooth'});});return;
  }
  const cat=ui.collectionCategory,meta=CATEGORY_META[cat],all=DATA.collectibles.filter(c=>c.category===cat),book=ui.collectionBook||1,filtered=all.filter(c=>cardBook(c)===book),owned=all.filter(c=>save.owned[c.id]).length;
  hub.innerHTML=`<button id="collectionBack" class="back-button">← Magical Archive</button><section class="gallery-hero compact-gallery-hero"><div class="gallery-icon">${meta.icon}</div><div><h2>${meta.title}</h2><span>${owned} / ${all.length} discovered</span><p>${meta.subtitle}</p></div></section><div class="year-tabs compact-year-tabs">${Array.from({length:7},(_,i)=>{const b=i+1,count=all.filter(c=>cardBook(c)===b).length;return `<button data-year="${b}" class="${book===b?'active':''}"><span>Y${b}</span><small>${count}</small></button>`;}).join('')}</div><div class="gallery-year-head compact-gallery-year"><div><span class="eyebrow">YEAR ${book}</span><h3>${BOOK_NAMES[book]}</h3></div><span>${filtered.filter(c=>save.owned[c.id]).length}/${filtered.length}</span></div><div class="museum-grid">${filtered.map(collectionCardHtml).join('')||'<p class="muted">No collectibles first appear in this year.</p>'}</div>`;
  document.querySelector('#collectionBack').onclick=()=>{ui.collectionCategory=null;ui.collectionBook=null;renderCollection();};hub.querySelectorAll('[data-year]').forEach(b=>b.onclick=()=>{ui.collectionBook=Number(b.dataset.year);renderCollection();});
}

// ---------- Stats dashboard ----------
function xpSeries7Days(){
  const today=parseDateKey(localDateKey());
  return Array.from({length:7},(_,i)=>{
    const d=addDays(today,i-6),key=localDateKey(d);
    const xp=save.eventLog.filter(e=>e.kind==='xp'&&e.ts&&localDateKey(new Date(e.ts))===key).reduce((n,e)=>n+(Number((String(e.title).match(/\+(\d+)\s+XP/)||[])[1])||0),0);
    return {key,label:d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2),xp};
  });
}
function dailyMissionSeries7Days(){
  const today=parseDateKey(localDateKey()),habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep');
  return Array.from({length:7},(_,i)=>{const d=addDays(today,i-6),key=localDateKey(d),record=save.daily[key];if(!record)return {key,label:d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2),done:null,total:habits.length};const done=habits.filter(h=>record.habits?.[h.id]?.completed).length;return {key,label:d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2),done,total:habits.length};});
}
function sleepSeries7Days(){
  const today=parseDateKey(localDateKey());
  return Array.from({length:7},(_,i)=>{const d=addDays(today,i-6),key=localDateKey(d),s=save.daily[key]?.sleep;return {key,label:d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2),hours:s?.mainHours>0?s.mainHours:null,nap:s?.napHours||0};});
}
function renderStats(){
  /* stats-activity-only-guard: never show Journey/Collection/world metrics here */

  const status=currentWeekStatus(),series=xpSeries7Days(),dailySeries=dailyMissionSeries7Days(),sleepSeries=sleepSeries7Days();
  const day=displayDaily(),dailyHabits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep'),dailyDone=dailyHabits.filter(h=>day.habits[h.id]?.completed).length;
  const sportDone=3-status.week.sportDueRemaining,weekKeys=currentWeekDates();
  const weekXP=save.eventLog.filter(e=>e.kind==='xp'&&e.ts&&weekKeys.includes(localDateKey(new Date(e.ts)))).reduce((n,e)=>n+(Number((String(e.title).match(/\+(\d+)\s+XP/)||[])[1])||0),0);
  const weeklyDone=status.week.weights+status.week.cardio+sportDone+status.week.sauna,weeklyTarget=16;
  const missionOrbs=[['🏋️','Gym',status.week.weights,4],['🏃','Incline',status.week.cardio,4],['⚽','Sport',sportDone,3],['🧖','Sauna',status.week.sauna,5]];
  const loggedSleep=sleepSeries.filter(x=>x.hours!==null),sleepAvg=loggedSleep.length?loggedSleep.reduce((n,x)=>n+x.hours,0)/loggedSleep.length:0,target=sleepTargetForLevel();
  const sevenXp=series.reduce((n,x)=>n+x.xp,0),maxXp=Math.max(1,...series.map(x=>x.xp));

  const view=document.querySelector('#view-stats');
  const title=view?.querySelector('h2');if(title)title.textContent='Activity Stats';
  const intro=view?.querySelector('h2 + p');if(intro)intro.textContent='Training, daily habits, sleep and recovery — nothing else.';

  document.querySelector('#statsDashboard').innerHTML=`
    <section class="activity-stats-hero">
      <span class="eyebrow">THIS WEEK</span><h3>Your activity dashboard</h3>
      <div class="activity-hero-grid">
        <div><span>Weekly sessions</span><strong>${weeklyDone}/${weeklyTarget}</strong></div>
        <div><span>Daily missions</span><strong>${dailyDone}/${dailyHabits.length}</strong></div>
        <div><span>Activity XP</span><strong>${weekXP.toLocaleString()}</strong></div>
      </div>
    </section>

    <section class="dashboard-card quest-progress-card">
      <div class="section-head"><div><span class="eyebrow">WEEKLY ACTIVITIES</span><h3>Mission progress</h3></div></div>
      <div class="quest-orb-grid">${missionOrbs.map(([icon,name,value,target])=>{const pct=Math.min(100,value/target*100);return `<div class="quest-orb ${value>=target?'complete':''}"><div class="quest-ring" style="--pct:${pct}"><span>${icon}</span></div><strong>${name}</strong><small>${value}/${target}${value>=target?' ✓':''}</small></div>`}).join('')}</div>
    </section>

    <section class="dashboard-card daily-history-card">
      <div class="section-head"><div><span class="eyebrow">DAILY MISSIONS</span><h3>Last 7 days</h3></div></div>
      <div class="daily-history-chart">${dailySeries.map(x=>`<div class="daily-history-day"><div class="daily-history-bar"><i class="${x.done===null?'empty':''}" style="height:${x.done===null?5:Math.max(8,x.done/x.total*100)}%"></i></div><b>${x.done===null?'—':`${x.done}/${x.total}`}</b><small>${x.label}</small></div>`).join('')}</div>
    </section>

    <section class="dashboard-card sleep-history-card">
      <div class="section-head"><div><span class="eyebrow">SLEEP</span><h3>Recovery trend</h3></div><strong>${loggedSleep.length?sleepAvg.toFixed(1)+' h avg':'No data yet'}</strong></div>
      <div class="sleep-target-copy">Current target: <b>${target.toFixed(2).replace(/\.00$/,'').replace(/0$/,'')} h main sleep</b> • 1 h nap</div>
      <div class="sleep-history-chart">${sleepSeries.map(x=>`<div class="sleep-history-day"><div class="sleep-history-bar"><span class="target-mark" style="bottom:${Math.min(100,target/10*100)}%"></span><i class="${x.hours===null?'empty':''}" style="height:${x.hours===null?4:Math.min(100,x.hours/10*100)}%"></i></div><b>${x.hours===null?'—':x.hours.toFixed(1)}</b><small>${x.label}</small></div>`).join('')}</div>
    </section>

    <section class="dashboard-card xp-trail-card activity-xp-card">
      <div class="section-head"><div><span class="eyebrow">ACTIVITY XP</span><h3>7-day output</h3></div><strong>${sevenXp.toLocaleString()} XP</strong></div>
      <div class="xp-orb-trail">${series.map((x,i)=>`<div class="xp-orb-day ${x.xp?'lit':''} ${i===6?'today':''}"><span class="xp-orb" style="--power:${Math.max(.18,x.xp/maxXp)}"></span><b>${x.xp||'·'}</b><small>${x.label}</small></div>`).join('')}</div>
    </section>`;
}

// ---------- Settings ----------
function renderSettings(){const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;document.querySelector('#installState').textContent=standalone?'Installed and running from your Home Screen in standalone mode.':'Browser mode: use Safari → Share → Add to Home Screen.';document.querySelector('#soundToggle').textContent=save.soundEnabled?'On':'Off';document.querySelector('#soundToggle').classList.toggle('off',!save.soundEnabled);document.querySelector('#devTools').hidden=!DEV_MODE;}
function render(){renderHome();renderJourney();renderCollection();renderStats();renderSettings();}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));}

function setupUI(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));if(b.dataset.view==='journey')renderJourney();if(b.dataset.view==='collection')renderCollection();if(b.dataset.view==='stats')renderStats();if(b.dataset.view==='settings')renderSettings();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelector('#saveSleep').onclick=saveSleep;document.querySelector('#sleepHours').oninput=renderSleep;if(FRESH_PREVIEW){document.querySelector('#saveSleep').disabled=true;document.querySelector('#sleepHours').disabled=true;document.querySelector('#napHours').disabled=true;}
  document.querySelector('#revealNext').onclick=()=>closeReveal(false);document.querySelector('#revealSkip').onclick=()=>closeReveal(true);
  document.querySelector('#soundToggle').onclick=()=>{save.soundEnabled=!save.soundEnabled;persist();renderSettings();if(save.soundEnabled)playChime('success');};
  document.querySelector('#exportSave').onclick=()=>{const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hp-fitness-rpg-save-${localDateKey()}.json`;a.click();URL.revokeObjectURL(a.href);};
  document.querySelector('#importSave').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{save=mergeState(JSON.parse(await f.text()));persist();ensureCurrentWeek();finalizePastDays();render();toast('Save imported.');}catch{toast('That save file could not be read.','warn');}};
  if(DEV_MODE){document.querySelectorAll('[data-xp]').forEach(b=>b.onclick=()=>addXP(Number(b.dataset.xp),'Development tester'));document.querySelector('#resetSave').onclick=()=>{if(confirm('Reset TEST progress on this device?')){localStorage.removeItem(stateKey);save=defaultState();ensureCurrentWeek();persist();render();}};}
}
function updateNetwork(){const b=document.querySelector('#networkBadge');b.textContent=navigator.onLine?'Online':'Offline ready';b.style.color=navigator.onLine?'#86efac':'#c4b5fd';}
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);

try{
  await loadData();ensureCurrentWeek();finalizePastDays();updateHighestSleepStage();ui.journeyBook=bookForLevel(Math.max(1,save.currentLevel));setupUI();render();updateNetwork();persist();queueMigratedReveals();
}catch(err){console.error(err);const b=document.querySelector('#networkBadge');b.textContent='Load error';b.style.color='#fb7185';alert('The app data could not load. Please refresh while online.');}

if('serviceWorker' in navigator){window.addEventListener('load',async()=>{try{const reg=await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});await reg.update();}catch(err){console.warn('Service worker update failed',err);}});}
