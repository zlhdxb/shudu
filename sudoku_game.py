#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数独游戏（Python 3 + tkinter，无第三方依赖）

功能：
  * 图形界面，鼠标点击 / 键盘都能玩
  * 难度选择：简单 / 中等 / 困难 / 专家（题目现场生成，保证唯一解）
  * 提示功能：自动填出正确数字，并计数
  * 笔记（候选数）模式、撤销、检查、计时、剩余计数
  * 与同宫同行同列冲突的数字自动标红，填数时自动清理相关笔记

运行：
  python sudoku_game.py               开始游戏
  python sudoku_game.py --selftest 5  自检：每档难度各生成 5 题并打印统计
  python sudoku_game.py --smoketest   界面冒烟测试（不弹窗口）
"""

import argparse
import random
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk
from tkinter import font as tkfont

# ============================================================================
# 一、求解核心：位掩码 + 最少候选优先（MRV）回溯
# ============================================================================

ALL = 0x1FF  # bit0..bit8 分别代表数字 1..9
BOX_IDX = [(i // 27) * 3 + (i % 9) // 3 for i in range(81)]  # 每格属于哪个宫


def popcount(x):
    return bin(x).count('1')


def solve(grid, limit=1, count_branches=False):
    """
    搜索求解。

    limit: 最多找几个解。判唯一性时传 2（数到第 2 个就停，比穷举快得多）。
    count_branches: 是否统计"需要试错"的次数（候选最少的格子仍有 >=2 个候选时算一次）。

    返回 (解的数量, 第一个解 或 None, 试错次数)
    """
    g = list(grid)
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9

    for i, v in enumerate(g):
        if not v:
            continue
        bit = 1 << (v - 1)
        r, c, b = i // 9, i % 9, BOX_IDX[i]
        if (rows[r] | cols[c] | boxes[b]) & bit:
            return 0, None, 0  # 题目本身就有重复数字
        rows[r] |= bit
        cols[c] |= bit
        boxes[b] |= bit

    found = []
    branches = 0

    def dfs():
        nonlocal branches
        best = -1
        best_cnt = 10
        best_mask = 0
        # MRV：挑候选最少的空格先填；候选只剩 1 个就是强制走法
        for i in range(81):
            if g[i]:
                continue
            m = ALL & ~(rows[i // 9] | cols[i % 9] | boxes[BOX_IDX[i]])
            cnt = popcount(m)
            if cnt == 0:
                return False  # 这格没数可填了，回溯
            if cnt < best_cnt:
                best_cnt, best, best_mask = cnt, i, m
                if cnt == 1:
                    break
        if best < 0:  # 全填满了
            found.append(g[:])
            return len(found) >= limit
        if count_branches and best_cnt > 1:
            branches += 1

        r, c, b = best // 9, best % 9, BOX_IDX[best]
        for v in range(1, 10):
            bit = 1 << (v - 1)
            if not (best_mask & bit):
                continue
            g[best] = v
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            if dfs():
                return True
            g[best] = 0
            rows[r] &= ~bit
            cols[c] &= ~bit
            boxes[b] &= ~bit
        return False

    dfs()
    return len(found), (found[0] if found else None), branches


def solution_count(grid, limit=2):
    return solve(grid, limit=limit)[0]


def is_unique(grid):
    return solution_count(grid, 2) == 1


def rate(grid):
    """难度评分：解这道题需要"试错"多少次（0 = 只用唯一候选就能推完）。"""
    return solve(grid, limit=1, count_branches=True)[2]


def is_valid_solution(g):
    """27 组单元（9 行 + 9 列 + 9 宫）各自都必须恰好含 1~9。"""
    seen = set()
    for unit in range(9):
        for k in range(9):
            r = g[unit * 9 + k]
            c = g[k * 9 + unit]
            b = g[((unit // 3) * 3 + k // 3) * 9 + (unit % 3) * 3 + k % 3]
            if not r or not c or not b:
                return False
            seen.add(('r', unit, r))
            seen.add(('c', unit, c))
            seen.add(('b', unit, b))
    return len(seen) == 9 * 9 * 3


# ============================================================================
# 二、出题：随机终盘 → 尽量挖空 → 按难度补回提示数
# ============================================================================

def random_solution(rng):
    """随机生成一个完整合法的终盘（MRV 搜索 + 打乱候选顺序）。"""
    g = [0] * 81
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9

    def dfs():
        best = -1
        best_cnt = 10
        best_mask = 0
        for i in range(81):
            if g[i]:
                continue
            m = ALL & ~(rows[i // 9] | cols[i % 9] | boxes[BOX_IDX[i]])
            cnt = popcount(m)
            if cnt == 0:
                return False
            if cnt < best_cnt:
                best_cnt, best, best_mask = cnt, i, m
                if cnt == 1:
                    break
        if best < 0:
            return True
        vals = [v for v in range(1, 10) if best_mask >> (v - 1) & 1]
        rng.shuffle(vals)
        r, c, b = best // 9, best % 9, BOX_IDX[best]
        for v in vals:
            bit = 1 << (v - 1)
            g[best] = v
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            if dfs():
                return True
            g[best] = 0
            rows[r] &= ~bit
            cols[c] &= ~bit
            boxes[b] &= ~bit
        return False

    if not dfs():
        raise RuntimeError('生成终盘失败')  # 实际上不会发生
    return g


def dig_minimal(rng, solution, floor=17):
    """
    逐个试删：删掉后若解不再唯一就补回去。
    删到底通常得到 22~28 个提示数的"接近最少提示"题目。
    """
    puzzle = list(solution)
    order = list(range(81))
    rng.shuffle(order)
    clues = 81
    for i in order:
        if clues <= floor:
            break
        keep = puzzle[i]
        puzzle[i] = 0
        if not is_unique(puzzle):
            puzzle[i] = keep
        else:
            clues -= 1
    return puzzle, clues


def add_clues(rng, puzzle, solution, target):
    """往回补提示数：给唯一解的题目补上正确数字，唯一性不会被破坏。"""
    holes = [i for i in range(81) if not puzzle[i]]
    rng.shuffle(holes)
    clues = 81 - len(holes)
    for i in holes:
        if clues >= target:
            break
        puzzle[i] = solution[i]
        clues += 1
    return puzzle, clues


# 每档难度：提示数区间 + 可接受的"试错次数"区间 + 同分时的偏好值
# （提示数越少越难；试错次数 = 只用"唯一候选"推不下去、必须试数的次数）
LEVELS = {
    '简单': {'clues': (44, 52), 'branches': (0, 0), 'ideal': 0},
    '中等': {'clues': (33, 39), 'branches': (0, 3), 'ideal': 1},
    '困难': {'clues': (27, 31), 'branches': (2, 60), 'ideal': 6},
    '专家': {'clues': (22, 26), 'branches': (12, 10 ** 9), 'ideal': 20},
}


def make_puzzle(level, rng, time_budget=2.5, max_attempts=24):
    """
    生成一道指定难度的题目。

    做法：反复生成候选题目（挖空 + 补回提示数），按"提示数落在区间内""试错次数
    落在区间内"打分，取分数最高、且最接近理想值的一道。带时间预算，不会卡住。
    返回 (puzzle, solution, clues, branches)
    """
    cfg = LEVELS[level]
    lo_c, hi_c = cfg['clues']
    lo_b, hi_b = cfg['branches']
    ideal_b = cfg['ideal']
    mid_c = (lo_c + hi_c) / 2

    t0 = time.time()
    best = None
    for attempt in range(max_attempts):
        if attempt and time.time() - t0 > time_budget:
            break  # 超时就用已有的最好结果，保证界面不卡
        solution = random_solution(rng)
        puzzle, clues = dig_minimal(rng, solution)
        target = rng.randint(lo_c, hi_c)
        if target > clues:
            puzzle, clues = add_clues(rng, puzzle, solution, target)
        n, _, branches = solve(puzzle, limit=1, count_branches=True)
        if n != 1:  # 挖洞时已保证唯一解，这里只是防御
            continue
        ok_clues = lo_c <= clues <= hi_c
        ok_branch = lo_b <= branches <= hi_b
        score = (2 if ok_clues else 0) + (3 if ok_branch else 0)
        closeness = abs(branches - ideal_b) + abs(clues - mid_c) * 0.4
        cand = (score, -closeness, puzzle, solution, clues, branches)
        if best is None or cand[:2] > best[:2]:
            best = cand
        if score == 5:
            break  # 两项都满足，收工
    if best is None:
        raise RuntimeError('出题失败，请再试一次')
    _, _, puzzle, solution, clues, branches = best
    return puzzle, solution, clues, branches


# ============================================================================
# 三、界面
# ============================================================================

CELL = 60
BOARD_PX = CELL * 9

BG = '#f4f6f8'
COL_GIVEN = '#1b1b1b'   # 题目给定
COL_USER = '#1565c0'    # 玩家填入
COL_HINT = '#2e7d32'    # 提示填出
COL_BAD = '#c62828'     # 冲突 / 检查出错误
COL_NOTE = '#607d8b'    # 笔记
COL_SEL = '#90caf9'     # 选中格
COL_SAME = '#ffe082'    # 同行列宫同数字
COL_PEER = '#eceff1'    # 同行列宫
COL_GRID = '#37474f'


def fmt_time(sec):
    sec = int(sec)
    return '%02d:%02d' % (sec // 60, sec % 60)


class SudokuApp:
    def __init__(self, root, seed=None, silent=False):
        self.root = root
        self.rng = random.Random(seed)
        self.silent = silent          # 冒烟测试时不弹窗
        self.busy = False
        self._pending = None
        self._work_error = None
        self._closing = False

        # 局面状态
        self.puzzle = None
        self.solution = None
        self.grid = [0] * 81
        self.notes = [set() for _ in range(81)]
        self.givens = set()
        self.hinted = set()
        self.bad = set()
        self.selected = None
        self.notes_mode = False
        self.undo_stack = []
        self.hints_used = 0
        self.mistakes = 0
        self.start_time = None
        self.elapsed = 0.0
        self.finished = False
        self.clues = 0
        self.branches = 0

        self._build_ui()
        self._tick()
        self.new_game()

    # ---------------------------------------------------------------- 界面搭建
    def _btn(self, parent, text, cmd, width=8):
        return tk.Button(parent, text=text, command=cmd, width=width,
                         font=self.f_ui, takefocus=0, bg='white',
                         activebackground='#e3f2fd', relief='raised', bd=1)

    def _build_ui(self):
        root = self.root
        root.title('数独')
        root.configure(bg=BG)
        root.resizable(False, False)

        self.f_ui = tkfont.Font(family='Microsoft YaHei UI', size=10)
        self.f_big = tkfont.Font(family='Segoe UI', size=25, weight='bold')
        self.f_note = tkfont.Font(family='Segoe UI', size=9)
        self.f_msg = tkfont.Font(family='Microsoft YaHei UI', size=14)

        # ---- 顶栏：难度 + 新游戏 + 统计
        top = tk.Frame(root, bg=BG)
        top.pack(fill='x', padx=14, pady=(12, 4))
        tk.Label(top, text='难度', font=self.f_ui, bg=BG).pack(side='left')
        # 注意：StringVar 必须留一个 Python 引用（self.level_var），
        # 否则会被垃圾回收，Tcl 变量随之消失，Combobox.get() 会返回空串。
        self.level_var = tk.StringVar(value='中等')
        self.level_box = ttk.Combobox(top, values=list(LEVELS), textvariable=self.level_var,
                                      state='readonly', width=6, font=self.f_ui)
        self.level_box.pack(side='left', padx=(6, 10))
        self.level_box.bind('<<ComboboxSelected>>', lambda e: self.new_game())
        self._btn(top, '新游戏', self.new_game, width=8).pack(side='left')

        self.lbl_stat = tk.Label(top, text='', font=self.f_ui, bg=BG, fg='#455a64')
        self.lbl_stat.pack(side='right')

        # ---- 中部：棋盘 + 右侧面板
        mid = tk.Frame(root, bg=BG)
        mid.pack(padx=14, pady=6)

        self.canvas = tk.Canvas(mid, width=BOARD_PX, height=BOARD_PX, bg='white',
                                highlightthickness=1, highlightbackground=COL_GRID, takefocus=0)
        self.canvas.pack(side='left')
        self.canvas.bind('<Button-1>', self.on_click)

        panel = tk.Frame(mid, bg=BG)
        panel.pack(side='left', padx=(12, 0), anchor='n')

        pad = tk.Frame(panel, bg=BG)
        pad.pack()
        self.digit_btns = {}
        for d in range(1, 10):
            b = tk.Button(pad, text=str(d), font=self.f_ui, width=4, pady=6,
                          takefocus=0, command=lambda dd=d: self.enter_digit(dd),
                          bg='white', activebackground='#e3f2fd', relief='raised', bd=1)
            b.grid(row=(d - 1) // 3, column=(d - 1) % 3, padx=2, pady=2)
            self.digit_btns[d] = b

        funcs = tk.Frame(panel, bg=BG)
        funcs.pack(pady=(12, 0))
        self._btn(funcs, '提示 (H)', self.do_hint, 10).grid(row=0, column=0, padx=2, pady=2)
        self._btn(funcs, '检查 (C)', self.do_check, 10).grid(row=0, column=1, padx=2, pady=2)
        self._btn(funcs, '撤销 (U)', self.do_undo, 10).grid(row=1, column=0, padx=2, pady=2)
        self.btn_notes = self._btn(funcs, '笔记 (N)', self.toggle_notes, 10)
        self.btn_notes.grid(row=1, column=1, padx=2, pady=2)
        self._btn(funcs, '清除', self.clear_cell, 10).grid(row=2, column=0, padx=2, pady=2)
        self._btn(funcs, '显示答案', self.reveal_all, 10).grid(row=2, column=1, padx=2, pady=2)

        tk.Label(panel, text='方向键移动 · 1-9 填数\n退格清除 · 空格切换笔记',
                 font=self.f_ui, bg=BG, fg='#78909c', justify='left').pack(pady=(12, 0), anchor='w')

        # ---- 底部状态栏
        self.status = tk.Label(root, text='', font=self.f_ui, bg=BG, fg='#37474f',
                               anchor='w', justify='left', wraplength=BOARD_PX + 210)
        self.status.pack(fill='x', padx=16, pady=(6, 12))

        root.bind_all('<Key>', self.on_key)
        root.update_idletasks()
        w, h = root.winfo_reqwidth(), root.winfo_reqheight()
        x = (root.winfo_screenwidth() - w) // 2
        y = max(0, (root.winfo_screenheight() - h) // 2 - 30)
        root.geometry('%dx%d+%d+%d' % (w, h, x, y))
        root.protocol('WM_DELETE_WINDOW', self.on_close)

    # ---------------------------------------------------------------- 绘制
    def draw(self):
        c = self.canvas
        c.delete('all')
        sel = self.selected
        sel_val = self.grid[sel] if sel is not None else 0
        highlighted = self.bad | self.conflict_cells()

        for i in range(81):
            r, col = divmod(i, 9)
            x0, y0 = col * CELL, r * CELL
            fill = 'white'
            if sel is not None:
                if r == sel // 9 or col == sel % 9 or BOX_IDX[i] == BOX_IDX[sel]:
                    fill = COL_PEER
                if sel_val and self.grid[i] == sel_val:
                    fill = COL_SAME
                if i == sel:
                    fill = COL_SEL
            c.create_rectangle(x0, y0, x0 + CELL, y0 + CELL, fill=fill, outline='')

            v = self.grid[i]
            cx, cy = x0 + CELL / 2, y0 + CELL / 2
            if v:
                if i in highlighted:
                    color = COL_BAD
                elif i in self.givens:
                    color = COL_GIVEN
                elif i in self.hinted:
                    color = COL_HINT
                else:
                    color = COL_USER
                c.create_text(cx, cy, text=str(v), font=self.f_big, fill=color)
            elif self.notes[i]:
                for d in sorted(self.notes[i]):
                    nr, nc = divmod(d - 1, 3)
                    c.create_text(x0 + (nc + 0.5) * CELL / 3, y0 + (nr + 0.5) * CELL / 3,
                                  text=str(d), font=self.f_note, fill=COL_NOTE)

        for k in range(10):
            w = 3 if k % 3 == 0 else 1
            pos = k * CELL
            c.create_line(pos, 0, pos, BOARD_PX, width=w, fill=COL_GRID)
            c.create_line(0, pos, BOARD_PX, pos, width=w, fill=COL_GRID)

        if self.busy:
            c.create_text(BOARD_PX / 2, BOARD_PX / 2, text='正在生成题目…',
                          font=self.f_msg, fill='#37474f')

    def conflict_cells(self):
        """同行/同列/同宫里重复出现的数字，全部标红。"""
        bad = set()
        units = [[r * 9 + c for c in range(9)] for r in range(9)]
        units += [[r * 9 + c for r in range(9)] for c in range(9)]
        units += [[i for i in range(81) if BOX_IDX[i] == b] for b in range(9)]
        for unit in units:
            seen = {}
            for i in unit:
                if self.grid[i]:
                    seen.setdefault(self.grid[i], []).append(i)
            for idxs in seen.values():
                if len(idxs) > 1:
                    bad.update(idxs)
        return bad

    def update_stats(self):
        left = sum(1 for v in self.grid if not v)
        txt = '时间 %s   ·   剩余 %d 格   ·   提示 %d' % (fmt_time(self.elapsed), left, self.hints_used)
        if self.mistakes:
            txt += '   ·   检查出 %d 处错误' % self.mistakes
        self.lbl_stat.config(text=txt)
        used = {}
        for v in self.grid:
            if v:
                used[v] = used.get(v, 0) + 1
        for d, b in self.digit_btns.items():
            b.config(state='disabled' if used.get(d, 0) >= 9 else 'normal',
                     fg='#b0bec5' if used.get(d, 0) >= 9 else '#1b1b1b')

    def set_status(self, text):
        self.status.config(text=text)

    def _tick(self):
        if self._closing:
            return
        if not self.finished and self.start_time is not None:
            self.elapsed = time.time() - self.start_time
        self.update_stats()
        self.root.after(500, self._tick)

    # ---------------------------------------------------------------- 出题
    def new_game(self):
        if self.busy:
            return
        level = self.level_var.get()
        self.busy = True
        self._pending = None
        self._work_error = None
        self.finished = False
        self.grid = [0] * 81
        self.notes = [set() for _ in range(81)]
        self.givens, self.hinted, self.bad = set(), set(), set()
        self.selected = None
        self.undo_stack = []
        self.hints_used = 0
        self.mistakes = 0
        self.start_time = None
        self.elapsed = 0.0
        self.set_status('正在生成「%s」难度的题目…' % level)
        self.update_stats()
        self.draw()
        seed = self.rng.randrange(1 << 30)
        threading.Thread(target=self._gen_worker, args=(level, seed), daemon=True).start()
        self.root.after(40, self._poll_gen)

    def _gen_worker(self, level, seed):
        """后台线程只算数据，绝不碰 tkinter。"""
        try:
            puzzle, solution, clues, branches = make_puzzle(level, random.Random(seed))
            self._pending = (puzzle, solution, clues, branches)
        except Exception as exc:  # noqa: BLE001
            self._work_error = exc

    def _poll_gen(self):
        if self._closing:
            return
        if self._work_error is not None:
            err, self._work_error = self._work_error, None
            self.busy = False
            self.set_status('生成失败：%s' % err)
            self.draw()
            if not self.silent:
                messagebox.showerror('出错了', str(err))
            return
        if self._pending is None:
            self.root.after(40, self._poll_gen)
            return
        puzzle, solution, clues, branches = self._pending
        self._pending = None
        self._start_puzzle(puzzle, solution, clues, branches)

    def _start_puzzle(self, puzzle, solution, clues, branches):
        self.puzzle = puzzle
        self.solution = solution
        self.grid = list(puzzle)
        self.notes = [set() for _ in range(81)]
        self.givens = {i for i, v in enumerate(puzzle) if v}
        self.hinted, self.bad = set(), set()
        self.clues, self.branches = clues, branches
        self.busy = False
        self.finished = False
        self.selected = next((i for i in range(81) if not self.grid[i]), None)
        level = self.level_var.get()
        self.set_status('「%s」难度 · 提示数 %d · 需要试错 %d 次 —— 点格子后按 1-9 填数'
                        % (level, clues, branches))
        self.draw()
        self.update_stats()

    # ---------------------------------------------------------------- 操作
    def start_timer_if_needed(self):
        if self.start_time is None:
            self.start_time = time.time()

    def push_undo(self):
        self.undo_stack.append((self.grid[:], [set(s) for s in self.notes],
                                set(self.hinted), set(self.bad), self.hints_used, self.mistakes))
        if len(self.undo_stack) > 300:
            self.undo_stack.pop(0)

    def do_undo(self):
        if self.busy or not self.undo_stack:
            if not self.busy:
                self.set_status('没有可撤销的操作。')
            return
        grid, notes, hinted, bad, hints, mistakes = self.undo_stack.pop()
        self.grid, self.notes, self.hinted, self.bad = grid, notes, hinted, bad
        self.hints_used, self.mistakes = hints, mistakes
        self.finished = False
        self.set_status('已撤销。')
        self.draw()
        self.update_stats()

    def on_click(self, event):
        if self.busy or self.finished:
            return
        col, r = int(event.x // CELL), int(event.y // CELL)
        if 0 <= r < 9 and 0 <= col < 9:
            self.selected = r * 9 + col
            try:
                self.canvas.focus_set()
            except tk.TclError:
                pass
            self.draw()

    def move_selection(self, key):
        if self.selected is None:
            self.selected = 0
        r, c = divmod(self.selected, 9)
        if key == 'Up':
            r = (r - 1) % 9
        elif key == 'Down':
            r = (r + 1) % 9
        elif key == 'Left':
            c = (c - 1) % 9
        elif key == 'Right':
            c = (c + 1) % 9
        self.selected = r * 9 + c
        self.draw()

    def remove_peer_notes(self, i, d):
        r, c, b = i // 9, i % 9, BOX_IDX[i]
        for k in range(81):
            if k != i and (k // 9 == r or k % 9 == c or BOX_IDX[k] == b):
                self.notes[k].discard(d)

    def enter_digit(self, d):
        if self.busy or self.finished or self.selected is None:
            return
        i = self.selected
        if i in self.givens or i in self.hinted:
            self.set_status('这一格是题目给定或提示填出的，不能修改。')
            return
        self.push_undo()
        if self.notes_mode:
            if self.grid[i]:
                self.grid[i] = 0
                self.notes[i] = {d}
            elif d in self.notes[i]:
                self.notes[i].discard(d)
            else:
                self.notes[i].add(d)
            self.set_status('笔记模式：已记录候选数 %d。' % d)
        else:
            self.grid[i] = d
            self.notes[i].clear()
            self.bad.discard(i)
            self.remove_peer_notes(i, d)
            self.start_timer_if_needed()
        self.draw()
        self.update_stats()
        self.check_win()

    def clear_cell(self):
        if self.busy or self.finished or self.selected is None:
            return
        i = self.selected
        if i in self.givens or i in self.hinted:
            return
        if not self.grid[i] and not self.notes[i]:
            return
        self.push_undo()
        self.grid[i] = 0
        self.notes[i] = set()
        self.bad.discard(i)
        self.draw()
        self.update_stats()

    def toggle_notes(self):
        self.notes_mode = not self.notes_mode
        self.btn_notes.config(text='笔记 开' if self.notes_mode else '笔记 (N)',
                              relief='sunken' if self.notes_mode else 'raised')
        self.set_status('笔记模式已%s：填数字会记为候选数。' % ('打开' if self.notes_mode else '关闭'))

    def do_hint(self):
        if self.busy or self.finished or self.solution is None:
            return
        target = None
        i = self.selected
        if i is not None and self.grid[i] != self.solution[i]:
            target = i                      # 选中的格子是空或填错 → 直接补它
        if target is None:
            wrong = [k for k in range(81) if self.grid[k] and self.grid[k] != self.solution[k]]
            empty = [k for k in range(81) if not self.grid[k]]
            pool = empty or wrong
            if not pool:
                self.set_status('没有需要提示的格子了。')
                return
            target = self.rng.choice(pool)

        self.push_undo()
        v = self.solution[target]
        self.grid[target] = v
        self.notes[target].clear()
        self.hinted.add(target)
        self.bad.discard(target)
        self.hints_used += 1
        self.remove_peer_notes(target, v)
        self.selected = target
        self.start_timer_if_needed()
        self.set_status('提示：第 %d 行第 %d 列是 %d。' % (target // 9 + 1, target % 9 + 1, v))
        self.draw()
        self.update_stats()
        self.check_win()

    def do_check(self):
        if self.busy or self.finished or self.solution is None:
            return
        wrong = {i for i in range(81) if self.grid[i] and self.grid[i] != self.solution[i]}
        self.bad = wrong
        self.mistakes = len(wrong)
        if wrong:
            self.set_status('检查：有 %d 处填错了（已标红）。' % len(wrong))
        else:
            self.set_status('检查：目前填入的数字都是对的。')
        self.draw()
        self.update_stats()

    def reveal_all(self):
        if self.busy or self.solution is None or self.finished:
            return
        if not self.silent and not messagebox.askyesno('显示答案', '确定要直接看答案吗？本局将结束。'):
            return
        self.push_undo()
        self.grid = list(self.solution)
        self.notes = [set() for _ in range(81)]
        self.bad = set()
        self.finished = True
        self.set_status('已显示答案。按「新游戏」再来一局吧。')
        self.draw()
        self.update_stats()

    def check_win(self):
        if self.finished or any(v == 0 for v in self.grid):
            return
        if any(self.grid[i] != self.solution[i] for i in range(81)):
            self.set_status('填满了，但还有不对的地方 —— 按「检查」看看。')
            return
        self.finished = True
        if self.start_time is not None:
            self.elapsed = time.time() - self.start_time
        msg = '恭喜完成「%s」！用时 %s，提示 %d 次。' % (
            self.level_var.get(), fmt_time(self.elapsed), self.hints_used)
        self.set_status(msg)
        self.draw()
        self.update_stats()
        if not self.silent:
            messagebox.showinfo('完成', msg)

    # ---------------------------------------------------------------- 键盘
    def on_key(self, event):
        if self.busy:
            return
        if isinstance(self.root.focus_get(), ttk.Combobox):
            return
        key = event.keysym
        if key in ('Up', 'Down', 'Left', 'Right'):
            self.move_selection(key)
            return 'break'
        if key in ('BackSpace', 'Delete'):
            self.clear_cell()
            return 'break'
        if key == 'space':
            self.toggle_notes()
            return 'break'
        ch = event.char or ''
        if ch in '123456789':
            self.enter_digit(int(ch))
            return 'break'
        if ch == '0':
            self.clear_cell()
            return 'break'
        low = key.lower()
        if low == 'h':
            self.do_hint()
            return 'break'
        if low == 'c':
            self.do_check()
            return 'break'
        if low == 'n':
            self.toggle_notes()
            return 'break'
        if low == 'u':
            self.do_undo()
            return 'break'

    def on_close(self):
        self._closing = True
        self.root.destroy()


# ============================================================================
# 四、自检
# ============================================================================

def selftest(n=5):
    rng = random.Random(20241012)
    print('每档难度各生成 %d 题：' % n)
    for level in LEVELS:
        t0 = time.time()
        stats = []
        for _ in range(n):
            puzzle, solution, clues, branches = make_puzzle(level, rng)
            assert is_valid_solution(solution), '终盘不合法'
            assert is_unique(puzzle), '题目不是唯一解'
            assert all(puzzle[i] == 0 or puzzle[i] == solution[i] for i in range(81)), '给定数字与解不符'
            assert rate(puzzle) == branches
            stats.append((clues, branches))
        dt = (time.time() - t0) / n
        print('  %s：提示数 %d~%d，试错 %d~%d，平均 %.0f ms/题' % (
            level,
            min(s[0] for s in stats), max(s[0] for s in stats),
            min(s[1] for s in stats), max(s[1] for s in stats),
            dt * 1000))
    print('自检通过：所有题目都是唯一解，终盘合法，给定数字与解一致。')


class _Ev:
    """模拟 tkinter 事件对象，用于冒烟测试。"""

    def __init__(self, **kw):
        self.keysym = kw.get('keysym', '')
        self.char = kw.get('char', '')
        self.state = kw.get('state', 0)
        self.x = kw.get('x', 0)
        self.y = kw.get('y', 0)


def _wait(app, pred, timeout=180):
    t0 = time.time()
    while not pred():
        app.root.update()
        time.sleep(0.01)
        if time.time() - t0 > timeout:
            raise TimeoutError('等待超时')


def smoketest():
    root = tk.Tk()
    root.withdraw()
    app = SudokuApp(root, seed=7, silent=True)
    _wait(app, lambda: not app.busy)   # 等 __init__ 里那局生成完
    for level in LEVELS:
        app.level_var.set(level)
        app.new_game()
        _wait(app, lambda: not app.busy)
        assert app.solution is not None and app.givens, level
        empties = [i for i in range(81) if not app.grid[i]]
        assert empties, '题目不该是满的'

        # 画布确实画出了东西：81 个格子底 + 网格线 + 数字/笔记
        items = app.canvas.find_all()
        kinds = {app.canvas.type(i) for i in items}
        assert 'rectangle' in kinds and 'line' in kinds and 'text' in kinds, '画布没画全'
        assert len(items) >= 81 + 20, '画布元素太少：%d' % len(items)

        i = empties[0]
        r, c = divmod(i, 9)
        app.on_click(_Ev(x=c * CELL + CELL // 2, y=r * CELL + CELL // 2))
        assert app.selected == i, '点击命中格子错误'

        # 键盘填数 + 撤销
        wrong = next(d for d in range(1, 10) if d != app.solution[i])
        app.on_key(_Ev(keysym=str(wrong), char=str(wrong)))
        assert app.grid[i] == wrong, '键盘填数失败'
        app.on_key(_Ev(keysym='u', char='u'))
        assert app.grid[i] == 0, '撤销失败'

        # 方向键
        app.on_key(_Ev(keysym='Right'))
        assert app.selected == min(i + 1, 80)
        app.selected = i

        # 笔记模式
        app.on_key(_Ev(keysym='n', char='n'))
        app.on_key(_Ev(keysym='4', char='4'))
        assert 4 in app.notes[i], '笔记没记上'
        app.on_key(_Ev(keysym='n', char='n'))

        # 提示
        before = app.hints_used
        app.do_hint()
        assert app.hints_used == before + 1, '提示计数没变'
        assert app.grid[i] == app.solution[i], '提示没填对'
        assert i in app.hinted

        # 冲突标红
        j = next((k for k in range(81) if k not in app.givens and k != i), None)
        if j is not None:
            app.selected = j
            app.enter_digit(app.grid[i])
            assert j in app.conflict_cells() or app.grid[j] == app.grid[i]

        # 检查
        app.do_check()
        # 故意填错再检查，必须被发现
        app.selected = next(k for k in range(81) if k not in app.givens and not app.grid[k])
        bad_v = next(d for d in range(1, 10) if d != app.solution[app.selected])
        app.enter_digit(bad_v)
        app.do_check()
        assert app.mistakes >= 1, '检查没发现错误'
        # 显示答案 / 胜利判定
        app.grid = list(app.solution)
        app.draw()
        app.check_win()
        assert app.finished, '胜利判定失败'
    app.on_close()
    print('界面冒烟测试通过：四档难度均可生成、点击/键盘/笔记/提示/撤销/检查/胜利判定均正常。')


def main():
    # 输出被重定向/管道捕获时，Windows 会退回 GBK，中文会乱码 —— 这里统一成 UTF-8。
    if not sys.stdout.isatty():
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:  # noqa: BLE001
            pass

    parser = argparse.ArgumentParser(description='数独游戏')
    parser.add_argument('--selftest', nargs='?', const=5, type=int, metavar='N',
                        help='自检：每档难度各生成 N 题并打印统计')
    parser.add_argument('--smoketest', action='store_true', help='界面冒烟测试（不显示窗口）')
    parser.add_argument('--seed', type=int, default=None, help='随机种子')
    args = parser.parse_args()

    if args.selftest is not None:
        selftest(args.selftest)
        return
    if args.smoketest:
        smoketest()
        return

    root = tk.Tk()
    SudokuApp(root, seed=args.seed)
    root.mainloop()


if __name__ == '__main__':
    sys.exit(main())
