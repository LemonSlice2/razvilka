/* Интерфейс: экраны, магазины, развилки, способность, тап, отрисовка.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* ============================================================
   7. ЭКРАНЫ
   ============================================================ */
const $ = id => document.getElementById(id);

function renderChoice(carry){
  const runs = carry ? carry.runs : 0;
  $('chooseTitle').textContent = runs > 0 ? 'Какой путь теперь?' : 'С чего начнёшь?';
  $('chooseLead').textContent = runs > 0
    ? 'Купленное в палате влияния остаётся навсегда. Деньги и всё нажитое в забеге — нет.'
    : 'Путь определяет, что приносит деньги. Дойдёшь до потолка — сможешь начать заново другим путём и потратить накопленное влияние.';

  const list = $('pathlist');
  list.innerHTML = '';
  for (const p of PATHS){
    const open = runs >= p.unlockAt;
    const b = document.createElement('button');
    b.className = 'path';
    b.style.setProperty('--pc', p.color);
    b.disabled = !open;
    const need = p.unlockAt - runs;
    b.innerHTML = `<img class="pic" src="img/path-${p.id}.webp" alt="" width="44" height="44">
      <div class="name">${p.name}</div>
      <div class="tag">${open ? p.tagline : 'Пока закрыт.'}</div>` +
      (open && (carry && carry.mastered || []).includes(p.id)
        ? `<div class="done">Освоен · ${MASTERY[p.id].name}</div>` : '') +
      (open ? '' : `<div class="lock">Откроется после ${p.unlockAt} ${plural(p.unlockAt,'перерождения','перерождений','перерождений')}
                    — осталось ${need}</div>`);
    if (open) b.addEventListener('click', () => start(freshRun(p.id, metaCarry || carry), 0));
    list.appendChild(b);
  }
}
function legacyMultOf(c){ return 1 + ((c && c.meta && c.meta.vliyanie) || 0) * REBIRTH_BONUS; }

/* Палата влияния живёт на экране выбора пути: пришёл с очками — потратил — пошёл дальше */
let metaCarry = null;

function renderMeta(carry){
  metaCarry = carry;
  const box = $('meta');
  renderMastery(carry);
  if (!carry || (!carry.legacy && !carry.legacyTotal)){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('metaBal').textContent = carry.legacy + ' ' + plural(carry.legacy,'очко','очка','очков');

  const list = $('metalist');
  list.innerHTML = '';
  for (const m of META){
    const lvl = carry.meta[m.id] || 0;
    const maxed = lvl >= m.max;
    const price = metaCost(m, lvl);
    const can = !maxed && carry.legacy >= price;

    const b = document.createElement('button');
    b.className = 'mrow' + (lvl ? ' has' : '');
    b.disabled = !can;
    b.innerHTML = `<div class="body">
        <div class="n">${m.name} ${lvl ? `<em>ур.${lvl}${m.max === Infinity ? '' : '/' + m.max}</em>` : ''}</div>
        <div class="d">${maxed ? m.desc(lvl) : (lvl ? m.desc(lvl) + ' · ' : '') + m.next(lvl)}</div>
      </div>
      <div class="price ${can ? '' : 'no'}">${maxed ? 'предел' : price}</div>`;
    if (can) b.addEventListener('click', () => buyMeta(m));
    list.appendChild(b);
  }
}

function renderMastery(carry){
  const box = $('mastery'), list = $('masterylist');
  const got = (carry && carry.mastered) || [];
  box.classList.toggle('hidden', got.length === 0);
  list.innerHTML = got.map(id => {
    const t = MASTERY[id]; if (!t) return '';
    return `<div class="trait"><span class="m">✦</span>
            <span><span>${t.name}</span><div class="d">${t.desc}</div></span></div>`;
  }).join('');
}

function buyMeta(m){
  const c = metaCarry;
  const lvl = c.meta[m.id] || 0;
  const price = metaCost(m, lvl);
  if (lvl >= m.max || c.legacy < price) return;
  c.legacy -= price;
  c.meta[m.id] = lvl + 1;
  Sound.wake(); Sound.buy(); haptic(16);
  Store.save({ ...c, path:null, money:0, owned:{}, perks:[], totalEarned:0, ts:Date.now() });
  renderMeta(c);
  renderChoice(c);
}

/* Всё, что живёт только в текущей сессии: усиления, заряды, откаты, таймеры.
   Нужно и при возврате к выбору пути, и при переходе на сейв с другого устройства. */
function resetSession(){
  buffs = [];
  charges = { left: 0, mult: 1 };
  abilityReadyAt = 0;
  pendingEvent = null;
  clearTimeout(bonusTimer);
  clearTimeout(eventTimer);
  document.querySelectorAll('.bonus').forEach(el => el.remove());
  $('eventcard').classList.add('hidden');
  $('buffline').innerHTML = '';
}

function showChoice(carry){
  S = null;
  resetSession();
  $('ability').classList.add('hidden');
  $('game').classList.add('hidden');
  $('choose').classList.remove('hidden');
  shopBuilt = false;
  renderMeta(carry);
  renderChoice(carry);
  if (carry) Store.save({ ...carryOf(carry), path:null, money:0, owned:{}, perks:[], totalEarned:0, ts:Date.now() });
}

function start(state, offlineEarned){
  S = state;
  document.documentElement.style.setProperty('--accent', path().color);
  $('choose').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('taplabel').textContent = path().tapLabel;

  const w = $('welcome');
  if (offlineEarned > 0){
    w.innerHTML = `Пока тебя не было, дело принесло <b>${fmt(offlineEarned)}$</b>.`;
    w.classList.remove('hidden');
    setTimeout(() => w.classList.add('hidden'), 6000);
  } else if (!Store.persistent){
    w.textContent = 'Прогресс сохраняется только на время сессии — открой файл напрямую в браузере, чтобы он сохранялся по-настоящему.';
    w.classList.remove('hidden');
  } else {
    w.classList.add('hidden');
  }
  abilityReadyAt = 0;
  charges = { left: 0, mult: 1 };
  const a = path().ability;
  $('ability').classList.toggle('hidden', !a);
  if (a){ $('abilityName').textContent = a.name; $('abilityDesc').textContent = a.desc; }

  Sound.resetMelody();
  buildShop();
  buildPerks();
  showPane('taps');
  draw();
  save();
  scheduleBonus(true);
  scheduleEvent(true);
}

/* Что апгрейд делает, числом. Люди жаловались, что «Бегает вместо тебя»
   не объясняет ничего: непонятно, доход это или тап и на сколько.
   Считается из тех же данных, что и сам эффект, поэтому разойтись не может. */
function effectText(u){
  if (u.type === 'income') return '+' + fmt(u.value) + '$/сек';
  if (u.type === 'mult')   return '×' + u.value + ' к тапу';
  return '+' + fmt(u.value) + ' к тапу';
}

let shopBuilt = false;
function buildShop(){
  const tapList = $('uplist-tap'), incList = $('uplist-income');
  tapList.innerHTML = ''; incList.innerHTML = '';
  for (const u of unlockedUpgrades()){
    const b = document.createElement('button');
    b.className = 'up';
    b.dataset.id = u.id;
    b.innerHTML = `<div class="body">
        <div class="n">${u.name} <em class="cnt"></em></div>
        <div class="d"><b>${effectText(u)}</b> · ${u.desc} <span class="cnt2"></span></div>
      </div><div class="cost"></div>`;
    b.addEventListener('click', () => buy(u));
    // множитель усиливает силу тапа, поэтому лежит вместе с тапом, а не отдельно
    (u.type === 'income' ? incList : tapList).appendChild(b);
  }
  shopBuilt = true;
}

function buildPerks(){
  const list = $('perklist');
  list.innerHTML = '';
  const ps = path().perks || [];
  $('perks').classList.toggle('hidden', ps.length === 0);
  for (const pk of ps){
    const b = document.createElement('button');
    b.className = 'perk';
    b.dataset.perk = pk.id;
    b.innerHTML = `<div class="body"><div class="n">${pk.name}</div>
                   <div class="d">${pk.desc}</div></div><div class="cost"></div>`;
    b.addEventListener('click', () => buyPerk(pk));
    list.appendChild(b);
  }
}

function buyPerk(pk){
  if (perk(pk.id) || S.money < pk.cost) return;
  S.money -= pk.cost;
  invest(pk.cost);
  S.perks.push(pk.id);
  Sound.rebirth(); haptic([16, 50, 24]);
  checkMastery();
  checkAchievements();
  draw(); save();
}

function buy(u){
  if (bought(u.id) >= u.max) return;
  const want = bulkAmount(u);
  const { n, cost } = costOfMany(u, want);
  if (n <= 0 || S.money < cost) return;
  S.money -= cost;
  invest(cost);
  S.owned[u.id] = bought(u.id) + n;
  Sound.buy(); haptic(14);
  checkAchievements();
  draw(); save();
}

/* Окно подтверждения внутри страницы. Системный confirm() не работает,
   когда игра открыта в песочнице (предпросмотр, встроенный фрейм). */
function ask(title, html, okLabel){
  return new Promise(resolve => {
    $('modalTitle').textContent = title;
    $('modalText').innerHTML = html;
    $('modalYes').textContent = okLabel;
    $('modal').classList.remove('hidden');
    const close = answer => {
      $('modal').classList.add('hidden');
      $('modalYes').onclick = null;
      $('modalNo').onclick = null;
      resolve(answer);
    };
    $('modalYes').onclick = () => close(true);
    $('modalNo').onclick  = () => close(false);
  });
}

/* Выбор из двух равнозначных вариантов. Возвращает 'a', 'b' или null. */
function choose(title, html, labelA, labelB){
  return new Promise(resolve => {
    $('modalTitle').textContent = title;
    $('modalText').innerHTML = html;
    $('modalYes').textContent = labelA;
    $('modalNo').textContent  = labelB;
    $('modalNo').classList.add('go');
    $('modal').querySelector('.row').classList.add('two');
    $('modal').classList.remove('hidden');
    const close = answer => {
      $('modal').classList.add('hidden');
      $('modalNo').classList.remove('go');
      $('modal').querySelector('.row').classList.remove('two');
      $('modalYes').onclick = null; $('modalNo').onclick = null;
      resolve(answer);
    };
    $('modalYes').onclick = () => close('a');
    $('modalNo').onclick  = () => close('b');
  });
}


/* ============================================================
   ВКЛАДКИ
   Развитие, тап и нажитое разведены по трём экранам: одним списком
   всё это приходилось листать, а тап уезжал наверх и терялся.
   ============================================================ */
let activePane = 'taps';

function showPane(name){
  activePane = name;
  for (const p of ['taps', 'profile', 'capital'])
    $('pane-' + p).classList.toggle('hidden', p !== name);
  document.querySelectorAll('#tabs .tab').forEach(t =>
    t.classList.toggle('is-on', t.dataset.pane === name));
  if (name === 'capital') renderCapital();
  if (name === 'profile') renderProfile();
  window.scrollTo(0, 0);
  draw();
}

document.querySelectorAll('#tabs .tab').forEach(t =>
  t.addEventListener('click', () => { Sound.wake(); haptic(8); showPane(t.dataset.pane); }));

/* ============================================================
   КАПИТАЛ — что нажито за этот забег.
   Список перестраивается при переходе на вкладку, а не каждый кадр:
   иначе перерисовка съедала бы кадры ради двух цифр.
   ============================================================ */
function capitalGain(u){
  const n = owned(u.id);
  if (u.type === 'mult')   return '×' + fmt(Math.pow(u.value, n));
  if (u.type === 'income') return '+' + fmt(u.value * n * legacyMult() * achMult()) + '$/сек';
  return '+' + fmt(u.value * n) + ' к основе';
}

function renderCapital(){
  if (!S || !S.path) return;
  const bought = unlockedUpgrades().filter(u => owned(u.id) > 0);
  const hands  = bought.filter(u => u.type !== 'income');
  const itself = bought.filter(u => u.type === 'income');
  const perks  = (path().perks || []).filter(pk => perk(pk.id));

  const group = (title, items, cls) => !items.length ? '' :
    `<div class="capgroup"><h3>${title}</h3>` + items.map(u =>
      `<div class="capline ${cls}">
         <span class="n">${u.name}</span>
         <span class="cnt">${owned(u.id)} ${plural(owned(u.id),'штука','штуки','штук')}</span>
         <span class="give">${capitalGain(u)}</span>
       </div>`).join('') + '</div>';

  $('capital').innerHTML =
    `<div class="capgroup">
       <h3>За всё время</h3>
       <div class="capsum life">
         <div class="box"><div class="k">Всего заработано</div><div class="v" id="capLifeEarned"></div></div>
         <div class="box"><div class="k">Вложено в развитие</div><div class="v" id="capLifeSpent"></div></div>
       </div>
       <div class="capnote" id="capRuns"></div>
       <div class="capnote" id="capCloud"></div>
     </div>
     <div class="capgroup">
       <h3>Этот забег</h3>
       <div class="capsum">
         <div class="box tap"><div class="k">Сила тапа</div><div class="v" id="capTap"></div></div>
         <div class="box inc"><div class="k">Доход</div><div class="v" id="capInc"></div></div>
       </div>
       <div class="capnote" id="capRun"></div>
     </div>`
    + group('Отдача от рук', hands, 'tap')
    + group('Работает само', itself, 'inc')
    + (perks.length
        ? `<div class="capgroup"><h3>Особое</h3>` + perks.map(pk =>
            `<div class="capline perk"><span class="n">${pk.name}</span>
             <span class="give">${pk.desc}</span></div>`).join('') + '</div>'
        : '')
    + (bought.length || perks.length ? ''
        : '<div class="capempty">Пока ничего не куплено. Всё, что купишь в развитии, соберётся здесь.</div>');

  drawCapitalTotals();
}

function drawCapitalTotals(){
  const t = $('capTap');
  if (!t) return;                      // вкладка ещё не строилась
  t.textContent = '+' + fmt(perTap() * focusMult()) + '$';
  $('capInc').textContent = '+' + fmt(perSecond()) + '$/сек';

  const st = S.stats;
  $('capLifeEarned').textContent = fmt(st.earnedTotal) + '$';
  $('capLifeSpent').textContent  = fmt(st.spentTotal) + '$';
  $('capRuns').textContent =
    `${S.runs} ${plural(S.runs,'перерождение','перерождения','перерождений')} · ` +
    `${fmt(st.taps)} ${plural(st.taps,'тап','тапа','тапов')} · ` +
    `${S.stats.paths.length} ${plural(S.stats.paths.length,'путь','пути','путей')} из ${PATHS.length}`;
  $('capRun').textContent =
    `Заработано ${fmt(S.totalEarned)}$ · в кармане ${fmt(S.money)}$`;

  const c = Store.cloudInfo();
  $('capCloud').textContent = !c.on
    ? 'Облако Telegram недоступно — прогресс только на этом устройстве'
    : c.lastPush
      ? 'Облако Telegram: отправлено ' + whenAgo(c.lastPush)
      : 'Облако Telegram: подключено, ещё не отправляли';
}


/* ============================================================
   ПРОФИЛЬ — кто ты, а не что нажил.
   Путь, черты освоенных путей, достижения, место в рейтинге.
   Нажитое живёт на соседней вкладке и сюда не дублируется.
   ============================================================ */
/* Кого сейчас смотрим. null — свой профиль. */
let viewingFoe = null;

function renderProfile(){
  if (!S || !S.path) return;
  if (viewingFoe) return renderFoe();
  const p = path();
  const traits = (S.mastered || []).map(id => MASTERY[id]).filter(Boolean);
  const done = S.achieved.length;

  const facts = [
    [fmt(powerOf()), 'сила'],
    [fmt(healthOf()), 'здоровье'],
    [combatRating(), 'боевой рейтинг'],
    [S.runs, plural(S.runs, 'перерождение', 'перерождения', 'перерождений')],
    ['×' + legacyMult().toFixed(2), 'влияние'],
    [S.stats.paths.length + '/' + PATHS.length, 'путей пройдено']
  ];

  $('profile').innerHTML =
    `<div class="gearstrip">` + GEAR.map(g => {
      const lvl = gearLevel(g.id), maxed = lvl >= GEAR_MAX;
      const busy = S.upgrade && S.upgrade.id === g.id;
      const need = maxed ? 0 : crystalsFor(lvl + 1);
      const can = canUpgrade(g.id);
      const bottom = maxed ? 'предел'
                   : busy  ? dur(upgradeLeft())
                   : need + ' ✦';
      return `<button class="gearcell${lvl ? ' has' : ''}${can ? ' can' : ''}${busy ? ' busy' : ''}"
                      data-gear="${g.id}" ${can ? '' : 'disabled'}>
          <img class="gi" src="img/gear-${g.id}.webp" alt="" width="38" height="38">
          <div class="lvl">${lvl ? 'ур. ' + lvl + '/' + GEAR_MAX : '—'}</div>
          <div class="gn">${g.name}</div>
          <div class="ge">${gearEffect(g)}</div>
          <div class="gp">${bottom}</div>
        </button>`;
    }).join('') + `</div>
     <div class="capnote gearnote">${gearHint()}</div>
     <button id="shopbtn"></button>
     <div id="shoppanel"></div>` +
    `<div class="pcard">
       <div class="pemblem" style="--pc:${p.color}"><img src="img/path-${p.id}.webp" alt="" width="46" height="46"></div>
       <div class="pwho">
         <div class="pname">${p.name}</div>
         <div class="ptag">${p.tagline}</div>
       </div>
     </div>
     <div class="pfacts">` +
       facts.map(([v, k]) => `<div class="pf"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('') +
     `</div>` +
     (traits.length
       ? `<div class="capgroup"><h3>Черты освоенных путей</h3>` + traits.map(t =>
           `<div class="trait"><span class="m">✦</span>
            <span><span>${t.name}</span><div class="d">${t.desc}</div></span></div>`).join('') + `</div>`
       : '') +
     `<div class="capgroup"><h3>Рейтинг</h3>
        <div class="shoptabs">
          <button class="shoptab${Rating.board === 'score' ? ' is-on' : ''}" data-board="score">По заработку</button>
          <button class="shoptab${Rating.board === 'bp' ? ' is-on' : ''}" data-board="bp">По боевым очкам</button>
        </div>${rankBoard(p)}</div>`;

  // Обновление асинхронное: рисуем что есть, а когда придёт свежее —
  // перерисовываем ещё раз. refresh() отдаёт false, если ничего не менялось,
  // поэтому в петлю это не сваливается.
  // панель могла быть открыта до перерисовки — состояние переживает её
  if (shopOpen) $('shoppanel').classList.add('open');
  document.querySelectorAll('#profile [data-foe]').forEach(b =>
    b.addEventListener('click', () => {
      const foe = (Rating.state.top || []).find(r => String(r.id) === b.dataset.foe);
      if (!foe) return;
      viewingFoe = foe; fightMsg = null;
      window.scrollTo(0, 0);
      renderProfile();
    }));
  document.querySelectorAll('#profile [data-board]').forEach(b =>
    b.addEventListener('click', () => {
      if (Rating.setBoard(b.dataset.board)) renderProfile();
    }));

  renderShop();
  $('shopbtn').addEventListener('click', () => {
    shopOpen = !shopOpen;
    $('shoppanel').classList.toggle('open', shopOpen);
    renderShop();
  });
  document.querySelectorAll('#profile .gearcell').forEach(b =>
    b.addEventListener('click', () => tapGear(b.dataset.gear)));

  Rating.refresh().then(changed => {
    if (changed && activePane === 'profile') renderProfile();
  });
}

/* Что вещь даёт сейчас и что добавит следующий уровень.
   «Разговор становится короче» не объясняет ничего — люди спрашивали. */
function gearEffect(g){
  const lvl = gearLevel(g.id);
  const parts = [];
  if (g.power)  parts.push((g.power  * lvl) + ' силы');
  if (g.health) parts.push((g.health * lvl) + ' здоровья');
  return lvl ? parts.join(' · ') : (g.power ? '+' + g.power + ' силы' : '') +
         (g.power && g.health ? ' · ' : '') + (g.health ? '+' + g.health + ' здоровья' : '');
}

/* Подсказка под полосой вещей: что происходит прямо сейчас.
   Без неё непонятно ни почему кнопки серые, ни сколько ждать. */
function gearHint(){
  if (S.upgrade){
    const g = GEAR.find(x => x.id === S.upgrade.id);
    return `${g.name} улучшается до ${S.upgrade.to} уровня · осталось ${dur(upgradeLeft())}. ` +
           'Одновременно идёт одно улучшение.';
  }
  const cheapest = GEAR.filter(g => gearLevel(g.id) < GEAR_MAX)
    .map(g => crystalsFor(gearLevel(g.id) + 1)).sort((a, b) => a - b)[0];
  if (cheapest === undefined) return 'Все вещи докачаны до предела.';
  if (S.crystals < cheapest)
    return `Кристаллов: ${S.crystals}. На ближайшее улучшение нужно ${cheapest} — купи в магазине за влияние.`;
  return `Кристаллов: ${S.crystals}. Жми на вещь, чтобы начать улучшение. ` +
         'Сила и здоровье идут в боевой рейтинг, на доход и тап не влияют.';
}

/* Отсчёт обновляется точечно: перерисовывать весь профиль каждый кадр
   ради двух строк — расточительство, да и клики бы срывались. */
function drawGearTimer(){
  const cell = document.querySelector(`#profile .gearcell[data-gear="${S.upgrade.id}"] .gp`);
  if (cell) cell.textContent = dur(upgradeLeft());
  const hint = $('profile').querySelector('.gearnote');
  if (hint) hint.textContent = gearHint();
}

function tapGear(id){
  if (!startUpgrade(id)) return;
  Sound.buy(); haptic(16);
  renderProfile(); draw(); save();
}

/* ============================================================
   МАГАЗИН
   Пока одна вкладка. Вкладки заведены сразу, потому что туда
   лягут другие расходники, и переделывать разметку не придётся.
   ============================================================ */
const SHOP_PACKS = [1, 5, 25];
let shopOpen = false;

function renderShop(){
  const open = $('shoppanel').classList.contains('open');
  $('shopbtn').innerHTML = `Магазин · кристаллов <b>${S.crystals}</b>`;
  if (!open) return;

  $('shoppanel').innerHTML =
    `<div class="shoptabs"><button class="shoptab is-on">Расходники</button></div>
     <div class="capnote">Кристалл улучшения — ${CRYSTAL_PRICE} влияния. У тебя ${S.legacy} ${plural(S.legacy,'очко','очка','очков')}.</div>` +
    SHOP_PACKS.map(n => {
      const price = crystalPrice(n);
      const can = S.legacy >= price;
      return `<button class="mrow" data-crystals="${n}" ${can ? '' : 'disabled'}>
          <div class="body">
            <div class="n">${n} ${plural(n,'кристалл','кристалла','кристаллов')} ✦</div>
            <div class="d">Тратятся на уровни вещей</div>
          </div>
          <div class="price ${can ? '' : 'no'}">${price}</div>
        </button>`;
    }).join('');

  document.querySelectorAll('#shoppanel [data-crystals]').forEach(b =>
    b.addEventListener('click', () => {
      if (!buyCrystals(Number(b.dataset.crystals))) return;
      Sound.buy(); haptic(16);
      renderProfile(); renderShop(); draw(); save();
    }));
}



const RANK_NOTE = {
  'not-configured': 'Общий рейтинг ещё не подключён — пока здесь только твой результат.',
  'no-telegram':    'Общий рейтинг работает только внутри Telegram: там игра знает, кто ты.',
  'bad-signature':  'Сервер не признал подпись. Обычно это значит, что токен бота на сервере устарел — его отозвали в BotFather, а на сервер положили старый.',
  'error':          'Сервер рейтинга не отвечает. Попробуй позже, на игру это не влияет.'
};

/* ============================================================
   ДРАКА
   Исход считает сервер. Клиент только отправляет вызов и показывает,
   что вышло — иначе побеждали бы все.
   ============================================================ */
/* Профиль выбранного соперника. Данные берутся из таблицы лидеров —
   она уже отдаёт силу, здоровье и очки, так что отдельной ручки не нужно. */
function renderFoe(){
  const f = viewingFoe;
  const mine = Rating.state.me || {};
  const myBp = Math.round(mine.bp || 1000);
  const iAmHim = String(f.id) === String(mine.id);
  const stat = (v, k) => '<div class="pf"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
  const pathName = f.path ? ((PATHS.find(p => p.id === f.path) || {}).name || '') : '';
  const runsText = f.runs ? ' · ' + f.runs + ' ' + plural(f.runs, 'перерождение', 'перерождения', 'перерождений') : '';

  $('profile').innerHTML =
    '<button id="foeback" class="shoptab">← Назад к рейтингу</button>' +
    '<div class="pcard">' +
      '<div class="pemblem" style="--pc:var(--legacy)">' + escapeText(f.name).charAt(0) + '</div>' +
      '<div class="pwho">' +
        '<div class="pname">' + escapeText(f.name) + '</div>' +
        '<div class="ptag">' + pathName + runsText + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="pfacts">' +
      stat(fmt(f.power), 'сила') +
      stat(fmt(f.health), 'здоровье') +
      stat(Math.round(f.bp), 'боевые очки') +
      stat(fmt(f.score) + '$', 'заработано') +
      stat(fmt(powerOf()), 'твоя сила') +
      stat(myBp, 'твои очки') +
    '</div>' +
    '<div class="capgroup"><h3>Драка</h3>' + foeFightBox(f, iAmHim) + '</div>';

  $('foeback').addEventListener('click', () => { viewingFoe = null; fightMsg = null; renderProfile(); });
  const atk = $('profile').querySelector('#attackbtn');
  if (atk) atk.addEventListener('click', () => doAttack(f.id));
}

function foeFightBox(f, iAmHim){
  const msg = fightMsg
    ? '<div class="fightmsg' + (fightMsg.bad ? ' bad' : '') + '">' + escapeText(fightMsg.text) + '</div>'
    : '';
  if (iAmHim) return '<div class="capnote">Это ты. На себя не нападёшь.</div>';
  if (!powerOf())
    return '<div class="capnote">Драться нечем. Улучши любую вещь — сила появится.</div>' + msg;

  // Слабого бить не запрещено, но и смысла нет: очков почти не дадут.
  // Запрет сделал бы выгодным вообще не покупать оружие.
  const mine = powerOf() * Math.sqrt(healthOf() / 100);
  const his  = f.power * Math.sqrt(Math.max(1, f.health) / 100);
  const weak = his < mine * 0.5
    ? '<div class="capnote">Он заметно слабее — за такую победу очков дадут почти нисколько.</div>'
    : '';

  return '<button id="attackbtn"' + (fightBusy ? ' disabled' : '') + '>' +
         (fightBusy ? 'Дерусь…' : 'Напасть') + '</button>' + weak + msg;
}

let fightBusy = false, fightMsg = null;

async function doAttack(targetId){
  if (fightBusy) return;
  fightBusy = true; fightMsg = null;
  renderProfile();

  const r = await Rating.attack(targetId);
  fightBusy = false;
  if (r.error){
    fightMsg = { text: r.error, bad: true };
  } else {
    fightMsg = { bad: !r.win, text:
      (r.win ? 'Победа за ' : 'Поражение за ') + r.rounds + ' ' +
      plural(r.rounds, 'раунд', 'раунда', 'раундов') +
      (r.win ? ', осталось ' + r.left + ' здоровья' : '') +
      ' · ' + (r.delta >= 0 ? '+' : '') + r.delta + ' очков, стало ' + Math.round(r.bp) };
    Sound.bonus(); haptic(r.win ? [16, 50, 24] : [30]);
  }
  renderProfile();
}

function rankBoard(p){
  const st = Rating.state;
  const mine = `<div class="rankrow me">
      <span class="place">${(st.me && st.me.place) || '—'}</span>
      <span class="who">Ты · ${p.name}</span>
      <span class="score">${Rating.board === 'bp'
        ? Math.round((Rating.state.me && Rating.state.me.bp) || 1000) + ' очк.'
        : fmt(S.stats.earnedTotal) + '$'}</span>
    </div>`;

  if (st.status !== 'ok')
    return mine + `<div class="capnote">${RANK_NOTE[st.status] || RANK_NOTE['error']}</div>`;

  const meId = st.me && st.me.id;
  const rows = st.top.map(r => `
    <button class="rankrow${r.id === meId ? ' me' : ''}" data-foe="${r.id}">
      <span class="place">${r.place}</span>
      <span class="who">${escapeText(r.name)}</span>
      <span class="score">${Rating.board === 'bp' ? Math.round(r.bp) + ' очк.' : fmt(r.score) + '$'}</span>
    </button>`).join('');

  // своя строка отдельно, если в двадцатку не попал
  const outside = meId && !st.top.some(r => r.id === meId) ? mine : '';
  return rows + outside +
    `<div class="capnote">Всего игроков: ${st.total}. Считается по заработанному за всё время.</div>`;
}

/* Имена приходят с сервера, то есть их пишут другие люди. В разметку они
   попадают только через это — иначе кто-нибудь назовётся тегом. */
function escapeText(s){
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ---------- перерождение ---------- */
async function doRebirth(){
  const pts = pendingPoints();
  if (pts < REBIRTH_MIN) return;
  const nextRuns = S.runs + 1;
  const opening = PATHS.find(p => p.unlockAt === nextRuns);

  const body = `Ты получишь <b>+${pts} ${plural(pts,'очко','очка','очков')} влияния</b>
      и сможешь потратить их в палате влияния перед следующим забегом.<br><br>
      Деньги, апгрейды и текущий путь исчезнут.`
    + (opening ? `<br><br>Откроется новый путь: <b>${opening.name}</b>.` : '');

  if (!await ask('Начать сначала?', body, 'Начать')) return;
  Sound.rebirth(); haptic([20, 60, 20, 60, 40]);
  showChoice({ ...carryOf(S),
               legacy: S.legacy + pts,
               legacyTotal: S.legacyTotal + pts,
               runs: nextRuns });
}

/* ---------- развилки ---------- */
let pendingEvent = null, eventTimer = null;

function scheduleEvent(first){
  clearTimeout(eventTimer);
  eventTimer = setTimeout(spawnEvent, eventDelaySec(first) * 1000);
}

function spawnEvent(){
  if (!S || !S.path || pendingEvent){ scheduleEvent(false); return; }
  const pool = EVENTS[S.path] || [];
  if (!pool.length) return;

  // Одна и та же развилка дважды за забег обесценивает их все. Когда новые
  // кончились — начинаем круг заново, но это уже поздняя стадия забега.
  if (!S.seen) S.seen = [];
  let fresh = pool.filter((_, i) => !S.seen.includes(i));
  if (!fresh.length){ S.seen = []; fresh = pool; }

  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  S.seen.push(pool.indexOf(pick));
  pendingEvent = pick;
  $('eventHint').textContent = pendingEvent.text;
  $('eventcard').classList.toggle('lasting', !!pendingEvent.lasting);
  $('eventcard').querySelector('.h').textContent =
    pendingEvent.lasting ? 'Развилка · на весь забег' : 'Развилка';
  $('eventcard').classList.remove('hidden');
  Sound.bonus(); haptic([10, 60, 10]);
}

async function openEvent(){
  if (!pendingEvent) return;
  const ev = pendingEvent;
  const warn = ev.lasting
    ? '<br><br><b>Решение действует до конца забега.</b> Перерождение его снимет.'
    : '';
  const pick = await choose('Развилка', ev.text + warn, ev.a.label, ev.b.label);
  if (pick === null) return;                    // передумал — карточка остаётся
  pendingEvent = null;
  $('eventcard').classList.add('hidden');
  const result = (pick === 'a' ? ev.a : ev.b).run();
  showToast({ name: result, note: 'Решение принято' });
  draw(); save();
  scheduleEvent(false);
}
$('eventcard').addEventListener('click', openEvent);

/* ---------- особая способность ---------- */
function useAbility(){
  if (!S || !S.path || abilityLeft() > 0) return;
  const a = path().ability;
  if (!a) return;
  const result = a.run();
  if (mastered('order') && charges.left <= 0) addCharges(6, 5);
  const cd = abilityCooldownSec();
  abilityReadyAt = Date.now() + cd * 1000;
  abilityCooldown = cd;
  Sound.bonus(); haptic([14, 45, 22]);

  const g = document.createElement('div');
  g.className = 'grab';
  g.textContent = result;
  const r = $('ability').getBoundingClientRect();
  g.style.left = Math.max(12, r.left + 14) + 'px';
  g.style.top  = r.top + 'px';
  document.body.appendChild(g);
  setTimeout(() => g.remove(), 1400);
  draw();
}
$('ability').addEventListener('click', useAbility);

/* ---------- появление и сбор бонусов ---------- */
let bonusTimer = null;

function scheduleBonus(first){
  clearTimeout(bonusTimer);
  bonusTimer = setTimeout(spawnBonus, bonusDelaySec(first) * 1000);
}

function spawnBonus(){
  if (!S || !S.path || !$('modal').classList.contains('hidden')) { scheduleBonus(false); return; }

  const type = BONUS_TYPES[Math.floor(Math.random() * BONUS_TYPES.length)];
  const el = document.createElement('button');
  el.className = 'bonus';
  el.textContent = type.glyph;
  el.setAttribute('aria-label', 'Бонус: ' + type.title);
  el.style.left = (8 + Math.random() * 70) + '%';
  el.style.top  = (26 + Math.random() * 42) + '%';

  let taken = false;
  const collect = e => {
    if (taken) return; taken = true;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const result = type.apply();
    S.stats.bonuses++;
    Sound.bonus(); haptic([12, 40, 18]);

    const g = document.createElement('div');
    g.className = 'grab';
    g.textContent = type.title + ': ' + result;
    g.style.left = Math.max(10, r.left - 40) + 'px';
    g.style.top  = r.top + 'px';
    document.body.appendChild(g);
    setTimeout(() => g.remove(), 1000);

    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
    draw();
    scheduleBonus(false);
  };
  el.addEventListener('touchstart', collect, {passive:false});
  el.addEventListener('mousedown', collect);

  document.body.appendChild(el);
  setTimeout(() => {
    if (taken) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
    scheduleBonus(false);
  }, BONUS_LIFE * (perk('apparat') ? 2.5 : 1) * 1000);
}

/* ---------- тап ---------- */
function doTap(x, y){
  let critMult = 1;
  if (perk('krysha') && Math.random() < 0.15) critMult = 8;
  else if (mastered('street') && Math.random() < 0.05) critMult = 4;
  const crit = critMult > 1;
  const gain = perTap() * focusMult() * critMult;
  earn(gain);
  spendFocus();
  spendCharge();

  // высота щелчка падает вместе с концентрацией — слышно, когда пора передохнуть
  Sound.tap(S.focus / FOCUS_MAX, path().melody);
  haptic(8);
  S.stats.taps++;

  const f = document.createElement('div');
  f.className = 'float' + (crit ? ' crit' : '');
  f.textContent = (crit ? '×' + critMult + '  +' : '+') + fmt(gain);
  const zone = $('tapzone').getBoundingClientRect();
  f.style.left = (x - zone.left - 14 + (Math.random()*20 - 10)) + 'px';
  f.style.top  = (y - zone.top - 20) + 'px';
  $('tapzone').appendChild(f);
  setTimeout(() => f.remove(), 720);

  const btn = $('tap');
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 70);
  draw();
}
const tapBtn = $('tap');
tapBtn.addEventListener('touchstart', e => {
  e.preventDefault();
  Sound.wake();
  for (const t of e.changedTouches) doTap(t.clientX, t.clientY);
}, {passive:false});
tapBtn.addEventListener('mousedown', e => { if (e.button === 0) doTap(e.clientX, e.clientY); });
$('rebirth').addEventListener('click', doRebirth);

function drawSound(){
  const b = $('sound');
  b.textContent = Settings.data.sound ? 'Звук вкл' : 'Звук выкл';
  b.classList.toggle('on', Settings.data.sound);
}
$('sound').addEventListener('click', () => {
  Settings.data.sound = !Settings.data.sound;
  Settings.save(); drawSound();

  if (Settings.data.sound){ Sound.wake(); Sound.buy(); }
});
drawSound();

$('bulk').addEventListener('click', () => {
  bulkIndex = (bulkIndex + 1) % BULK_MODES.length;
  const m = BULK_MODES[bulkIndex];
  $('bulk').textContent = m === 'max' ? 'макс' : '×' + m;
  draw();
});

$('achbtn').addEventListener('click', () => {
  $('achlist').classList.toggle('open');
  drawAchievements();
});

function drawAchievements(){
  if (!S) return;
  const got = S.achieved.length;
  $('achbtn').innerHTML = `Достижения <b>${got}/${ACHIEVEMENTS.length}</b> · +${Math.round(got*ACH_BONUS*100)}% к заработку`;
  if (!$('achlist').classList.contains('open')) return;
  $('achlist').innerHTML = ACHIEVEMENTS.map(a => {
    const done = S.achieved.includes(a.id);
    return `<div class="ach ${done ? 'done' : 'locked'}">
      <span class="mark">${done ? '✦' : '·'}</span>
      <span><span>${a.name}</span><div class="d">${a.desc}</div></span>
    </div>`;
  }).join('');
}

/* ---------- цикл ---------- */
let last = performance.now();
function loop(now){
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (S && S.path){
    earn(perSecond() * dt);
    // автотапы концентрацию не тратят, иначе перк душил бы сам себя
    const autoTaps = (perk('avtomat') ? 3 : 0) + (mastered('science') ? 1 : 0);
    if (autoTaps) earn(perTap() * focusMult() * autoTaps * dt);
    regenFocus(dt);
    tickProduction(dt);
    // улучшение вещи могло доехать прямо сейчас
    if (tickUpgrade()){
      Sound.buy(); haptic([16, 50, 24]);
      if (activePane === 'profile') renderProfile();
    }
    draw();
  }
  requestAnimationFrame(loop);
}

function draw(){
  if (!S || !S.path) return;
  $('money').textContent = fmt(S.money) + '$';
  const ps = perSecond();
  $('income').textContent = ps > 0 ? '+' + fmt(ps) + '$/сек' : '';
  $('tapval').textContent = '+' + fmt(perTap() * focusMult()) + '$';

  $('pathline').innerHTML = path().name +
    (S.legacy > 0 ? ` · <b>влияние ×${legacyMult().toFixed(2)}</b>` : '');

  const pct = S.focus / FOCUS_MAX;
  $('focusfill').style.width = (pct * 100) + '%';
  $('focusnote').textContent = pct > .75 ? 'полная отдача' : pct > .35 ? 'отдача падает' : 'нужен передых';

  // активные усиления
  const now = Date.now();
  buffs = buffs.filter(b => b.until > now);
  const bl = $('buffline');
  if (buffs.length){
    bl.innerHTML = buffs.map(b => {
      const left = Math.ceil((b.until - now) / 1000);
      return `<span class="buff">×${b.mult} ${b.kind === 'tap' ? 'тап' : 'доход'} · ${left}с</span>`;
    }).join('');
  } else if (bl.innerHTML) bl.innerHTML = '';

  const pts = pendingPoints();
  const rb = $('rebirth');
  if (pts >= REBIRTH_MIN){
    rb.classList.remove('hidden');
    $('rebirthPts').textContent = '+' + pts;
    const next = 1 + (S.legacy + pts) * REBIRTH_BONUS;
    $('rebirthSub').textContent = `Потеряешь всё нажитое, получишь влияние ×${next.toFixed(2)} навсегда`;
  } else rb.classList.add('hidden');

  // способность: откат и готовность
  const ab = path().ability;
  if (ab){
    const left = abilityLeft();
    const el = $('ability');
    el.classList.toggle('ready', left <= 0);
    el.classList.toggle('cooling', left > 0);
    $('abilityCd').style.width = left > 0 ? ((left / abilityCooldown) * 100) + '%' : '0%';
    $('abilityWhen').textContent = left > 0 ? Math.ceil(left) + 'с' : 'готово';
    el.disabled = left > 0;
  }

  // заряды показываем рядом с активными усилениями
  if (charges.left > 0){
    bl.innerHTML += `<span class="buff">×${charges.mult} тап · ${charges.left} ${plural(charges.left,'заряд','заряда','зарядов')}</span>`;
  }

  // Уклады — то, что игрок сам выбрал на развилке. Без напоминания он через
  // десять минут не поймёт, почему концентрация горит вдвое быстрее.
  for (const m of modList())
    bl.innerHTML += `<span class="buff mod">×${m.mult.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} ${m.name}</span>`;

  // прогресс до следующего очка влияния
  const have = legacyPoints(S.totalEarned);
  const nextAt = REBIRTH_DIVISOR * Math.pow(have + 1, 1 / REBIRTH_POWER);
  const prevAt = REBIRTH_DIVISOR * Math.pow(have,     1 / REBIRTH_POWER);
  const p01 = Math.max(0, Math.min(1, (S.totalEarned - prevAt) / (nextAt - prevAt)));
  $('legacyfill').style.width = (p01 * 100) + '%';
  $('legacycap').innerHTML = have > 0
    ? `Влияние за забег: <b>+${pts}</b>`
    : 'До первого очка влияния';
  $('legacynext').textContent = 'ещё ' + fmt(Math.max(0, nextAt - S.totalEarned)) + '$';

  for (const pk of (path().perks || [])){
    const el = document.querySelector(`.perk[data-perk="${pk.id}"]`);
    if (!el) continue;
    const has = perk(pk.id);
    el.classList.toggle('bought', has);
    el.classList.toggle('locked', !has && S.money < pk.cost);
    el.querySelector('.cost').textContent = has ? 'куплено' : fmt(pk.cost) + '$';
    el.disabled = has || S.money < pk.cost;
  }

  if (activePane === 'capital') drawCapitalTotals();
  if (activePane === 'profile' && S.upgrade) drawGearTimer();

  // точка на вкладке «Тапы»: развилка ждёт или способность готова,
  // а игрок сейчас смотрит в другое место
  const abil = path().ability;
  const waiting = !!pendingEvent || (abil && abilityLeft() <= 0);
  $('tabdot').classList.toggle('on', waiting && activePane !== 'taps');

  checkAchievements();
  drawAchievements();

  if (!shopBuilt) return;
  for (const u of unlockedUpgrades()){
    const el = document.querySelector(`.up[data-id="${u.id}"]`);
    const n = owned(u.id), maxed = bought(u.id) >= u.max;
    const want = maxed ? 0 : bulkAmount(u);
    const deal = maxed ? { n:0, cost:Infinity } : costOfMany(u, want);
    el.querySelector('.cost').textContent = maxed ? 'предел' : fmt(deal.cost) + '$';
    const g = grown(u.id);
    el.querySelector('.cnt').textContent = n
      ? (u.max === Infinity ? `×${n}` + (g ? ` (${g} сами)` : '') : `${n}/${u.max}`)
      : '';
    const cnt2 = el.querySelector('.cnt2');
    if (!maxed && deal.n > 1) cnt2.textContent = '+' + deal.n + ' шт';
    else cnt2.textContent = '';
    el.disabled = maxed || S.money < deal.cost;
  }
}

