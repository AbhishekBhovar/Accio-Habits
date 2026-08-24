const DATA = {};
const stateKey = 'hpFitnessRpgSave_v3';
const legacyStateKeys = ['hpFitnessRpgSave_v2','hpFitnessRpgSave_v1'];
const APP_VERSION = '5.3.0';
const DEV_MODE = new URLSearchParams(location.search).get('dev') === '1';
const CATEGORY_META = {
  'Character': {icon:'🧙',title:'Characters',subtitle:'Witches, wizards, friends and foes'},
  'Creature': {icon:'🐉',title:'Creatures',subtitle:'A magical field guide'},
  'Object / Artefact': {icon:'🏆',title:'Objects & Artefacts',subtitle:'Relics, tools and legendary objects'},
  'Location': {icon:'🏰',title:'Locations',subtitle:'Places across the Wizarding World'},
  'Spell / Magic': {icon:'✨',title:'Magic',subtitle:'Spells, potions and magical abilities'},
  'Moment': {icon:'🎞️',title:'Moments',subtitle:'Memories from your journey'}
};
const BOOK_NAMES = ['','Philosopher\'s Stone','Chamber of Secrets','Prisoner of Azkaban','Goblet of Fire','Order of the Phoenix','Half-Blood Prince','Deathly Hallows'];

let ui = {journeyBook:1, collectionCategory:null, collectionBook:null, collectionMode:'home', collectionCard:null, revealQueue:[], revealActive:false};
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
function normalizeWeek(week){
  return Object.assign(week,{weights:week.weights||0,weightDays:week.weightDays||[],cardio:week.cardio||0,cardioLog:week.cardioLog||[],sportActual:week.sportActual||0,sportLog:week.sportLog||[],sportBankUsed:week.sportBankUsed||0,sportDueRemaining:Number.isFinite(week.sportDueRemaining)?week.sportDueRemaining:3,sauna:week.sauna||0,saunaLog:week.saunaLog||[],saunaXpDays:week.saunaXpDays||[],finalized:!!week.finalized});
}
function ensureCurrentWeek(){
  const currentKey=weekKey();
  if(save.lastWeekKey && save.lastWeekKey!==currentKey){finalizeWeek(save.lastWeekKey);}
  if(!save.weekly[currentKey]){
    const usedFromBank=Math.min(3,save.sportBank||0);save.sportBank=(save.sportBank||0)-usedFromBank;
    save.weekly[currentKey]={weights:0,weightDays:[],cardio:0,cardioLog:[],sportActual:0,sportLog:[],sportBankUsed:usedFromBank,sportDueRemaining:3-usedFromBank,sauna:0,saunaLog:[],saunaXpDays:[],createdAt:Date.now(),finalized:false};
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
  if(!save.soundEnabled)return;try{ensureAudio();const now=audioContext.currentTime,presets={success:{n:[659,784],g:.03,s:.07,d:.15,t:'sine'},undo:{n:[659,523],g:.022,s:.055,d:.12,t:'sine'},level:{n:[392,523,659,784],g:.05,s:.095,d:.28,t:'triangle'},checkpoint:{n:[523,659,784],g:.045,s:.10,d:.25,t:'triangle'},Rare:{n:[659,784],g:.035,s:.09,d:.19,t:'sine'},Epic:{n:[523,659,784],g:.045,s:.09,d:.23,t:'triangle'},Legendary:{n:[392,523,659,988],g:.055,s:.10,d:.29,t:'triangle'},Mythic:{n:[330,494,659,988,1319],g:.06,s:.105,d:.33,t:'triangle'},book:{n:[330,392,523,659,784,1047],g:.065,s:.11,d:.37,t:'triangle'}};const p=presets[kind]||presets.success;p.n.forEach((freq,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain(),t=now+i*p.s;o.type=p.t;o.frequency.value=freq;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(p.g,t+.018);g.gain.exponentialRampToValueAtTime(.0001,t+p.d);o.connect(g).connect(audioContext.destination);o.start(t);o.stop(t+p.d+.02);});}catch(err){console.warn('Sound failed',err)}
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
  const awards=BATTLE_PROTO.items.filter(i=>i.level===level && !i.secret);
  for(const a of awards){logEvent(level,`Readiness: ${a.name} — ${a.state}`,'readiness');ui.revealQueue.push({type:'readiness',award:a});}
  // Legacy collectible data is preserved silently for save compatibility, but it no longer drives the reward experience.
  for(const c of granted){logEvent(level,`Prepared: ${visibleName(c)}`,'discovery');}
  for(const x of row.revelations)logEvent(level,x,'revelation');for(const x of row.evolutions)logEvent(level,x,'evolution');
  if(DATA.config.bookCompletionLevels.includes(level)&&!save.completedBooks.includes(row.book)){save.completedBooks.push(row.book);}
}
function addXP(amount,source='Activity'){
  const safeAmount=Math.max(0,Math.round(Number(amount)||0));if(!safeAmount)return;
  save.totalXP+=safeAmount;logEvent(save.currentLevel,`+${safeAmount} XP — ${source}`,'xp');
  while(save.currentLevel<168){const threshold=cumulativeXpForLevel(save.currentLevel+1);if(save.totalXP<threshold)break;save.currentLevel++;levelUp(save.currentLevel);}
  persist();render();runRevealQueue();
}
function removeLatestXpEvent(amount,source){
  const needle=`+${amount} XP — ${source}`;
  const i=save.eventLog.findIndex(e=>e.kind==='xp'&&e.title===needle);
  if(i>=0)save.eventLog.splice(i,1);
}
function syncProgressAfterXpRemoval(){
  let level=0;
  while(level<168 && save.totalXP>=cumulativeXpForLevel(level+1)) level++;
  if(level>=save.currentLevel){save.currentLevel=level;return;}
  save.currentLevel=level;
  for(const [id,meta] of Object.entries(save.owned||{})){
    if(Number(meta?.discoveredLevel||0)>level) delete save.owned[id];
  }
  save.completedBooks=(save.completedBooks||[]).filter(b=>b*24<=level);
  save.eventLog=(save.eventLog||[]).filter(e=>!(Number(e.level||0)>level && ['level','story','discovery','revelation','evolution'].includes(e.kind)));
  ui.revealQueue=[];
}
function removeXP(amount,source='Activity'){
  const safeAmount=Math.max(0,Math.round(Number(amount)||0));if(!safeAmount)return;
  save.totalXP=Math.max(0,save.totalXP-safeAmount);
  removeLatestXpEvent(safeAmount,source);
  syncProgressAfterXpRemoval();
  persist();render();
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
  if(item.type==='readiness'){const a=item.award;const meta=BATTLE_PROTO.categories.find(c=>c.id===a.cat);eye.textContent='BATTLE READINESS INCREASED';art.textContent=meta?.icon||'✦';art.className='reveal-art readiness-award-art';rar.textContent=(meta?.name||'READINESS').toUpperCase();rar.className='reveal-rarity Legendary';title.textContent=a.name;text.textContent=`${a.state} • ${a.detail}`;playChime('Legendary');}
  else if(item.type==='collectible'){closeReveal(false);return;}
  else {closeReveal(false);return;}
}
function closeReveal(skip=false){document.querySelector('#revealOverlay').className='reveal-overlay';document.querySelector('#revealOverlay').hidden=true;ui.revealActive=false;if(skip)ui.revealQueue=[];else setTimeout(runRevealQueue,140);}

// ---------- daily habits ----------
function sleepXP(hours){hours=Number(hours)||0;if(hours<DATA.habits.sleep.zeroBelowHours)return 0;if(hours>=8)return 50;return Math.round((hours/8)*50);}
function toggleHabit(id){
  ensureAudio();
  const habit=DATA.habits.dailyHabits.find(h=>h.id===id);if(!habit||habit.input==='sleep')return;
  const day=getDaily(),entry=day.habits[id];
  if(entry?.completed){
    const xp=entry.xpAwarded||habit.xp;
    delete day.habits[id];
    removeXP(xp,habit.name);
    playChime('undo');
    return;
  }
  day.habits[id]={completed:true,xpAwarded:habit.xp,ts:Date.now()};
  addXP(habit.xp,habit.name);playChime('success');toast(`${habit.name} complete • +${habit.xp} XP`);
}
function completeHabit(id){toggleHabit(id);}

function saveSleep(){
  ensureAudio();const day=getDaily(),main=Math.max(0,Number(document.querySelector('#sleepHours').value)||0),nap=Math.max(0,Number(document.querySelector('#napHours').value)||0);if(main<=0){toast('Enter your main sleep hours first.','warn');return;}
  const before=calculateDayStatus(),newXp=sleepXP(main),oldXp=day.sleep?.xpAwarded||0,delta=Math.max(0,newXp-oldXp);day.sleep={mainHours:main,napHours:nap,xpAwarded:Math.max(oldXp,newXp),scoreXp:newXp,savedAt:Date.now()};updateHighestSleepStage();if(delta)addXP(delta,'Sleep');else{persist();render();}const after=calculateDayStatus();toast(`Sleep saved • ${newXp}/50 XP`);if(!before.perfectDay&&after.perfectDay){playChime('perfect');toast('🌟 PERFECT DAY achieved!','perfect');}}
function calculateDayStatus(key=localDateKey()){
  const day=getDaily(key);let earned=0,max=DATA.habits.dailyMaxXP;
  for(const h of DATA.habits.dailyHabits){if(h.id==='sleep'){earned+=day.sleep?.scoreXp||0;continue;}const entry=day.habits[h.id];if(entry?.completed)earned+=entry.xpAwarded||h.xp;}
  const controllable=DATA.habits.dailyHabits.filter(h=>h.id!=='sleep'),perfectRoutine=controllable.every(h=>day.habits[h.id]?.completed===true),sleepHours=day.sleep?.mainHours||0,perfectDay=perfectRoutine&&sleepHours>=8&&sleepHours<=9,exceptionalDay=perfectDay&&(day.weeklyCreditsToday||0)>=DATA.habits.achievements.exceptionalDayWeeklyCredits;
  return {earned,max,discipline:max?earned/max:0,perfectRoutine,perfectDay,exceptionalDay};
}

// ---------- weekly missions ----------
function decrementDayCredit(date,amount=1){const day=save.daily?.[date];if(day)day.weeklyCreditsToday=Math.max(0,(day.weeklyCreditsToday||0)-amount);}
function logWeights(){ensureAudio();const week=ensureCurrentWeek(),date=localDateKey();if(week.weights>=4)return toast('Gym target already complete this week.','warn');if(week.weightDays.includes(date))return toast('Gym already credited today.','warn');week.weights++;week.weightDays.push(date);getDaily().weeklyCreditsToday++;addXP(100,'Gym Weight Lifting');toast(`Gym • ${week.weights}/4 • +100 XP`);}
function undoWeights(){const week=ensureCurrentWeek();if(week.weights<=0)return toast('Nothing to undo for Gym.','warn');const date=week.weightDays.pop()||localDateKey();week.weights=Math.max(0,week.weights-1);decrementDayCredit(date,1);removeXP(100,'Gym Weight Lifting');playChime('undo');}
function logCardio(credits=1){ensureAudio();const week=ensureCurrentWeek(),remaining=Math.max(0,4-week.cardio),accepted=Math.min(credits,remaining);if(accepted<=0)return toast('Incline / Stairs target already complete this week.','warn');week.cardio+=accepted;week.cardioLog.push({date:localDateKey(),credits:accepted});getDaily().weeklyCreditsToday+=accepted;const xp=accepted*40;addXP(xp,'Incline Walk / StairMaster');toast(`Incline / Stairs +${accepted} • +${xp} XP`);}
function undoCardio(){const week=ensureCurrentWeek();if(week.cardio<=0)return toast('Nothing to undo for Incline / Stairs.','warn');const last=week.cardioLog.pop(),credits=Math.min(week.cardio,Math.max(1,last?.credits||1)),date=last?.date||localDateKey();week.cardio=Math.max(0,week.cardio-credits);decrementDayCredit(date,credits);removeXP(credits*40,'Incline Walk / StairMaster');playChime('undo');}
function logSport(){ensureAudio();const week=ensureCurrentWeek();if(week.sportDueRemaining<=0)return toast('Sport / Outdoor weekly target is already complete.','warn');const date=localDateKey();week.sportActual++;week.sportLog.push({date,banked:false});getDaily().weeklyCreditsToday++;week.sportDueRemaining=Math.max(0,week.sportDueRemaining-1);addXP(50,'Sport / Outdoor Activity');toast(`Sport / Outdoor • ${3-week.sportDueRemaining}/3 • +50 XP`);}
function undoSport(){const week=ensureCurrentWeek(),progress=3-week.sportDueRemaining;if(progress<=0)return toast('Nothing to undo for Sport / Outdoor.','warn');if(week.sportActual>0){const last=week.sportLog.pop(),date=last?.date||localDateKey();week.sportActual=Math.max(0,week.sportActual-1);week.sportDueRemaining=Math.min(3,week.sportDueRemaining+1);decrementDayCredit(date,1);removeXP(50,'Sport / Outdoor Activity');}else if((week.sportBankUsed||0)>0){week.sportBankUsed=Math.max(0,week.sportBankUsed-1);save.sportBank=(save.sportBank||0)+1;week.sportDueRemaining=Math.min(3,week.sportDueRemaining+1);persist();render();}playChime('undo');}
function logSauna(credits){
  ensureAudio();const week=ensureCurrentWeek(),date=localDateKey(),remaining=Math.max(0,5-week.sauna),accepted=Math.min(credits,remaining);if(accepted<=0)return toast('Sauna target already complete this week.','warn');
  const firstXpToday=!week.saunaXpDays.includes(date);week.sauna+=accepted;week.saunaLog.push({date,credits:accepted,xpAwarded:firstXpToday?35:0});getDaily().weeklyCreditsToday+=accepted;if(firstXpToday){week.saunaXpDays.push(date);addXP(35,'Sauna');toast(`Sauna +${accepted} credit${accepted>1?'s':''} • +35 XP`);}else{persist();render();toast(`Sauna +${accepted} credit • 0 extra XP`);}
}
function undoSauna(){const week=ensureCurrentWeek();if(week.sauna<=0)return toast('Nothing to undo for Sauna.','warn');const last=week.saunaLog.pop(),credits=Math.min(week.sauna,Math.max(1,last?.credits||1)),date=last?.date||localDateKey(),xp=Number.isFinite(last?.xpAwarded)?last.xpAwarded:(week.saunaXpDays.includes(date)?35:0);week.sauna=Math.max(0,week.sauna-credits);decrementDayCredit(date,credits);if(xp>0){const stillXpThatDay=week.saunaLog.some(x=>x.date===date&&x.xpAwarded>0);if(!stillXpThatDay)week.saunaXpDays=week.saunaXpDays.filter(d=>d!==date);removeXP(xp,'Sauna');}else{persist();render();}playChime('undo');}

function sportProgressText(week=ensureCurrentWeek()){return `${3-week.sportDueRemaining}/3 weekly target • ${save.sportBank} banked`;}

// ---------- sleep stats ----------
function sleepEntries(days=7){const today=parseDateKey(localDateKey()),arr=[];for(let i=days-1;i>=0;i--){const key=localDateKey(addDays(today,-i)),s=save.daily[key]?.sleep;if(s?.mainHours>0)arr.push({key,...s});}return arr;}
function sleepStageForAverage(a){let stage=1;for(const s of DATA.habits.sleep.stages)if(a>=s.minAverage)stage=s.stage;return stage;}
function stageRoman(n){return ['','I','II','III','IV','V'][n]||String(n);}
function updateHighestSleepStage(){const entries=sleepEntries(14);if(entries.length<14)return;save.sleep.highestStage=Math.max(save.sleep.highestStage,sleepStageForAverage(avg(entries.map(x=>x.mainHours))));persist();}
function sleepSummary(){const seven=sleepEntries(7),sevenAvg=avg(seven.map(x=>x.mainHours)),stage=sleepStageForAverage(sevenAvg),recovery=seven.reduce((n,x)=>n+(x.napHours||0)+Math.max(0,x.mainHours-8),0),shortfall=seven.reduce((n,x)=>n+Math.max(0,8-x.mainHours),0);return {sevenAvg,stage,count:seven.length,recovery,shortfall};}
function currentWeekDates(offsetWeeks=0){const start=addDays(mondayOf(),offsetWeeks*7);return Array.from({length:7},(_,i)=>localDateKey(addDays(start,i)));}
function currentWeekStatus(){const week=ensureCurrentWeek(),today=localDateKey(),elapsed=currentWeekDates().filter(k=>k<=today),statuses=elapsed.map(k=>calculateDayStatus(k)),avgDiscipline=statuses.length?avg(statuses.map(s=>s.discipline)):0,routineDays=statuses.filter(s=>s.perfectRoutine).length,ss=sleepSummary();return {week,avgDiscipline,routineDays,perfectWeek:avgDiscipline>=.9&&week.weights>=4&&week.cardio>=4&&week.sportDueRemaining===0&&week.sauna>=5&&routineDays>=3,optimalSleepWeek:ss.count===7&&ss.sevenAvg>=8&&ss.sevenAvg<=9};}

// ---------- render Today ----------
function renderHome(){
  const row=currentRow(),next=nextLevelRow();document.querySelector('#levelOrb').textContent='⚡';document.querySelector('#levelTitle').textContent='Preparing Harry';document.querySelector('#storyBeat').textContent='Every mission builds the skills needed for the battles ahead.';document.querySelector('#bookLabel').textContent=row?`BOOK ${row.book} • BATTLE TRAINING`:'BATTLE TRAINING';
  const xpNeed=next?.xpRequired||0,inside=xpIntoCurrent(),pct=save.currentLevel>=168?100:Math.max(0,Math.min(100,(inside/xpNeed)*100));document.querySelector('#xpBar').style.width=`${pct}%`;document.querySelector('#xpText').textContent=save.currentLevel>=168?'Saga complete':`${inside.toLocaleString()} / ${xpNeed.toLocaleString()} XP`;document.querySelector('#checkpointText').textContent=row?`Checkpoint ${row.checkpoint}`:'Checkpoint 1';
  const owned=Object.keys(save.owned).length,today=calculateDayStatus(),liveStreak=save.streak.current+(today.discipline>=.8&&!getDaily().finalized?1:0);document.querySelector('#ownedCount').textContent=`${owned} / ${DATA.collectibles.length}`;document.querySelector('#sagaPct').textContent=`${((save.currentLevel/168)*100).toFixed(1)}% saga`;document.querySelector('#todayScore').textContent=`${today.earned} XP`;document.querySelector('#todayXp').textContent=`${today.earned} / ${today.max} daily XP`;document.querySelector('#streakText').textContent=`${liveStreak} 🔥`;document.querySelector('#bestStreakText').textContent=`Best ${Math.max(save.streak.best,liveStreak)}`;
  const banner=document.querySelector('#victoryBanner'),statusZone=document.querySelector('#statusZone');banner.hidden=true;statusZone.classList.remove('is-perfect','is-routine-complete');
  renderWeekly();renderDailyHabits();renderSleep();
  const log=document.querySelector('#eventLog');if(log)log.innerHTML='';
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

function habitRowsHtml(habits,day){return habits.map(h=>{const entry=day.habits[h.id],done=entry?.completed;return `<button class="habit-row ${done?'done':''} ${h.id==='readStudy'?'study-row':''}" data-habit="${h.id}"><span class="habit-icon">${h.icon}</span><span class="habit-copy"><strong>${escapeHtml(h.name)}</strong></span><span class="habit-xp">${done?'↶':`+${h.xp}`}</span></button>`;}).join('');}
function renderDailyHabits(){
  const day=getDaily(),list=document.querySelector('#dailyHabitList'),habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep'),completed=habits.filter(h=>day.habits[h.id]?.completed).length;document.querySelector('#routineBadge').textContent=`${completed} / ${habits.length}`;document.querySelector('#todayDateLabel').textContent=prettyDate(localDateKey());
  if(completed===habits.length){list.innerHTML=`<div class="routine-complete-strip"><span>✨</span><div><strong>All ${habits.length} daily missions complete</strong><small>Your checklist is tucked away for the rest of today.</small></div></div><details class="completed-details"><summary>View completed missions</summary><div class="completed-list">${habitRowsHtml(habits,day)}</div></details>`;}
  else list.innerHTML=habitRowsHtml(habits,day);
  list.querySelectorAll('[data-habit]').forEach(b=>b.onclick=()=>toggleHabit(b.dataset.habit));
}
function renderSleep(){const day=getDaily(),s=day.sleep;if(document.activeElement!==document.querySelector('#sleepHours'))document.querySelector('#sleepHours').value=s?.mainHours??'';if(document.activeElement!==document.querySelector('#napHours'))document.querySelector('#napHours').value=s?.napHours??'';const preview=s?.scoreXp??sleepXP(document.querySelector('#sleepHours').value);document.querySelector('#sleepXpPreview').textContent=`${preview} / 50 XP`;}
function missionProgressDots(value,target){return Array.from({length:target},(_,i)=>`<span class="mission-dot ${i<value?'filled':''}"></span>`).join('');}
function renderWeekly(){
  const week=ensureCurrentWeek();document.querySelector('#weekLabel').textContent=`${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`;
  document.querySelector('#weeklyMissionList').innerHTML=`
    <div class="weekly-mission ${week.weights>0?'has-progress':''}"><div class="weekly-info"><span class="weekly-icon">🏋️</span><div><strong>Gym</strong><small>4 sessions • 100 XP each</small><div class="mission-dots">${missionProgressDots(week.weights,4)}</div></div></div><div class="weekly-action"><b>${week.weights}/4</b><div class="stepper"><button id="undoWeights" class="undo-control" ${week.weights<=0?'disabled':''}>−</button><button id="logWeights" ${week.weights>=4?'disabled':''}>+</button></div></div></div>
    <div class="weekly-mission ${week.cardio>0?'has-progress':''}"><div class="weekly-info"><span class="weekly-icon">🏃</span><div><strong>Incline Walk / StairMaster</strong><small>4 sessions • 40 XP each</small><div class="mission-dots">${missionProgressDots(week.cardio,4)}</div></div></div><div class="weekly-action"><b>${week.cardio}/4</b><div class="stepper"><button id="undoCardio" class="undo-control" ${week.cardio<=0?'disabled':''}>−</button><button id="logCardio1" ${week.cardio>=4?'disabled':''}>+</button></div></div></div>
    <div class="weekly-mission ${week.sportDueRemaining<=0?'complete':''}"><div class="weekly-info"><span class="weekly-icon">⚽</span><div><strong>Sport / Outdoor</strong><small>3 sessions • 50 XP each</small><div class="mission-dots">${missionProgressDots(3-week.sportDueRemaining,3)}</div></div></div><div class="weekly-action"><b>${3-week.sportDueRemaining}/3</b><div class="stepper"><button id="undoSport" class="undo-control" ${(3-week.sportDueRemaining)<=0?'disabled':''}>−</button><button id="logSport" ${week.sportDueRemaining<=0?'disabled':''}>+</button></div></div></div>
    <div class="weekly-mission sauna-mission ${week.sauna>=5?'complete':''}"><div class="weekly-info"><span class="weekly-icon">🧖</span><div><strong>Sauna</strong><small>5 sessions × 30 min • 35 XP</small><div class="mission-dots">${missionProgressDots(week.sauna,5)}</div></div></div><div class="weekly-action"><b>${week.sauna}/5</b><div class="stepper"><button id="undoSauna" class="undo-control" ${week.sauna<=0?'disabled':''}>−</button><button id="logSauna1" ${week.sauna>=5?'disabled':''}>+</button></div></div></div>`;
  document.querySelector('#logWeights').onclick=logWeights;document.querySelector('#undoWeights').onclick=undoWeights;
  document.querySelector('#logCardio1').onclick=()=>logCardio(1);document.querySelector('#undoCardio').onclick=undoCardio;
  document.querySelector('#logSport').onclick=logSport;document.querySelector('#undoSport').onclick=undoSport;
  document.querySelector('#logSauna1').onclick=()=>logSauna(1);document.querySelector('#undoSauna').onclick=undoSauna;
}

function renderAchievements(){const status=calculateDayStatus(),week=currentWeekStatus(),chips=[[status.discipline>=.8,'🔥','Discipline Day',`${Math.round(status.discipline*100)}% / 80%`],[status.perfectRoutine,'⭐','Daily Missions','All missions complete'],[status.perfectDay,'🌟','Perfect Day','Routine + 8–9h sleep'],[status.exceptionalDay,'👑','Exceptional','Perfect + 2 weekly credits'],[week.perfectWeek,'🏆','Perfect Week','Weekly targets + consistency'],[week.optimalSleepWeek,'🌙','Sleep Week','7-day avg 8–9h']];document.querySelector('#achievementStatus').innerHTML=chips.map(([ok,icon,name,detail])=>`<button class="achievement-badge ${ok?'earned':''}" type="button" title="${escapeHtml(detail)}"><span class="achievement-medallion">${icon}</span><strong>${name}</strong><small>${ok?'UNLOCKED':'LOCKED'}</small></button>`).join('');}

// ---------- Journey map ----------
function bookForLevel(level){return Math.min(7,Math.max(1,Math.ceil(level/24)));}
function renderJourney(){
  const root=document.querySelector('#journeyContent'); if(!root)return;
  const currentBook=Math.min(2,Math.max(1,bookForLevel(Math.max(1,save.currentLevel))));
  const years=['The Threat Emerges','The Chamber Opens','Fear & the Dementors','Voldemort Returns','The War Begins','The Horcrux Hunt','The Final Stand'];
  const encounters=currentBook===1?[["🧹","Flight Training","Learn control in the air"],["👹","Troll Attack","Turn classroom magic into action"],["🌲","Forbidden Forest","Face danger and gather intelligence"],["♟️","Trapdoor Trials","Combine skill, knowledge and allies"],["☠️","Quirrell","Year One boss confrontation"]]:[["📖","Strange Attacks","Investigate the pattern"],["⚔️","Dueling Club","Develop combat magic"],["🕷️","Forest Encounter","Follow the evidence"],["🚪","Open the Chamber","Use what you have learned"],["🐍","Face the Basilisk","Survive the monster"],["📕","Destroy the Diary","End the hidden threat"]];
  const doneCount=Math.min(encounters.length-1,Math.max(0,currentBook===1?Math.floor(save.currentLevel/5):Math.floor((save.currentLevel-24)/4)));
  root.innerHTML=`<section class="campaign53"><div class="campaign53-head"><span>THE ROAD TO THE FINAL BATTLE</span><h2>Campaign</h2><p>Seven years. One destiny. Every year arms Harry for what comes next.</p></div><div class="campaign53-mountain"><div class="campaign53-summit">♜</div><div class="campaign53-path"></div>${years.map((y,i)=>{const n=i+1,cls=n<currentBook?'done':n===currentBook?'current':'locked';return `<div class="campaign53-year ${cls} y${n}"><small>YEAR ${n}</small><b>${y}</b><em>${n<currentBook?'✓ COMPLETE':n===currentBook?'● ACTIVE':'🔒 LOCKED'}</em></div>`}).join('')}</div><section class="campaign53-current"><span>YEAR ${currentBook} CAMPAIGN</span><h3>${years[currentBook-1]}</h3><p>Only preparation, trials and confrontations that make Harry battle-ready appear here.</p><div class="campaign53-encounters">${encounters.map((e,i)=>`<div class="campaign53-enc ${i<doneCount?'done':i===doneCount?'current':'locked'}"><i>${i<doneCount?'✓':e[0]}</i><div><b>${e[1]}</b><small>${i<doneCount?'Preparation secured':i===doneCount?e[2]:'Locked'}</small></div></div>`).join('')}</div></section></section>`;
}

function showJourneyNode(level){const l=DATA.levels[level-1],status=level<save.currentLevel?'Completed':level===save.currentLevel?'Current level':'Locked',detail=document.querySelector('#journeyNodeDetail');detail.hidden=false;detail.innerHTML=`<div class="node-detail-head"><span class="map-node-chip">${level}</span><div><span class="eyebrow">${status.toUpperCase()}</span><h3>${escapeHtml(status==='Locked'?'Unknown chapter':l.storyBeat)}</h3></div></div><p>${status==='Locked'?'Continue your journey to reveal this chapter.':`Book ${l.book}: ${escapeHtml(l.bookName)} • Checkpoint ${l.checkpoint}`}</p>`;detail.scrollIntoView({behavior:'smooth',block:'nearest'});}


// ---------- Battle Readiness prototype: Books 1–2 ----------
const BATTLE_PROTO={
categories:[
{id:'magic',icon:'⚡',name:'Magic',desc:'Spells, magical techniques and magical power'},
{id:'combat',icon:'⚔',name:'Combat & Skills',desc:'Flying, duelling, survival and practical ability'},
{id:'knowledge',icon:'▣',name:'Knowledge',desc:'Intelligence Harry needs to understand and defeat the enemy'},
{id:'assets',icon:'🛡',name:'Allies & Arsenal',desc:'People, weapons and tools Harry can call upon'}
],
items:[
{level:2,book:1,cat:'magic',name:'Latent Magic',state:'Awakened',detail:'Harry’s magical power begins to emerge.'},
{level:5,book:1,cat:'knowledge',name:'Enemy Identified',state:'Voldemort Dossier I',detail:'Harry learns who murdered his parents and tried to kill him.'},
{level:7,book:1,cat:'assets',name:'Primary Wand',state:'Equipped',detail:'Harry gains his primary magical weapon.'},
{level:13,book:1,cat:'combat',name:'Flying',state:'Natural Aptitude',detail:'Exceptional instinct in the air becomes a real tactical skill.'},
{level:14,book:1,cat:'combat',name:'Seeker Training',state:'Developing',detail:'Speed, reactions and aerial tracking sharpen under pressure.'},
{level:16,book:1,cat:'magic',name:'Levitation Charm',state:'Combat Proven',detail:'Classroom magic becomes a real solution against a dangerous creature.',payoff:'Training → Troll victory'},
{level:16,book:1,cat:'assets',name:'The Trio',state:'Alliance Formed',detail:'Two trusted friends expand Harry’s effective abilities.'},
{level:17,book:1,cat:'combat',name:'Flying Under Attack',state:'Pressure Tested',detail:'Harry maintains control while his broom is being attacked.'},
{level:18,book:1,cat:'assets',name:'Invisibility Cloak',state:'Equipped',detail:'A powerful stealth tool enters Harry’s arsenal.'},
{level:20,book:1,cat:'knowledge',name:'Investigation',state:'Developing',detail:'Harry and his allies solve the mystery protecting the Stone.'},
{level:22,book:1,cat:'knowledge',name:'Enemy Still Active',state:'Threat Confirmed',detail:'Voldemort is not merely history.'},
{level:23,book:1,cat:'combat',name:'Aerial Precision',state:'Applied',detail:'Flying training pays off against the winged key.'},
{level:24,book:1,cat:'combat',name:'Dark Wizard Encounter',state:'Survived',detail:'Harry confronts the threat behind the Stone and survives.'},
{level:25,book:2,cat:'assets',name:'Mysterious House-Elf',state:'Potential Ally',detail:'A new figure risks punishment to warn Harry.'},
{level:28,book:2,cat:'assets',name:'Safe Haven',state:'Support Network',detail:'Harry gains a dependable magical family and refuge.'},
{level:33,book:2,cat:'knowledge',name:'Chamber Investigation',state:'Opened',detail:'Harry begins tracking the hidden threat inside the school.'},
{level:35,book:2,cat:'magic',name:'Disarming Charm',state:'Learned',detail:'Harry acquires a spell that will become central to his fighting identity.'},
{level:36,book:2,cat:'magic',name:'Serpent Speech',state:'Identified',detail:'A feared ability is recognised and can later become useful.'},
{level:37,book:2,cat:'combat',name:'Espionage',state:'Field Tested',detail:'Disguise and infiltration are used to gather intelligence.'},
{level:39,book:2,cat:'knowledge',name:'Riddle Dossier',state:'Opened',detail:'A mysterious diary provides direct access to the enemy’s past.'},
{level:43,book:2,cat:'combat',name:'Forest Escape',state:'Survived',detail:'Investigation continues under mortal threat.'},
{level:44,book:2,cat:'knowledge',name:'Monster Intelligence',state:'Solved',detail:'Research identifies the creature and how it attacks.'},
{level:45,book:2,cat:'magic',name:'Serpent Speech',state:'Operational',detail:'The ability becomes the key to entering the hidden chamber.'},
{level:46,book:2,cat:'knowledge',name:'Enemy Identity',state:'Revealed',detail:'Harry connects the charming schoolboy in the diary to his enemy.'},
{level:46,book:2,cat:'assets',name:'Phoenix Ally',state:'Emergency Support',detail:'A powerful ally intervenes in the chamber.'},
{level:46,book:2,cat:'assets',name:'Ancient Sword',state:'Earned',detail:'A legendary weapon answers Harry when he needs it.'},
{level:47,book:2,cat:'combat',name:'Serpent Battle',state:'Major Victory',detail:'Harry defeats an enormous magical predator in direct combat.'},
{level:47,book:2,cat:'assets',name:'Venomous Fang',state:'Proven',detail:'The fang destroys the diary. Its deeper importance remains unknown.'},
{level:48,book:2,cat:'assets',name:'House-Elf Ally',state:'True Ally',detail:'Harry turns an earlier warning into lasting loyalty.'}
]
};
const BOSS_BATTLES={
1:{title:'THE STONE',subtitle:'FINAL GAUNTLET • BOOK I',stages:[
{name:'Escape the Living Vines',xp:120,icon:'🌿',uses:'Magic',reward:'Path opened'},
{name:'Catch the Winged Key',xp:180,icon:'🪽',uses:'Flying',reward:'Aerial skill proven'},
{name:'Survive Wizard Chess',xp:180,icon:'♟',uses:'Allies',reward:'Teamwork proven'},
{name:'Pass the Final Trial',xp:140,icon:'🧪',uses:'Knowledge',reward:'Final chamber reached'},
{name:'Face the Dark Wizard',xp:300,icon:'⚔',uses:'Courage + magic',reward:'BOOK I COMPLETE'}]},
2:{title:'THE CHAMBER',subtitle:'FINAL BATTLE • BOOK II',stages:[
{name:'Open the Chamber',xp:150,icon:'🐍',uses:'Serpent Speech',reward:'Chamber access'},
{name:'Enter the Depths',xp:150,icon:'🕯',uses:'Courage',reward:'Rescue attempt begins'},
{name:'Call for Help',xp:200,icon:'🔥',uses:'Loyalty',reward:'Phoenix ally arrives'},
{name:'Blind the Serpent',xp:220,icon:'👁',uses:'Phoenix ally',reward:'Battle advantage'},
{name:'Slay the Serpent',xp:300,icon:'⚔',uses:'Ancient Sword',reward:'Serpent defeated'},
{name:'Survive the Venom',xp:200,icon:'🔥',uses:'Phoenix tears',reward:'Harry survives'},
{name:'Destroy the Diary',xp:300,icon:'📖',uses:'Venomous Fang',reward:'Diary destroyed'},
{name:'Rescue Ginny',xp:180,icon:'🛡',uses:'All preparation',reward:'BOOK II COMPLETE'}]}
};
const READINESS_THRESHOLDS={magic:[120,260,430,640,900],combat:[140,300,500,740,1020,1340,1700,2100],knowledge:[100,220,380,580,820,1100,1420],assets:[120,260,420,620,860,1140,1460,1820,2220]};
function readinessPoints(){const p={magic:0,combat:0,knowledge:0,assets:0};const magicIds=['proteinCreatine','supplements','morningWaters','ccfTea','almonds','healthyLunch','water','healthyDinner','deepBreathing'];for(const d of Object.values(save.daily||{})){for(const [id,e] of Object.entries(d.habits||{}))if(e?.completed){if(id==='readStudy')p.knowledge+=20;else if(id==='stretch')p.combat+=15;else if(id==='relaxFun')p.assets+=10;else if(magicIds.includes(id))p.magic+=Math.max(8,Math.round((e.xpAwarded||10)*.55));}if(d.sleep?.mainHours){p.magic+=Math.round((d.sleep.scoreXp||0)*.35);p.assets+=Math.round((d.sleep.scoreXp||0)*.45);}}for(const w of Object.values(save.weekly||{})){p.combat+=(w.weights||0)*45+(w.cardio||0)*22+(w.sportActual||0)*30;p.assets+=(w.sauna||0)*25+(w.sportActual||0)*10;}return p;}
function readinessRank(id){const pts=readinessPoints()[id]||0;return READINESS_THRESHOLDS[id].filter(x=>pts>=x).length;}
function readinessProgress(id){const pts=readinessPoints()[id]||0,ths=READINESS_THRESHOLDS[id],rank=readinessRank(id),prev=rank?ths[rank-1]:0,next=ths[rank]||ths[ths.length-1];return {pts,rank,total:ths.length,need:rank>=ths.length?0:next-pts,pct:rank>=ths.length?100:Math.max(0,Math.min(100,Math.round((pts-prev)/(next-prev)*100)))};}
function battleUnlocked(i){return i.level<=Math.max(1,save.currentLevel);}
function battleVisible(i){return !i.secret;}
function battleCategoryState(cat){const items=BATTLE_PROTO.items.filter(i=>i.cat===cat.id);return {items,unlocked:items.slice(0,readinessRank(cat.id))};}
function readinessPct(){return Math.round(BATTLE_PROTO.categories.reduce((n,c)=>n+readinessRank(c.id)/READINESS_THRESHOLDS[c.id].length,0)/BATTLE_PROTO.categories.length*100);}
function readinessSourceLabel(id){return {magic:'Nutrition • routine • recovery',combat:'Gym • cardio • sport • stretching',knowledge:'Read / Study • learning • planning',assets:'Recovery • resilience • consistency'}[id]||'';}
function renderCollection(){
 const hub=document.querySelector('#collectionHub');if(!hub)return;const selected=ui.collectionCategory;
 if(selected){const cat=BATTLE_PROTO.categories.find(c=>c.id===selected),state=battleCategoryState(cat);hub.innerHTML=`<button id="collectionBack" class="back-button">← Battle Readiness</button><section class="readiness-detail-hero"><span>${cat.icon}</span><div><small>${state.unlocked.length} / ${state.items.length} DEVELOPED</small><h2>${cat.name}</h2><p>${cat.desc}</p></div></section><div class="readiness-list">${state.items.map(i=>`<article class="readiness-item ${battleUnlocked(i)?'unlocked':'locked'}"><div><b>${battleUnlocked(i)?i.name:'Unknown preparation'}</b><em>${battleUnlocked(i)?i.state:'LOCKED'}</em></div><p>${battleUnlocked(i)?i.detail:'Continue training to reveal this preparation.'}</p>${battleUnlocked(i)&&i.payoff?`<small>PAYOFF • ${i.payoff}</small>`:''}</article>`).join('')}</div>`;hub.querySelector('#collectionBack').onclick=()=>{ui.collectionCategory=null;renderCollection()};return;}
 const pct=readinessPct(), tier=pct<20?'UNPREPARED':pct<40?'APPRENTICE':pct<65?'BATTLE-TESTED':pct<85?'AUROR READY':'VOLDemort READY';
 hub.innerHTML=`<section class="readiness-hero-new"><div class="readiness-ring" style="--pct:${pct}"><div><strong>${pct}%</strong><span>${tier}</span></div></div><h2>Battle Readiness</h2><p>Build the magic, skill, intelligence and support Harry will need for the battles ahead.</p></section><section class="readiness-four">${BATTLE_PROTO.categories.map(cat=>{const r=readinessProgress(cat.id);return `<button data-category="${cat.id}" class="pillar-card"><span class="pillar-icon">${cat.icon}</span><div><b>${cat.name}</b><small>Rank ${r.rank} • ${r.pts} readiness XP</small><small class="pillar-source">${readinessSourceLabel(cat.id)}</small><i><u style="width:${r.pct}%"></u></i><small>${r.need?r.need+' XP to next capability':'MASTERED'}</small></div><em>›</em></button>`}).join('')}</section><section class="classified-tease"><span>☠</span><div><b>CLASSIFIED INTELLIGENCE</b><small>A deeper secret about the enemy remains hidden.</small></div><i>LOCKED</i></section>`;
 hub.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{ui.collectionCategory=b.dataset.category;renderCollection()});
}
function battleBook(){return Math.min(2,Math.max(1,Math.ceil(Math.max(1,save.currentLevel)/24)));}
function battleState(book){const stages=BOSS_BATTLES[book].stages;const startLevel=book===1?20:44;const startXP=cumulativeXpForLevel(startLevel);const earned=Math.max(0,save.totalXP-startXP);let rem=earned,done=0,into=0;for(const st of stages){if(rem>=st.xp){rem-=st.xp;done++}else{into=rem;break}}return {stages,done,into,earned};}
function currentBattleForecast(){
 const book=battleBook(),boss=BOSS_BATTLES[book],st=battleState(book),current=st.stages[Math.min(st.done,st.stages.length-1)];
 const target=current?.xp||1, xp=Math.min(st.into,target), xpPct=Math.round(xp/target*100);
 const cats=BATTLE_PROTO.categories.map(c=>{const x=battleCategoryState(c);return {id:c.id,name:c.name,icon:c.icon,have:x.unlocked.length,total:x.items.length};});
 const overall=Math.round((xpPct+readinessPct())/2);
 return {book,boss,current,target,xp,xpPct,cats,overall};
}
function battleForecastHtml(){const f=currentBattleForecast();const weak=f.cats.filter(c=>c.have<c.total).sort((a,b)=>(a.have/a.total)-(b.have/b.total))[0];return `<section class="next-battle-card"><div class="battle-top"><div><span class="eyebrow">NEXT BATTLE</span><h3>${f.current?.name||f.boss.title}</h3><small>${f.boss.title}</small></div><div class="battle-readiness-score">${f.overall}%</div></div><div class="battle-xp-track"><i style="width:${f.xpPct}%"></i></div><small>${f.xp.toLocaleString()} / ${f.target.toLocaleString()} XP • ${Math.max(0,f.target-f.xp).toLocaleString()} XP to battle-ready</small><div class="battle-req-grid">${f.cats.map(c=>`<div class="battle-req ${c.have<c.total?'need':''}">${c.icon} ${c.name}<br><b>${c.have}/${c.total}</b>${c.have<c.total?' • needs '+(c.total-c.have):' ✓'}</div>`).join('')}</div><div class="battle-training-tip"><b>Best training right now:</b> ${weak?.id==='combat'?'Gym, cardio, sport or stretching':weak?.id==='knowledge'?'Read / Study, research or workout planning':weak?.id==='magic'?'Nutrition and routine missions':'Recovery, resilience and consistency'}</div></section>`;}
function renderBattle(){const hub=document.querySelector('#battleHub');if(!hub)return;const book=battleBook();const adventures={1:{title:'Escape the Living Vines',chapter:'THE STONE',intro:'The stone door slams shut behind you. In the darkness, something cold coils around Harry’s ankle. Thick vines climb his legs and tighten every time he struggles. Hermione shouts that the plant reacts to panic. You have seconds to decide.',choices:[["🔥","Create light and heat","magic",1,"Use controlled magic to force the plant to recoil."],["📖","Remember the Herbology lesson","knowledge",1,"Recall what the plant fears before it closes around you."],["⚔️","Fight for space","combat",1,"Use strength and movement to buy Hermione time."],["🤝","Trust Hermione","assets",1,"Stop struggling and follow her instructions."]]},2:{title:'The Chamber Is Opened',chapter:'THE CHAMBER',intro:'Cold air rises from the hidden passage. The entrance responds to a language Harry barely understands. Somewhere below, Ginny is running out of time—and something enormous is moving in the dark.',choices:[["🐍","Speak to the mechanism","knowledge",2,"Use what Harry has learned about the strange language."],["⚔️","Descend ready to fight","combat",2,"Enter prepared for a close-quarters confrontation."],["⚡","Trust instinct and magic","magic",2,"Rely on developed magical control under pressure."],["🛡️","Carry what your allies gave you","assets",2,"Enter with the support and tools earned through the year."]]}};const a=adventures[book],ranks=Object.fromEntries(BATTLE_PROTO.categories.map(c=>[c.id,readinessRank(c.id)]));const xpTarget=book===1?120:2500,xp=Math.min(xpTarget,Math.max(0,book===1?save.totalXP:save.totalXP-cumulativeXpForLevel(24))),xpPct=Math.round(xp/xpTarget*100);const avg=Math.round(BATTLE_PROTO.categories.reduce((n,c)=>n+readinessRank(c.id)/Math.max(1,(book===1?1:2)),0)/4*100);hub.innerHTML=`<section class="adventure53"><header><span>NEXT ENCOUNTER • ${a.chapter}</span><h2>${a.title}</h2><div class="adventure-score">${Math.min(100,avg)}%</div></header><div class="adventure-scene"><p>${a.intro}</p><strong>What does Harry do?</strong></div><div class="adventure-choices">${a.choices.map((c,i)=>{const ok=ranks[c[2]]>=c[3];return `<button class="adventure-choice ${ok?'available':'locked'}" data-choice="${i}" ${ok?'':'disabled'}><i>${c[0]}</i><div><b>${c[1]}</b><small>${c[4]}</small><em>${ok?'✓ AVAILABLE':`🔒 ${c[2]==='assets'?'ALLIES & ARSENAL':c[2].toUpperCase()} RANK ${c[3]} • CURRENT ${ranks[c[2]]}`}</em></div></button>`}).join('')}</div><section class="adventure-training"><b>TRAINING STATUS</b><div class="adventure-xp"><i style="width:${xpPct}%"></i></div><small>${xp} / ${xpTarget} encounter XP</small><p>Your real-world missions determine which choices become available. Train the missing capability, then return to the encounter.</p></section></section>`;hub.querySelectorAll('.adventure-choice.available').forEach(b=>b.onclick=()=>{const c=a.choices[Number(b.dataset.choice)];hub.innerHTML=`<section class="adventure53 result"><span>CHOICE MADE</span><h2>${c[0]} ${c[1]}</h2><p>${c[4]}</p><div class="story-result">Harry commits to the decision. The danger does not simply disappear—the choice changes what happens next. <strong>Your ${c[2]==='assets'?'Allies & Arsenal':c[2]} training opened this route.</strong></div><button class="primary wide" id="battleContinue">Continue the encounter</button></section>`;document.querySelector('#battleContinue').onclick=()=>{toast('Next story branch unlocks as the campaign advances.');renderBattle();};});}

function renderStats(){
  const week=ensureCurrentWeek(), habits=habitWeekStats(), nutrition=habits.filter(nutritionHabit), foundations=habits.filter(h=>!nutritionHabit(h)),sportDone=3-week.sportDueRemaining,series=sleepWeekSeries();
  const mainVals=series.map(x=>x.main).filter(v=>v!==null),napVals=series.map(x=>x.nap).filter(v=>v!==null),mainAvg=mainVals.length?avg(mainVals):0,napAvg=napVals.length?avg(napVals):0;
  document.querySelector('#statsDashboard').innerHTML=`
    <section class="stats-intro"><span class="eyebrow">YOUR ACTIVITY</span><h2>This week</h2></section>
    <section class="dashboard-card activity-dashboard"><div class="section-head"><div><span class="eyebrow">WEEKLY ACTIVITIES</span><h3>Your movement</h3></div><span class="mini-badge">${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}</span></div><div class="activity-ring-grid">${ringHtml('🏋️','Gym',week.weights,4)}${ringHtml('🏃','Incline / Stairs',week.cardio,4)}${ringHtml('⚽','Sport / Outdoor',sportDone,3)}${ringHtml('🧖','Sauna',week.sauna,5)}</div></section>
    ${nutrition.length?`<section class="dashboard-card"><div class="section-head"><div><span class="eyebrow">NUTRITION & FUEL</span><h3>Eating & essentials</h3></div><span class="mini-badge">week to date</span></div><div class="habit-stats-grid">${nutrition.map(habitStatHtml).join('')}</div></section>`:''}
    ${foundations.length?`<section class="dashboard-card"><div class="section-head"><div><span class="eyebrow">DAILY FOUNDATIONS</span><h3>Your habits</h3></div><span class="mini-badge">week to date</span></div><div class="habit-stats-grid">${foundations.map(habitStatHtml).join('')}</div></section>`:''}
    <section class="dashboard-card sleep-split-card"><div class="section-head"><div><span class="eyebrow">RECOVERY</span><h3>Sleep</h3></div></div><div class="sleep-split-grid"><div class="sleep-chart-panel"><div class="sleep-chart-title"><span>🌙 Night sleep</span><strong>${mainVals.length?mainAvg.toFixed(1)+'h':'—'}</strong></div>${sleepBarsHtml('main')}<small>7-day average</small></div><div class="sleep-chart-panel"><div class="sleep-chart-title"><span>💤 Naps</span><strong>${napVals.length?napAvg.toFixed(1)+'h':'—'}</strong></div>${sleepBarsHtml('nap')}<small>7-day average</small></div></div></section>`;
}

// ---------- Settings ----------
function renderSettings(){const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;document.querySelector('#installState').textContent=standalone?'Installed and running from your Home Screen in standalone mode.':'Browser mode: use Safari → Share → Add to Home Screen.';document.querySelector('#soundToggle').textContent=save.soundEnabled?'On':'Off';document.querySelector('#soundToggle').classList.toggle('off',!save.soundEnabled);document.querySelector('#devTools').hidden=!DEV_MODE;}
function render(){renderHome();renderCollection();renderBattle();renderStats();}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));}

function setupUI(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));if(b.dataset.view==='journey'){try{renderJourney();}catch(e){console.error(e);}}if(b.dataset.view==='collection')renderCollection();if(b.dataset.view==='battle')renderBattle();if(b.dataset.view==='stats')renderStats();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelector('#saveSleep').onclick=saveSleep;document.querySelector('#sleepHours').oninput=renderSleep;
  document.querySelector('#revealNext').onclick=()=>closeReveal(false);document.querySelector('#revealSkip').onclick=()=>closeReveal(true);
  const soundToggle=document.querySelector('#soundToggle');if(soundToggle)soundToggle.onclick=()=>{save.soundEnabled=!save.soundEnabled;persist();if(save.soundEnabled)playChime('success');};
  document.querySelector('#exportSave').onclick=()=>{const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hp-fitness-rpg-save-${localDateKey()}.json`;a.click();URL.revokeObjectURL(a.href);};
  document.querySelector('#importSave').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{save=mergeState(JSON.parse(await f.text()));persist();ensureCurrentWeek();finalizePastDays();render();toast('Save imported.');}catch{toast('That save file could not be read.','warn');}};
  if(DEV_MODE){document.querySelectorAll('[data-xp]').forEach(b=>b.onclick=()=>addXP(Number(b.dataset.xp),'Development tester'));document.querySelector('#resetSave').onclick=()=>{if(confirm('Reset TEST progress on this device?')){localStorage.removeItem(stateKey);save=defaultState();ensureCurrentWeek();persist();render();}};}
}
function updateNetwork(){const b=document.querySelector('#networkBadge');b.textContent=navigator.onLine?'Online':'Offline ready';b.style.color=navigator.onLine?'#86efac':'#c4b5fd';}
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);

try{
  await loadData();ensureCurrentWeek();finalizePastDays();updateHighestSleepStage();ui.journeyBook=bookForLevel(Math.max(1,save.currentLevel));setupUI();render();updateNetwork();persist();queueMigratedReveals();
}catch(err){console.error(err);const b=document.querySelector('#networkBadge');b.textContent='Load error';b.style.color='#fb7185';alert('The app could not finish loading. Please refresh once while online.');}

if('serviceWorker' in navigator){window.addEventListener('load',async()=>{try{const reg=await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});await reg.update();}catch(err){console.warn('Service worker update failed',err);}});}
