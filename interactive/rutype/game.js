(() => {
  "use strict";

  // Заполни адресом веб-приложения Apps Script после деплоя (см. apps-script/README.md).
  // Пока строка пустая, таблица рекордов работает только локально (localStorage) —
  // ничего не ломается, просто результаты не видны на других устройствах.
  const LEADERBOARD_URL = "https://script.google.com/macros/s/AKfycbwkyipNq8l2QLc0U_jL5aW95-K-BZLoFpwba_nSAUJ2L_4bEvjvgjXCcX-72qkJkt3I/exec";

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const screens = {
    menu: $("#menu-screen"),
    game: $("#game-screen"),
  };
  const overlays = {
    pause: $("#pause-overlay"),
    gameover: $("#gameover-overlay"),
    records: $("#records-overlay"),
    settings: $("#settings-overlay"),
    recordDetail: $("#record-detail-overlay"),
    customtext: $("#customtext-overlay"),
  };
  const field = $("#field");
  const ship = $("#ship");
  const hudScore = $("#hud-score");
  const hudLevel = $("#hud-level");
  const hudLives = $("#hud-lives");
  const empFill = $("#emp-fill");
  const nicknameInput = $("#nickname");
  const stopEndlessBtn = $("#stop-endless-btn");

  // ---------- persistence ----------
  const STORAGE_KEYS = {
    settings: "rutype_settings",
    nickname: "rutype_nickname",
    leaderboard: "rutype_leaderboard",
    customText: "rutype_custom_text",
  };

  const DEFAULT_SETTINGS = {
    lang: "ru",
    speed: 1,
    tiers: [1, 2, 3],
    lives: 3,
    strict: false,
    sound: true,
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
  }
  function loadLocalLeaderboard() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.leaderboard));
      if (!raw) return {};
      // миграция со старого формата (плоский массив без разбивки по языкам)
      if (Array.isArray(raw)) {
        const migrated = { ru: raw };
        saveLocalLeaderboard(migrated);
        return migrated;
      }
      return raw;
    } catch {
      return {};
    }
  }
  function saveLocalLeaderboard(byLang) {
    localStorage.setItem(STORAGE_KEYS.leaderboard, JSON.stringify(byLang));
  }

  // ---------- стандартные настройки для общего рейтинга ----------
  // обычная скорость, 3 жизни, слова "короткие+средние+длинные",
  // фразы можно добавить дополнительно — на результат они принципиально не влияют
  function isStandardRun(s) {
    if (!s) return false;
    if (s.lives !== 3) return false;
    if (s.speed !== 1) return false;
    const t = new Set(s.tiers || []);
    if (!(t.has(1) && t.has(2) && t.has(3))) return false;
    if (t.has(4) && t.size !== 4) return false;
    if (!t.has(4) && t.size !== 3) return false;
    return true;
  }

  // ---------- онлайн-таблица рекордов (Google Apps Script) ----------
  // При успехе возвращает { ok:true, rank } / { ok:true, entries }.
  // При любой проблеме (не настроено, нет сети, скрипт недоступен) — null,
  // и вызывающий код тихо откатывается на localStorage.
  async function fetchOnlineTop(lang, limit, period) {
    if (!LEADERBOARD_URL) return null;
    try {
      const url = `${LEADERBOARD_URL}?lang=${encodeURIComponent(lang)}&limit=${limit}&period=${period}`;
      const res = await fetch(url);
      const data = await res.json();
      return data && data.ok ? data.entries : null;
    } catch {
      return null;
    }
  }

  async function postOnlineScore(lang, entry) {
    if (!LEADERBOARD_URL) return null;
    try {
      // Content-Type: text/plain — осознанно, чтобы избежать CORS-preflight,
      // который Apps Script не поддерживает. Тело всё равно валидный JSON.
      const res = await fetch(LEADERBOARD_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ lang, ...entry }),
      });
      const data = await res.json();
      return data && data.ok ? data : null;
    } catch {
      return null;
    }
  }


  function splitCustomText(raw) {
    const sentences = raw
      .split(/[\n.!?;:]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const wordRegex = /[\p{L}'-]+/gu;
    const singles = new Set();
    const phrases = new Set();

    sentences.forEach((sentence) => {
      const words = (sentence.match(wordRegex) || [])
        .map((w) => w.toLowerCase())
        .filter((w) => w.length >= 2);
      words.forEach((w) => singles.add(w));
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3);
        if (chunk.length >= 2) {
          const phrase = chunk.join(" ");
          if (phrase.length <= 40) phrases.add(phrase);
        }
      }
    });

    const tiers = { 1: [], 2: [], 3: [], 4: [] };
    singles.forEach((w) => {
      if (w.length <= 4) tiers[1].push(w);
      else if (w.length <= 7) tiers[2].push(w);
      else tiers[3].push(w);
    });
    phrases.forEach((p) => tiers[4].push(p));
    Object.keys(tiers).forEach((k) => {
      if (!tiers[k].length) delete tiers[k];
    });
    return tiers;
  }

  function registerCustomBank() {
    const raw = localStorage.getItem(STORAGE_KEYS.customText);
    if (!raw) {
      delete window.WORD_BANKS.custom;
      return false;
    }
    const tiers = splitCustomText(raw);
    if (!Object.keys(tiers).length) {
      delete window.WORD_BANKS.custom;
      return false;
    }
    window.WORD_BANKS.custom = { label: "Свой текст", tiers };
    return true;
  }

  function customBankWordCount() {
    const bank = window.WORD_BANKS.custom;
    if (!bank) return 0;
    return Object.values(bank.tiers).reduce((sum, arr) => sum + arr.length, 0);
  }

  let settings = loadSettings();

  // ---------- screen / overlay helpers ----------
  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.remove("active"));
    screens[name].classList.add("active");
  }
  function showOverlay(name) {
    overlays[name].classList.add("active");
  }
  function hideOverlay(name) {
    overlays[name].classList.remove("active");
  }
  function hideAllOverlays() {
    Object.keys(overlays).forEach(hideOverlay);
  }

  // ---------- settings UI ----------
  function populateLangSelect() {
    const sel = $("#set-lang");
    sel.innerHTML = "";
    Object.entries(window.WORD_BANKS || {}).forEach(([code, bank]) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = bank.label || code;
      sel.appendChild(opt);
    });
  }

  function applySettingsToForm() {
    $("#set-lang").value = settings.lang;
    $("#set-speed").value = String(settings.speed);
    $("#set-lives").value = String(settings.lives);
    $("#set-strict").checked = !!settings.strict;
    $("#set-sound").checked = !!settings.sound;
    $$("#settings-form [data-tier]").forEach((cb) => {
      cb.checked = settings.tiers.includes(Number(cb.dataset.tier));
    });
  }

  function readSettingsFromForm() {
    const tiers = $$("#settings-form [data-tier]")
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.tier));
    settings = {
      lang: $("#set-lang").value,
      speed: Number($("#set-speed").value),
      tiers: tiers.length ? tiers : [1],
      lives: Number($("#set-lives").value),
      strict: $("#set-strict").checked,
      sound: $("#set-sound").checked,
    };
    saveSettings(settings);
  }

  // ---------- records UI ----------
  let currentRecordsList = [];
  let currentRecordsLang = null;
  let currentRecordsPeriod = "day"; // по умолчанию суточная — там у новичков есть шанс попасть в топ

  function availableLeaderboardLangs() {
    return Object.keys(window.WORD_BANKS || {}).filter((code) => code !== "custom");
  }

  function renderLangSwitch() {
    const box = $("#records-lang-switch");
    box.innerHTML = "";
    availableLeaderboardLangs().forEach((code) => {
      const bank = window.WORD_BANKS[code];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = bank.label || code;
      btn.className = code === currentRecordsLang ? "active" : "";
      btn.addEventListener("click", () => {
        currentRecordsLang = code;
        renderRecords();
      });
      box.appendChild(btn);
    });
  }

  function renderPeriodSwitch() {
    const box = $("#records-period-switch");
    box.innerHTML = "";
    [
      ["day", "за сутки"],
      ["all", "за всё время"],
    ].forEach(([value, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = value === currentRecordsPeriod ? "active" : "";
      btn.addEventListener("click", () => {
        currentRecordsPeriod = value;
        renderRecords();
      });
      box.appendChild(btn);
    });
  }

  function filterByPeriodLocal(list, period) {
    if (period !== "day") return list;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return list.filter((e) => e.date && e.date >= since);
  }

  async function renderRecords() {
    const langs = availableLeaderboardLangs();
    if (!currentRecordsLang || !langs.includes(currentRecordsLang)) {
      // по умолчанию открываем язык, с которым сейчас играют, если это настоящий банк слов
      currentRecordsLang = langs.includes(settings.lang) ? settings.lang : langs[0];
    }
    renderLangSwitch();
    renderPeriodSwitch();

    const requestedLang = currentRecordsLang; // на случай, если за время запроса язык/период переключат
    const requestedPeriod = currentRecordsPeriod;
    const body = $("#records-body");
    const empty = $("#records-empty");
    const badge = $("#records-source");
    empty.style.display = "none";
    body.innerHTML = `<tr><td colspan="3" class="records-loading">загрузка…</td></tr>`;
    badge.textContent = "";

    let list = await fetchOnlineTop(requestedLang, 10, requestedPeriod);
    let source = "online";
    if (!list) {
      const boardLocal = loadLocalLeaderboard();
      const all = (boardLocal[requestedLang] || []).slice().sort((a, b) => b.score - a.score);
      list = filterByPeriodLocal(all, requestedPeriod).slice(0, 10);
      source = LEADERBOARD_URL ? "offline" : "local";
    }

    if (requestedLang !== currentRecordsLang || requestedPeriod !== currentRecordsPeriod) return; // устаревший ответ

    currentRecordsList = list;
    body.innerHTML = "";
    badge.textContent =
      source === "online" ? "онлайн-таблица" : source === "offline" ? "офлайн (нет связи с сервером)" : "локально на этом устройстве";
    if (!list.length) {
      empty.style.display = "block";
      empty.textContent =
        requestedPeriod === "day" ? "за последние сутки пока пусто — сыграй первым" : "пока пусто — сыграй первым";
      return;
    }
    list.forEach((entry, i) => {
      const tr = document.createElement("tr");
      tr.className = "record-row";
      tr.dataset.index = i;
      tr.innerHTML = `<td class="rank">${i + 1}</td><td>${escapeHtml(entry.name)}</td><td class="score">${entry.score}</td>`;
      body.appendChild(tr);
    });
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function submitScore(lang, entry) {
    const online = await postOnlineScore(lang, entry);
    if (online) {
      return { rank: online.rank, online: true };
    }
    // сети нет / скрипт не настроен / Google на секунду недоступен — пишем локально,
    // чтобы результат хотя бы не потерялся на этом устройстве
    const board = loadLocalLeaderboard();
    const list = board[lang] || [];
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, 50);
    board[lang] = trimmed;
    saveLocalLeaderboard(board);
    return { rank: trimmed.indexOf(entry) + 1, online: false };
  }

  function openRecordDetail(entry) {
    $("#rd-name-date").textContent = `${entry.name} · ${new Date(entry.date || Date.now()).toLocaleDateString()}`;
    $("#rd-score").textContent = entry.score;
    $("#rd-level").textContent = entry.level ?? "—";
    $("#rd-accuracy").textContent = entry.accuracy != null ? entry.accuracy + "%" : "—";
    $("#rd-wpm").textContent = entry.cpm ?? "—";
    renderLetterMap($("#rd-letters"), entry.letterMisses || {});
    showOverlay("recordDetail");
  }

  // ---------- letter mistake map ----------
  function renderLetterMap(container, lettersObj, title) {
    container.innerHTML = "";
    const entries = Object.entries(lettersObj || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (!entries.length) return;
    const titleEl = document.createElement("div");
    titleEl.className = "lm-title";
    titleEl.textContent = title || "проблемные буквы";
    container.appendChild(titleEl);
    const max = entries[0][1];
    entries.forEach(([letter, count]) => {
      const row = document.createElement("div");
      row.className = "lm-row";
      row.innerHTML = `<div class="lm-letter">${escapeHtml(letter)}</div><div class="lm-bar-track"><div class="lm-bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div><div class="lm-count">${count}</div>`;
      container.appendChild(row);
    });
  }

  // ---------- sound (Web Audio, никаких файлов) ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!settings.sound) return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function playShot() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.08);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }
  function playEmp() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.5);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }
  function playMistake() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(140, t);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // ================= GAME =================
  const LEVEL_UP_BASE = 150; // очков на уровень
  const SPAWN_INTERVAL_BASE = 1900; // мс
  const SPAWN_INTERVAL_MIN = 550;
  const FALL_SPEED_BASE = 34; // px/сек

  let G = null; // текущее состояние игры
  let lastMode = "levels"; // 'levels' | 'endless', для кнопки "ещё раз"

  function wordPool() {
    const bank = window.WORD_BANKS[settings.lang] || window.WORD_BANKS.ru;
    let pool = [];
    settings.tiers.forEach((t) => {
      if (bank.tiers[t]) pool = pool.concat(bank.tiers[t]);
    });
    if (!pool.length) pool = bank.tiers[1] || Object.values(bank.tiers)[0] || [];
    return pool;
  }

  // избегаем повторного первого символа среди слов, которые ещё не начали набирать —
  // это главная причина, когда "толпа" на одну букву падает одновременно
  function pickWordText(pool) {
    const usedFirstChars = new Set(
      G.words.filter((w) => w.typed === 0 && !w.mistake).map((w) => w.text[0])
    );
    let candidates = pool.filter((w) => !usedFirstChars.has(w[0]));
    if (!candidates.length) candidates = pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // максимум слов одновременно на поле — растёт с уровнем, но не бесконечно,
  // иначе на высоких уровнях экран превращается в кашу
  function maxWordsOnScreen() {
    return Math.min(4 + Math.floor(G.level / 3), 9);
  }

  function scoreForLevel(level) {
    return level * LEVEL_UP_BASE;
  }

  function resetGameState(endless) {
    G = {
      mode: endless ? "endless" : "levels",
      score: 0,
      level: 1,
      lives: settings.lives,
      words: [], // {id, text, typed, el, x, y, speed}
      activeWordId: null,
      spawnTimer: 0,
      spawnInterval: SPAWN_INTERVAL_BASE,
      combo: 0,
      empCharge: 0,
      correctKeys: 0,
      missedKeys: 0,
      missedWords: 0,
      letterMisses: {},
      startedAt: performance.now(),
      lastFrame: null,
      paused: false,
      over: false,
      nextId: 1,
      // снимок настроек на момент старта — именно по нему проверяем
      // право результата попасть в общий рейтинг (настройки могут
      // измениться позже, а прошедший раунд не должен пересчитываться)
      runSettings: { ...settings },
    };
  }

  function livesHtml() {
    hudLives.innerHTML = "";
    for (let i = 0; i < settings.lives; i++) {
      const d = document.createElement("div");
      d.className = "life-hex" + (i < G.lives ? "" : " lost");
      hudLives.appendChild(d);
    }
  }

  function startGame(opts = {}) {
    const isEndless = !!opts.endless;
    lastMode = isEndless ? "endless" : "levels";
    const nick = (nicknameInput.value || "игрок").trim().slice(0, 16);
    localStorage.setItem(STORAGE_KEYS.nickname, nick);

    resetGameState(isEndless);
    field.querySelectorAll(".enemy").forEach((el) => el.remove());
    hideAllOverlays();
    showScreen("game");
    hudScore.textContent = "0";
    hudLevel.textContent = isEndless ? "ТРЕНИРОВКА" : "УРОВЕНЬ 1";
    hudLives.style.display = isEndless ? "none" : "flex";
    stopEndlessBtn.style.display = isEndless ? "flex" : "none";
    empFill.style.width = "0%";
    empFill.classList.remove("ready");
    if (!isEndless) livesHtml();

    requestAnimationFrame((t) => {
      G.lastFrame = t;
      requestAnimationFrame(loop);
    });
  }

  function fieldRect() {
    return field.getBoundingClientRect();
  }

  function shipDangerY() {
    // ship sits `bottom: 90px` in CSS -> convert to top-based Y within field
    return field.clientHeight - 90;
  }

  function spawnWord() {
    const pool = wordPool();
    const text = pickWordText(pool);
    const el = document.createElement("div");
    el.className = "enemy";
    el.innerHTML = `<span class="typed"></span><span class="mistake"></span><span class="rest">${escapeHtml(text)}</span>`;
    el.style.left = "-9999px"; // временно, чтобы измерить ширину не мигая
    field.appendChild(el);

    // подбираем X так, чтобы слово (даже длинная фраза) не вылезало за край поля
    const width = el.offsetWidth;
    const edge = width / 2 + 10;
    const minX = Math.min(edge, field.clientWidth / 2);
    const maxX = Math.max(minX, field.clientWidth - edge);

    // избегаем наложения на уже летящие слова: ищем X подальше от соседей,
    // особенно от тех, что ещё близко к верху (могут визуально столкнуться)
    const minGap = width + 26;
    let x = minX + Math.random() * (maxX - minX);
    let bestX = x;
    let bestScore = -1;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = minX + Math.random() * (maxX - minX);
      let worstGap = Infinity;
      G.words.forEach((w) => {
        if (w.y > 260) return; // это слово уже прошло верхнюю зону, не мешает спавну
        worstGap = Math.min(worstGap, Math.abs(w.x - candidate));
      });
      if (worstGap === Infinity) worstGap = minGap; // на поле пусто — любой X годится
      if (worstGap > bestScore) {
        bestScore = worstGap;
        bestX = candidate;
      }
      if (worstGap >= minGap) {
        bestX = candidate;
        break;
      }
    }
    x = bestX;

    const speedJitter = 0.85 + Math.random() * 0.3;
    const effLevel = G.mode === "endless" ? 1 : G.level;
    const speed = FALL_SPEED_BASE * settings.speed * levelSpeedMultiplier(effLevel) * speedJitter;

    const word = {
      id: G.nextId++,
      text,
      typed: 0,
      el,
      x,
      y: -40,
      speed,
    };
    el.style.left = x + "px";
    el.style.top = word.y + "px";
    G.words.push(word);
  }

  function levelSpeedMultiplier(level) {
    return 1 + (level - 1) * 0.14;
  }
  function levelSpawnInterval(level) {
    return Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_BASE - (level - 1) * 110);
  }

  function updateWordDisplay(word) {
    const typedSpan = word.el.querySelector(".typed");
    const mistakeSpan = word.el.querySelector(".mistake");
    const restSpan = word.el.querySelector(".rest");
    typedSpan.textContent = word.text.slice(0, word.typed);
    mistakeSpan.textContent = word.mistake || "";
    restSpan.textContent = word.text.slice(word.typed);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function shipTip() {
    return { x: field.clientWidth / 2, y: shipDangerY() - 6 };
  }
  function spawnLaser(targetX, targetY, isEmp = false) {
    const svg = $("#laser-layer");
    if (!svg) return;
    const origin = shipTip();
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", origin.x);
    line.setAttribute("y1", origin.y);
    line.setAttribute("x2", targetX);
    line.setAttribute("y2", targetY);
    line.setAttribute("class", "laser-line" + (isEmp ? " emp" : ""));
    svg.appendChild(line);
    requestAnimationFrame(() => line.classList.add("fade"));
    setTimeout(() => line.remove(), 200);
  }

  function killWord(word, viaEmp = false) {
    if (word.el.classList.contains("dying")) return;
    word.el.classList.add("dying");
    const cx = word.x;
    const cy = word.y + word.el.offsetHeight / 2;
    spawnLaser(cx, cy, viaEmp);
    if (!viaEmp) playShot();
    setTimeout(() => word.el.remove(), 200);
    G.words = G.words.filter((w) => w.id !== word.id);
    if (G.activeWordId === word.id) G.activeWordId = null;

    G.combo += 1;
    const base = word.text.replace(/\s/g, "").length * 10;
    const comboMult = 1 + Math.min(G.combo, 10) * 0.05;
    const gained = Math.round(base * (viaEmp ? 0.5 : comboMult));
    G.score += gained;

    if (!viaEmp) {
      G.empCharge = Math.min(100, G.empCharge + 12);
    }

    if (G.mode !== "endless") checkLevelUp();
    refreshHud();
  }

  function checkLevelUp() {
    while (G.score >= scoreForLevel(G.level)) {
      G.level += 1;
      G.spawnInterval = levelSpawnInterval(G.level);
      hudLevel.textContent = `УРОВЕНЬ ${G.level}`;
      flashLevelUp();
    }
  }

  function flashLevelUp() {
    hudLevel.animate(
      [
        { textShadow: "0 0 0 rgba(94,231,255,0)" },
        { textShadow: "0 0 14px rgba(94,231,255,0.9)" },
        { textShadow: "0 0 0 rgba(94,231,255,0)" },
      ],
      { duration: 700 }
    );
  }

  function refreshHud() {
    hudScore.textContent = String(G.score);
    empFill.style.width = G.empCharge + "%";
    empFill.classList.toggle("ready", G.empCharge >= 100);
  }

  function loseLife(word) {
    word.el.remove();
    G.words = G.words.filter((w) => w.id !== word.id);
    if (G.activeWordId === word.id) G.activeWordId = null;
    G.combo = 0;
    G.lives -= 1;
    livesHtml();
    ship.animate(
      [{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.25)" }, { transform: "translateX(-50%) scale(1)" }],
      { duration: 250 }
    );
    if (G.lives <= 0) {
      endGame();
    }
  }

  function wordEscaped(word) {
    word.el.remove();
    G.words = G.words.filter((w) => w.id !== word.id);
    if (G.activeWordId === word.id) G.activeWordId = null;
    G.combo = 0;
    G.missedWords += 1;
  }

  function triggerEmp() {
    if (G.empCharge < 100 || !G.words.length) return;
    field.animate(
      [{ boxShadow: "inset 0 0 0 rgba(139,124,246,0)" }, { boxShadow: "inset 0 0 120px rgba(139,124,246,0.5)" }, { boxShadow: "inset 0 0 0 rgba(139,124,246,0)" }],
      { duration: 400 }
    );
    playEmp();
    G.words.slice().forEach((w) => killWord(w, true));
    G.empCharge = 0;
    refreshHud();
  }

  function endGame() {
    if (G.over) return;
    G.over = true;
    showResultsOverlay(true);
  }

  function finishEndless() {
    if (!G || G.over) return;
    G.over = true;
    showResultsOverlay(false);
  }

  async function showResultsOverlay(competitive) {
    const elapsedMin = Math.max(0.05, (performance.now() - G.startedAt) / 60000);
    const totalKeys = G.correctKeys + G.missedKeys;
    const accuracy = totalKeys ? Math.round((G.correctKeys / totalKeys) * 100) : 100;
    const cpm = Math.round(G.correctKeys / elapsedMin);

    $("#go-title").textContent = competitive ? "корабль повреждён" : "тренировка завершена";
    $("#go-score").textContent = G.score;
    $("#go-level-row").style.display = competitive ? "" : "none";
    $("#go-level").textContent = G.level;
    $("#go-accuracy").textContent = accuracy + "%";
    $("#go-wpm").textContent = cpm;
    $("#go-restart-btn").textContent = competitive ? "ещё раз" : "тренироваться ещё";
    renderLetterMap($("#go-letters"), G.letterMisses);

    if (competitive) {
      const nick = localStorage.getItem(STORAGE_KEYS.nickname) || "игрок";
      const runLang = G.runSettings.lang;
      const eligible = runLang !== "custom" && isStandardRun(G.runSettings);
      if (eligible) {
        const entry = {
          name: nick,
          score: G.score,
          level: G.level,
          accuracy,
          cpm,
          letterMisses: G.letterMisses,
          lang: runLang,
          date: Date.now(),
        };
        $("#go-rank").textContent = "сохраняем результат…";
        showOverlay("gameover"); // не заставляем ждать сеть, чтобы увидеть остальные цифры
        const { rank, online } = await submitScore(runLang, entry);
        const place = rank && rank <= 10 ? `место в рекордах: ${rank}` : "результат сохранён";
        $("#go-rank").textContent = online ? place : `${place} (офлайн, синхронизируется только на этом устройстве)`;
        return;
      } else if (runLang === "custom") {
        $("#go-rank").textContent = "свой текст не участвует в общем рейтинге";
      } else {
        $("#go-rank").textContent =
          "результат не попал в общий рейтинг — включи стандартные настройки (обычная скорость, 3 жизни, короткие+средние+длинные слова)";
      }
    } else {
      $("#go-rank").textContent = `пропущено слов: ${G.missedWords || 0}`;
    }

    showOverlay("gameover");
  }

  // ---------- input ----------
  function handleChar(ch) {
    if (!G || G.paused || G.over) return;
    let word = G.words.find((w) => w.id === G.activeWordId);

    // в строгом режиме, пока не исправлена ошибка, ввод в это слово заблокирован
    if (word && word.mistake) {
      registerMiss(word.text[word.typed]);
      return;
    }

    if (!word) {
      const candidates = G.words.filter((w) => w.typed === 0 && w.text[0] === ch);
      if (!candidates.length) {
        registerMiss();
        return;
      }
      candidates.sort((a, b) => b.y - a.y); // ближайшее к кораблю — приоритет
      word = candidates[0];
      G.activeWordId = word.id;
      word.el.classList.add("active");
    }

    if (word.text[word.typed] === ch) {
      word.typed += 1;
      G.correctKeys += 1;
      updateWordDisplay(word);
      if (word.typed >= word.text.length) {
        killWord(word);
      }
    } else {
      const expected = word.text[word.typed];
      registerMiss(expected);
      if (settings.strict) {
        word.mistake = ch;
        word.el.classList.add("error");
        updateWordDisplay(word);
        playMistake();
      }
    }
  }

  function handleBackspace() {
    if (!G || G.paused || G.over) return;
    const word = G.words.find((w) => w.id === G.activeWordId);
    if (word && word.mistake) {
      word.mistake = null;
      word.el.classList.remove("error");
      updateWordDisplay(word);
    }
  }

  function registerMiss(expectedChar) {
    G.missedKeys += 1;
    G.combo = 0;
    if (expectedChar) {
      G.letterMisses[expectedChar] = (G.letterMisses[expectedChar] || 0) + 1;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (screens.game.classList.contains("active") && !overlays.pause.classList.contains("active") && !overlays.gameover.classList.contains("active")) {
      if (e.key === "Enter") {
        e.preventDefault();
        triggerEmp();
        return;
      }
      if (e.key === "Escape") {
        pauseGame();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        handleChar(e.key.toLowerCase());
      }
    } else if (e.key === "Escape") {
      hideAllOverlays();
      if (G && !G.over) resumeGame();
    }
  });

  // ---------- pause/resume ----------
  function pauseGame() {
    if (!G || G.over) return;
    G.paused = true;
    showOverlay("pause");
  }
  function resumeGame() {
    if (!G || G.over) return;
    G.paused = false;
    hideOverlay("pause");
    requestAnimationFrame((t) => {
      G.lastFrame = t;
      requestAnimationFrame(loop);
    });
  }

  // ---------- main loop ----------
  function loop(timestamp) {
    if (!G || G.over || G.paused) return;
    const dt = Math.min(48, timestamp - G.lastFrame);
    G.lastFrame = timestamp;

    G.spawnTimer += dt;
    if (G.spawnTimer >= G.spawnInterval) {
      if (G.words.length < maxWordsOnScreen()) {
        G.spawnTimer = 0;
        spawnWord();
      }
      // если поле переполнено, таймер не сбрасываем — заспавним, как только освободится место
    }

    const dangerY = shipDangerY();
    G.words.slice().forEach((w) => {
      w.y += (w.speed * dt) / 1000;
      w.el.style.top = w.y + "px";
      if (w.y >= dangerY) {
        if (G.mode === "endless") wordEscaped(w);
        else loseLife(w);
      }
    });

    if (!G.over) requestAnimationFrame(loop);
  }

  // ---------- wiring ----------
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".record-row");
    if (row) {
      const entry = currentRecordsList[Number(row.dataset.index)];
      if (entry) openRecordDetail(entry);
      return;
    }

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    switch (action) {
      case "start":
        startGame();
        break;
      case "start-endless":
        startGame({ endless: true });
        break;
      case "stop-endless":
        finishEndless();
        break;
      case "pause":
        pauseGame();
        break;
      case "resume":
        resumeGame();
        break;
      case "restart":
        hideAllOverlays();
        startGame({ endless: lastMode === "endless" });
        break;
      case "quit-to-menu":
        hideAllOverlays();
        if (G) G.over = true;
        showScreen("menu");
        renderRecords();
        break;
      case "open-settings":
        applySettingsToForm();
        showOverlay("settings");
        break;
      case "save-settings":
        readSettingsFromForm();
        hideOverlay("settings");
        break;
      case "reset-settings":
        settings = { ...DEFAULT_SETTINGS };
        saveSettings(settings);
        applySettingsToForm();
        break;
      case "open-records":
        renderRecords();
        showOverlay("records");
        break;
      case "open-customtext": {
        $("#custom-text-input").value = localStorage.getItem(STORAGE_KEYS.customText) || "";
        $("#custom-text-status").textContent = "";
        showOverlay("customtext");
        break;
      }
      case "save-customtext": {
        const text = $("#custom-text-input").value.trim();
        const status = $("#custom-text-status");
        if (!text) {
          status.textContent = "текст пустой";
          break;
        }
        localStorage.setItem(STORAGE_KEYS.customText, text);
        const ok = registerCustomBank();
        populateLangSelect();
        if (ok) {
          status.textContent = `сохранено: ${customBankWordCount()} слов/фраз — выбери «свой текст» в настройках`;
        } else {
          status.textContent = "маловато текста — добавь ещё несколько слов";
        }
        break;
      }
      case "clear-customtext": {
        localStorage.removeItem(STORAGE_KEYS.customText);
        delete window.WORD_BANKS.custom;
        $("#custom-text-input").value = "";
        $("#custom-text-status").textContent = "очищено";
        populateLangSelect();
        if (settings.lang === "custom") {
          settings.lang = "ru";
          saveSettings(settings);
        }
        break;
      }
      case "close-overlay":
        hideAllOverlays();
        break;
    }
  });

  // ---------- init ----------
  function init() {
    registerCustomBank();
    populateLangSelect();
    settings = loadSettings();
    applySettingsToForm();
    const savedNick = localStorage.getItem(STORAGE_KEYS.nickname);
    if (savedNick) nicknameInput.value = savedNick;
    showScreen("menu");
  }

  init();
})();
