#!/bin/bash
# line2sheet 一鍵啟動腳本
# 用法: ./start.sh

set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ .env 不存在，請先複製 .env.example 填入設定"
  exit 1
fi

if [ ! -f service-account.json ]; then
  echo "❌ service-account.json 不存在，請從 Google Cloud Console 下載"
  exit 1
fi

# 啟動 server（背景）
echo "🚀 啟動 server on port 3000..."
bun run src/index.ts &
SERVER_PID=$!

# 等 server 準備好
sleep 2

# 啟動 ngrok
echo "🌐 啟動 ngrok..."
~/.local/bin/ngrok http 3000 --log=stdout &
NGROK_PID=$!

sleep 3

# 取得 ngrok 公開網址
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | \
  grep -o '"public_url":"https://[^"]*"' | \
  head -1 | cut -d'"' -f4)

echo ""
echo "✅ 啟動完成！"
echo ""
echo "📋 填入 LINE Developers 後台："
echo "   Webhook URL: ${NGROK_URL}/webhook"
echo ""
echo "按 Ctrl+C 停止所有服務"

# 等待
trap "kill $SERVER_PID $NGROK_PID 2>/dev/null" EXIT
wait
