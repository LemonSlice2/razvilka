/* Системы: сохранение, звук и вибрация, усиления, заряды, случайные бонусы,
   достижения.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* ============================================================
   4. СОХРАНЕНИЕ — единственное место, знающее, где живут данные.
      Позже сюда встанет Telegram ID или сервер.
   ============================================================ */
const Store = (() => {
  const KEY = 'razvilka_save_v2', OLD = 'razvilka_save_v1';
  let memory = null, ok = true;
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); } catch(e){ ok = false; }

  // Облако Telegram: привязано к аккаунту, поэтому ходит между устройствами.
  // Локальное хранилище остаётся главным — оно синхронное и работает без сети.
  // Облако только догоняет: сетевой вызов на каждое автосохранение раз в пять
  // секунд был бы расточительством без всякой пользы.
  const PUSH_EVERY = 25000;        // не чаще раза в 25 секунд
  const REMOTE_TIMEOUT = 6000;     // столько ждём ответа, дальше играем от локального
  const VALUE_LIMIT = 4096;        // жёсткий предел Telegram на длину значения
  // Отправка заперта до тех пор, пока не сверились с облаком. Иначе локальный
  // сейв улетает наверх прямо на запуске и затирает прогресс другого устройства
  // ещё до того, как игрок увидел вопрос. Копится только pending.
  let pushAllowed = false;
  let remote = null, pending = null, pushTimer = null, lastPush = 0, pulledAt = 0;

  function push(json){
    if (!remote) return;
    // Молчаливая потеря сохранения хуже, чем его отсутствие: если перерастём
    // предел, это должно быть видно в консоли, а не проявиться через месяц.
    if (json.length > VALUE_LIMIT){
      console.warn('сейв не влезает в облако Telegram:', json.length, 'из', VALUE_LIMIT);
      return;
    }
    lastPush = Date.now();
    try { remote.set(KEY, json); } catch(e){}
  }

  function schedulePush(json){
    if (!remote) return;
    pending = json;
    if (!pushAllowed || pushTimer) return;
    const wait = Math.max(0, PUSH_EVERY - (Date.now() - lastPush));
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (pending){ push(pending); pending = null; }
    }, wait);
  }
  return {
    persistent: ok,
    load(){
      try {
        if (!ok) return memory;
        const cur = localStorage.getItem(KEY);
        if (cur) return JSON.parse(cur);
        const old = localStorage.getItem(OLD);      // перенос прогресса со старой версии
        if (old){
          const o = JSON.parse(old);
          return { legacy:0, runs:0, path:o.path, money:o.money||0,
                   owned:{}, totalEarned:o.money||0, focus:FOCUS_MAX, ts:o.ts||Date.now() };
        }
        return null;
      } catch(e){ return null; }
    },
    save(state){
      const json = JSON.stringify(state);
      memory = JSON.parse(json);
      if (ok){ try { localStorage.setItem(KEY, json); } catch(e){} }
      schedulePush(json);
    },
    clear(){
      memory = null;
      if (ok){ try { localStorage.removeItem(KEY); localStorage.removeItem(OLD); } catch(e){} }
      if (remote) try { remote.remove(KEY); } catch(e){}
    },

    /* ---------- облако ---------- */

    // Ставится из telegram.js. Снаружи Telegram остаётся null, и вся облачная
    // часть просто не включается.
    useRemote(api){ remote = api; },
    get hasRemote(){ return !!remote; },

    // Читает сохранение из облака. Всегда завершается: если Telegram не ответил
    // за REMOTE_TIMEOUT, отдаём null и играем от локального.
    pull(){
      if (!remote) return Promise.resolve(null);
      return new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done){ done = true; resolve(v); } };
        setTimeout(() => finish(null), REMOTE_TIMEOUT);
        try {
          remote.get(KEY, (err, value) => {
            pulledAt = Date.now();
            if (err || !value) return finish(null);
            try { finish(JSON.parse(value)); } catch(e){ finish(null); }
          });
        } catch(e){ finish(null); }
      });
    },

    // Открыть отправку. Зовётся из сверки с облаком, когда решение принято.
    allowPush(){
      if (pushAllowed) return;
      pushAllowed = true;
      if (pending) schedulePush(pending);
    },

    // Немедленная отправка: при уходе со страницы ждать нечего.
    // До сверки молчим — потерять одно сохранение не страшно, затереть чужой
    // прогресс страшно.
    pushNow(){ if (pushAllowed && pending){ push(pending); pending = null; } },

    // Для строчки состояния на вкладке «Капитал»: без неё непонятно,
    // работает облако или молча выключено, и это уже один раз стоило времени.
    cloudInfo(){ return { on: !!remote, lastPush, pulledAt }; }
  };
})();

/* ============================================================
   4b. ЗВУК И ВИБРАЦИЯ
   Звук синтезируется на месте — никаких файлов, игра остаётся одним файлом.
   ============================================================ */
const Settings = {
  data: { sound: true },
  load(){ try { const r = localStorage.getItem('razvilka_settings');
                if (r) this.data = { ...this.data, ...JSON.parse(r) }; } catch(e){} },
  save(){ try { localStorage.setItem('razvilka_settings', JSON.stringify(this.data)); } catch(e){} }
};
Settings.load();

const Sound = (() => {
  let ctx = null;
  function ensure(){
    // AudioContext можно создать только в ответ на действие человека
    if (!ctx){ try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol){
    if (!Settings.data.sound) return;
    const c = ensure(); if (!c) return;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    gain.gain.setValueAtTime(vol || .06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(); osc.stop(c.currentTime + dur);
  }
  return {
    wake: ensure,
    tap(pitch){ tone(220 + pitch * 260, .07, 'triangle', .05); },
    buy(){ tone(520, .09, 'sine', .07); setTimeout(() => tone(780, .12, 'sine', .06), 60); },
    bonus(){ [660, 880, 1170].forEach((f, i) => setTimeout(() => tone(f, .18, 'sine', .07), i * 70)); },
    rebirth(){ [330, 440, 550, 660].forEach((f, i) => setTimeout(() => tone(f, .35, 'sine', .07), i * 110)); }
  };
})();

function haptic(ms){
  // работает на Android; iOS Safari системную вибрацию из браузера не даёт
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch(e){} }
}

/* ============================================================
   4c. СЛУЧАЙНЫЕ БОНУСЫ
   Появляются сами, живут несколько секунд. Главный механизм удержания:
   человек держит игру открытой ради момента, который может случиться.
   ============================================================ */
const BONUS_TYPES = [
  { id:'kush',  glyph:'$', title:'Куш',
    text: n => `+${n}$`,
    apply(){ const amount = Math.max(perSecond() * 45, perTap() * 30) * (perk('videnie') ? 2 : 1);
             earn(amount); return fmt(amount) + '$'; } },
  { id:'kuraj', glyph:'!', title:'Кураж',
    apply(){ const d = perk('videnie') ? 2 : 1;
             addBuff('tap', 7, 25 * d); return '×7 к тапу'; } },
  { id:'veter', glyph:'~', title:'Попутный ветер',
    apply(){ const d = perk('videnie') ? 2 : 1;
             addBuff('income', 5, 30 * d); return '×5 к доходу'; } }
];

const BONUS_FIRST   = [40, 80];    // когда может появиться первый, секунд
const BONUS_EVERY   = [95, 190];   // интервал между следующими
const BONUS_LIFE    = 12;          // сколько секунд ждёт нажатия

let buffs = [];   // активные усиления живут только в текущей сессии
function addBuff(kind, mult, seconds){
  buffs.push({ kind, mult, until: Date.now() + seconds * 1000 });
}
function buffMult(kind){
  const now = Date.now();
  return buffs.filter(b => b.kind === kind && b.until > now)
              .reduce((m, b) => m * b.mult, 1);
}
function buffActive(kind){
  const now = Date.now();
  return buffs.some(b => b.kind === kind && b.until > now);
}

// Заряды тратятся тапами, а не временем — отдельный счётчик
let charges = { left: 0, mult: 1 };
function addCharges(count, mult){ charges = { left: count, mult }; }
function chargeMult(){ return charges.left > 0 ? charges.mult : 1; }
function spendCharge(){ if (charges.left > 0) charges.left--; }

/* Откат способности живёт в текущей сессии */
let abilityReadyAt = 0, abilityCooldown = 1;
function abilityLeft(){ return Math.max(0, (abilityReadyAt - Date.now()) / 1000); }

/* ============================================================
   4d. ДОСТИЖЕНИЯ
   Хранятся навсегда, перерождение их не сбрасывает.
   Каждое даёт небольшую постоянную прибавку — чтобы были не только галочкой.
   ============================================================ */
const ACH_BONUS = 0.02;   // +2% ко всему заработку за каждое

const ACHIEVEMENTS = [
  { id:'first_buy', name:'Первое вложение',   desc:'Купить любой апгрейд',
    test: () => Object.keys(S.owned).length > 0 },
  { id:'taps500',   name:'Набитая рука',      desc:'Сделать 500 тапов',
    test: () => S.stats.taps >= 500 },
  { id:'taps5k',    name:'Мозоль',            desc:'Сделать 5000 тапов',
    test: () => S.stats.taps >= 5000 },
  { id:'bonus1',    name:'Поймал',            desc:'Схватить первый бонус',
    test: () => S.stats.bonuses >= 1 },
  { id:'bonus25',   name:'Реакция',           desc:'Схватить 25 бонусов',
    test: () => S.stats.bonuses >= 25 },
  { id:'maxmult',   name:'Предел возможного', desc:'Прокачать множитель до упора',
    test: () => path().upgrades.some(u => u.type === 'mult' && owned(u.id) >= u.max) },
  { id:'mil',       name:'Первый миллион',    desc:'Заработать 1M за один забег',
    test: () => S.totalEarned >= 1e6 },
  { id:'bil',       name:'Девять нулей',      desc:'Заработать 1B за один забег',
    test: () => S.totalEarned >= 1e9 },
  { id:'rebirth1',  name:'Второй шанс',       desc:'Переродиться впервые',
    test: () => S.runs >= 1 },
  { id:'rebirth5',  name:'Круг замкнулся',    desc:'Переродиться 5 раз',
    test: () => S.runs >= 5 },
  { id:'allpaths',  name:'Все дороги',        desc:'Пройти хотя бы раз каждым путём',
    test: () => PATHS.every(p => S.stats.paths.includes(p.id)) },
  { id:'legacy50',  name:'Вес имени',         desc:'Накопить 50 очков влияния',
    test: () => S.legacyTotal >= 50 },
  { id:'mastery1',  name:'До конца',          desc:'Освоить любой путь целиком',
    test: () => S.mastered.length >= 1 },
  { id:'masteryAll',name:'Полное собрание',   desc:'Освоить все пять путей',
    test: () => S.mastered.length >= PATHS.length }
];

function achMult(){ return 1 + (S ? S.achieved.length : 0) * ACH_BONUS; }

function checkAchievements(){
  if (!S || !S.path) return;
  for (const a of ACHIEVEMENTS){
    if (S.achieved.includes(a.id)) continue;
    let ok = false;
    try { ok = a.test(); } catch(e){}
    if (ok){ S.achieved.push(a.id); showToast(a); }
  }
}

let toastTimer = null;
function showToast(a){
  const old = document.getElementById('toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.innerHTML = `<div class="h">${a.note || 'Достижение · +' + Math.round(ACH_BONUS*100) + '% к заработку'}</div>
                 <div class="n">${a.name}</div>`;
  document.body.appendChild(t);
  Sound.buy();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3600);
}

