#!/bin/bash
# X-Farmer — Khởi động trên macOS

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           X-FARMER — KHỞI ĐỘNG (MAC)            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Load nvm nếu có ────────────────────────────────
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ─── Dùng Node 20 nếu nvm có sẵn ────────────────────
if command -v nvm &>/dev/null; then
    nvm use 20 --silent 2>/dev/null || true
fi

# ─── Kiểm tra Node.js ───────────────────────────────
if ! command -v node &>/dev/null; then
    echo " [LỖI] Node.js chưa được cài đặt!"
    echo " Tải tại: https://nodejs.org"
    echo ""
    exit 1
fi

NODE_VER=$(node -v)
echo " [OK] Node.js $NODE_VER"

# ─── Kiểm tra và cài dependencies ───────────────────
if [ ! -d "node_modules" ]; then
    echo " [INFO] Chưa có node_modules, đang cài dependencies..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo " [LỖI] npm install thất bại!"
        exit 1
    fi
    echo ""
    echo " [OK] Đã cài xong dependencies"
else
    echo " [OK] Dependencies đã sẵn sàng"
fi

# ─── Kiểm tra config.json ────────────────────────────
if [ ! -f "config.json" ]; then
    echo " [LỖI] Không tìm thấy config.json!"
    exit 1
fi
echo " [OK] config.json"

# ─── Kiểm tra profiles.json ──────────────────────────
if [ ! -f "profiles.json" ]; then
    echo " [LỖI] Không tìm thấy profiles.json!"
    exit 1
fi
echo " [OK] profiles.json"

# ─── Khởi động Dashboard ─────────────────────────────
echo ""
echo " Đang khởi động Dashboard..."
echo " Mở trình duyệt: http://localhost:3000"
echo ""
echo " Nhấn Ctrl+C để dừng."
echo ""

node main.js server
