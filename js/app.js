(() => {
  'use strict';

  // ---------------- MINESWEEPER BOARD (Intermediate: 16x16, 40 mines) ----------------
  const COLS = 16;
  const ROWS = 16;
  const MINES = 40;
  const CELL_COUNT = COLS * ROWS;
  const JUMP_DIST_THRESHOLD = 5; // chebyshev distance considered "far" for solve-flow jumps

  function generateBoard() {
    const mines = new Uint8Array(CELL_COUNT); // 1 = mine, 0 = safe
    let placed = 0;
    while (placed < MINES) {
      const i = Math.floor(Math.random() * CELL_COUNT);
      if (!mines[i]) { mines[i] = 1; placed++; }
    }
    return mines;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffledIndices(exclude) {
    const arr = [];
    for (let i = 0; i < CELL_COUNT; i++) if (!exclude || !exclude.has(i)) arr.push(i);
    return shuffle(arr);
  }

  function shuffledSafeIndices(mines, exclude) {
    const arr = [];
    for (let i = 0; i < CELL_COUNT; i++) if (!mines[i] && (!exclude || !exclude.has(i))) arr.push(i);
    return shuffle(arr);
  }

  function indexToRC(i) {
    return { row: Math.floor(i / COLS), col: i % COLS };
  }

  function chebyshev(i, j) {
    const a = indexToRC(i), b = indexToRC(j);
    return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
  }

  function getNeighbors(index) {
    const { row, col } = indexToRC(index);
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push(nr * COLS + nc);
      }
    }
    return out;
  }

  function computeNeighborCounts(mines) {
    const counts = new Uint8Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      if (mines[i]) continue;
      let c = 0;
      const neighbors = getNeighbors(i);
      for (const n of neighbors) if (mines[n]) c++;
      counts[i] = c;
    }
    return counts;
  }

  // ---------------- STATE ----------------
  const settings = {
    mode: 'random', // 'random' | 'solve'
    duration: 60,
    size: 'medium',
    concurrent: 3,
    jumpChance: 0.1,
  };

  const SIZE_MULT = { small: 0.42, medium: 0.58, large: 0.75 };

  let run = null; // holds per-run state while playing
  let phase = 'menu'; // 'menu' | 'countdown' | 'playing' | 'results'
  let countdownIv = null;
  let currentRaf = null;

  // ---------------- DOM ----------------
  const screens = {
    menu: document.getElementById('menu-screen'),
    game: document.getElementById('game-screen'),
    results: document.getElementById('results-screen'),
  };

  const playArea = document.getElementById('play-area');
  const hudTime = document.getElementById('hud-time');
  const hudScore = document.getElementById('hud-score');
  const hudAcc = document.getElementById('hud-acc');
  const hudStreak = document.getElementById('hud-streak');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownNum = document.getElementById('countdown-num');
  const jumpChanceRow = document.getElementById('jump-chance-row');

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ---------------- MENU WIRING ----------------
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.mode = btn.dataset.mode;
      jumpChanceRow.style.display = settings.mode === 'solve' ? 'flex' : 'none';
    });
  });
  jumpChanceRow.style.display = settings.mode === 'solve' ? 'flex' : 'none';

  document.querySelectorAll('.pill-group').forEach(group => {
    const key = group.dataset.setting;
    group.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        settings[key] = isNaN(pill.dataset.value) ? pill.dataset.value : Number(pill.dataset.value);
      });
    });
  });

  document.getElementById('start-btn').addEventListener('click', () => startCountdown());
  document.getElementById('retry-btn').addEventListener('click', () => startCountdown());
  document.getElementById('menu-btn').addEventListener('click', () => { phase = 'menu'; showScreen('menu'); });
  document.getElementById('quit-btn').addEventListener('click', () => endRun(true));

  // Block the browser context menu everywhere while the game is active
  document.addEventListener('contextmenu', e => {
    if (screens.game.classList.contains('active')) e.preventDefault();
  });

  // ---------------- COUNTDOWN ----------------
  function startCountdown() {
    if (phase === 'countdown' || phase === 'playing') return; // ignore re-entrant starts
    phase = 'countdown';
    stopAllTimers();

    showScreen('game');
    playArea.innerHTML = '';
    countdownOverlay.classList.add('active');
    let n = 3;
    countdownNum.textContent = n;
    countdownIv = setInterval(() => {
      n -= 1;
      if (n > 0) {
        countdownNum.textContent = n;
      } else {
        clearInterval(countdownIv);
        countdownIv = null;
        countdownOverlay.classList.remove('active');
        beginRun();
      }
    }, 700);
  }

  function stopAllTimers() {
    if (countdownIv) { clearInterval(countdownIv); countdownIv = null; }
    if (currentRaf) { cancelAnimationFrame(currentRaf); currentRaf = null; }
  }

  // ---------------- RUN LIFECYCLE ----------------
  function beginRun() {
    phase = 'playing';
    run = {
      startTime: performance.now(),
      duration: settings.duration,
      areaW: playArea.clientWidth,
      areaH: playArea.clientHeight,
      activeIndices: new Set(),
      hits: 0,
      misses: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      reactionTimes: [],
      left: { attempts: 0, hits: 0 },
      right: { attempts: 0, hits: 0 },
      ended: false,
    };

    if (settings.mode === 'solve') {
      const mines = generateBoard();
      run.board = mines;
      run.solve = createSolveState(mines);
    } else {
      run.board = generateBoard();
      run.queue = shuffledIndices();
    }

    playArea.innerHTML = '';
    updateHud(0);
    for (let i = 0; i < settings.concurrent; i++) spawnNext();
    currentRaf = requestAnimationFrame(tick);
  }

  function tick() {
    if (!run || run.ended || phase !== 'playing') return;
    const elapsed = (performance.now() - run.startTime) / 1000;
    const remaining = Math.max(0, run.duration - elapsed);
    updateHud(remaining);
    if (remaining <= 0) {
      endRun(false);
      return;
    }
    currentRaf = requestAnimationFrame(tick);
  }

  function updateHud(remaining) {
    hudTime.textContent = remaining.toFixed(1);
    hudScore.textContent = run.score;
    const total = run.hits + run.misses;
    const acc = total === 0 ? 100 : Math.round((run.hits / total) * 100);
    hudAcc.textContent = acc + '%';
    hudStreak.textContent = run.streak;
  }

  function endRun(quit) {
    if (phase !== 'countdown' && phase !== 'playing') return;
    if (run) run.ended = true;
    stopAllTimers();
    playArea.innerHTML = '';

    if (quit) {
      phase = 'menu';
      showScreen('menu');
      run = null;
      return;
    }

    phase = 'results';

    const total = run.hits + run.misses;
    const acc = total === 0 ? 0 : Math.round((run.hits / total) * 100);
    const avgReaction = run.reactionTimes.length
      ? Math.round(run.reactionTimes.reduce((a, b) => a + b, 0) / run.reactionTimes.length)
      : 0;
    const tps = (run.hits / run.duration).toFixed(2);
    const leftAcc = run.left.attempts === 0 ? 0 : Math.round((run.left.hits / run.left.attempts) * 100);
    const rightAcc = run.right.attempts === 0 ? 0 : Math.round((run.right.hits / run.right.attempts) * 100);

    document.getElementById('r-score').textContent = run.score;
    document.getElementById('r-hits').textContent = run.hits;
    document.getElementById('r-misses').textContent = run.misses;
    document.getElementById('r-acc').textContent = acc + '%';
    document.getElementById('r-avgtime').textContent = avgReaction + 'ms';
    document.getElementById('r-tps').textContent = tps;
    document.getElementById('r-streak').textContent = run.bestStreak;
    document.getElementById('r-leftacc').textContent = leftAcc + '%';
    document.getElementById('r-rightacc').textContent = rightAcc + '%';

    showScreen('results');
  }

  // ---------------- RANDOM MODE SELECTION ----------------
  function nextCellIndexRandom() {
    if (run.queue.length === 0) {
      run.board = generateBoard();
      run.queue = shuffledIndices(run.activeIndices);
    }
    return run.queue.pop();
  }

  // ---------------- SOLVE FLOW MODE ----------------
  function createSolveState(mines) {
    return {
      counts: computeNeighborCounts(mines),
      state: new Uint8Array(CELL_COUNT), // 0 untouched, 1 revealed, 2 flagged
      frontier: new Set(),
      reseedPool: shuffledSafeIndices(mines),
      lastPos: null,
    };
  }

  function regenerateSolveBoard() {
    const mines = generateBoard();
    run.board = mines;
    run.solve = createSolveState(mines);
    run.solve.reseedPool = shuffledSafeIndices(mines, run.activeIndices);
  }

  function solveReveal(index) {
    const s = run.solve;
    if (s.state[index] !== 0) return;
    s.state[index] = 1;
    s.frontier.delete(index);
    const neighbors = getNeighbors(index);
    for (const n of neighbors) if (s.state[n] === 0) s.frontier.add(n);
    if (s.counts[index] === 0) {
      for (const n of neighbors) {
        if (s.state[n] === 0 && !run.board[n]) solveReveal(n);
      }
    }
  }

  function solveFlag(index) {
    const s = run.solve;
    if (s.state[index] !== 0) return;
    s.state[index] = 2;
    s.frontier.delete(index);
  }

  function reseedSolve() {
    const s = run.solve;
    while (s.reseedPool.length) {
      const idx = s.reseedPool.pop();
      if (s.state[idx] === 0 && !s.frontier.has(idx) && !run.activeIndices.has(idx)) return idx;
    }
    return null;
  }

  const NEAREST_POOL_SIZE = 3; // pick randomly among the N closest cells, not always the single nearest

  function pickNearestFrontier() {
    const s = run.solve;
    if (s.frontier.size === 0) return null;
    const ranked = [...s.frontier]
      .map(idx => ({ idx, d: s.lastPos !== null ? chebyshev(idx, s.lastPos) : 0 }))
      .sort((a, b) => a.d - b.d);
    const poolSize = Math.min(NEAREST_POOL_SIZE, ranked.length);
    const pick = ranked[Math.floor(Math.random() * poolSize)].idx;
    s.frontier.delete(pick);
    return pick;
  }

  function pickJumpTarget() {
    const s = run.solve;
    if (s.lastPos === null) return null;
    const far = [];
    for (const idx of s.frontier) {
      if (chebyshev(idx, s.lastPos) >= JUMP_DIST_THRESHOLD) far.push(idx);
    }
    if (far.length === 0) return null;
    const pick = far[Math.floor(Math.random() * far.length)];
    s.frontier.delete(pick);
    return pick;
  }

  function nextCellIndexSolve() {
    const s = run.solve;
    let idx = null;

    if (s.frontier.size === 0) {
      idx = reseedSolve();
    } else if (Math.random() < settings.jumpChance) {
      idx = pickJumpTarget() ?? reseedSolve() ?? pickNearestFrontier();
    } else {
      idx = pickNearestFrontier();
    }

    if (idx === null) {
      regenerateSolveBoard();
      return nextCellIndexSolve();
    }

    run.solve.lastPos = idx;
    // Advance the board immediately (not on click) so this cell's cascade/frontier
    // is already available for the next pick — this is what makes concurrent squares
    // fan out from one shared cluster instead of each being an independent seed.
    if (run.board[idx]) solveFlag(idx); else solveReveal(idx);
    return idx;
  }

  // ---------------- TARGET SPAWNING ----------------
  function spawnNext() {
    if (!run || run.ended) return;

    const index = settings.mode === 'solve' ? nextCellIndexSolve() : nextCellIndexRandom();
    const mine = run.board[index] === 1;
    const side = mine ? 'right' : 'left';
    const col = index % COLS;
    const row = Math.floor(index / COLS);

    const cellW = run.areaW / COLS;
    const cellH = run.areaH / ROWS;
    const size = Math.min(cellW, cellH) * SIZE_MULT[settings.size];
    const x = col * cellW + (cellW - size) / 2;
    const y = row * cellH + (cellH - size) / 2;

    const el = document.createElement('div');
    el.className = `target ${side}`;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    if (side === 'right') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.innerHTML =
        '<line x1="6" y1="21" x2="6" y2="3" stroke="#3a2a1a" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M6 4 L19 8 L6 12 Z" fill="#3a2a1a"/>';
      el.appendChild(icon);
    }

    const spawnTime = performance.now();
    run.activeIndices.add(index);
    let resolved = false;

    el.addEventListener('mousedown', e => onTargetMouseDown(e, el, index, side, spawnTime, () => resolved, () => { resolved = true; }));
    playArea.appendChild(el);
  }

  // ---------------- CLICK HANDLING ----------------
  function onTargetMouseDown(e, el, index, side, spawnTime, isResolved, markResolved) {
    e.preventDefault();
    e.stopPropagation();
    if (!run || run.ended || isResolved()) return;

    const button = e.button === 2 ? 'right' : e.button === 0 ? 'left' : null;
    if (!button) return;
    markResolved();

    const correct = button === side;
    run[button].attempts += 1;
    const reactionMs = performance.now() - spawnTime;

    if (correct) {
      run[button].hits += 1;
      run.hits += 1;
      run.score += 1;
      run.streak += 1;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      run.reactionTimes.push(reactionMs);
      flashHit(el, true);
      spawnPopText(e.clientX, e.clientY, '+1', true);
    } else {
      run.misses += 1;
      run.streak = 0;
      flashHit(el, false);
      spawnPopText(e.clientX, e.clientY, 'wrong button', false);
    }

    // Solve Flow already advanced the board for this cell at pick time (see
    // nextCellIndexSolve) — a wrong-button click only costs accuracy here.
    run.activeIndices.delete(index);
    el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 160);
    if (run && !run.ended) spawnNext();
  }

  // Click on empty play area = whiffed shot
  playArea.addEventListener('mousedown', e => {
    if (e.target !== playArea) return; // target clicks handled above
    if (!run || run.ended) return;
    const button = e.button === 2 ? 'right' : e.button === 0 ? 'left' : null;
    if (!button) return;
    run[button].attempts += 1;
    run.misses += 1;
    run.streak = 0;
    spawnPopText(e.clientX, e.clientY, 'miss', false);
  });

  function flashHit(el, hit) {
    el.classList.add(hit ? 'hit-flash' : 'miss-flash');
  }

  function spawnPopText(clientX, clientY, text, good) {
    const rect = playArea.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'pop-text ' + (good ? 'good' : 'bad');
    t.textContent = text;
    t.style.left = (clientX - rect.left) + 'px';
    t.style.top = (clientY - rect.top) + 'px';
    playArea.appendChild(t);
    setTimeout(() => t.remove(), 500);
  }

})();
