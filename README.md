# BattleMap Online v2 🗺️

Многопользовательская игра по раскрытию реальной карты мира. Исследуйте планету вместе с другими игроками!

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install

# Локальная разработка
npm run dev

# Сборка для продакшена
npm run build

# Деплой на Vercel
vercel --prod
```

## 📁 Структура проекта

```
BattleMap v2/
├── src/                      # Исходный код
│   ├── client/              # Frontend код
│   │   ├── js/             # JavaScript модули
│   │   │   ├── BattleMap.js        # Основной класс игры
│   │   │   ├── OnlineBattleMap.js  # Онлайн функциональность
│   │   │   ├── ApiService.js       # API клиент
│   │   │   └── app.js              # Точка входа
│   │   └── css/            # Стили (пока не используется)
│   └── api/                # Backend API
│       ├── middleware/     # Middleware функции
│       │   ├── cors.js            # CORS настройки
│       │   ├── validation.js      # Валидация данных
│       │   └── errorHandler.js    # Обработка ошибок
│       └── utils/          # Утилиты
│           └── redis.js           # Redis клиент
│
├── api/                     # API endpoints (Vercel Functions)
│   ├── game-state.js       # Состояние игры и топ стран
│   ├── reveal-cell.js      # Раскрытие клеток
│   ├── leaderboard.js      # Таблица лидеров
│   └── world-state.js      # Альтернативный endpoint
│
├── public/                  # Статические файлы
│   ├── css/               # CSS файлы
│   │   └── main.css      # Основные стили
│   └── js/               # JavaScript bundles
│       └── battlemap.bundle.js  # Собранный bundle
│
├── legacy/                  # Архивные файлы
│   └── ...                 # Старые версии и эксперименты
│
├── scripts/                 # Скрипты деплоя
│   └── ...                 # Bash скрипты
│
└── docs/                    # Документация
    └── ...                 # MD файлы

```

## 🎮 Основные функции

- **Раскрытие карты**: Кликайте по карте чтобы раскрывать клетки 10x10 км
- **Онлайн синхронизация**: Все изменения синхронизируются между игроками
- **Топ стран**: Отслеживание прогресса по странам с процентами
- **Статистика**: Количество раскрытых клеток, площадь, онлайн игроки
- **Стили карт**: 7 различных стилей карт на выбор

## 🛠️ Технологии

- **Frontend**: Vanilla JavaScript (ES6 модули), Leaflet.js
- **Backend**: Vercel Serverless Functions
- **База данных**: Upstash Redis
- **Карты**: OpenStreetMap, CartoDB, ESRI
- **Деплой**: Vercel

## 📊 API Endpoints

### GET /api/game-state
Возвращает состояние игры, все раскрытые клетки и топ-10 стран

### POST /api/reveal-cell
Раскрывает клетку на карте
```json
{
  "cellKey": "55.7,37.6",
  "userId": "player_123"
}
```

### GET /api/leaderboard
Возвращает таблицу лидеров и последнюю активность

### GET /api/world-state
Альтернативный endpoint для состояния мира

## 🔧 Переменные окружения

Создайте `.env.local` файл:

```bash
KV_REST_API_URL=your_upstash_redis_url
KV_REST_API_TOKEN=your_upstash_redis_token
```

## 📈 Улучшения v2

### ✅ Выполнено:
- Модульная структура кода
- Разделение на клиент/сервер
- Middleware для API
- Единый CSS файл
- Улучшенная валидация
- Архивирование старых файлов

### 🔄 В планах:
- TypeScript поддержка
- Unit тесты
- WebSocket для real-time обновлений
- Service Worker для offline режима
- Webpack/Vite для сборки
- CI/CD pipeline

## 📝 Лицензия

MIT

## 👨‍💻 Разработка

Для локальной разработки используйте:

```bash
# Запуск Vercel dev сервера
vercel dev

# Или простой HTTP сервер
python -m http.server 8000
```

## 🚢 Деплой

Проект автоматически деплоится на Vercel при пуше в master:

```bash
git add .
git commit -m "feat: описание изменений"
git push origin master
```

---

🌍 **Live Demo**: [battlemap-online.vercel.app](https://battlemap-online.vercel.app)