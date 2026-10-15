/*
 * 数独核心：求解 / 出题 / 难度评级
 * 浏览器与 Node 通用（UMD）。浏览器里挂在 window.SudokuCore，Node 里可 require。
 *
 * 算法：
 *   求解 = 位掩码 + 最少候选优先（MRV）回溯
 *   出题 = 随机终盘 → 逐个试删并验唯一解 → 按难度把提示数补回来
 *   难度 = 提示数 + "试错次数"（候选最少的格子仍有 >=2 个候选时算一次）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SudokuCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALL = 0x1ff; // bit0..bit8 表示数字 1..9
  var BOX = new Uint8Array(81);
  for (var i0 = 0; i0 < 81; i0++) {
    BOX[i0] = (((i0 / 27) | 0) * 3) + ((((i0 % 9) / 3) | 0));
  }

  function popcount(x) {
    var n = 0;
    while (x) { x &= x - 1; n++; }
    return n;
  }

  /* ---------------------------------------------------------------- 求解 */
  /**
   * @param {ArrayLike<number>} grid 长度 81，0 表示空格
   * @param {{limit?:number, countBranches?:boolean}} [opts]
   * @returns {{count:number, solution:Uint8Array|null, branches:number}}
   */
  function solve(grid, opts) {
    var o = opts || {};
    var limit = o.limit || 1;
    var countBranches = !!o.countBranches;

    var g = Uint8Array.from(grid);
    var rows = new Int32Array(9);
    var cols = new Int32Array(9);
    var boxes = new Int32Array(9);

    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (!v) continue;
      var bit = 1 << (v - 1);
      var r = (i / 9) | 0, c = i % 9, b = BOX[i];
      if ((rows[r] | cols[c] | boxes[b]) & bit) {
        return { count: 0, solution: null, branches: 0 }; // 题目自身冲突
      }
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
    }

    var found = [];
    var branches = 0;

    function dfs() {
      var best = -1, bestCnt = 10, bestMask = 0;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = ALL & ~(rows[(k / 9) | 0] | cols[k % 9] | boxes[BOX[k]]);
        var cnt = popcount(m);
        if (cnt === 0) return false;         // 死路，回溯
        if (cnt < bestCnt) {
          bestCnt = cnt; best = k; bestMask = m;
          if (cnt === 1) break;              // 唯一候选，不用再找了
        }
      }
      if (best < 0) {                        // 填满 = 一个解
        found.push(g.slice());
        return found.length >= limit;
      }
      if (countBranches && bestCnt > 1) branches++;

      var br = (best / 9) | 0, bc = best % 9, bb = BOX[best];
      for (var val = 1; val <= 9; val++) {
        var vb = 1 << (val - 1);
        if (!(bestMask & vb)) continue;
        g[best] = val;
        rows[br] |= vb; cols[bc] |= vb; boxes[bb] |= vb;
        if (dfs()) return true;
        g[best] = 0;
        rows[br] &= ~vb; cols[bc] &= ~vb; boxes[bb] &= ~vb;
      }
      return false;
    }

    dfs();
    return {
      count: found.length,
      solution: found.length ? found[0] : null,
      branches: branches,
    };
  }

  /** 解是否唯一（数到第 2 个解就停） */
  function isUnique(grid) {
    return solve(grid, { limit: 2 }).count === 1;
  }

  /** 难度评分：解这道题需要"试错"多少次（0 = 只用唯一候选就能推完） */
  function rate(grid) {
    return solve(grid, { limit: 1, countBranches: true }).branches;
  }

  /** 27 组单元各自恰好含 1~9 */
  function isValidSolution(g) {
    var seen = new Set();
    for (var unit = 0; unit < 9; unit++) {
      for (var k = 0; k < 9; k++) {
        var rv = g[unit * 9 + k];
        var cv = g[k * 9 + unit];
        var bv = g[(((unit / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (unit % 3) * 3 + (k % 3)];
        if (!rv || !cv || !bv) return false;
        seen.add('r' + unit + ':' + rv);
        seen.add('c' + unit + ':' + cv);
        seen.add('b' + unit + ':' + bv);
      }
    }
    return seen.size === 243;
  }

  /* ---------------------------------------------------------------- 随机 */
  /** 可复现的伪随机数发生器 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 随机生成一个完整合法终盘 */
  function randomSolution(rng) {
    var g = new Uint8Array(81);
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);

    function dfs() {
      var best = -1, bestCnt = 10, bestMask = 0;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = ALL & ~(rows[(k / 9) | 0] | cols[k % 9] | boxes[BOX[k]]);
        var cnt = popcount(m);
        if (cnt === 0) return false;
        if (cnt < bestCnt) {
          bestCnt = cnt; best = k; bestMask = m;
          if (cnt === 1) break;
        }
      }
      if (best < 0) return true;

      var vals = [];
      for (var v = 1; v <= 9; v++) if (bestMask & (1 << (v - 1))) vals.push(v);
      shuffle(vals, rng);

      var br = (best / 9) | 0, bc = best % 9, bb = BOX[best];
      for (var n = 0; n < vals.length; n++) {
        var vb = 1 << (vals[n] - 1);
        g[best] = vals[n];
        rows[br] |= vb; cols[bc] |= vb; boxes[bb] |= vb;
        if (dfs()) return true;
        g[best] = 0;
        rows[br] &= ~vb; cols[bc] &= ~vb; boxes[bb] &= ~vb;
      }
      return false;
    }

    if (!dfs()) throw new Error('生成终盘失败');
    return g;
  }

  /* ---------------------------------------------------------------- 出题 */
  /** 逐个试删：删掉后若解不再唯一就补回，挖到接近最少提示数 */
  function digMinimal(rng, solution, floor) {
    var min = floor || 17;
    var puzzle = Uint8Array.from(solution);
    var order = [];
    for (var i = 0; i < 81; i++) order.push(i);
    shuffle(order, rng);

    var clues = 81;
    for (var n = 0; n < order.length; n++) {
      if (clues <= min) break;
      var idx = order[n];
      var keep = puzzle[idx];
      puzzle[idx] = 0;
      if (isUnique(puzzle)) clues--;
      else puzzle[idx] = keep;
    }
    return { puzzle: puzzle, clues: clues };
  }

  /** 往回补提示数：补正确数字不会破坏唯一性 */
  function addClues(rng, puzzle, solution, target) {
    var holes = [];
    for (var i = 0; i < 81; i++) if (!puzzle[i]) holes.push(i);
    shuffle(holes, rng);
    var clues = 81 - holes.length;
    for (var n = 0; n < holes.length && clues < target; n++) {
      puzzle[holes[n]] = solution[holes[n]];
      clues++;
    }
    return clues;
  }

  // 四档难度：提示数区间 + 试错次数区间 + 同分时的偏好值
  var LEVELS = {
    '简单': { clues: [44, 52], branches: [0, 0], ideal: 0 },
    '中等': { clues: [33, 39], branches: [0, 3], ideal: 1 },
    '困难': { clues: [27, 31], branches: [2, 60], ideal: 6 },
    '专家': { clues: [22, 26], branches: [12, 1e9], ideal: 20 },
  };

  /**
   * 生成一道指定难度的题目。
   * 反复生成候选，按"提示数/试错次数是否落在区间内"打分，取最优；带时间预算。
   * @returns {{puzzle:Uint8Array, solution:Uint8Array, clues:number, branches:number, attempts:number}}
   */
  function makePuzzle(level, rng, opts) {
    var o = opts || {};
    var timeBudget = o.timeBudget == null ? 900 : o.timeBudget;
    var maxAttempts = o.maxAttempts == null ? 20 : o.maxAttempts;

    var cfg = LEVELS[level] || LEVELS['中等'];
    var loC = cfg.clues[0], hiC = cfg.clues[1];
    var loB = cfg.branches[0], hiB = cfg.branches[1];
    var midC = (loC + hiC) / 2;
    var t0 = Date.now();

    var best = null;
    var attempts = 0;
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt && Date.now() - t0 > timeBudget) break; // 超预算就用已有最好结果
      attempts++;
      var solution = randomSolution(rng);
      var dug = digMinimal(rng, solution);
      var puzzle = dug.puzzle;
      var clues = dug.clues;
      var target = loC + ((rng() * (hiC - loC + 1)) | 0);
      if (target > clues) clues = addClues(rng, puzzle, solution, target);

      var branches = rate(puzzle);
      var okClues = clues >= loC && clues <= hiC;
      var okBranch = branches >= loB && branches <= hiB;
      var score = (okClues ? 2 : 0) + (okBranch ? 3 : 0);
      var closeness = Math.abs(branches - cfg.ideal) + Math.abs(clues - midC) * 0.4;

      if (!best || score > best.score || (score === best.score && closeness < best.closeness)) {
        best = { score: score, closeness: closeness, puzzle: puzzle, solution: solution, clues: clues, branches: branches };
      }
      if (score === 5) break; // 两项都满足，收工
    }
    if (!best) throw new Error('出题失败');

    return {
      puzzle: best.puzzle,
      solution: best.solution,
      clues: best.clues,
      branches: best.branches,
      attempts: attempts,
    };
  }

  /* ---------------------------------------------------------------- 工具 */
  function fromStr(s) {
    var clean = String(s).replace(/[^0-9.]/g, '');
    if (clean.length !== 81) throw new Error('需要 81 个字符');
    var g = new Uint8Array(81);
    for (var i = 0; i < 81; i++) {
      var ch = clean[i];
      g[i] = (ch === '.' || ch === '0') ? 0 : Number(ch);
    }
    return g;
  }

  function toStr(g) {
    var s = '';
    for (var i = 0; i < 81; i++) s += g[i] ? String(g[i]) : '.';
    return s;
  }

  return {
    ALL: ALL,
    BOX: BOX,
    solve: solve,
    isUnique: isUnique,
    rate: rate,
    isValidSolution: isValidSolution,
    mulberry32: mulberry32,
    randomSolution: randomSolution,
    digMinimal: digMinimal,
    addClues: addClues,
    makePuzzle: makePuzzle,
    LEVELS: LEVELS,
    fromStr: fromStr,
    toStr: toStr,
  };
});
