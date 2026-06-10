#!/bin/bash
cd "$(dirname "$0")"

# PMAS: предпочитаем Node-бэкенд (реальная 3D-реконструкция).
# Если Node нет — статический сервер Python (без реконструкции).
if command -v node >/dev/null 2>&1; then
  PORT="${PORT:-3000}"
  if [ ! -d node_modules ]; then
    echo "PMAS — первая установка зависимостей (npm install)..."
    npm install || { echo "npm install не удался"; exit 1; }
  fi
  echo "PMAS — запуск с 3D-реконструкцией на http://localhost:$PORT"
  echo "Для остановки нажмите Ctrl+C"
  (sleep 1 && open "http://localhost:$PORT") &
  PORT="$PORT" node backend/server.js
else
  PORT="${PORT:-8080}"
  echo "Node.js не найден — запускаю статический режим без 3D-реконструкции."
  echo "PMAS — запуск на http://localhost:$PORT"
  echo "Для остановки нажмите Ctrl+C"
  open "http://localhost:$PORT"
  python3 -m http.server "$PORT"
fi
