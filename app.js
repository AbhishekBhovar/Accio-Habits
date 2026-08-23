const DATA = {};
const stateKey = 'hpFitnessRpgSave_v2';
const legacyStateKey = 'hpFitnessRpgSave_v1';
const APP_VERSION = '2.0.0';

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
    version:2,
    appVersion:APP_VERSION,
    totalXP:0,
    currentLevel:0,
    owned:{},
    eventLog:[],
    legendaryPityCounter:0,
    bankedRewardSlots:0,
    completedBooks:[],
    daily:{},
    weekly:{},
    sportBank:0,
    saunaBank:0,
    streak:{current:0,best:0,lastFinalizedDate:null},
    achievements:{perfectRoutineDays:0,perfectDays:0,exceptionalDays:0,perfectWeeks:0,optimalSleepWeeks:0},
    sleep:{highestStage:1},
    lastWeekKey:null
  };
}
function loadState(){
  try{
    const current=JSON.parse(localStorage.getItem(stateKey)||'null');
    if(current) return mergeState(current);
    const legacy=JSON.parse(localStorage.getItem(legacyStateKey)||'null');
    if(legacy){
      const migrated=mergeState({...legacy,version:2,appVersion:APP_VERSION});
      localStorage.setItem(stateKey,JSON.stringify(migrated));
      return migrated;
    }
  }catch(err){console.warn('Save load failed',err)}
  return defaultState();
}
function mergeState(raw){
  const base=defaultState();
  return {
    ...base,...raw,
    streak:{...base.streak,...(raw.streak||{})},
    achievements:{...base.achievements,...(raw.achievements||{})},
    sleep:{...base.sleep,...(raw.sleep||{})},
    daily:raw.daily||{},weekly:raw.weekly||{},owned:raw.owned||{},eventLog:raw.eventLog||[]
  };
}
let save=loadState();
function persist(){save.appVersion=APP_VERSION;localStorage.setItem(stateKey,JSON.stringify(save));}

// ---------- date/week helpers ----------
function localDateKey(date=new Date()){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseDateKey(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12,0,0);}
function addDays(date,days){const x=new Date(date);x.setDate(x.getDate()+days);return x;}
function mondayOf(date=new Date()){
  const x=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);const day=x.getDay();const diff=day===0?-6:1-day;x.setDate(x.getDate()+diff);return x;
}
function weekKey(date=new Date()){return localDateKey(mondayOf(date));}
function prettyDate(key){return parseDateKey(key).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'});}
function weekEndFromKey(key){return addDays(parseDateKey(key),6);}
function getDaily(key=localDateKey()){
  if(!save.daily[key]) save.daily[key]={habits:{},sleep:null,finalized:false,disciplineScore:null,perfectRoutine:false,perfectDay:false,exceptionalDay:false,weeklyCreditsToday:0};
  return save.daily[key];
}
function weekStatusForKey(key){
  const week=save.weekly[key];if(!week)return null;
  const dates=Array.from({length:7},(_,i)=>localDateKey(addDays(parseDateKey(key),i)));
  const statuses=dates.map(k=>calculateDayStatus(k));
  const avgDiscipline=avg(statuses.map(s=>s.discipline));
  const routineDays=statuses.filter(s=>s.perfectRoutine).length;
  const sleepRows=dates.map(k=>save.daily[k]?.sleep).filter(s=>s?.mainHours>0);
  const sleepAvg=sleepRows.length===7?avg(sleepRows.map(s=>s.mainHours)):0;
  return {
    avgDiscipline,routineDays,
    perfectWeek:avgDiscipline>=.9&&week.weights>=4&&week.cardio>=4&&week.sportDueRemaining===0&&routineDays>=3,
    optimalSleepWeek:sleepRows.length===7&&sleepAvg>=8&&sleepAvg<=9
  };
}
function finalizeWeek(key){
  const week=save.weekly[key];if(!week||week.finalized)return;
  const status=weekStatusForKey(key);
  week.finalized=true;week.finalStats=status;
  if(status?.perfectWeek)save.achievements.perfectWeeks+=1;
  if(status?.optimalSleepWeek)save.achievements.optimalSleepWeeks+=1;
}
function ensureCurrentWeek(){
  const currentKey=weekKey();
  if(save.lastWeekKey && save.lastWeekKey!==currentKey){
    finalizeWeek(save.lastWeekKey);
    let cursor=addDays(parseDateKey(save.lastWeekKey),7);
    while(localDateKey(cursor)!==currentKey){
      // Skipped weeks consume banked sport credits against their target, but create no debt.
      save.sportBank=Math.max(0,save.sportBank-3);
      cursor=addDays(cursor,7);
    }
  }
  if(!save.weekly[currentKey]){
    const usedFromBank=Math.min(3,save.sportBank);
    save.sportBank-=usedFromBank;
    save.weekly[currentKey]={weights:0,weightDays:[],cardio:0,cardioLog:[],sportActual:0,sportBankUsed:usedFromBank,sportDueRemaining:3-usedFromBank,createdAt:Date.now(),finalized:false};
  }
  save.lastWeekKey=currentKey;
  return save.weekly[currentKey];
}
function finalizePastDays(){
  const today=localDateKey();
  const keys=Object.keys(save.daily).sort();
  for(const key of keys){if(key<today && !save.daily[key].finalized) finalizeDay(key);}
  // If we have a last finalized date, explicitly count any unlogged gaps as 0% days.
  if(save.streak.lastFinalizedDate){
    let cursor=addDays(parseDateKey(save.streak.lastFinalizedDate),1);
    const yesterday=addDays(parseDateKey(today),-1);
    while(cursor<=yesterday){
      const key=localDateKey(cursor);
      if(!save.daily[key]) save.daily[key]={habits:{},sleep:null,finalized:false,disciplineScore:null,perfectRoutine:false,perfectDay:false,exceptionalDay:false,weeklyCreditsToday:0};
      if(!save.daily[key].finalized) finalizeDay(key);
      cursor=addDays(cursor,1);
    }
  }
}
function finalizeDay(key){
  const day=getDaily(key);const status=calculateDayStatus(key);
  day.finalized=true;day.disciplineScore=status.discipline;day.perfectRoutine=status.perfectRoutine;day.perfectDay=status.perfectDay;day.exceptionalDay=status.exceptionalDay;
  if(status.discipline>=DATA.habits.achievements.disciplineStreakThreshold) save.streak.current+=1; else save.streak.current=0;
  save.streak.best=Math.max(save.streak.best,save.streak.current);save.streak.lastFinalizedDate=key;
  if(status.perfectRoutine) save.achievements.perfectRoutineDays+=1;
  if(status.perfectDay) save.achievements.perfectDays+=1;
  if(status.exceptionalDay) save.achievements.exceptionalDays+=1;
  persist();
}

// ---------- Harry Journey ----------
function cumulativeXpForLevel(level){return DATA.levels.slice(0,level).reduce((n,l)=>n+l.xpRequired,0)}
function xpIntoCurrent(){return save.totalXP-cumulativeXpForLevel(save.currentLevel)}
function nextLevelRow(){return DATA.levels[save.currentLevel]||null}
function currentRow(){return save.currentLevel?DATA.levels[save.currentLevel-1]:null}
function visibleName(card){
  const rule=DATA.identity.find(r=>r.collectible===card.name);
  if(!rule || !rule.revealLevel || save.currentLevel>=Number(rule.revealLevel)) return card.name;
  return rule.visibleBeforeReveal || card.name;
}
function cardStatus(card){if(save.owned[card.id]) return 'owned';return save.currentLevel>=card.firstEligibleLevel?'eligible':'locked'}
function grantGuaranteedAt(level){
  const granted=[];
  for(const c of DATA.collectibles){if(c.firstEligibleLevel===level&&c.delivery==='Guaranteed'&&!save.owned[c.id]){save.owned[c.id]={discoveredLevel:level};granted.push(c)}}
  return granted;
}
function logEvent(level,title,kind='story'){save.eventLog.unshift({level,title,kind,ts:Date.now()});save.eventLog=save.eventLog.slice(0,80)}
function levelUp(level){
  const row=DATA.levels[level-1];const granted=grantGuaranteedAt(level);logEvent(level,row.storyBeat,'level');
  for(const c of granted) logEvent(level,`Discovered: ${visibleName(c)} [${c.rarity}]`,'discovery');
  for(const x of row.revelations) logEvent(level,x,'revelation');
  for(const x of row.evolutions) logEvent(level,x,'evolution');
  if(DATA.config.bookCompletionLevels.includes(level)&&!save.completedBooks.includes(row.book)) save.completedBooks.push(row.book);
  showLevelDialog(row,granted);
}
function addXP(amount,source='Activity'){
  const safeAmount=Math.max(0,Math.round(Number(amount)||0));if(!safeAmount)return;
  save.totalXP+=safeAmount;logEvent(save.currentLevel,`+${safeAmount} XP — ${source}`,'xp');
  while(save.currentLevel<168){const threshold=cumulativeXpForLevel(save.currentLevel+1);if(save.totalXP<threshold)break;save.currentLevel++;levelUp(save.currentLevel)}
  persist();render();
}
function showLevelDialog(row,granted){
  const d=document.querySelector('#levelDialog');
  document.querySelector('#dialogTitle').textContent=`Level ${row.level} — ${row.storyBeat}`;
  document.querySelector('#dialogStory').textContent=`${row.bookName} • Checkpoint ${row.checkpoint}`;
  const groups=[];
  if(granted.length)groups.push(['Guaranteed discoveries',granted.map(c=>`${visibleName(c)} — ${c.rarity}`)]);
  if(row.evolutions.length)groups.push(['Evolutions',row.evolutions]);if(row.revelations.length)groups.push(['Revelations',row.revelations]);if(row.momentCards.length)groups.push(['Moment cards',row.momentCards]);
  document.querySelector('#dialogRewards').innerHTML=groups.map(([h,items])=>`<div class="reward-group"><h4>${escapeHtml(h)}</h4>${items.map(x=>`<p>${escapeHtml(x)}</p>`).join('')}</div>`).join('')||'<p class="muted">Story progression unlocked.</p>';
  if(!d.open)d.showModal();
}

// ---------- daily habits ----------
function sleepXP(hours){hours=Number(hours)||0;if(hours<DATA.habits.sleep.zeroBelowHours)return 0;if(hours>=8)return 50;return Math.round((hours/8)*50)}
function completeHabit(id){
  const habit=DATA.habits.dailyHabits.find(h=>h.id===id);if(!habit||habit.input==='sleep')return;
  const day=getDaily();if(day.habits[id]?.completed)return;
  day.habits[id]={completed:true,xpAwarded:habit.xp,viaBank:false,ts:Date.now()};
  addXP(habit.xp,habit.name);showMission(habit.name,`+${habit.xp} XP`);persist();render();
}
function saveSleep(){
  const day=getDaily();const main=Math.max(0,Number(document.querySelector('#sleepHours').value)||0);const nap=Math.max(0,Number(document.querySelector('#napHours').value)||0);
  if(main<=0){alert('Enter your main sleep hours first.');return}
  const newXp=sleepXP(main),oldXp=day.sleep?.xpAwarded||0,delta=Math.max(0,newXp-oldXp);
  day.sleep={mainHours:main,napHours:nap,xpAwarded:Math.max(oldXp,newXp),scoreXp:newXp,savedAt:Date.now()};
  if(delta)addXP(delta,'Sleep');else{persist();render()}
  updateHighestSleepStage();showMission('Sleep saved',`${main.toFixed(2)} h • ${newXp}/50 XP${nap?` • +${nap.toFixed(2)} h recovery`:''}`);
}
function bankExtraSauna(){save.saunaBank+=1;persist();render();showMission('Sauna credit banked','Completion credit +1 • 0 additional XP')}
function useSaunaBankToday(){
  const day=getDaily(),habit=DATA.habits.dailyHabits.find(h=>h.id==='sauna');if(day.habits.sauna?.completed){alert('Sauna is already completed today.');return}if(save.saunaBank<1){alert('No sauna completion credits are banked.');return}
  save.saunaBank-=1;day.habits.sauna={completed:true,xpAwarded:0,viaBank:true,completionValue:habit.xp,ts:Date.now()};persist();render();showMission('Sauna completion credit used','Today counts as complete • 0 XP (XP was only earned when the extra session happened)');
}
function calculateDayStatus(key=localDateKey()){
  const day=getDaily(key);let earned=0;const max=DATA.habits.dailyMaxXP;
  for(const h of DATA.habits.dailyHabits){
    if(h.id==='sleep'){earned+=day.sleep?.scoreXp||0;continue}
    const entry=day.habits[h.id];if(entry?.completed)earned+=entry.viaBank?(entry.completionValue||h.xp):(entry.xpAwarded||h.xp);
  }
  const controllable=DATA.habits.dailyHabits.filter(h=>h.id!=='sleep');
  const perfectRoutine=controllable.every(h=>day.habits[h.id]?.completed===true);
  const sleepHours=day.sleep?.mainHours||0;const perfectDay=perfectRoutine&&sleepHours>=8&&sleepHours<=9;
  const exceptionalDay=perfectDay&&(day.weeklyCreditsToday||0)>=DATA.habits.achievements.exceptionalDayWeeklyCredits;
  return {earned,max,discipline:max?earned/max:0,perfectRoutine,perfectDay,exceptionalDay};
}
function showMission(title,text){const d=document.querySelector('#missionDialog');document.querySelector('#missionDialogTitle').textContent=title;document.querySelector('#missionDialogText').textContent=text;if(!d.open)d.showModal()}

// ---------- weekly missions ----------
function logWeights(){
  const week=ensureCurrentWeek(),date=localDateKey();if(week.weights>=4){alert('Your 4 XP-bearing weights sessions are already complete this week.');return}if(week.weightDays.includes(date)){alert('A weights session has already been credited today.');return}
  week.weights++;week.weightDays.push(date);getDaily().weeklyCreditsToday+=1;addXP(100,'Gym Weight Lifting');showMission('Weights complete',`+100 XP • ${week.weights}/4 this week`);persist();render();
}
function logCardio(credits){
  const week=ensureCurrentWeek(),remaining=Math.max(0,4-week.cardio);const accepted=Math.min(credits,remaining);if(accepted<=0){alert('Your 4 cardio credits are already complete this week.');return}
  week.cardio+=accepted;week.cardioLog.push({date:localDateKey(),credits:accepted,type:credits===1?'finisher':'standalone'});getDaily().weeklyCreditsToday+=accepted;const xp=accepted*40;addXP(xp,'Incline Walk / StairMaster');showMission('Cardio complete',`+${xp} XP • ${week.cardio}/4 credits this week`);persist();render();
}
function logSport(){
  const week=ensureCurrentWeek();week.sportActual+=1;getDaily().weeklyCreditsToday+=1;
  if(week.sportDueRemaining>0)week.sportDueRemaining-=1;else save.sportBank+=1;
  addXP(50,'Sport / Outdoor Activity');showMission('Adventure complete',`+50 XP • ${sportProgressText(week)}`);persist();render();
}
function sportProgressText(week=ensureCurrentWeek()){
  const fulfilled=3-week.sportDueRemaining;return `${fulfilled}/3 weekly target • ${save.sportBank} banked`;
}

// ---------- sleep stats ----------
function sleepEntries(days=7){
  const today=parseDateKey(localDateKey()),arr=[];
  for(let i=days-1;i>=0;i--){const key=localDateKey(addDays(today,-i));const s=save.daily[key]?.sleep;if(s?.mainHours>0)arr.push({key,...s})}
  return arr;
}
function avg(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0}
function sleepStageForAverage(a){let stage=1;for(const s of DATA.habits.sleep.stages){if(a>=s.minAverage)stage=s.stage}return stage}
function stageRoman(n){return ['','I','II','III','IV','V'][n]||String(n)}
function updateHighestSleepStage(){
  const entries=sleepEntries(14);if(entries.length<14)return;
  const fourteenAvg=avg(entries.map(x=>x.mainHours));save.sleep.highestStage=Math.max(save.sleep.highestStage,sleepStageForAverage(fourteenAvg));persist();
}
function sleepSummary(){
  const seven=sleepEntries(7),sevenAvg=avg(seven.map(x=>x.mainHours)),stage=sleepStageForAverage(sevenAvg),fourteen=sleepEntries(14),recovery=seven.reduce((n,x)=>n+(x.napHours||0)+Math.max(0,x.mainHours-8),0),shortfall=seven.reduce((n,x)=>n+Math.max(0,8-x.mainHours),0);
  return {sevenAvg,stage,count:seven.length,recovery,shortfall,fourteenCount:fourteen.length};
}

// ---------- achievements/week stats ----------
function currentWeekDates(){const start=mondayOf();return Array.from({length:7},(_,i)=>localDateKey(addDays(start,i)))}
function currentWeekStatus(){
  const week=ensureCurrentWeek(),today=localDateKey(),elapsed=currentWeekDates().filter(k=>k<=today),statuses=elapsed.map(k=>calculateDayStatus(k));const avgDiscipline=statuses.length?avg(statuses.map(s=>s.discipline)):0;const routineDays=statuses.filter(s=>s.perfectRoutine).length;
  const perfectWeek=avgDiscipline>=.9&&week.weights>=4&&week.cardio>=4&&week.sportDueRemaining===0&&routineDays>=3;
  const ss=sleepSummary();const optimalSleepWeek=ss.count===7&&ss.sevenAvg>=8&&ss.sevenAvg<=9;
  return {week,avgDiscipline,routineDays,perfectWeek,optimalSleepWeek};
}

// ---------- render ----------
function renderHome(){
  const row=currentRow(),next=nextLevelRow();document.querySelector('#levelOrb').textContent=save.currentLevel;document.querySelector('#levelTitle').textContent=save.currentLevel?`Level ${save.currentLevel}`:'Level 0';document.querySelector('#storyBeat').textContent=row?.storyBeat||'Your journey is ready to begin.';document.querySelector('#bookLabel').textContent=row?`BOOK ${row.book} • ${row.bookName}`:'BEFORE HOGWARTS';
  const xpNeed=next?.xpRequired||0,inside=xpIntoCurrent(),pct=save.currentLevel>=168?100:Math.max(0,Math.min(100,(inside/xpNeed)*100));document.querySelector('#xpBar').style.width=`${pct}%`;document.querySelector('#xpText').textContent=save.currentLevel>=168?'Saga complete':`${inside.toLocaleString()} / ${xpNeed.toLocaleString()} XP`;document.querySelector('#checkpointText').textContent=row?`Checkpoint ${row.checkpoint}`:'Checkpoint 1';
  const owned=Object.keys(save.owned).length;document.querySelector('#ownedCount').textContent=`${owned} / ${DATA.collectibles.length}`;document.querySelector('#sagaPct').textContent=`${((save.currentLevel/168)*100).toFixed(1)}% saga`;
  const today=calculateDayStatus(),liveStreak=save.streak.current+(today.discipline>=.8&&!getDaily().finalized?1:0);document.querySelector('#todayScore').textContent=`${Math.round(today.discipline*100)}%`;document.querySelector('#todayXp').textContent=`${today.earned} / ${today.max} routine points`;document.querySelector('#streakText').textContent=`${liveStreak} 🔥`;document.querySelector('#bestStreakText').textContent=`Best ${Math.max(save.streak.best,liveStreak)}`;
  renderDailyHabits();renderSleep();renderWeekly();renderAchievements();
  const log=document.querySelector('#eventLog');log.innerHTML=save.eventLog.length?save.eventLog.slice(0,10).map(e=>`<div class="event">${escapeHtml(e.title)}<small>${e.level?`Level ${e.level}`:'Journey'} • ${new Date(e.ts).toLocaleDateString()}</small></div>`).join(''):'<p class="muted">No events yet.</p>';
}
function renderDailyHabits(){
  const day=getDaily(),list=document.querySelector('#dailyHabitList'),habits=DATA.habits.dailyHabits.filter(h=>h.input!=='sleep');let completed=0;
  list.innerHTML=habits.map(h=>{const entry=day.habits[h.id],done=entry?.completed;if(done)completed++;const sub=done?(entry.viaBank?'Completed with banked credit • 0 journey XP':`Completed • +${entry.xpAwarded} XP`):h.rule;return `<div class="habit-row ${done?'done':''}"><div class="habit-icon">${h.icon}</div><div class="habit-copy"><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(sub)}</small></div><div class="habit-xp">${h.xp}</div><button class="habit-action" data-habit="${h.id}" ${done?'disabled':''}>${done?'✓':'Complete'}</button></div>`}).join('');
  list.querySelectorAll('[data-habit]').forEach(b=>b.onclick=()=>completeHabit(b.dataset.habit));document.querySelector('#routineBadge').textContent=`${completed} / ${habits.length}`;document.querySelector('#todayDateLabel').textContent=prettyDate(localDateKey());
}
function renderSleep(){
  const day=getDaily(),s=day.sleep;if(document.activeElement!==document.querySelector('#sleepHours'))document.querySelector('#sleepHours').value=s?.mainHours??'';if(document.activeElement!==document.querySelector('#napHours'))document.querySelector('#napHours').value=s?.napHours??'';
  const preview=s?.scoreXp??sleepXP(document.querySelector('#sleepHours').value);document.querySelector('#sleepXpPreview').textContent=`${preview} / 50 XP`;const summary=sleepSummary();document.querySelector('#sleep7Day').textContent=summary.count?`7-day avg: ${summary.sevenAvg.toFixed(1)}h`:'7-day avg: —';document.querySelector('#sleepStage').textContent=`Current: Stage ${stageRoman(summary.stage)}`;document.querySelector('#sleepHighest').textContent=`Highest: Stage ${stageRoman(save.sleep.highestStage)}`;
}
function renderWeekly(){
  const week=ensureCurrentWeek();document.querySelector('#weekLabel').textContent=`${prettyDate(weekKey())} – ${weekEndFromKey(weekKey()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`;
  document.querySelector('#weeklyMissionList').innerHTML=`
    <div class="weekly-mission"><div><span>🏋️</span><strong>Gym Weight Lifting</strong><small>100 XP/session • no carryover</small></div><div class="weekly-progress"><b>${week.weights}/4</b><button id="logWeights" ${week.weights>=4?'disabled':''}>+ Session</button></div></div>
    <div class="weekly-mission"><div><span>🏃</span><strong>Incline Walk / StairMaster</strong><small>4 credits/week • finisher = 1 • standalone = 2</small></div><div class="weekly-progress"><b>${week.cardio}/4</b><div class="tiny-buttons"><button id="logCardio1" ${week.cardio>=4?'disabled':''}>+1</button><button id="logCardio2" ${week.cardio>=4?'disabled':''}>+2</button></div></div></div>
    <div class="weekly-mission"><div><span>⚽</span><strong>Sport / Outdoor Activity</strong><small>≥1 hour • every genuine activity earns 50 XP • surplus carries</small></div><div class="weekly-progress"><b>${3-week.sportDueRemaining}/3</b><button id="logSport">+ Activity</button><small>${save.sportBank} banked</small></div></div>`;
  document.querySelector('#logWeights').onclick=logWeights;document.querySelector('#logCardio1').onclick=()=>logCardio(1);document.querySelector('#logCardio2').onclick=()=>logCardio(2);document.querySelector('#logSport').onclick=logSport;
}
function renderAchievements(){
  const status=calculateDayStatus(),week=currentWeekStatus();const chips=[
    [status.discipline>=.8,'🔥','Discipline day',`${Math.round(status.discipline*100)}% / 80%`],
    [status.perfectRoutine,'⭐','Perfect Routine','All controllable missions'],
    [status.perfectDay,'🌟','Perfect Day','Routine + 8–9h sleep'],
    [status.exceptionalDay,'👑','Exceptional Day','Perfect + 2 weekly credits'],
    [week.perfectWeek,'🏆','Perfect Week','≥90% + weekly targets'],
    [week.optimalSleepWeek,'🌙','Optimal Sleep Week','7-day avg 8–9h']
  ];
  document.querySelector('#achievementStatus').innerHTML=chips.map(([ok,icon,name,detail])=>`<div class="achievement ${ok?'earned':''}"><span>${icon}</span><div><strong>${name}</strong><small>${detail}</small></div><b>${ok?'✓':'—'}</b></div>`).join('');
}
function renderJourney(){document.querySelector('#journeyList').innerHTML=DATA.levels.map(l=>{const cls=l.level<save.currentLevel?'done':l.level===save.currentLevel?'current':'locked';return `<div class="journey-level ${cls}"><div class="level-num">${l.level}</div><div><strong>${escapeHtml(l.storyBeat)}</strong><p>Book ${l.book}: ${escapeHtml(l.bookName)} • CP ${l.checkpoint}</p></div><span class="rarity ${cls==='done'?'Rare':''}">${cls==='done'?'✓':cls==='current'?'NOW':'🔒'}</span></div>`}).join('')}
function renderCollection(){
  const cat=document.querySelector('#categoryFilter').value,rar=document.querySelector('#rarityFilter').value,st=document.querySelector('#statusFilter').value;const cards=DATA.collectibles.filter(c=>(cat==='all'||c.category===cat)&&(rar==='all'||c.rarity===rar)&&(st==='all'||cardStatus(c)===st));
  document.querySelector('#collectionGrid').innerHTML=cards.map(c=>{const status=cardStatus(c),display=status==='locked'?'Locked collectible':visibleName(c);return `<article class="collectible ${status}"><span class="rarity ${c.rarity}">${c.rarity}</span><h4>${escapeHtml(display)}</h4><p>${escapeHtml(c.category)}</p><p>${status==='owned'?`Discovered Lv ${save.owned[c.id].discoveredLevel}`:status==='eligible'?`Eligible since Lv ${c.firstEligibleLevel}`:`Unlocks from Lv ${c.firstEligibleLevel}`}</p></article>`}).join('')||'<p class="muted">No collectibles match these filters.</p>';
}
function renderStats(){
  const status=currentWeekStatus(),ss=sleepSummary();document.querySelector('#lifetimeXp').textContent=save.totalXP.toLocaleString();document.querySelector('#statsBestStreak').textContent=`${Math.max(save.streak.best,save.streak.current)} days`;document.querySelector('#perfectRoutineCount').textContent=save.achievements.perfectRoutineDays;document.querySelector('#perfectDayCount').textContent=save.achievements.perfectDays;
  document.querySelector('#weekStats').innerHTML=`<p><span>Daily discipline average</span><strong>${Math.round(status.avgDiscipline*100)}%</strong></p><p><span>Weights</span><strong>${status.week.weights}/4</strong></p><p><span>Cardio</span><strong>${status.week.cardio}/4</strong></p><p><span>Sport/outdoor</span><strong>${3-status.week.sportDueRemaining}/3 (+${save.sportBank} bank)</strong></p><p><span>Perfect Routine Days</span><strong>${status.routineDays}</strong></p>`;
  document.querySelector('#sleepStats').innerHTML=`<p><span>7-day average</span><strong>${ss.count?ss.sevenAvg.toFixed(1)+' h':'—'}</strong></p><p><span>Current stage</span><strong>Stage ${stageRoman(ss.stage)}</strong></p><p><span>Highest achieved</span><strong>Stage ${stageRoman(save.sleep.highestStage)}</strong></p><p><span>Recovery sleep (7d)</span><strong>${ss.recovery.toFixed(1)} h</strong></p><p><span>Shortfall vs 8h baseline (7d)</span><strong>${ss.shortfall.toFixed(1)} h</strong></p>`;
}
function renderSettings(){document.querySelector('#saunaBankText').textContent=`${save.saunaBank} credit${save.saunaBank===1?'':'s'}`;document.querySelector('#sportBankSettings').textContent=`${save.sportBank} credit${save.sportBank===1?'':'s'} banked`;const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;document.querySelector('#installState').textContent=standalone?'Installed: running from your Home Screen in standalone mode.':'Browser mode: use Safari → Share → Add to Home Screen.'}
function render(){renderHome();renderJourney();renderCollection();renderStats();renderSettings()}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}

function setupUI(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));if(b.dataset.view==='collection')renderCollection();if(b.dataset.view==='stats')renderStats();if(b.dataset.view==='settings')renderSettings();window.scrollTo({top:0,behavior:'smooth'})});
  document.querySelector('#closeDialog').onclick=()=>document.querySelector('#levelDialog').close();document.querySelector('#closeMissionDialog').onclick=()=>document.querySelector('#missionDialog').close();
  ['categoryFilter','rarityFilter','statusFilter'].forEach(id=>document.querySelector(`#${id}`).onchange=renderCollection);const cats=[...new Set(DATA.collectibles.map(c=>c.category))];document.querySelector('#categoryFilter').innerHTML='<option value="all">All categories</option>'+cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  document.querySelector('#saveSleep').onclick=saveSleep;document.querySelector('#sleepHours').oninput=renderSleep;document.querySelector('#addSaunaBank').onclick=bankExtraSauna;document.querySelector('#useSaunaBank').onclick=useSaunaBankToday;
  document.querySelectorAll('[data-xp]').forEach(b=>b.onclick=()=>addXP(Number(b.dataset.xp),'Development tester'));
  document.querySelector('#exportSave').onclick=()=>{const blob=new Blob([JSON.stringify(save,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hp-fitness-rpg-save-${localDateKey()}.json`;a.click();URL.revokeObjectURL(a.href)};
  document.querySelector('#importSave').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{save=mergeState(JSON.parse(await f.text()));persist();ensureCurrentWeek();finalizePastDays();render();alert('Save imported.')}catch{alert('That save file could not be read.')}};
  document.querySelector('#resetSave').onclick=()=>{if(confirm('Reset ALL Harry Potter RPG and habit progress on this device?')){localStorage.removeItem(stateKey);localStorage.removeItem(legacyStateKey);save=defaultState();ensureCurrentWeek();persist();render()}};
}
function updateNetwork(){const b=document.querySelector('#networkBadge');b.textContent=navigator.onLine?'Online':'Offline ready';b.style.color=navigator.onLine?'#86efac':'#c4b5fd'}
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);

try{
  await loadData();ensureCurrentWeek();finalizePastDays();updateHighestSleepStage();setupUI();render();updateNetwork();persist();
}catch(err){console.error(err);const b=document.querySelector('#networkBadge');b.textContent='Load error';b.style.color='#fb7185';alert('The app data could not load. Please refresh while online.');}

if('serviceWorker' in navigator){
  window.addEventListener('load',async()=>{try{const reg=await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});await reg.update()}catch(err){console.warn('Service worker update failed',err)}});
}
