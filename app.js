const DATA = {};
const stateKey = 'hpFitnessRpgSave_v3';
const legacyStateKeys = ['hpFitnessRpgSave_v2','hpFitnessRpgSave_v1'];
const APP_VERSION = '5.4.0';
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
  const xpNeed=next?.xpRequired||0,inside=xpIntoCurrent(),pct=save.currentLevel>=168?100:Math.max(0,Math.min(100,(inside/xpNeed)*100));document.querySelector('#xpBar').style.width=`${pct}%`;document.querySelector('#xpText').textContent=save.currentLevel>=168?'Saga complete':`${inside.toLocaleString()} / ${xpNeed.toLocaleString()} XP`;try{const b=adventureBook(),s=adventureState(b),sc=ADVENTURE54[b][s.scene],sx=sceneXp(sc);document.querySelector('#checkpointText').textContent=s.completed?`Year ${b} campaign complete`:`Next: ${sc.title} • ${Math.max(0,sx.target-sx.earned)} XP`; }catch{document.querySelector('#checkpointText').textContent='Next battle';}
  const today=calculateDayStatus(),liveStreak=save.streak.current+(today.discipline>=.8&&!getDaily().finalized?1:0);document.querySelector('#ownedCount').textContent=`${readinessPct()}%`;document.querySelector('#sagaPct').textContent='battle ready';document.querySelector('#todayScore').textContent=`${today.earned} XP`;document.querySelector('#todayXp').textContent=`${today.earned} / ${today.max} daily XP`;document.querySelector('#streakText').textContent=`${liveStreak} 🔥`;document.querySelector('#bestStreakText').textContent=`Best ${Math.max(save.streak.best,liveStreak)}`;
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
  const book=Math.min(7,Math.max(1,bookForLevel(Math.max(1,save.currentLevel))));
  const years=[
    ['The Threat Emerges','Learn the foundations. Survive the first confrontation.'],
    ['The Chamber Opens','Investigate the attacks. Enter the Chamber.'],
    ['Fear & the Dementors','Train against fear and master defensive magic.'],
    ['Voldemort Returns','Survive the tournament and the enemy’s return.'],
    ['The War Begins','Build resistance, leadership and real combat experience.'],
    ['The Horcrux Hunt','Turn knowledge of the enemy into a plan to make him mortal.'],
    ['The Final Stand','Bring every skill, ally and weapon to the last battle.']
  ];
  const encounterSets={
    1:[
      ['🧹','Flight Training','TRAINING','Flying becomes a usable skill rather than a talent.'],
      ['👹','Troll Attack','TRIAL','Classroom learning is tested in real danger.'],
      ['🌲','Forbidden Forest','TRIAL','Harry confirms the threat is still alive.'],
      ['♟','Trapdoor Gauntlet','BATTLE','Skills, allies and knowledge all have to work together.'],
      ['⚡','Quirrell','YEAR BOSS','The first direct confrontation with the enemy behind the Stone.']
    ],
    2:[
      ['📖','Strange Attacks','INVESTIGATION','Find the pattern behind the attacks.'],
      ['⚔','Dueling Club','TRAINING','Combat magic and serpent speech enter the picture.'],
      ['🕷','Forest Encounter','TRIAL','Follow the evidence into mortal danger.'],
      ['🚪','Enter the Chamber','BATTLE','Use knowledge that once seemed frightening.'],
      ['🐍','Basilisk','YEAR BOSS','Survive and defeat the creature guarding the Chamber.'],
      ['📕','Destroy the Diary','FINAL OBJECTIVE','End the threat without yet understanding its deeper secret.']
    ]
  };
  const starts=[0,0,12000,25200,39600,55200,72000,90000];
  const ends=[0,12000,25200,39600,55200,72000,90000,109200];
  const startXP=starts[book],endXP=ends[book],yearPct=Math.max(0,Math.min(100,Math.round((save.totalXP-startXP)/(endXP-startXP)*100)));
  const encounters=encounterSets[Math.min(book,2)]||[];
  const unlockedByXP=book===1?[900,2500,5200,8200,10800]:[13200+900,13200+3000,13200+5700,13200+8200,13200+10800,13200+12600];
  const currentEncounter=Math.max(0,unlockedByXP.findIndex(x=>save.totalXP<x));
  const idx=currentEncounter<0?encounters.length-1:currentEncounter;

  root.innerHTML=`
    <section class="campaign54">
      <div class="campaign54-hero">
        <div class="campaign54-art" aria-hidden="true"></div>
        <div class="campaign54-shade"></div>
        <div class="campaign54-copy">
          <span>THE ROAD TO DEFEAT VOLDEMORT</span>
          <h2>Seven years.<br>One final battle.</h2>
          <div class="campaign54-progress"><i style="width:${Math.round(save.totalXP/109200*100)}%"></i></div>
          <small>${save.totalXP.toLocaleString()} / 109,200 total training XP</small>
        </div>
      </div>

      <section class="campaign54-years">
        ${years.map((y,i)=>{
          const n=i+1, state=n<book?'complete':n===book?'active':'locked';
          return `<article class="campaign54-year ${state}">
            <span class="year-medal">${n<book?'✓':n}</span>
            <div><small>YEAR ${n}</small><b>${y[0]}</b><p>${n===book?y[1]:(n<book?'Campaign completed':'Locked until the previous campaign is complete.')}</p></div>
            <em>${n<book?'COMPLETE':n===book?'ACTIVE':'🔒'}</em>
          </article>`;
        }).join('')}
      </section>

      ${book<=2?`<section class="campaign54-current">
        <div class="campaign54-current-head">
          <div><span>YEAR ${book} CAMPAIGN</span><h3>${years[book-1][0]}</h3></div>
          <strong>${yearPct}%</strong>
        </div>
        <div class="campaign54-yearbar"><i style="width:${yearPct}%"></i></div>
        <div class="campaign54-encounters">
          ${encounters.map((e,i)=>`<article class="campaign54-enc ${i<idx?'done':i===idx?'current':'locked'}">
            <span>${i<idx?'✓':e[0]}</span>
            <div><small>${e[2]}</small><b>${e[1]}</b><p>${i<=idx?e[3]:'Complete the previous objective to reveal this trial.'}</p></div>
            <em>${i<idx?'COMPLETE':i===idx?'NEXT':'🔒'}</em>
          </article>`).join('')}
        </div>
        <button class="primary wide campaign54-battle-btn" id="openCurrentBattle">Enter current encounter →</button>
      </section>`:`<section class="campaign54-sealed"><b>PROTOTYPE SEALED AFTER YEAR 2</b><p>Years 3–7 remain mapped on the mountain but their battle campaigns will be built after the Books 1–2 gameplay loop is approved.</p></section>`}
    </section>`;
  const btn=root.querySelector('#openCurrentBattle');
  if(btn)btn.onclick=()=>{
    const battleBtn=document.querySelector('.bottom-nav [data-view="battle"]');
    if(battleBtn)battleBtn.click();
  };
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
const READINESS_THRESHOLDS={
  magic:[60,150,280,440,640,880,1160,1480],
  combat:[70,180,330,520,750,1020,1330,1680],
  knowledge:[50,130,240,390,580,810,1080,1390],
  assets:[55,145,265,420,610,840,1110,1420]
};
const READINESS_CAPABILITIES={
  magic:[
    ['Magical Control','Power is becoming deliberate rather than accidental.'],
    ['Spell Precision','Harry can apply learned magic more reliably under pressure.'],
    ['Defensive Casting','Protective magic becomes a dependable response to danger.'],
    ['Rapid Casting','Harry can act before a threat fully develops.'],
    ['Counter-Magic','Harry begins answering hostile magic instead of only surviving it.'],
    ['Advanced Control','Difficult magic can be held together under stress.'],
    ['Battle Casting','Harry can maintain effective magic through sustained danger.'],
    ['Mastery','Magic is no longer the weak link in Harry’s preparation.']
  ],
  combat:[
    ['Movement Control','Balance, reactions and body control improve.'],
    ['Aerial Reflexes','Flying and high-speed reactions become tactically useful.'],
    ['Pressure Composure','Harry keeps functioning when a situation turns dangerous.'],
    ['Dueling Footwork','Movement and timing support effective spell combat.'],
    ['Threat Response','Harry reacts decisively to sudden attacks.'],
    ['Sustained Combat','Stamina supports longer and more dangerous encounters.'],
    ['Elite Reflexes','Harry can read and answer fast-changing threats.'],
    ['Combat Mastery','Physical and tactical preparation are battle-ready.']
  ],
  knowledge:[
    ['Observation','Harry notices clues that would otherwise be missed.'],
    ['Recall Under Pressure','Lessons can be retrieved when they are actually needed.'],
    ['Threat Analysis','Harry can connect evidence and identify what he is facing.'],
    ['Strategic Thinking','Information begins shaping decisions before a fight starts.'],
    ['Advanced Research','Difficult magical problems can be investigated methodically.'],
    ['Enemy Intelligence','Patterns in the enemy’s behaviour become usable knowledge.'],
    ['Battle Planning','Knowledge directly shapes how Harry approaches major fights.'],
    ['Strategic Mastery','Harry can turn information into a decisive advantage.']
  ],
  assets:[
    ['Resourcefulness','Harry makes better use of the help and tools around him.'],
    ['Trusted Support','Allies become a dependable part of his survival strategy.'],
    ['Prepared Loadout','Useful equipment and support are brought into danger deliberately.'],
    ['Alliance Strength','Harry can rely on a wider network instead of acting alone.'],
    ['Specialist Support','Different allies cover weaknesses Harry cannot solve himself.'],
    ['Battle Resources','Tools, weapons and support are ready for major confrontations.'],
    ['War Network','Harry can call on a powerful and resilient support system.'],
    ['Alliance Mastery','Harry enters battle with the full strength of his network.']
  ]
};
const READINESS_HABIT_MAP={
  proteinCreatine:{cat:'magic',pts:14}, supplements:{cat:'magic',pts:14},
  morningWaters:{cat:'magic',pts:8}, ccfTea:{cat:'magic',pts:8},
  almonds:{cat:'magic',pts:7}, healthyLunch:{cat:'magic',pts:10},
  water:{cat:'magic',pts:10}, healthyDinner:{cat:'magic',pts:10},
  deepBreathing:{cat:'magic',pts:8},
  readStudy:{cat:'knowledge',pts:25},
  stretch:{cat:'combat',pts:15},
  relaxFun:{cat:'assets',pts:12}
};
function readinessPoints(){
  const p={magic:0,combat:0,knowledge:0,assets:0};
  for(const d of Object.values(save.daily||{})){
    for(const [id,e] of Object.entries(d.habits||{})){
      if(!e?.completed) continue;
      const map=READINESS_HABIT_MAP[id];
      if(map) p[map.cat]+=map.pts;
    }
    if(d.sleep?.mainHours){
      const sx=d.sleep.scoreXp||0;
      p.magic+=Math.round(sx*.28);
      p.assets+=Math.round(sx*.32);
    }
    const completed=Object.values(d.habits||{}).filter(e=>e?.completed).length;
    if(completed>=10) p.assets+=8; // consistency / dependable preparation
  }
  for(const w of Object.values(save.weekly||{})){
    p.combat+=(w.weights||0)*42+(w.cardio||0)*22+(w.sportActual||0)*30;
    p.assets+=(w.sauna||0)*22+(w.sportActual||0)*8;
  }
  return p;
}
function readinessRank(id){
  const pts=readinessPoints()[id]||0;
  return (READINESS_THRESHOLDS[id]||[]).filter(x=>pts>=x).length;
}
function readinessProgress(id){
  const pts=readinessPoints()[id]||0, ths=READINESS_THRESHOLDS[id]||[], rank=readinessRank(id);
  const prev=rank?ths[rank-1]:0, next=ths[rank]||ths[ths.length-1]||1;
  return {
    pts,rank,total:ths.length,
    need:rank>=ths.length?0:Math.max(0,next-pts),
    pct:rank>=ths.length?100:Math.max(0,Math.min(100,Math.round((pts-prev)/(next-prev)*100))),
    nextThreshold:rank>=ths.length?ths[ths.length-1]:next
  };
}
function battleUnlocked(){return false;}
function battleVisible(){return true;}
function battleCategoryState(cat){
  const rank=readinessRank(cat.id);
  const caps=READINESS_CAPABILITIES[cat.id]||[];
  return {items:caps.map((c,i)=>({name:c[0],detail:c[1],rank:i+1})),unlocked:caps.slice(0,rank)};
}
function readinessPct(){
  const ids=['magic','combat','knowledge','assets'];
  return Math.round(ids.reduce((n,id)=>{
    const r=readinessProgress(id);
    return n + Math.min(1,r.pts/(READINESS_THRESHOLDS[id][READINESS_THRESHOLDS[id].length-1]||1));
  },0)/ids.length*100);
}
function readinessSourceLabel(id){
  return {
    magic:'Nutrition • routine • hydration • sleep',
    combat:'Gym • cardio • sport • stretching',
    knowledge:'Read / Study • research • learning • planning',
    assets:'Recovery • sauna • consistency • support'
  }[id]||'';
}

function renderCollection(){
  const hub=document.querySelector('#collectionHub'); if(!hub)return;
  const selected=ui.collectionCategory;
  if(selected){
    const cat=BATTLE_PROTO.categories.find(c=>c.id===selected);
    const r=readinessProgress(cat.id), caps=READINESS_CAPABILITIES[cat.id]||[];
    hub.innerHTML=`
      <button id="collectionBack" class="back-button">← Battle Readiness</button>
      <section class="readiness54-detail">
        <div class="readiness54-detail-icon">${cat.icon}</div>
        <div><span>${readinessSourceLabel(cat.id)}</span><h2>${cat.name}</h2>
        <p>${cat.desc}</p></div>
      </section>
      <section class="readiness54-xpbox">
        <div><b>Rank ${r.rank}</b><strong>${r.pts.toLocaleString()} Readiness XP</strong></div>
        <div class="readiness54-xpbar"><i style="width:${r.pct}%"></i></div>
        <small>${r.need?r.need.toLocaleString()+' XP until next capability':'MASTERED'}</small>
      </section>
      <section class="capability-road">
        ${caps.map((c,i)=>{
          const unlocked=i<r.rank, current=i===r.rank;
          return `<article class="${unlocked?'unlocked':current?'current':'locked'}">
            <span>${unlocked?'✓':i+1}</span><div><small>RANK ${i+1}</small><b>${c[0]}</b><p>${unlocked||current?c[1]:'Continue training to reveal this capability.'}</p></div>
          </article>`;
        }).join('')}
      </section>`;
    hub.querySelector('#collectionBack').onclick=()=>{ui.collectionCategory=null;renderCollection();};
    return;
  }
  const pct=readinessPct(),tier=pct<15?'UNPREPARED':pct<35?'APPRENTICE':pct<60?'DEVELOPING':pct<80?'BATTLE-READY':'ELITE';
  const totalToday=(()=>{const d=getDaily(),m={magic:0,combat:0,knowledge:0,assets:0};for(const [id,e] of Object.entries(d.habits||{})){if(!e?.completed)continue;const x=READINESS_HABIT_MAP[id];if(x)m[x.cat]+=x.pts;}if(d.sleep?.mainHours){m.magic+=Math.round((d.sleep.scoreXp||0)*.28);m.assets+=Math.round((d.sleep.scoreXp||0)*.32);}return m;})();
  hub.innerHTML=`
    <section class="readiness54-hero">
      <div class="readiness54-ring" style="--pct:${pct}"><div><strong>${pct}%</strong><span>${tier}</span></div></div>
      <div><span>FINAL BATTLE PREPARATION</span><h2>Battle Readiness</h2><p>Your habits train Harry. Readiness XP becomes permanent capabilities that open new choices in battle.</p></div>
    </section>
    <section class="readiness54-today">
      <span>TODAY'S TRAINING</span>
      <div>${BATTLE_PROTO.categories.map(c=>`<small>${c.icon} +${totalToday[c.id]||0} ${c.name}</small>`).join('')}</div>
    </section>
    <section class="readiness54-grid">
      ${BATTLE_PROTO.categories.map(cat=>{
        const r=readinessProgress(cat.id), next=READINESS_CAPABILITIES[cat.id]?.[r.rank]?.[0]||'Mastered';
        return `<button data-category="${cat.id}" class="readiness54-card">
          <span class="readiness54-icon">${cat.icon}</span>
          <div><b>${cat.name}</b><small>Rank ${r.rank} • ${r.pts.toLocaleString()} readiness XP</small>
          <p>${readinessSourceLabel(cat.id)}</p>
          <i><u style="width:${r.pct}%"></u></i>
          <em>${r.need?`${r.need.toLocaleString()} XP → ${next}`:'MASTERED'}</em></div>
          <strong>›</strong>
        </button>`;
      }).join('')}
    </section>
    <section class="classified54"><span>☠</span><div><b>CLASSIFIED INTELLIGENCE</b><small>A deeper secret about the enemy remains hidden.</small></div><i>LOCKED</i></section>`;
  hub.querySelectorAll('[data-category]').forEach(btn=>btn.onclick=()=>{ui.collectionCategory=btn.dataset.category;renderCollection();window.scrollTo({top:0,behavior:'smooth'});});
}

const ADVENTURE54={
  1:[
    {
      id:'vines',eyebrow:'TRAPDOOR GAUNTLET • TRIAL I',title:'The Living Vines',xpStart:0,xpTarget:900,
      art:'🌿',
      story:`The stone door slams shut overhead. For one breath there is only darkness. Then the floor moves.<br><br>Cold vines whip around Harry’s ankle and climb his legs. Ron is already waist-deep. Hermione shouts that struggling makes the plant tighten. The leaves are closing around Harry’s chest.<br><br><strong>There is no time for a perfect answer. What does Harry do?</strong>`,
      choices:[
        {icon:'📖',label:'Recall the Herbology lesson',cat:'knowledge',rank:1,desc:'Search your memory for what this plant fears.',outcome:'Hermione’s warning clicks into place. Panic feeds the trap. Harry forces himself still and remembers the plant needs darkness and damp.',advance:true},
        {icon:'⚡',label:'Use controlled magic',cat:'magic',rank:1,desc:'Create enough light and heat to make the vines recoil.',outcome:'Harry steadies his wand instead of thrashing. The vines recoil from the sudden heat and a gap opens.',advance:true},
        {icon:'🛡',label:'Trust Hermione completely',cat:'assets',rank:1,desc:'Stop fighting and follow the ally who understands the danger.',outcome:'Harry stops resisting. The vines loosen just enough for Hermione to guide him through the opening.',advance:true},
        {icon:'⚔',label:'Rip yourself free',cat:'combat',rank:0,desc:'Rely on strength and movement instead of understanding the trap.',outcome:'The vines react instantly. Every pull makes them tighter. Brute force is the wrong answer here.',advance:false}
      ]
    },
    {
      id:'keys',eyebrow:'TRAPDOOR GAUNTLET • TRIAL II',title:'The Winged Keys',xpStart:900,xpTarget:3000,
      art:'🗝️',
      story:`The vines fall away and the next chamber opens into a storm of silver wings. Hundreds of keys circle beneath the ceiling. One battered key will open the only door forward.<br><br>Brooms lie on the floor. Months of flying practice suddenly have a purpose beyond sport.<br><br><strong>How does Harry approach the room?</strong>`,
      choices:[
        {icon:'🧹',label:'Take the broom and hunt the damaged key',cat:'combat',rank:2,desc:'Use trained aerial reactions and tracking.',outcome:'Harry launches upward. Quidditch instincts take over—track, anticipate, dive. His fingers close around the damaged key.',advance:true},
        {icon:'📖',label:'Study the flock first',cat:'knowledge',rank:1,desc:'Look for the key whose wear matches the lock.',outcome:'Harry slows down long enough to notice one key has a bent wing and scratched shaft. He now knows exactly what to chase.',advance:true},
        {icon:'⚡',label:'Blast the keys apart',cat:'magic',rank:1,desc:'Try to solve the room with raw magic.',outcome:'The flock scatters wildly. The right key disappears among hundreds of identical wings. Power without a plan wastes time.',advance:false}
      ]
    },
    {
      id:'chess',eyebrow:'TRAPDOOR GAUNTLET • TRIAL III',title:'The Wizard Chessboard',xpStart:3000,xpTarget:6500,
      art:'♟️',
      story:`Beyond the key chamber, stone pieces tower over a black-and-white board. They do not move until the three friends step onto the squares.<br><br>Ron studies the position. He sees the board faster than Harry does—and his expression says the solution will cost something.<br><br><strong>Who leads this trial?</strong>`,
      choices:[
        {icon:'🤝',label:'Trust Ron’s strategy',cat:'assets',rank:2,desc:'Let an ally supply the skill Harry does not have.',outcome:'Harry follows Ron’s calls instead of trying to control everything himself. The path to the king opens—but Ron has to sacrifice his piece.',advance:true},
        {icon:'📖',label:'Analyse the board together',cat:'knowledge',rank:2,desc:'Slow the fight down and search for the safest line.',outcome:'The trio studies the board, but Ron still sees the decisive pattern first. Harry learns that readiness includes knowing when someone else is better equipped.',advance:true},
        {icon:'⚔',label:'Charge the opposing king',cat:'combat',rank:1,desc:'Treat the board like a physical fight.',outcome:'A stone rook slams across the board and blocks Harry immediately. This battle is won with strategy, not aggression.',advance:false}
      ]
    },
    {
      id:'quirrell',eyebrow:'YEAR 1 • BOSS BATTLE',title:'The Man Behind the Stone',xpStart:6500,xpTarget:10800,
      art:'⚡',
      story:`Harry enters the final chamber alone. The Mirror stands beneath torchlight. The person waiting for him is not who he expected—and the threat Harry has been chasing all year is suddenly much closer.<br><br>Harry cannot overpower what is in front of him. He has to survive long enough to understand why the enemy cannot simply take what he wants.<br><br><strong>This is the first real test of everything Harry has become.</strong>`,
      choices:[
        {icon:'⚡',label:'Keep control and resist',cat:'magic',rank:2,desc:'Use discipline rather than panic.',outcome:'Harry refuses to surrender the Stone. The confrontation becomes physical, but something about Harry’s touch is hurting the attacker.',advance:true},
        {icon:'🛡',label:'Trust the protection you carry',cat:'assets',rank:2,desc:'Rely on the protection and people that shaped Harry’s survival.',outcome:'Harry holds on. The enemy still does not understand the force protecting him—and that ignorance becomes a weakness.',advance:true},
        {icon:'📖',label:'Read what the enemy actually wants',cat:'knowledge',rank:2,desc:'Understand the objective before acting.',outcome:'Harry recognises that the Mirror is the key. Preventing access matters more than winning a conventional duel.',advance:true}
      ],
      complete:'YEAR 1 COMPLETE'
    }
  ],
  2:[
    {
      id:'entrance',eyebrow:'YEAR 2 • THE CHAMBER',title:'Open the Chamber',xpStart:13200,xpTarget:15000,art:'🐍',
      story:`The sink has shifted. Behind it is a stone mechanism carved with serpents. Ginny is somewhere below, and every minute matters.<br><br>For months Harry has feared the strange language that answers him. Now the frightening ability may be the only way forward.<br><br><strong>The entrance is waiting for a command.</strong>`,
      choices:[
        {icon:'🐍',label:'Speak to the serpent mechanism',cat:'knowledge',rank:2,desc:'Use what Harry has learned about his strange ability.',outcome:'The words come naturally. Stone grinds against stone and the hidden passage opens beneath Harry’s feet.',advance:true},
        {icon:'⚡',label:'Force the mechanism with magic',cat:'magic',rank:3,desc:'Try to overpower an ancient lock.',outcome:'The spell flashes across the stone but the carved serpents do not move. This door was built for a very specific key.',advance:false}
      ]
    },
    {
      id:'riddle',eyebrow:'YEAR 2 • CHAMBER DEPTHS',title:'The Memory in the Diary',xpStart:15000,xpTarget:18500,art:'📕',
      story:`Ginny lies motionless on the stone floor. A boy Harry has only seen inside a diary stands nearby—calm, articulate, and somehow becoming more solid as Ginny fades.<br><br>The pieces of the year are beginning to connect. The diary was never just a diary.<br><br><strong>Harry needs information before he needs force.</strong>`,
      choices:[
        {icon:'📖',label:'Make him reveal who he is',cat:'knowledge',rank:3,desc:'Keep him talking and connect the clues.',outcome:'The name rearranges into the truth. The helpful schoolboy and Harry’s enemy are the same person at different points in time.',advance:true},
        {icon:'⚔',label:'Attack immediately',cat:'combat',rank:2,desc:'Try to end the threat before understanding it.',outcome:'The spell passes through him. Harry has attacked the image without understanding what sustains it.',advance:false}
      ]
    },
    {
      id:'basilisk',eyebrow:'YEAR 2 • BOSS PHASE',title:'Face the Basilisk',xpStart:18500,xpTarget:22500,art:'🐍',
      story:`Stone trembles. Something enormous moves through the Chamber.<br><br>The creature is faster than Harry expected, and looking directly at it could be fatal. Then a burst of fire-coloured wings tears through the darkness. Help has arrived—but help alone will not finish the fight.<br><br><strong>Choose how Harry uses the opening.</strong>`,
      choices:[
        {icon:'🤝',label:'Fight with Fawkes’ help',cat:'assets',rank:3,desc:'Use an ally to change the conditions of the battle.',outcome:'Fawkes attacks the creature’s eyes. The impossible fight changes shape. Harry finally has a chance to move without meeting its gaze.',advance:true},
        {icon:'⚔',label:'Take the opening and strike',cat:'combat',rank:3,desc:'Use movement, timing and courage to close the distance.',outcome:'Harry moves the instant the creature recoils. The blade drives home—but a fang tears into Harry’s arm.',advance:true},
        {icon:'⚡',label:'Stand and trade spells',cat:'magic',rank:3,desc:'Fight the creature from range.',outcome:'Magic slows it for seconds, not long enough. Harry needs the advantages his allies and equipment created.',advance:false}
      ]
    },
    {
      id:'diary',eyebrow:'YEAR 2 • FINAL OBJECTIVE',title:'Destroy the Diary',xpStart:22500,xpTarget:24800,art:'📕',
      story:`The creature collapses, but the boy from the diary is still there. Harry’s strength is fading. Beside him lies a broken fang wet with venom.<br><br>The diary reacts when Harry reaches for it. For the first time, the object looks afraid.<br><br><strong>One final decision ends the Chamber.</strong>`,
      choices:[
        {icon:'📖',label:'Connect the diary to the threat',cat:'knowledge',rank:3,desc:'Recognise what Riddle has been using to remain present.',outcome:'Harry understands that the diary is not evidence—it is the mechanism. Destroying it is more important than attacking the memory.',advance:true},
        {icon:'⚔',label:'Drive the fang through the diary',cat:'combat',rank:3,desc:'Turn the Basilisk’s own weapon against the object.',outcome:'Venom burns through the pages. The memory screams and collapses. Ginny begins to breathe again.',advance:true}
      ],
      complete:'YEAR 2 COMPLETE'
    }
  ]
};
function adventureBook(){
  return Math.min(2,Math.max(1,bookForLevel(Math.max(1,save.currentLevel))));
}
function adventureState(book){
  if(!save.adventure54)save.adventure54={};
  if(!save.adventure54[book])save.adventure54[book]={scene:0,lastResult:null};
  const scenes=ADVENTURE54[book]||[];
  const s=save.adventure54[book];
  s.scene=Math.max(0,Math.min(s.scene,Math.max(0,scenes.length-1)));
  return s;
}
function sceneXp(scene){
  const span=Math.max(1,scene.xpTarget-scene.xpStart);
  return {earned:Math.max(0,Math.min(span,save.totalXP-scene.xpStart)),target:span};
}
function missingTrainingForScene(scene){
  const opts=scene.choices.filter(c=>c.rank>0);
  const misses=opts.map(c=>({cat:c.cat,need:Math.max(0,c.rank-readinessRank(c.cat))})).filter(x=>x.need>0).sort((a,b)=>a.need-b.need);
  return misses[0]||null;
}
function renderBattle(){
  const hub=document.querySelector('#battleHub');if(!hub)return;
  const book=adventureBook(),state=adventureState(book),scenes=ADVENTURE54[book],scene=scenes[state.scene];
  const xp=sceneXp(scene),xpReady=xp.earned>=xp.target;
  const missing=missingTrainingForScene(scene);
  const labels={magic:'Magic',combat:'Combat & Skills',knowledge:'Knowledge',assets:'Allies & Arsenal'};
  const trainTips={magic:'Complete your nutrition, routine, hydration and sleep missions.',combat:'Gym, cardio, sport and stretching train this fastest.',knowledge:'Use Read / Study for intentional learning, research and workout planning.',assets:'Recovery, sauna, consistency and support-building train this area.'};

  if(state.lastResult){
    const result=state.lastResult;
    hub.innerHTML=`<section class="adventure54 result">
      <div class="adventure54-result-art">${result.icon}</div>
      <span>${result.success?'DECISION SUCCESS':'THE CHOICE HAS CONSEQUENCES'}</span>
      <h2>${result.label}</h2>
      <div class="adventure54-story">${result.outcome}</div>
      <div class="adventure54-result-note">${result.success?'Your preparation opened this route.':'Harry survives the moment, but this route does not solve the problem.'}</div>
      <button class="primary wide" id="adventureResultContinue">${result.success?'Continue the story':'Choose another action'}</button>
    </section>`;
    hub.querySelector('#adventureResultContinue').onclick=()=>{
      const advance=result.success&&result.advance;
      state.lastResult=null;
      if(advance){
        if(state.scene<scenes.length-1)state.scene++;
        else state.completed=true;
      }
      persist();renderBattle();window.scrollTo({top:0,behavior:'smooth'});
    };
    return;
  }

  if(state.completed){
    hub.innerHTML=`<section class="adventure54 complete">
      <span>CAMPAIGN VICTORY</span><div class="adventure54-victory">🏆</div>
      <h2>${scenes[scenes.length-1].complete||`YEAR ${book} COMPLETE`}</h2>
      <p>You trained Harry, made the decisions and completed every major confrontation in this prototype campaign.</p>
      <button class="primary wide" id="replayAdventure">Replay Year ${book}</button>
    </section>`;
    hub.querySelector('#replayAdventure').onclick=()=>{state.scene=0;state.completed=false;persist();renderBattle();};
    return;
  }

  hub.innerHTML=`<section class="adventure54">
    <header class="adventure54-head">
      <div><span>${scene.eyebrow}</span><h2>${scene.title}</h2></div>
      <div class="adventure54-step">${state.scene+1}<small>/${scenes.length}</small></div>
    </header>
    <div class="adventure54-art">${scene.art}</div>
    <div class="adventure54-story">${scene.story}</div>

    <section class="adventure54-gate">
      <div class="adventure54-gate-head"><span>ENCOUNTER XP</span><b>${xp.earned.toLocaleString()} / ${xp.target.toLocaleString()}</b></div>
      <div class="adventure54-xpbar"><i style="width:${Math.round(xp.earned/xp.target*100)}%"></i></div>
      <small>${xpReady?'XP READY ✓':`${(xp.target-xp.earned).toLocaleString()} more XP until this encounter can be completed`}</small>
    </section>

    <div class="adventure54-question">Choose Harry’s action</div>
    <div class="adventure54-choices">
      ${scene.choices.map((c,i)=>{
        const rank=readinessRank(c.cat),skillReady=rank>=c.rank,available=xpReady&&skillReady;
        return `<button class="adventure54-choice ${available?'available':'locked'}" data-choice="${i}" ${available?'':'disabled'}>
          <span>${c.icon}</span><div><b>${c.label}</b><p>${c.desc}</p>
          <small>${!xpReady?`🔒 ${xp.target-xp.earned} encounter XP needed`:skillReady?'✓ AVAILABLE':`🔒 ${labels[c.cat]} Rank ${c.rank} • Current ${rank}`}</small></div>
        </button>`;
      }).join('')}
    </div>

    ${!xpReady||missing?`<section class="adventure54-coach">
      <span>BEST TRAINING RIGHT NOW</span>
      <b>${!xpReady?'Keep earning mission XP':`Build ${labels[missing.cat]}`}</b>
      <p>${!xpReady?'Every completed Today mission moves Harry closer to attempting this encounter.':trainTips[missing.cat]}</p>
    </section>`:''}
  </section>`;

  hub.querySelectorAll('.adventure54-choice.available').forEach(btn=>btn.onclick=()=>{
    const c=scene.choices[Number(btn.dataset.choice)];
    state.lastResult={icon:c.icon,label:c.label,outcome:c.outcome,success:!!c.advance,advance:!!c.advance};
    persist();renderBattle();window.scrollTo({top:0,behavior:'smooth'});
  });
}


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
