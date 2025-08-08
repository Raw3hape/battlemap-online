#!/bin/bash

# 🚀 Быстрый деплой BattleMap Online
# Для пользователя: Raw3hape (GitHub) / sergyshkineu-2146 (Vercel)

echo "🗺️  BattleMap Online - Быстрый деплой"
echo "====================================="

# Проверка Vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "📦 Установка Vercel CLI..."
    npm i -g vercel
fi

# Создание package.json
cat > package.json << 'EOF'
{
  "name": "battlemap-online",
  "version": "1.0.0",
  "scripts": {
    "dev": "vercel dev",
    "deploy": "vercel --prod"
  },
  "dependencies": {
    "@vercel/kv": "^1.0.1"
  }
}
EOF

# Создание vercel.json
cat > vercel.json << 'EOF'
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "functions": {
    "api/*.js": {
      "maxDuration": 10
    }
  }
}
EOF

# Установка зависимостей
echo "📦 Установка зависимостей..."
npm install

# Инициализация Git
if [ ! -d .git ]; then
    git init
    git add .
    git commit -m "Initial commit: BattleMap Online"
fi

# Деплой
echo "🚀 Деплой на Vercel..."
echo ""
echo "При первом запуске:"
echo "1. Войдите в Vercel (используйте GitHub аккаунт Raw3hape)"
echo "2. Выберите scope: sergyshkineu-2146"
echo "3. Подтвердите создание проекта"
echo ""

vercel --prod

echo ""
echo "✅ Деплой завершен!"
echo ""
echo "📝 Следующие шаги:"
echo "1. Перейдите в Vercel Dashboard: https://vercel.com/sergyshkineu-2146"
echo "2. Откройте проект battlemap-online"
echo "3. Перейдите в Storage -> Create Database -> KV"
echo "4. Создайте KV хранилище с именем 'battlemap-kv'"
echo "5. Обновите деплой: vercel --prod"
echo ""
echo "🎮 Ваша игра будет доступна по адресу, показанному выше!"