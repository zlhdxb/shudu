@echo off
rem 数独 - Windows 一键启动
rem 需要 Python 3.7+（https://www.python.org/downloads/，安装时勾选 Add Python to PATH）

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto nopython

python sudoku_game.py %*
if errorlevel 1 pause
goto :eof

:nopython
where py >nul 2>nul
if errorlevel 1 (
    echo.
    echo 找不到 Python。请先安装 Python 3.7+：https://www.python.org/downloads/
    echo 安装时记得勾选 "Add Python to PATH"。
    echo.
    pause
    goto :eof
)
py sudoku_game.py %*
if errorlevel 1 pause
