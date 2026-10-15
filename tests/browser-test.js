/* 临时：浏览器端黑盒自测（放进页面里跑，结果写进 #testout）
 * 只用 DOM 观察行为，不读内部状态。
 */
(function () {
  'use strict';
  var Core = window.SudokuCore;
  var out = [];
  var nPass = 0, nFail = 0;
  var errors = [];

  window.addEventListener('error', function (e) {
    errors.push('JS 运行时错误: ' + e.message + ' @' + e.filename + ':' + e.lineno);
  });

  function ok(cond, msg) {
    if (cond) { nPass++; out.push('PASS: ' + msg); }
    else { nFail++; out.push('FAIL: ' + msg); }
  }

  // 注意：棋盘是「9 个宫 × 每宫 9 格」的嵌套结构，DOM 顺序不等于格子编号顺序，
  // 所以要按 (行,列) 反查所属宫和宫内位置。
  function cellAt(i) {
    var r = Math.floor(i / 9), c = i % 9;
    var blocks = document.querySelectorAll('#board .block');
    var block = blocks[Math.floor(r / 3) * 3 + Math.floor(c / 3)];
    return block.querySelectorAll('.cell')[(r % 3) * 3 + (c % 3)];
  }
  function digitAt(i) { return cellAt(i).querySelector('.digit').textContent; }

  function readGivens() {
    var s = '';
    for (var i = 0; i < 81; i++) s += digitAt(i) || '.';
    return s;
  }

  function press(key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
  }

  /** 取某格同行/同列/同宫里已出现的数字 */
  function peerValues(i) {
    var vals = {};
    var r = Math.floor(i / 9), c = i % 9, b = Core.BOX[i];
    for (var k = 0; k < 81; k++) {
      if (k === i) continue;
      if (Math.floor(k / 9) === r || (k % 9) === c || Core.BOX[k] === b) {
        var v = digitAt(k);
        if (v) vals[v] = 1;
      }
    }
    return vals;
  }

  function report(err) {
    if (err) { errors.push('测试脚本异常: ' + (err.stack || err.message || err)); }
    var tail = errors.length ? '\n' + errors.join('\n') : '';
    out.push('');
    out.push('RESULT: ' + nPass + ' passed, ' + nFail + ' failed' + tail);
    var pre = document.createElement('pre');
    pre.id = 'testout';
    pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#fff;color:#000;font-size:11px;display:none';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }

  window.addEventListener('load', function () {
    try {
      /* ---------------------------------------------------- 1. 结构 */
      var cells = document.querySelectorAll('#board .cell');
      ok(cells.length === 81, '棋盘 81 格（实际 ' + cells.length + '）');
      ok(document.querySelectorAll('#board .block').length === 9, '棋盘 9 个宫');
      var pads = document.querySelectorAll('.pad-btn');
      ok(pads.length === 9, '数字键盘 9 个按钮（实际 ' + pads.length + '）');
      ok(document.querySelectorAll('.actions button').length === 6, '6 个功能按钮');

      /* ---------------------------------------------------- 2. 题目质量 */
      var givens = readGivens();
      var filled = 0;
      for (var i = 0; i < 81; i++) if (givens[i] !== '.') filled++;
      ok(filled >= 17 && filled <= 60, '题目提示数合理（' + filled + '）');
      var g = Core.fromStr(givens);
      var res = Core.solve(g, { limit: 2 });
      ok(res.count === 1, '页面上的题目唯一解（解数 ' + res.count + '）');
      ok(Core.isValidSolution(res.solution), '终盘合法');
      var startStats = document.getElementById('stats').textContent;
      ok(/时间 \d\d:\d\d/.test(startStats), '统计栏有时间显示（' + startStats + '）');
      ok(/提示数 \d+/.test(document.getElementById('sub').textContent), '副标题显示难度评级（' + document.getElementById('sub').textContent + '）');
      var noteTexts = Array.prototype.map.call(document.querySelectorAll('#board .notes'), function (n) {
        return n.textContent;
      }).join('');
      ok(noteTexts === '', '开局没有残留笔记');

      /* ---------------------------------------------------- 3. 选中与填数 */
      var empty = [];
      for (var k = 0; k < 81; k++) if (!digitAt(k)) empty.push(k);
      ok(empty.length === 81 - filled, '空位数正确（' + empty.length + '）');

      var target = empty[0];
      cellAt(target).click();
      ok(cellAt(target).className.indexOf('sel') >= 0, '点击后格子被选中');
      var peers = 0;
      for (var p = 0; p < 81; p++) if (p !== target && cellAt(p).className.indexOf('peer') >= 0) peers++;
      ok(peers === 20, '同行同列同宫高亮 20 格（实际 ' + peers + '）');

      var right = res.solution[target];
      var pv = peerValues(target);

      // 填正确数字 → 应是玩家色（不是题目给定的颜色）
      press(String(right));
      ok(digitAt(target) === String(right), '键盘填入数字 ' + right);
      ok(cellAt(target).querySelector('.digit').className.indexOf('c-user') >= 0,
        '玩家填的数字用玩家色');

      // 撤销
      press('u');
      ok(digitAt(target) === '', '撤销后格子清空');

      // 数字键盘按钮
      document.querySelectorAll('.pad-btn')[right - 1].click();
      ok(digitAt(target) === String(right), '点击数字键盘也能填数');
      press('Backspace');
      ok(digitAt(target) === '', '退格清除');

      // 与同行同列同宫重复的数字应自动标红（冲突高亮）
      var conflictDigit = 0;
      for (var cd in pv) { conflictDigit = Number(cd); break; }
      ok(conflictDigit > 0, '该格同行同列同宫里有已填数字（冲突测试的前提）');
      if (conflictDigit) {
        cellAt(target).click();
        press(String(conflictDigit));
        ok(digitAt(target) === String(conflictDigit), '填入重复数字 ' + conflictDigit);
        ok(cellAt(target).querySelector('.digit').className.indexOf('c-bad') >= 0,
          '与同行列宫重复的数字自动标红（冲突高亮）');
        press('Backspace');
        ok(digitAt(target) === '', '清除后恢复');
      }

      /* ---------------------------------------------------- 4. 检查 */
      var wrong = (right % 9) + 1; // 保证与正解不同
      cellAt(target).click();
      press(String(wrong));
      document.querySelector('button[data-act="check"]').click();
      var st = document.getElementById('status').textContent;
      ok(/有 1 处填错/.test(st), '检查能发现错误（' + st + '）');
      ok(cellAt(target).querySelector('.digit').className.indexOf('c-bad') >= 0, '错误数字标红');
      document.querySelector('button[data-act="undo"]').click();

      /* ---------------------------------------------------- 5. 笔记 */
      cellAt(target).click();
      press('n');
      press('3');
      press('7');
      var notes = cellAt(target).querySelector('.notes');
      var shown = Array.prototype.filter.call(notes.querySelectorAll('span'), function (s) { return s.textContent; })
        .map(function (s) { return s.textContent; }).join(',');
      ok(shown === '3,7', '笔记记录候选数 3 和 7（实际 "' + shown + '"）');
      press('3');
      shown = Array.prototype.filter.call(notes.querySelectorAll('span'), function (s) { return s.textContent; })
        .map(function (s) { return s.textContent; }).join(',');
      ok(shown === '7', '再按一次 3 取消该候选（实际 "' + shown + '"）');
      press('n'); // 关掉笔记模式
      ok(document.getElementById('notesBtn').className.indexOf('on') < 0, '笔记模式按钮状态可切换');
      press('Backspace');

      /* ---------------------------------------------------- 6. 提示 */
      cellAt(target).click();
      press('h');
      ok(digitAt(target) === String(res.solution[target]), '提示填入正确数字 ' + res.solution[target]);
      ok(cellAt(target).querySelector('.digit').className.indexOf('c-hint') >= 0, '提示填的数字用提示色');
      ok(/提示 1 次|提示：/.test(document.getElementById('stats').textContent + document.getElementById('status').textContent),
        '提示次数已统计');

      /* ---------------------------------------------------- 7. 填完获胜 */
      for (var q = 0; q < 81; q++) {
        if (!digitAt(q)) {
          cellAt(q).click();
          press(String(res.solution[q]));
        }
      }
      var full = 0;
      for (var f = 0; f < 81; f++) if (digitAt(f)) full++;
      ok(full === 81, '棋盘已填满（' + full + '）');
      var overlay = document.getElementById('overlay');
      ok(overlay.hidden === false, '完成后弹出完成提示');
      ok(/恭喜完成/.test(document.getElementById('ovTitle').textContent), '弹窗标题正确');
      ok(/用时 \d\d:\d\d/.test(document.getElementById('ovText').textContent), '弹窗显示用时');

      /* ---------------------------------------------------- 8. 换难度 */
      document.getElementById('ovAgain').click();
      ok(overlay.hidden === true, '「再来一局」关闭弹窗');
      var sel = document.getElementById('level');
      sel.value = '专家';
      sel.dispatchEvent(new Event('change'));
      var givens2 = readGivens();
      var filled2 = 0;
      for (var m = 0; m < 81; m++) if (givens2[m] !== '.') filled2++;
      ok(filled2 >= 22 && filled2 <= 26, '切到「专家」后提示数 22~26（实际 ' + filled2 + '）');
      ok(Core.solve(Core.fromStr(givens2), { limit: 2 }).count === 1, '「专家」题目也是唯一解');
      ok(document.getElementById('stats').textContent.indexOf('剩余 ' + (81 - filled2)) >= 0, '统计栏剩余格数更新');
      var allText = document.getElementById('board').textContent;
      ok(allText.length > 0, '棋盘有内容渲染');
    } catch (err) {
      report(err);
      return;
    }
    report(null);
  });
})();
