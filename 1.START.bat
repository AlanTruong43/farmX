@echo off
chcp 65001 >nul
title X-Farmer Dashboard

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║           X-FARMER — KHỞI ĐỘNG                  ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: ─── Kiểm tra Node.js ───────────────────────────────
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo  [LỖI] Node.js chưa được cài đặt!
    echo  Tải tại: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: ─── Kiểm tra và cài dependencies ───────────────────
if not exist "node_modules" (
    echo  [INFO] Chưa có node_modules, đang cài dependencies...
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [LỖI] npm install thất bại!
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Đã cài xong dependencies
) else (
    echo  [OK] Dependencies đã sẵn sàng
)

:: ─── Kiểm tra config.json ────────────────────────────
if not exist "config.json" (
    echo  [LỖI] Không tìm thấy config.json!
    pause
    exit /b 1
)
echo  [OK] config.json

:: ─── Kiểm tra profiles.json ──────────────────────────
if not exist "profiles.json" (
    echo  [LỖI] Không tìm thấy profiles.json!
    pause
    exit /b 1
)
echo  [OK] profiles.json

:: ─── Khởi động Dashboard ─────────────────────────────
echo.
echo  Đang khởi động Dashboard...
echo  Mở trình duyệt: http://localhost:3000
echo.
echo  Nhấn Ctrl+C để dừng.
echo.

node main.js server

pause
