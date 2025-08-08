#!/bin/bash

# 🚀 BattleMap Online - Автоматическая установка
# GitHub: Raw3hape
# Vercel: sergyshkineu-2146

set -e

echo "🗺️  BattleMap Online - Автоматическая установка"
echo "================================================"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Проверка установленных инструментов
check_requirements() {
    echo -e "${YELLOW}📋 Проверка зависимостей...${NC}"
    
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git не установлен${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js не установлен${NC}"
        exit 1
    fi
    
    if ! command -v vercel &> /dev/null; then
        echo -e "${YELLOW}⚠️  Vercel CLI не установлен. Устанавливаю...${NC}"
        npm i -g vercel
    fi
    
    echo -e "${GREEN}✅ Все зависимости установлены${NC}"
}

# Создание структуры проекта
create_project_structure() {
    echo -e "${YELLOW}📁 Создание структуры проекта...${NC}"
    
    # Создаем папки
    mkdir -p battlemap-online/{api,lib,scripts,public}
    cd battlemap-online
    
    # Копируем существующий фронтенд
    cp ../battlemap-fixed-grid.html public/index.html
    
    echo -e "${GREEN}✅ Структура создана${NC}"
}

# Инициализация Git репозитория
init_git() {
    echo -e "${YELLOW}🔧 Инициализация Git...${NC}"
    
    git init
    
    # Создаем .gitignore
    cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
.vercel
.DS_Store
*.log
dist/
.cache/
EOF
    
    git add .
    git commit -m "Initial commit: BattleMap Online"
    
    # Создаем репозиторий на GitHub
    echo -e "${YELLOW}📦 Создание репозитория на GitHub...${NC}"
    
    # Используем GitHub CLI если доступен, иначе инструкции
    if command -v gh &> /dev/null; then
        gh repo create battlemap-online --public --source=. --remote=origin --push
    else
        echo -e "${YELLOW}Создайте репозиторий вручную:${NC}"
        echo "1. Перейдите на https://github.com/Raw3hape"
        echo "2. Создайте новый репозиторий 'battlemap-online'"
        echo "3. Выполните команды:"
        echo "   git remote add origin https://github.com/Raw3hape/battlemap-online.git"
        echo "   git push -u origin main"
        read -p "Нажмите Enter после создания репозитория..."
    fi
    
    echo -e "${GREEN}✅ Git настроен${NC}"
}

# Настройка проекта
setup_project() {
    echo -e "${YELLOW}⚙️  Настройка проекта...${NC}"
    
    # package.json
    cat > package.json << 'EOF'
{
  "name": "battlemap-online",
  "version": "1.0.0",
  "description": "Онлайн игра раскрытия карты мира",
  "scripts": {
    "dev": "vercel dev",
    "build": "echo 'No build needed'",
    "deploy": "vercel --prod",
    "init-world": "node scripts/generate-world-grid.js",
    "setup-db": "node scripts/setup-database.js"
  },
  "dependencies": {
    "@vercel/kv": "^1.0.1",
    "@vercel/postgres": "^0.5.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0"
  }
}
EOF

    # vercel.json
    cat > vercel.json << 'EOF'
{
  "buildCommand": "echo 'No build needed'",
  "outputDirectory": "public",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/public/$1" }
  ],
  "functions": {
    "api/*.js": {
      "maxDuration": 10
    }
  }
}
EOF
    
    echo -e "${GREEN}✅ Конфигурация создана${NC}"
}

# Подключение к Vercel
connect_vercel() {
    echo -e "${YELLOW}🔗 Подключение к Vercel...${NC}"
    
    # Логин в Vercel
    vercel login
    
    # Линковка проекта
    vercel link --yes
    
    # Создание KV хранилища
    echo -e "${YELLOW}💾 Создание KV хранилища...${NC}"
    vercel kv add battlemap-kv
    
    # Получение переменных окружения
    vercel env pull .env.local
    
    echo -e "${GREEN}✅ Vercel подключен${NC}"
}

# Установка зависимостей
install_dependencies() {
    echo -e "${YELLOW}📦 Установка зависимостей...${NC}"
    npm install
    echo -e "${GREEN}✅ Зависимости установлены${NC}"
}

# Деплой
deploy_project() {
    echo -e "${YELLOW}🚀 Деплой проекта...${NC}"
    
    # Коммит всех изменений
    git add .
    git commit -m "Setup complete" || true
    git push origin main || true
    
    # Деплой на Vercel
    vercel --prod
    
    echo -e "${GREEN}✅ Проект развернут!${NC}"
}

# Вывод информации
print_success() {
    echo ""
    echo -e "${GREEN}🎉 Установка завершена успешно!${NC}"
    echo "================================================"
    echo -e "📍 Ваш проект доступен по адресу:"
    echo -e "   ${GREEN}https://battlemap-online.vercel.app${NC}"
    echo ""
    echo -e "🔧 Полезные команды:"
    echo -e "   ${YELLOW}npm run dev${NC} - локальная разработка"
    echo -e "   ${YELLOW}npm run deploy${NC} - деплой на продакшн"
    echo -e "   ${YELLOW}npm run init-world${NC} - инициализация мировой сетки"
    echo ""
    echo -e "📚 Документация: https://github.com/Raw3hape/battlemap-online"
}

# Основной процесс
main() {
    check_requirements
    create_project_structure
    setup_project
    init_git
    connect_vercel
    install_dependencies
    deploy_project
    print_success
}

# Запуск
main