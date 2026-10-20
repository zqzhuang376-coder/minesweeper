import { Minesweeper } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const levels = {
  easy: { name:'初级', rows:9, cols:9, mines:10 },
  medium: { name:'中级', rows:16, cols:16, mines:40 },
  hard: { name:'高级', rows:16, cols:30, mines:99 },
};
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const readSaved = (key, fallback) => {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; }
};
const writeSaved = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
let level = readSaved('fangcun-level', 'easy');
if (!levels[level]) level = 'easy';
let records = readSaved('fangcun-records', {});
if (!records || typeof records !== 'object' || Array.isArray(records)) records = {};
let soundOn = readSaved('fangcun-sound', false) === true;
let game, mode = 'reveal', startedAt = 0, elapsed = 0, timerInterval, resultTimeout, explodedIndex = -1;
let audio, focusedIndex = 0, longPressTimer, pointerStart, suppressClickUntil = 0, touchFlagged = false, touchIndex = -1;

function playSound(kind) {
  if (!soundOn) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const notes = { reveal:[600], flag:[420,600], lost:[180,120], won:[523,659,784,1047] }[kind] || [600];
    notes.forEach((hz,i) => {
      const osc = audio.createOscillator(), gain = audio.createGain(), time = audio.currentTime + i * .11;
      osc.type = 'sine'; osc.frequency.setValueAtTime(hz,time);
      gain.gain.setValueAtTime(0,time); gain.gain.linearRampToValueAtTime(.06,time+.012); gain.gain.exponentialRampToValueAtTime(.001,time+.14);
      osc.connect(gain); gain.connect(audio.destination); osc.start(time); osc.stop(time+.16);
    });
  } catch {}
}

function updateSoundButton() {
  $('#sound-toggle').innerHTML = icon(soundOn ? 'sound' : 'mute');
  $('#sound-toggle').setAttribute('aria-pressed', String(soundOn));
  $('#sound-toggle').setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
  $('#sound-toggle').title = soundOn ? '关闭音效' : '开启音效';
}
function updateBest() {
  const value = records[level];
  $('#best-time').innerHTML = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value}<span> 秒</span>` : '等你创造 <span>↗</span>';
}
function setMode(nextMode) {
  mode = nextMode;
  for (const value of ['reveal','flag']) {
    $(`#${value}-mode`).classList.toggle('active',mode===value);
    $(`#${value}-mode`).setAttribute('aria-pressed',String(mode===value));
  }
}
function updateTimer() {
  if (game.status === 'playing') elapsed = Math.floor((performance.now()-startedAt)/1000);
  $('#timer').textContent = String(Math.min(elapsed,999)).padStart(3,'0');
  $('#timer').title = `已用时 ${elapsed} 秒`;
}
function newGame(nextLevel = level) {
  clearInterval(timerInterval); clearTimeout(resultTimeout); clearTimeout(longPressTimer);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  level = nextLevel;
  writeSaved('fangcun-level',level);
  const config = levels[level];
  game = new Minesweeper(config.rows, config.cols, config.mines);
  elapsed = 0; startedAt = 0; explodedIndex = -1; focusedIndex = 0;
  suppressClickUntil = 0; touchFlagged = false; touchIndex = -1; pointerStart = null;
  setMode('reveal'); updateTimer(); updateBest();
  $('#board-mode-label').textContent = `${config.name} · ${config.cols} × ${config.rows}`;
  $('#board').style.setProperty('--cols',config.cols);
  if (level !== 'easy') $('#board').style.setProperty('--cell-size',level==='hard'?'28px':'29px');
  else $('#board').style.removeProperty('--cell-size');
  $('#board').setAttribute('aria-rowcount',config.rows);
  $('#board').setAttribute('aria-colcount',config.cols);
  $('#board').setAttribute('aria-label',`${config.name}扫雷棋盘，${config.rows} 行 ${config.cols} 列，${config.mines} 颗地雷`);
  const fragment = document.createDocumentFragment();
  game.cells.forEach((_,i) => {
    const cell = document.createElement('button');
    cell.type='button'; cell.className='cell'; cell.dataset.index=i;
    cell.setAttribute('role','gridcell'); cell.setAttribute('aria-rowindex',Math.floor(i/config.cols)+1); cell.setAttribute('aria-colindex',i%config.cols+1);
    cell.tabIndex=i===0?0:-1; fragment.appendChild(cell);
  });
  $('#board').replaceChildren(fragment);
  $('#board-scroll').scrollLeft=0;
  document.querySelectorAll('[data-level]').forEach(button => {
    button.classList.toggle('selected',button.dataset.level===level);
    button.setAttribute('aria-pressed',String(button.dataset.level===level));
  });
  render();
}

function render() {
  const ended = game.status==='lost' || game.status==='won';
  const config = levels[level];
  const buttons = $('#board').children;
  game.cells.forEach((cell,i) => {
    const button=buttons[i], showMine=ended && cell.mine && !cell.flagged, wrongFlag=game.status==='lost' && cell.flagged && !cell.mine;
    button.className = ['cell',cell.revealed?'revealed':'',cell.flagged?'flagged':'',showMine?'mine':'',wrongFlag?'wrong-flag':'',i===explodedIndex?'exploded':'',ended?'game-ended':''].filter(Boolean).join(' ');
    button.dataset.number=cell.revealed&&!cell.mine?cell.adjacent:'';
    const markup=cell.flagged?icon('flag'):showMine || cell.revealed&&cell.mine?icon('mine'):cell.revealed&&cell.adjacent?String(cell.adjacent):'';
    if(button.innerHTML!==markup) button.innerHTML=markup;
    const label=wrongFlag?'错误的旗子':cell.flagged?'已插旗':showMine||cell.revealed&&cell.mine?'地雷':cell.revealed?(cell.adjacent?`周围 ${cell.adjacent} 颗地雷`:'空白'):'未翻开';
    button.setAttribute('aria-label',`第 ${Math.floor(i/config.cols)+1} 行，第 ${i%config.cols+1} 列，${label}`);
    button.setAttribute('aria-disabled',String(ended));
  });
  const remaining=config.mines-game.flaggedCount;
  $('#mine-counter').textContent=remaining<0?`-${String(Math.abs(remaining)).padStart(2,'0')}`:String(remaining).padStart(3,'0');
  const safe=config.rows*config.cols-config.mines;
  $('#progress-text').textContent=`${game.revealedCount} / ${safe}`;
  $('#progress-bar').style.width=`${game.revealedCount/safe*100}%`;
  $('#status-line').className=`status-line ${game.status}`;
  $('#status-text').textContent={
    ready:'准备好了，点一格开始吧',
    playing:mode==='flag'?'插旗模式：点一下，标记你的判断':'慢慢来，每个数字都是线索',
    won:'全部找到！这局，漂亮。',
    lost:'碰到地雷了。下一局，再试试。'
  }[game.status];
  $('#mouth').setAttribute('d',game.status==='lost'?'M15 30q7-8 14 0':game.status==='won'?'M14 24q8 12 16 0Z':'M15 25q7 8 14 0');
}

function act(index,action='reveal') {
  if (game.status==='lost'||game.status==='won') return;
  const before=game.status;
  const result=action==='flag'?game.toggleFlag(index):game.cells[index].revealed?game.chord(index):game.reveal(index);
  if (!result.changed) return;
  if (before==='ready' && game.status!=='ready') {
    startedAt=performance.now();
    timerInterval=setInterval(updateTimer,250);
  }
  if (game.status==='lost'||game.status==='won') {
    elapsed=Math.floor((performance.now()-startedAt)/1000);
    clearInterval(timerInterval); updateTimer();
    if (game.status==='lost') explodedIndex=game.cells.findIndex(cell=>cell.mine&&cell.revealed);
    const win=game.status==='won';
    const prior=records[level];
    const newRecord=win && (!(typeof prior==='number'&&Number.isFinite(prior)&&prior>=0) || elapsed<prior);
    if(newRecord){records[level]=elapsed;writeSaved('fangcun-records',records);updateBest();}
    playSound(game.status);
    resultTimeout=setTimeout(()=>showResult(win,newRecord),win?650:850);
  } else playSound(action==='flag'?'flag':'reveal');
  render();
}
function showResult(win,newRecord) {
  $('#result-dialog').classList.toggle('lost',!win);
  $('#result-icon').innerHTML=icon(win?'trophy':'sun');
  $('#result-eyebrow').textContent=win?'NICELY DONE':'ONE MORE LITTLE ADVENTURE';
  $('#result-title').textContent=win?'每一步，都算数。':'差一点，再来一局。';
  $('#result-message').textContent=win?'所有安全的方格，都被你找到了。':'这颗地雷先被你找到了，好运留给下一次。';
  $('#result-time').innerHTML=`${elapsed}<span> 秒</span>`;
  $('#result-level').textContent=levels[level].name;
  $('#record-message').hidden=!newRecord;
  $('#result-dialog').showModal();
}

$('#board').addEventListener('click',event=>{
  const cell=event.target.closest('[data-index]');
  if (!cell || (Number(cell.dataset.index)===touchIndex && performance.now()<suppressClickUntil)) return;
  focusCell(Number(cell.dataset.index),false);
  act(Number(cell.dataset.index),mode);
});
$('#board').addEventListener('contextmenu',event=>{
  event.preventDefault();
  clearTimeout(longPressTimer);
  const cell=event.target.closest('[data-index]');
  if(!cell)return;
  const index=Number(cell.dataset.index);
  if(pointerStart || event.pointerType==='touch' || event.pointerType==='pen'){
    if(touchFlagged || (index===touchIndex && performance.now()<suppressClickUntil))return;
    touchIndex=index;touchFlagged=true;suppressClickUntil=Infinity;
  }
  act(index,'flag');
});
$('#board').addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse')return;
  const cell=event.target.closest('[data-index]');
  if(!cell)return;
  clearTimeout(longPressTimer);
  touchFlagged=false;touchIndex=Number(cell.dataset.index);suppressClickUntil=0;
  pointerStart={x:event.clientX,y:event.clientY};
  longPressTimer=setTimeout(()=>{
    act(Number(cell.dataset.index),'flag');
    touchFlagged=true;suppressClickUntil=Infinity;
    longPressTimer=null;
  },450);
});
$('#board').addEventListener('pointermove',event=>{
  if(pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>8)clearTimeout(longPressTimer);
});
for(const event of ['pointerup','pointercancel','pointerleave']) $('#board').addEventListener(event,()=>{
  clearTimeout(longPressTimer);
  if(touchFlagged)suppressClickUntil=performance.now()+700;
  pointerStart=null;
});
function focusCell(index,moveFocus=true){
  const buttons=$('#board').children;
  if(buttons[focusedIndex])buttons[focusedIndex].tabIndex=-1;
  focusedIndex=index;buttons[index].tabIndex=0;
  if(moveFocus)buttons[index].focus();
}
$('#board').addEventListener('keydown',event=>{
  const cell=event.target.closest('[data-index]');if(!cell)return;
  const i=Number(cell.dataset.index),cols=game.cols;
  const destinations={ArrowUp:i>=cols?i-cols:i,ArrowDown:i+cols<game.cells.length?i+cols:i,ArrowLeft:i%cols>0?i-1:i,ArrowRight:i%cols<cols-1?i+1:i,Home:i-i%cols,End:i-i%cols+cols-1};
  if(event.key in destinations){event.preventDefault();focusCell(destinations[event.key]);}
  else if(event.key.toLowerCase()==='f'){event.preventDefault();act(i,'flag');}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();act(i,mode);}
});
$('#difficulty-options').addEventListener('click',event=>{const button=event.target.closest('[data-level]');if(button && button.dataset.level!==level)newGame(button.dataset.level);});
for(const id of ['restart','face-button','play-again'])$(`#${id}`).addEventListener('click',()=>newGame());
for(const value of ['reveal','flag'])$(`#${value}-mode`).addEventListener('click',()=>{setMode(value);render();});
for(const id of ['help-open','more-help'])$(`#${id}`).addEventListener('click',()=>$('#help-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
$('#sound-toggle').addEventListener('click',()=>{soundOn=!soundOn;writeSaved('fangcun-sound',soundOn);updateSoundButton();if(soundOn)playSound('flag');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateTimer();});
updateSoundButton();
newGame();
