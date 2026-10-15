/* 数独 · 点击即玩 —— 界面逻辑
 * 依赖 sudoku-core.js（window.SudokuCore）
 */
(function () {
  'use strict';

  var Core = window.SudokuCore;

  var els = {
    board: document.getElementById('board'),
    pad: document.getElementById('pad'),
    status: document.getElementById('status'),
    stats: document.getElementById('stats'),
    sub: document.getElementById('sub'),
    level: document.getElementById('level'),
    newBtn: document.getElementById('new'),
    notesBtn: document.getElementById('notesBtn'),
    actions: document.querySelector('.actions'),
    overlay: document.getElementById('overlay'),
    ovTitle: document.getElementById('ovTitle'),
    ovText: document.getElementById('ovText'),
    ovAgain: document.getElementById('ovAgain'),
  };

  var S = {
    level: '中等',
    puzzle: null,
    solution: null,
    grid: new Uint8Array(81),
    notes: new Uint16Array(81), // 位掩码，bit0..bit8 对应 1..9
    givens: new Uint8Array(81),
    hinted: new Uint8Array(81),
    bad: Object.create(null),   // 检查出来的错误格
    selected: -1,
    notesMode: false,
    undoStack: [],
    hintsUsed: 0,
    mistakes: 0,
    startTime: null,
    elapsed: 0,
    finished: false,
    clues: 0,
    branches: 0,
  };

  var cellEls = new Array(81);

  /* ------------------------------------------------------------ 工具函数 */
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setStatus(msg) { els.status.textContent = msg; }

  function rowOf(i) { return (i / 9) | 0; }
  function colOf(i) { return i % 9; }

  /* -------------------------------------------------------------- 建 DOM */
  function buildBoard() {
    els.board.innerHTML = '';
    for (var br = 0; br < 3; br++) {
      for (var bc = 0; bc < 3; bc++) {
        var block = document.createElement('div');
        block.className = 'block';
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 3; j++) {
            var idx = (br * 3 + i) * 9 + (bc * 3 + j);
            var cell = document.createElement('div');
            cell.className = 'cell';

            var digit = document.createElement('span');
            digit.className = 'digit';

            var notes = document.createElement('div');
            notes.className = 'notes';
            var noteSpans = [];
            for (var d = 1; d <= 9; d++) {
              var sp = document.createElement('span');
              notes.appendChild(sp);
              noteSpans.push(sp);
            }
            notes.style.display = 'none';

            cell.appendChild(digit);
            cell.appendChild(notes);
            (function (index) {
              cell.addEventListener('click', function () { selectCell(index); });
            })(idx);

            block.appendChild(cell);
            cellEls[idx] = { root: cell, digit: digit, notes: notes, noteSpans: noteSpans };
          }
        }
        els.board.appendChild(block);
      }
    }
  }

  function buildPad() {
    els.pad.innerHTML = '';
    for (var d = 1; d <= 9; d++) {
      var b = document.createElement('button');
      b.className = 'pad-btn';
      b.type = 'button';
      b.innerHTML = '<span class="pd">' + d + '</span><span class="pc"></span>';
      (function (digit) {
        b.addEventListener('click', function () { inputDigit(digit); });
      })(d);
      els.pad.appendChild(b);
      padBtns[d] = b;
    }
  }
  var padBtns = {};

  /* ---------------------------------------------------------------- 渲染 */
  function conflictCells() {
    var bad = Object.create(null);
    var units = [];
    var r, c, k;
    for (r = 0; r < 9; r++) {
      var row = [];
      for (c = 0; c < 9; c++) row.push(r * 9 + c);
      units.push(row);
    }
    for (c = 0; c < 9; c++) {
      var col = [];
      for (r = 0; r < 9; r++) col.push(r * 9 + c);
      units.push(col);
    }
    for (var b = 0; b < 9; b++) {
      var box = [];
      for (k = 0; k < 81; k++) if (Core.BOX[k] === b) box.push(k);
      units.push(box);
    }
    for (var u = 0; u < units.length; u++) {
      var seen = Object.create(null);
      for (var n = 0; n < units[u].length; n++) {
        var idx = units[u][n];
        var v = S.grid[idx];
        if (!v) continue;
        if (seen[v] !== undefined) { bad[idx] = 1; bad[seen[v]] = 1; }
        else seen[v] = idx;
      }
    }
    return bad;
  }

  function render() {
    var sel = S.selected;
    var selVal = sel >= 0 ? S.grid[sel] : 0;
    var conflicts = conflictCells();

    for (var i = 0; i < 81; i++) {
      var el = cellEls[i];
      var v = S.grid[i];

      var cls = 'cell';
      if (sel >= 0) {
        if (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || Core.BOX[i] === Core.BOX[sel]) cls += ' peer';
        if (selVal && v === selVal) cls += ' same';
        if (i === sel) cls += ' sel';
      }
      el.root.className = cls;

      if (v) {
        el.digit.textContent = String(v);
        el.digit.className = 'digit ' + (
          (conflicts[i] || S.bad[i]) ? 'c-bad'
            : S.givens[i] ? 'c-given'
              : S.hinted[i] ? 'c-hint'
                : 'c-user'
        );
        el.notes.style.display = 'none';
      } else {
        el.digit.textContent = '';
        el.notes.style.display = '';
        var m = S.notes[i];
        for (var d = 1; d <= 9; d++) {
          el.noteSpans[d - 1].textContent = (m & (1 << (d - 1))) ? String(d) : '';
        }
      }
    }
    renderStats();
  }

  function renderStats() {
    var left = 0;
    var used = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 81; i++) {
      if (!S.grid[i]) left++;
      else used[S.grid[i]]++;
    }
    var txt = '时间 ' + fmtTime(S.elapsed) + ' · 剩余 ' + left + ' 格 · 提示 ' + S.hintsUsed;
    if (S.mistakes) txt += ' · 检查出 ' + S.mistakes + ' 处错误';
    els.stats.textContent = txt;

    for (var d = 1; d <= 9; d++) {
      var btn = padBtns[d];
      if (!btn) continue;
      var n = 9 - used[d];
      btn.querySelector('.pc').textContent = n > 0 ? n : '✓';
      btn.disabled = used[d] >= 9;
    }
  }

  /* -------------------------------------------------------------- 计时器 */
  function startTimer() {
    if (S.startTime === null) S.startTime = Date.now();
  }

  setInterval(function () {
    if (S.startTime !== null && !S.finished) {
      S.elapsed = (Date.now() - S.startTime) / 1000;
      renderStats();
    }
  }, 500);

  /* ---------------------------------------------------------------- 撤销 */
  function snapshot() {
    return {
      grid: S.grid.slice(),
      notes: S.notes.slice(),
      hinted: S.hinted.slice(),
      bad: Object.assign(Object.create(null), S.bad),
      hintsUsed: S.hintsUsed,
      mistakes: S.mistakes,
    };
  }

  function pushUndo() {
    S.undoStack.push(snapshot());
    if (S.undoStack.length > 200) S.undoStack.shift();
  }

  function doUndo() {
    if (S.finished) return;
    var snap = S.undoStack.pop();
    if (!snap) { setStatus('没有可撤销的操作。'); return; }
    S.grid = snap.grid;
    S.notes = snap.notes;
    S.hinted = snap.hinted;
    S.bad = snap.bad;
    S.hintsUsed = snap.hintsUsed;
    S.mistakes = snap.mistakes;
    setStatus('已撤销。');
    render();
  }

  /* ------------------------------------------------------------ 新的一局 */
  function newGame() {
    S.level = els.level.value;
    setStatus('正在生成「' + S.level + '」难度的题目…');

    var seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    var p;
    try {
      p = Core.makePuzzle(S.level, Core.mulberry32(seed), { timeBudget: 700, maxAttempts: 24 });
    } catch (err) {
      setStatus('出题失败：' + err.message + '（再点一次「新游戏」试试）');
      return;
    }

    S.puzzle = p.puzzle;
    S.solution = p.solution;
    S.grid = p.puzzle.slice();
    S.notes = new Uint16Array(81);
    S.givens = new Uint8Array(81);
    S.hinted = new Uint8Array(81);
    S.bad = Object.create(null);
    S.clues = p.clues;
    S.branches = p.branches;
    for (var i = 0; i < 81; i++) if (p.puzzle[i]) S.givens[i] = 1;

    S.selected = -1;
    S.undoStack = [];
    S.hintsUsed = 0;
    S.mistakes = 0;
    S.startTime = null;
    S.elapsed = 0;
    S.finished = false;
    S.notesMode = false;
    els.notesBtn.classList.remove('on');
    els.overlay.hidden = true;

    els.sub.textContent = '提示数 ' + p.clues + ' · 需要试错 ' + p.branches + ' 次';

    for (var k = 0; k < 81; k++) {
      if (!S.grid[k]) { S.selected = k; break; }
    }
    setStatus('「' + S.level + '」难度 · 点格子后用 1-9 填数，或直接按键盘。');
    render();
  }

  /* -------------------------------------------------------------- 交互 */
  function selectCell(i) {
    if (S.finished) return;
    S.selected = i;
    render();
  }

  function moveSelection(key) {
    if (S.selected < 0) S.selected = 0;
    var r = rowOf(S.selected);
    var c = colOf(S.selected);
    if (key === 'ArrowUp') r = (r + 8) % 9;
    else if (key === 'ArrowDown') r = (r + 1) % 9;
    else if (key === 'ArrowLeft') c = (c + 8) % 9;
    else if (key === 'ArrowRight') c = (c + 1) % 9;
    S.selected = r * 9 + c;
    render();
  }

  function removePeerNotes(i, d) {
    var bit = ~(1 << (d - 1));
    var r = rowOf(i);
    var c = colOf(i);
    var b = Core.BOX[i];
    for (var k = 0; k < 81; k++) {
      if (k !== i && (rowOf(k) === r || colOf(k) === c || Core.BOX[k] === b)) {
        S.notes[k] &= bit;
      }
    }
  }

  function inputDigit(d) {
    if (S.finished || S.selected < 0) return;
    var i = S.selected;
    if (S.givens[i] || S.hinted[i]) {
      setStatus('这一格是题目给定或提示填出的，不能修改。');
      return;
    }
    pushUndo();
    if (S.notesMode) {
      var bit = 1 << (d - 1);
      if (S.grid[i]) {
        S.grid[i] = 0;
        S.notes[i] = bit;
      } else if (S.notes[i] & bit) {
        S.notes[i] &= ~bit;
      } else {
        S.notes[i] |= bit;
      }
      setStatus('笔记模式：已记录候选数 ' + d + '。');
    } else {
      S.grid[i] = d;
      S.notes[i] = 0;
      delete S.bad[i];
      removePeerNotes(i, d);
      startTimer();
    }
    render();
    checkWin();
  }

  function clearCell() {
    if (S.finished || S.selected < 0) return;
    var i = S.selected;
    if (S.givens[i] || S.hinted[i]) return;
    if (!S.grid[i] && !S.notes[i]) return;
    pushUndo();
    S.grid[i] = 0;
    S.notes[i] = 0;
    delete S.bad[i];
    render();
  }

  function toggleNotes() {
    S.notesMode = !S.notesMode;
    els.notesBtn.classList.toggle('on', S.notesMode);
    setStatus('笔记模式已' + (S.notesMode ? '打开' : '关闭') + '：填数字会记为候选数。');
  }

  function doHint() {
    if (S.finished || !S.solution) return;
    var target = -1;
    var i;
    if (S.selected >= 0 && S.grid[S.selected] !== S.solution[S.selected]) {
      target = S.selected;
    }
    if (target < 0) {
      var pool = [];
      for (i = 0; i < 81; i++) if (!S.grid[i]) pool.push(i);
      if (!pool.length) {
        for (i = 0; i < 81; i++) if (S.grid[i] && S.grid[i] !== S.solution[i]) pool.push(i);
      }
      if (!pool.length) { setStatus('没有需要提示的格子了。'); return; }
      target = pool[Math.floor(Math.random() * pool.length)];
    }

    pushUndo();
    var v = S.solution[target];
    S.grid[target] = v;
    S.notes[target] = 0;
    S.hinted[target] = 1;
    delete S.bad[target];
    S.hintsUsed++;
    removePeerNotes(target, v);
    S.selected = target;
    startTimer();
    setStatus('提示：第 ' + (rowOf(target) + 1) + ' 行第 ' + (colOf(target) + 1) + ' 列是 ' + v + '。');
    render();
    checkWin();
  }

  function doCheck() {
    if (S.finished || !S.solution) return;
    S.bad = Object.create(null);
    var n = 0;
    for (var i = 0; i < 81; i++) {
      if (S.grid[i] && S.grid[i] !== S.solution[i]) { S.bad[i] = 1; n++; }
    }
    S.mistakes = n;
    setStatus(n ? '检查：有 ' + n + ' 处填错了（已标红）。' : '检查：目前填入的数字都是对的。');
    render();
  }

  function doReveal() {
    if (S.finished || !S.solution) return;
    if (!window.confirm('确定要直接看答案吗？本局将结束。')) return;
    pushUndo();
    S.grid = S.solution.slice();
    S.notes = new Uint16Array(81);
    S.bad = Object.create(null);
    S.finished = true;
    setStatus('已显示答案。点「新游戏」再来一局吧。');
    render();
  }

  function checkWin() {
    if (S.finished) return;
    for (var i = 0; i < 81; i++) if (!S.grid[i]) return;
    for (var k = 0; k < 81; k++) {
      if (S.grid[k] !== S.solution[k]) {
        setStatus('填满了，但还有不对的地方 —— 按「检查」看看。');
        return;
      }
    }
    S.finished = true;
    if (S.startTime !== null) S.elapsed = (Date.now() - S.startTime) / 1000;
    renderStats();
    els.ovTitle.textContent = '恭喜完成！';
    els.ovText.innerHTML = '难度「' + S.level + '」 · 用时 ' + fmtTime(S.elapsed) +
      '<br>提示 ' + S.hintsUsed + ' 次' +
      (S.mistakes ? ' · 检查出 ' + S.mistakes + ' 处错误' : '');
    els.overlay.hidden = false;
    setStatus('恭喜完成「' + S.level + '」！用时 ' + fmtTime(S.elapsed) + '，提示 ' + S.hintsUsed + ' 次。');
  }

  /* -------------------------------------------------------------- 事件 */
  var ACTIONS = {
    hint: doHint,
    check: doCheck,
    undo: doUndo,
    notes: toggleNotes,
    clear: clearCell,
    reveal: doReveal,
  };

  els.actions.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var fn = ACTIONS[btn.dataset.act];
    if (fn) fn();
    btn.blur();
  });

  els.newBtn.addEventListener('click', function () { newGame(); els.newBtn.blur(); });
  els.level.addEventListener('change', newGame);
  els.ovAgain.addEventListener('click', function () { els.overlay.hidden = true; newGame(); });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      moveSelection(k);
      e.preventDefault();
      return;
    }
    if (k === 'Backspace' || k === 'Delete') { clearCell(); e.preventDefault(); return; }
    if (k === ' ') { toggleNotes(); e.preventDefault(); return; }
    if (k >= '1' && k <= '9') { inputDigit(Number(k)); e.preventDefault(); return; }
    if (k === '0') { clearCell(); e.preventDefault(); return; }

    var low = k.toLowerCase();
    if (low === 'h') { doHint(); e.preventDefault(); }
    else if (low === 'c') { doCheck(); e.preventDefault(); }
    else if (low === 'n') { toggleNotes(); e.preventDefault(); }
    else if (low === 'u') { doUndo(); e.preventDefault(); }
  });

  /* ---------------------------------------------------------------- 启动 */
  buildBoard();
  buildPad();
  newGame();
})();
