const DATA = {};
const stateKey = 'hpFitnessRpgSave_v3';
const legacyStateKeys = ['hpFitnessRpgSave_v2','hpFitnessRpgSave_v1'];
const APP_VERSION = '3.4.0';
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
  if(item.type==='level'){eye.textContent='LEVEL UNLOCKED';art.textContent=`${item.row.level}`;art.className='reveal-art level-art';rar.textContent=`BOOK ${item.row.book} • CHECKPOINT ${item.row.checkpoint}`;rar.className='reveal-rarity';title.textContent=item.row.storyBeat;text.textContent=item.row.bookName;playChime('level');}
  else if(item.type==='collectible'){const c=item.card;eye.textContent=item.restored?'COLLECTIBLE REVEAL RESTORED':'COLLECTIBLE DISCOVERED';art.textContent=revealArtForCard(c);art.className=`reveal-art card-art ${c.rarity}`;rar.textContent=c.rarity.toUpperCase();rar.className=`reveal-rarity ${c.rarity}`;title.textContent=visibleName(c);text.textContent=`${c.category} • Discovered at Level ${save.owned[c.id]?.discoveredLevel||c.firstEligibleLevel}`;playChime(c.rarity);}
  else if(item.type==='book'){eye.textContent='BOOK COMPLETE';art.textContent='🏆';art.className='reveal-art book-art';rar.textContent=`BOOK ${item.row.book} OF 7`;rar.className='reveal-rarity Legendary';title.textContent=item.row.bookName;text.textContent='Journey complete. Your next chapter awaits.';playChime('book');}
  else {eye.textContent='YOUR COLLECTION';art.textContent='✨';art.className='reveal-art';rar.textContent='UPGRADE REWARD';title.textContent=`${item.count} discoveries restored`;text.textContent='This update now gives your existing discoveries the reveal they deserved.';playChime('Epic');}
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
    toast(`${habit.name} unchecked • -${xp} XP`,'warn');
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
function undoWeights(){const week=ensureCurrentWeek();if(week.weights<=0)return toast('Nothing to undo for Gym.','warn');const date=week.weightDays.pop()||localDateKey();week.weights=Math.max(0,week.weights-1);decrementDayCredit(date,1);removeXP(100,'Gym Weight Lifting');toast(`Gym session removed • ${week.weights}/4`,'warn');}
function logCardio(credits=1){ensureAudio();const week=ensureCurrentWeek(),remaining=Math.max(0,4-week.cardio),accepted=Math.min(credits,remaining);if(accepted<=0)return toast('Incline / Stairs target already complete this week.','warn');week.cardio+=accepted;week.cardioLog.push({date:localDateKey(),credits:accepted});getDaily().weeklyCreditsToday+=accepted;const xp=accepted*40;addXP(xp,'Incline Walk / StairMaster');toast(`Incline / Stairs +${accepted} • +${xp} XP`);}
function undoCardio(){const week=ensureCurrentWeek();if(week.cardio<=0)return toast('Nothing to undo for Incline / Stairs.','warn');const last=week.cardioLog.pop(),credits=Math.min(week.cardio,Math.max(1,last?.credits||1)),date=last?.date||localDateKey();week.cardio=Math.max(0,week.cardio-credits);decrementDayCredit(date,credits);removeXP(credits*40,'Incline Walk / StairMaster');toast(`Incline / Stairs removed • ${week.cardio}/4`,'warn');}
function logSport(){ensureAudio();const week=ensureCurrentWeek();if(week.sportDueRemaining<=0)return toast('Sport / Outdoor weekly target is already complete.','warn');const date=localDateKey();week.sportActual++;week.sportLog.push({date,banked:false});getDaily().weeklyCreditsToday++;week.sportDueRemaining=Math.max(0,week.sportDueRemaining-1);addXP(50,'Sport / Outdoor Activity');toast(`Sport / Outdoor • ${3-week.sportDueRemaining}/3 • +50 XP`);}
function undoSport(){const week=ensureCurrentWeek();if(week.sportActual<=0 && week.sportDueRemaining>=3)return toast('Nothing to undo for Sport / Outdoor.','warn');const last=week.sportLog.pop(),date=last?.date||localDateKey();week.sportActual=Math.max(0,week.sportActual-1);week.sportDueRemaining=Math.min(3,week.sportDueRemaining+1);decrementDayCredit(date,1);removeXP(50,'Sport / Outdoor Activity');toast(`Sport / Outdoor removed • ${3-week.sportDueRemaining}/3`,'warn');}
function logSauna(credits){
  ensureAudio();const week=ensureCurrentWeek(),date=localDateKey(),remaining=Math.max(0,5-week.sauna),accepted=Math.min(credits,remaining);if(accepted<=0)return toast('Sauna target already complete this week.','warn');
  const firstXpToday=!week.saunaXpDays.includes(date);week.sauna+=accepted;week.saunaLog.push({date,credits:accepted,xpAwarded:firstXpToday?35:0});getDaily().weeklyCreditsToday+=accepted;if(firstXpToday){week.saunaXpDays.push(date);addXP(35,'Sauna');toast(`Sauna +${accepted} credit${accepted>1?'s':''} • +35 XP`);}else{persist();render();toast(`Sauna +${accepted} credit • 0 extra XP`);}
}
function undoSauna(){const week=ensureCurrentWeek();if(week.sauna<=0)return toast('Nothing to undo for Sauna.','warn');const last=week.saunaLog.pop(),credits=Math.min(week.sauna,Math.max(1,last?.credits||1)),date=last?.date||localDateKey(),xp=Number.isFinite(last?.xpAwarded)?last.xpAwarded:(week.saunaXpDays.includes(date)?35:0);week.sauna=Math.max(0,week.sauna-credits);decrementDayCredit(date,credits);if(xp>0){const stillXpThatDay=week.saunaLog.some(x=>x.date===date&&x.xpAwarded>0);if(!stillXpThatDay)week.saunaXpDays=week.saunaXpDays.filter(d=>d!==date);removeXP(xp,'Sauna');}else{persist();render();}toast(`Sauna removed • ${week.sauna}/5`,'warn');}

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
  const row=currentRow(),next=nextLevelRow();document.querySelector('#levelOrb').textContent=save.currentLevel;document.querySelector('#levelTitle').textContent=save.currentLevel?`Level ${save.currentLevel}`:'Level 0';document.querySelector('#storyBeat').textContent=row?.storyBeat||'Your journey is ready to begin.';document.querySelector('#bookLabel').textContent=row?`BOOK ${row.book} • ${row.bookName}`:'BEFORE HOGWARTS';
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

function habitRowsHtml(habits,day){return habits.map(h=>{const entry=day.habits[h.id],done=entry?.completed;return `<button class="habit-row ${done?'done':''}" data-habit="${h.id}"><span class="habit-icon">${h.icon}</span><span class="habit-copy"><strong>${escapeHtml(h.name)}</strong></span><span class="habit-xp">${done?'↶':`+${h.xp}`}</span></button>`;}).join('');}
function renderDailyHabits(){
  const day=getDaily(),list=document.querySelector('#dailyHabitList'),habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep'),completed=habits.filter(h=>day.habits[h.id]?.completed).length;document.querySelector('#routineBadge').textContent=`${completed} / ${habits.length}`;document.querySelector('#todayDateLabel').textContent=prettyDate(localDateKey());
  if(completed===habits.length){list.innerHTML=`<div class="routine-complete-strip"><span>✨</span><div><strong>All ${habits.length} daily missions complete</strong><small>Your checklist is tucked away for the rest of today.</small></div></div><details class="completed-details"><summary>View completed missions</summary><div class="completed-list">${habitRowsHtml(habits,day)}</div></details>`;}
  else list.innerHTML=habitRowsHtml(habits,day);
  list.querySelectorAll('[data-habit]').forEach(b=>b.onclick=()=>toggleHabit(b.dataset.habit));
}
function renderSleep(){const day=getDaily(),s=day.sleep;if(document.activeElement!==document.querySelector('#sleepHours'))document.querySelector('#sleepHours').value=s?.mainHours??'';if(document.activeElement!==document.querySelector('#napHours'))document.querySelector('#napHours').value=s?.napHours??'';const preview=s?.scoreXp??sleepXP(document.querySelector('#sleepHours').value),summary=sleepSummary();document.querySelector('#sleepXpPreview').textContent=`${preview} / 50 XP`;document.querySelector('#sleep7Day').textContent=summary.count?`7-day avg: ${summary.sevenAvg.toFixed(1)}h`:'7-day avg: —';}
function missionProgressDots(value,target){return Array.from({length:target},(_,i)=>`<span class="mission-dot ${i<value?'filled':''}"></span>`).join('');}
function renderWeekly(){
  const week=ensureCurrentWeek();document.querySelector('#weekLabel').textContent=`${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`;
  document.querySelector('#weeklyMissionList').innerHTML=`
    <div class="weekly-mission ${week.weights>0?'has-progress':''}"><div class="weekly-info"><span class="weekly-icon">🏋️</span><div><strong>Gym</strong><small>4 sessions • 100 XP each</small><div class="mission-dots">${missionProgressDots(week.weights,4)}</div></div></div><div class="weekly-action"><b>${week.weights}/4</b><div class="stepper"><button id="undoWeights" class="undo-control" ${week.weights<=0?'disabled':''}>−</button><button id="logWeights" ${week.weights>=4?'disabled':''}>+</button></div></div></div>
    <div class="weekly-mission ${week.cardio>0?'has-progress':''}"><div class="weekly-info"><span class="weekly-icon">🏃</span><div><strong>Incline Walk / StairMaster</strong><small>4 sessions • 40 XP each</small><div class="mission-dots">${missionProgressDots(week.cardio,4)}</div></div></div><div class="weekly-action"><b>${week.cardio}/4</b><div class="stepper"><button id="undoCardio" class="undo-control" ${week.cardio<=0?'disabled':''}>−</button><button id="logCardio1" ${week.cardio>=4?'disabled':''}>+</button></div></div></div>
    <div class="weekly-mission ${week.sportDueRemaining<=0?'complete':''}"><div class="weekly-info"><span class="weekly-icon">⚽</span><div><strong>Sport / Outdoor</strong><small>3 sessions • 50 XP each</small><div class="mission-dots">${missionProgressDots(3-week.sportDueRemaining,3)}</div></div></div><div class="weekly-action"><b>${3-week.sportDueRemaining}/3</b><div class="stepper"><button id="undoSport" class="undo-control" ${(3-week.sportDueRemaining)<=0?'' : ((3-week.sportDueRemaining)<=0?'':'')} ${week.sportActual<=0?'disabled':''}>−</button><button id="logSport" ${week.sportDueRemaining<=0?'disabled':''}>+</button></div></div></div>
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
  if(!ui.journeyBook)ui.journeyBook=bookForLevel(Math.max(1,save.currentLevel));
  document.querySelector('#bookTabs').innerHTML=Array.from({length:7},(_,i)=>{const b=i+1;return `<button data-book="${b}" class="${ui.journeyBook===b?'active':''}"><span>${b}</span><small>${BOOK_NAMES[b]}</small></button>`;}).join('');
  document.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{ui.journeyBook=Number(b.dataset.book);renderJourney();});
  const rows=DATA.levels.filter(l=>l.book===ui.journeyBook),map=document.querySelector('#journeyMap');
  const h=1500,w=360,points=rows.map((l,i)=>({x:70+Math.round((Math.sin(i*.92)+1)*105),y:145+i*52,row:l}));
  const path=points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
  const nodes=points.map((p,i)=>{const l=p.row,cls=l.level<save.currentLevel?'done':l.level===save.currentLevel?'current':'locked',checkpoint=l.level%4===0;return `<button class="map-node ${cls} ${checkpoint?'checkpoint':''}" data-level="${l.level}" style="left:${(p.x/w)*100}%;top:${p.y}px"><span>${cls==='done'?'✓':l.level}</span>${checkpoint?'<em>✦</em>':''}</button>`;}).join('');
  map.innerHTML=`<div class="map-sky"><div class="castle-mark">🏰</div><div><span>BOOK ${ui.journeyBook}</span><strong>${escapeHtml(BOOK_NAMES[ui.journeyBook])}</strong></div></div><svg class="map-path" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg><div class="map-landmark map-landmark-a">✦</div><div class="map-landmark map-landmark-b">☾</div>${nodes}<div class="map-footer-rune">MISCHIEF MANAGED • ${rows.filter(l=>l.level<=save.currentLevel).length}/24 LEVELS</div>`;
  map.style.height=`${h+80}px`;
  map.querySelectorAll('[data-level]').forEach(n=>n.onclick=()=>showJourneyNode(Number(n.dataset.level)));
}
function showJourneyNode(level){const l=DATA.levels[level-1],status=level<save.currentLevel?'Completed':level===save.currentLevel?'Current level':'Locked',detail=document.querySelector('#journeyNodeDetail');detail.hidden=false;detail.innerHTML=`<div class="node-detail-head"><span class="map-node-chip">${level}</span><div><span class="eyebrow">${status.toUpperCase()}</span><h3>${escapeHtml(status==='Locked'?'Unknown chapter':l.storyBeat)}</h3></div></div><p>${status==='Locked'?'Continue your journey to reveal this chapter.':`Book ${l.book}: ${escapeHtml(l.bookName)} • Checkpoint ${l.checkpoint}`}</p>`;detail.scrollIntoView({behavior:'smooth',block:'nearest'});}

// ---------- Collection museum ----------
function cardBook(card){return bookForLevel(card.firstEligibleLevel);}
function collectibleFact(c){
  const discovered=save.owned[c.id]?.discoveredLevel||c.firstEligibleLevel||1,row=DATA.levels[Math.max(0,Number(discovered)-1)];
  const raw=Array.isArray(c.revelationLevels)?c.revelationLevels:String(c.revelationLevels||'').split(';');
  const safe=raw.map(x=>String(x).trim()).filter(Boolean).map(x=>{const m=x.match(/^(\d+)/);return {level:m?Number(m[1]):999,text:x.replace(/^\d+\s*:\s*/,'')};}).filter(x=>x.level<=save.currentLevel).pop();
  if(safe?.text)return safe.text;
  const notes=String(c.notes||'').trim();if(notes&&!/spoiler|do not|future/i.test(notes))return notes;
  if(row?.storyBeat)return `${visibleName(c)} becomes part of your story around “${row.storyBeat}.”`;
  return `${visibleName(c)} is a ${c.rarity} ${String(c.category||'collectible').toLowerCase()} in your magical archive.`;
}
function collectionCardHtml(c){const status=cardStatus(c),owned=status==='owned',name=owned?visibleName(c):(status==='eligible'?'Undiscovered':'?'),meta=CATEGORY_META[c.category],art=owned?meta.icon:'✦';return `<article class="museum-card ${status} ${c.rarity}"><div class="museum-art"><span>${art}</span><i>${owned?escapeHtml(name.slice(0,1)):'?'}</i></div><div class="museum-copy"><span class="rarity ${c.rarity}">${c.rarity}</span><h4>${escapeHtml(name)}</h4><p>${owned?`Discovered Lv ${save.owned[c.id].discoveredLevel}`:(status==='eligible'?`Eligible since Lv ${c.firstEligibleLevel}`:'Undiscovered')}</p></div></article>`;}
// ---------- Stats dashboard ----------
function elapsedWeekDates(){const today=localDateKey();return currentWeekDates().filter(k=>k<=today);}
function habitWeekStats(){
  const dates=elapsedWeekDates(), habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep');
  return habits.map(h=>{const done=dates.filter(k=>save.daily[k]?.habits?.[h.id]?.completed).length;return {...h,done,total:dates.length,pct:dates.length?Math.round(done/dates.length*100):0};});
}
function ringHtml(icon,label,value,target,sub=''){
  const pct=target?Math.min(100,Math.round(value/target*100)):0;
  return `<div class="activity-ring-card"><div class="activity-ring" style="--pct:${pct}"><div><span>${icon}</span><strong>${value}/${target}</strong></div></div><b>${escapeHtml(label)}</b>${sub?`<small>${escapeHtml(sub)}</small>`:''}</div>`;
}
function habitStatHtml(h){return `<div class="habit-stat"><div class="habit-stat-head"><span>${h.icon||'✓'} ${escapeHtml(h.name)}</span><strong>${h.done}/${h.total}</strong></div><div class="habit-stat-track"><i style="width:${h.pct}%"></i></div><small>${h.pct}% of days so far this week</small></div>`;}
function nutritionHabit(h){const t=`${h.id||''} ${h.name||''} ${h.rule||''}`.toLowerCase();return /protein|creatine|meal|food|fruit|veg|vegetable|nutrition|breakfast|oat|tea|water|chia|fennel|sultana|almond|supplement|vitamin/.test(t);}
function renderStats(){
  const week=ensureCurrentWeek(), ss=sleepSummary(), habits=habitWeekStats(), nutrition=habits.filter(nutritionHabit), foundations=habits.filter(h=>!nutritionHabit(h));
  const sportDone=3-week.sportDueRemaining;
  document.querySelector('#statsDashboard').innerHTML=`
    <section class="stats-intro"><span class="eyebrow">YOUR ACTIVITY</span><h2>This week</h2><p>See what you have actually done — no perfect-day scores, no world progress.</p></section>
    <section class="dashboard-card activity-dashboard"><div class="section-head"><div><span class="eyebrow">WEEKLY ACTIVITIES</span><h3>Your movement</h3></div><span class="mini-badge">${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}</span></div><div class="activity-ring-grid">${ringHtml('🏋️','Gym',week.weights,4)}${ringHtml('🏃','Incline / Stairs',week.cardio,4)}${ringHtml('⚽','Sport / Outdoor',sportDone,3,save.sportBank?`+${save.sportBank} saved`:'')}${ringHtml('🧖','Sauna',week.sauna,5)}</div></section>
    ${nutrition.length?`<section class="dashboard-card"><div class="section-head"><div><span class="eyebrow">NUTRITION & FUEL</span><h3>Eating & essentials</h3></div><span class="mini-badge">week to date</span></div><div class="habit-stats-grid">${nutrition.map(habitStatHtml).join('')}</div></section>`:''}
    ${foundations.length?`<section class="dashboard-card"><div class="section-head"><div><span class="eyebrow">DAILY FOUNDATIONS</span><h3>Your habits</h3></div><span class="mini-badge">week to date</span></div><div class="habit-stats-grid">${foundations.map(habitStatHtml).join('')}</div></section>`:''}
    <section class="dashboard-card"><div class="section-head"><div><span class="eyebrow">RECOVERY</span><h3>Sleep</h3></div><strong>${ss.count?ss.sevenAvg.toFixed(1)+' h avg':'—'}</strong></div><div class="sleep-dashboard"><div class="sleep-ring" style="--pct:${Math.min(100,ss.sevenAvg/8*100)}"><span>${ss.count?ss.sevenAvg.toFixed(1)+'h':'—'}</span></div><div><p><span>Nights logged</span><strong>${ss.count}/7</strong></p><p><span>Naps</span><strong>${sleepEntries(7).reduce((n,x)=>n+(Number(x.napHours)||0),0).toFixed(1)} h</strong></p></div></div></section>`;
}

// ---------- Settings ----------
function renderSettings(){const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;document.querySelector('#installState').textContent=standalone?'Installed and running from your Home Screen in standalone mode.':'Browser mode: use Safari → Share → Add to Home Screen.';document.querySelector('#soundToggle').textContent=save.soundEnabled?'On':'Off';document.querySelector('#soundToggle').classList.toggle('off',!save.soundEnabled);document.querySelector('#devTools').hidden=!DEV_MODE;}
function render(){renderHome();renderJourney();renderCollection();renderStats();renderSettings();}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));}

function setupUI(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));if(b.dataset.view==='journey')renderJourney();if(b.dataset.view==='collection')renderCollection();if(b.dataset.view==='stats')renderStats();if(b.dataset.view==='settings')renderSettings();window.scrollTo({top:0,behavior:'smooth'});});
  document.querySelector('#saveSleep').onclick=saveSleep;document.querySelector('#sleepHours').oninput=renderSleep;
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
