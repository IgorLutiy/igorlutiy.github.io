// ===== Версия =====
const GAME_VERSION = '1.0';

// ===== Состояние игры =====
const state = {
  lang: 'ru',
  length: 5,
  words: [],
  currentWord: '',
  scrambled: [],
  usedIndices: new Set(),
  answer: [],
  score: 0,
  round: 0,
  wordsSolved: 0,
  wrongAttempts: 0,
  hintsUsed: 0,
  startTime: null,
  timerInterval: null,
  maxRounds: 10,
  bestScore: Number(localStorage.getItem('wordGameBest') || 0)
};

// ===== Очки =====
// Правильный ответ: + (длина × 10)
// Неверная попытка: −10
// Подсказка: −15
const POINTS = {
  correctBase: 10,   // умножается на длину слова
  wrong: -10,
  hint: -15
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const screens = {
  menu: $('#menuScreen'),
  game: $('#gameScreen'),
  result: $('#resultScreen')
};

// ===== Утилиты =====
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function setFeedback(text, type = '') {
  const el = $('#feedback');
  el.textContent = text;
  el.className = 'feedback ' + type;
}

function updateScoreDisplay() {
  $('#score').textContent = state.score;
}

// ===== Инициализация =====
function init() {
  // Версия
  const versionEl = document.getElementById('gameVersion');
  if (versionEl) versionEl.textContent = 'v' + GAME_VERSION;

  // Языки
  const langSelect = $('#langSelect');
  getAvailableLanguages().forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = `${lang.flag} ${lang.name}`;
    langSelect.appendChild(opt);
  });
  langSelect.value = state.lang;

  // События
  langSelect.addEventListener('change', (e) => {
    state.lang = e.target.value;
    updateMenuStats();
  });

  $('#lengthSelect').addEventListener('change', (e) => {
    state.length = Number(e.target.value);
    updateMenuStats();
  });

  $('#startBtn').addEventListener('click', startGame);
  $('#checkBtn').addEventListener('click', checkAnswer);
  $('#shuffleBtn').addEventListener('click', reshuffle);
  $('#skipBtn').addEventListener('click', skipWord);
  $('#hintBtn').addEventListener('click', showHint);
  $('#playAgainBtn').addEventListener('click', startGame);
  $('#menuBtn').addEventListener('click', () => {
    stopTimer();
    showScreen('menu');
    updateMenuStats();
  });

  // Ввод с клавиатуры
  const input = $('#answerInput');
  input.addEventListener('input', (e) => {
    const val = normalizeWord(e.target.value);
    e.target.value = val.toUpperCase();
    state.answer = val.split('');
    renderSlots();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkAnswer();
  });

  // Клик по слотам — убрать букву
  $('#answerSlots').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot || !slot.dataset.index) return;
    const idx = Number(slot.dataset.index);
    const letter = state.answer[idx];
    if (!letter) return;
    for (let i = 0; i < state.scrambled.length; i++) {
      if (state.usedIndices.has(i) && state.scrambled[i] === letter) {
        state.usedIndices.delete(i);
        break;
      }
    }
    state.answer.splice(idx, 1);
    renderLetters();
    renderSlots();
    $('#answerInput').value = state.answer.join('').toUpperCase();
  });

  updateMenuStats();
  showScreen('menu');
}

function updateMenuStats() {
  const words = getWords(state.lang, state.length);
  $('#totalWords').textContent = words.length;
  $('#bestScore').textContent = state.bestScore;
}

// ===== Игра =====
function startGame() {
  state.length = Number($('#lengthSelect').value);
  state.lang = $('#langSelect').value;
  state.words = shuffle(getWords(state.lang, state.length));
  if (state.words.length === 0) {
    alert('Нет слов этой длины для выбранного языка.');
    return;
  }
  state.score = 0;
  state.round = 0;
  state.wordsSolved = 0;
  state.wrongAttempts = 0;
  state.hintsUsed = 0;
  state.startTime = Date.now();
  startTimer();
  nextWord();
  showScreen('game');
}

function nextWord() {
  if (state.round >= state.maxRounds || state.round >= state.words.length) {
    endGame();
    return;
  }
  state.currentWord = state.words[state.round];
  state.scrambled = shuffle(state.currentWord.split(''));
  let attempts = 0;
  while (state.scrambled.join('') === state.currentWord && attempts < 10) {
    state.scrambled = shuffle(state.currentWord.split(''));
    attempts++;
  }
  state.usedIndices = new Set();
  state.answer = [];
  state.round++;
  $('#round').textContent = state.round;
  updateScoreDisplay();
  $('#answerInput').value = '';
  setFeedback('');
  renderLetters();
  renderSlots();
  $('#answerInput').focus();
}

function renderLetters() {
  const container = $('#scrambledLetters');
  container.innerHTML = '';
  state.scrambled.forEach((letter, i) => {
    const el = document.createElement('div');
    el.className = 'letter' + (state.usedIndices.has(i) ? ' used' : '');
    el.textContent = letter.toUpperCase();
    el.dataset.index = i;
    if (!state.usedIndices.has(i)) {
      el.addEventListener('click', () => addLetter(i));
    }
    container.appendChild(el);
  });
}

function renderSlots() {
  const container = $('#answerSlots');
  container.innerHTML = '';
  const len = state.currentWord.length;
  for (let i = 0; i < len; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (state.answer[i] ? ' filled' : '');
    slot.textContent = state.answer[i] ? state.answer[i].toUpperCase() : '';
    if (state.answer[i]) slot.dataset.index = i;
    container.appendChild(slot);
  }
}

function addLetter(index) {
  if (state.usedIndices.has(index)) return;
  if (state.answer.length >= state.currentWord.length) return;
  state.usedIndices.add(index);
  state.answer.push(state.scrambled[index]);
  renderLetters();
  renderSlots();
  $('#answerInput').value = state.answer.join('').toUpperCase();
}

function reshuffle() {
  state.scrambled = shuffle(state.currentWord.split(''));
  state.usedIndices = new Set();
  state.answer = [];
  $('#answerInput').value = '';
  renderLetters();
  renderSlots();
}

function checkAnswer() {
  const inputVal = normalizeWord($('#answerInput').value || state.answer.join(''));
  if (!inputVal) {
    setFeedback('Введите или соберите слово', 'error');
    return;
  }
  if (inputVal.length !== state.currentWord.length) {
    setFeedback('Неверная длина слова', 'error');
    return;
  }

  const slots = $$('#answerSlots .slot');
  if (inputVal === state.currentWord) {
    // Успех
    const points = state.currentWord.length * POINTS.correctBase;
    state.score += points;
    state.wordsSolved++;
    slots.forEach(s => s.classList.add('correct'));
    setFeedback(`✓ Верно! +${points}`, 'success');
    updateScoreDisplay();
    setTimeout(nextWord, 900);
  } else {
    // Неверно — штраф
    state.score += POINTS.wrong;
    state.wrongAttempts++;
    slots.forEach(s => s.classList.add('wrong'));
    setFeedback(`✗ Неверно ${POINTS.wrong}`, 'error');
    updateScoreDisplay();
    setTimeout(() => {
      slots.forEach(s => s.classList.remove('wrong'));
      setFeedback('');
    }, 700);
  }
}

function skipWord() {
  setFeedback(`Было: ${state.currentWord.toUpperCase()}`, 'hint');
  setTimeout(nextWord, 1200);
}

function showHint() {
  // Штраф за подсказку
  state.score += POINTS.hint;
  state.hintsUsed++;
  updateScoreDisplay();

  const word = state.currentWord;
  const revealed = word[0].toUpperCase() + '_'.repeat(word.length - 1);
  setFeedback(`Подсказка: ${revealed}  (${POINTS.hint})`, 'hint');
}

function startTimer() {
  stopTimer();
  state.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    $('#timer').textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function endGame() {
  stopTimer();
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    localStorage.setItem('wordGameBest', state.bestScore);
  }
  $('#finalScore').textContent = state.score;
  $('#wordsSolved').textContent = state.wordsSolved;
  $('#finalTime').textContent = formatTime(elapsed);

  // Доп. статистика
  const extra = document.getElementById('resultExtra');
  if (extra) {
    extra.textContent = `Ошибок: ${state.wrongAttempts} · Подсказок: ${state.hintsUsed}`;
  }

  $('#resultTitle').textContent = state.wordsSolved >= state.maxRounds * 0.7 ? 'Отлично!' : 'Хорошая попытка!';
  $('#resultMessage').textContent = `Вы угадали ${state.wordsSolved} из ${Math.min(state.round, state.maxRounds)} слов.`;
  showScreen('result');
}

// Запуск
document.addEventListener('DOMContentLoaded', init);
