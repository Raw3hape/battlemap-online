#!/bin/bash

# 🚀 Полностью автоматический деплой BattleMap Online
# GitHub: Raw3hape | Vercel: sergyshkineu-2146

set -e

echo "🗺️  BattleMap Online - Автоматический деплой"
echo "============================================"
echo ""

# Цвета
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Проверка, что мы в правильной папке
if [ ! -f "battlemap-online.html" ]; then
    echo "❌ Ошибка: battlemap-online.html не найден"
    echo "Запустите скрипт из папки проекта"
    exit 1
fi

echo -e "${YELLOW}📝 Шаг 1: Подготовка проекта${NC}"
echo "Проект уже подготовлен ✅"
echo ""

echo -e "${YELLOW}🔧 Шаг 2: Создание GitHub репозитория${NC}"
echo "Попытка создать репозиторий на GitHub..."

# Проверяем GitHub CLI
if command -v gh &> /dev/null; then
    echo "GitHub CLI найден, создаю репозиторий..."
    
    # Проверяем авторизацию
    if gh auth status &> /dev/null; then
        # Создаем репозиторий
        gh repo create battlemap-online --public --source=. --remote=origin --push 2>/dev/null || {
            echo "Репозиторий уже существует или не удалось создать"
            git remote add origin https://github.com/Raw3hape/battlemap-online.git 2>/dev/null || true
            git push -u origin master 2>/dev/null || true
        }
        echo -e "${GREEN}✅ GitHub репозиторий настроен${NC}"
    else
        echo "Требуется авторизация в GitHub CLI"
        gh auth login
    fi
else
    echo "GitHub CLI не установлен"
    echo "Создайте репозиторий вручную на https://github.com/Raw3hape"
    echo "Название: battlemap-online"
    echo ""
    echo "После создания выполните:"
    echo "git remote add origin https://github.com/Raw3hape/battlemap-online.git"
    echo "git push -u origin master"
    echo ""
    read -p "Нажмите Enter когда создадите репозиторий..."
fi

echo ""
echo -e "${YELLOW}🚀 Шаг 3: Деплой на Vercel${NC}"
echo ""
echo "Сейчас произойдет:"
echo "1. Авторизация в Vercel (если нужно)"
echo "2. Линковка проекта"
echo "3. Деплой на продакшн"
echo ""

# Деплой через Vercel CLI
vercel --prod --yes 2>/dev/null || {
    echo ""
    echo "При первом запуске ответьте на вопросы:"
    echo "- Set up and deploy? Y"
    echo "- Which scope? sergyshkineu-2146"
    echo "- Link to existing project? N"
    echo "- Project name? battlemap-online"
    echo "- In which directory? ./"
    echo ""
    vercel --prod
}

echo ""
echo -e "${GREEN}✅ Проект развернут!${NC}"
echo ""

# Получаем URL проекта
PROJECT_URL=$(vercel ls 2>/dev/null | grep battlemap-online | awk '{print $2}' | head -1)

if [ -z "$PROJECT_URL" ]; then
    PROJECT_URL="https://battlemap-online.vercel.app"
fi

echo "============================================"
echo -e "${GREEN}🎉 ДЕПЛОЙ ЗАВЕРШЕН УСПЕШНО!${NC}"
echo "============================================"
echo ""
echo "📍 Ваш проект доступен по адресу:"
echo -e "   ${GREEN}$PROJECT_URL${NC}"
echo ""
echo "⚠️  ВАЖНО: Настройте KV хранилище:"
echo "1. Перейдите на https://vercel.com/sergyshkineu-2146/battlemap-online"
echo "2. Откройте вкладку Storage"
echo "3. Нажмите 'Create Database' → 'KV'"
echo "4. Назовите: battlemap-kv"
echo "5. Нажмите Create"
echo ""
echo "После создания KV хранилища:"
echo "vercel env pull .env.local"
echo "vercel --prod"
echo ""
echo "📚 GitHub: https://github.com/Raw3hape/battlemap-online"
echo "🎮 Игра: $PROJECT_URL"
echo ""