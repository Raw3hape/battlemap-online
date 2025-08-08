# BattleMap v2 - Документация проекта

## 📋 Обзор проекта

BattleMap v2 - это интерактивная онлайн-игра, где пользователи раскрывают карту мира, убирая "туман войны" с клеток размером 10x10 км. Проект использует Leaflet для карт, Canvas для рендеринга тумана, и Upstash Redis для хранения данных.

## 🏗️ Архитектура

### Фронтенд
- **Leaflet.js** - интерактивные карты
- **Canvas API** - рендеринг тумана и сетки
- **Vanilla JavaScript** - основная логика (модульная структура)

### Бэкенд
- **Vercel Serverless Functions** - API endpoints
- **Upstash Redis** - хранение состояния игры
- **KV Storage** - персистентность данных

## 📁 Структура проекта

```
BattleMap v2/
├── api/                      # Serverless функции
│   ├── reveal-batch.js      # Батчинг раскрытия клеток
│   ├── game-state.js        # Получение состояния игры
│   ├── player-stats.js      # Статистика игроков
│   └── admin/               # Админ-функции
│       └── reset.js         # Сброс состояния
│
├── public/
│   ├── js/                  # JavaScript модули
│   │   ├── battlemap-stable.js    # Стабильная версия (рекомендуется)
│   │   ├── battlemap-final.js     # Финальная версия с оптимизациями
│   │   └── battlemap-optimized.js # Версия с защитой от спама
│   │
│   └── css/
│       ├── main.css         # Основные стили
│       └── main-mobile.css  # Мобильные стили
│
├── index.html               # Главная страница
├── vercel.json             # Конфигурация Vercel
└── package.json            # Зависимости
```

## 🎮 Основной функционал

### Режимы управления

#### Десктоп
- **Клик** - раскрыть одну клетку
- **Shift + ЛКМ или ПКМ** - перемещение карты
- **Колесо мыши** - зум

#### Мобильные устройства
- **Тап** - раскрыть клетку
- **Свайп** - перемещение карты
- **Щипок** - зум
- **Двойной тап** - быстрый зум

### Ключевые особенности
- Сетка клеток 10x10 км
- Батчинг запросов (до 10 клеток)
- Rate limiting (5 кликов/сек)
- Синхронизация каждые 20 секунд
- Темная/светлая тема
- 8 стилей карт
- Локальное сохранение прогресса

## 🚀 API Endpoints

### `/api/reveal-batch`
```javascript
POST /api/reveal-batch
{
  cells: ["55.7558,37.6173", ...],
  playerId: "player_abc123",
  timestamp: 1234567890
}
```

### `/api/game-state`
```javascript
GET /api/game-state
Response: {
  allCells: [...],
  totalCells: 1234,
  onlinePlayers: 42,
  topCountries: [...]
}
```

## ⚡ Критические оптимизации

### iOS Safari
- Отключены анимации (`fadeAnimation: false`)
- Canvas с `willReadFrequently: false`
- Throttling рендеринга (100мс)
- Ограничение количества клеток (1000)

### Производительность
- Viewport-based рендеринг
- Батчинг Canvas операций
- RequestAnimationFrame для рендеринга
- Кэширование тайлов карты

## 🐛 Известные проблемы и решения

### Проблема: iPhone Safari зависает при зуме
**Решение**: Отключены анимации Leaflet для iOS, добавлен throttling

### Проблема: Десктоп drag не работал
**Решение**: Реализован через Shift+ЛКМ или ПКМ

### Проблема: Высокая нагрузка от рисования
**Решение**: Переход на tap-only режим (без drawing mode)

### Проблема: 500 ошибка "Failed to parse URL from /pipeline"
**Решение**: Использование прямых Redis команд вместо pipeline

## 🔧 Переменные окружения

```env
KV_REST_API_URL=https://your-redis-url.upstash.io
KV_REST_API_TOKEN=your-token-here
```

## 📊 Ключевые настройки

```javascript
// Размер клетки
CELL_SIZE_KM = 10;
CELL_SIZE_LAT = 10 / 111;

// Батчинг
batchDelay = 500ms;
maxBatchSize = 10;

// Rate limiting
maxClicksPerSecond = 5;
revealCooldown = 200ms;

// Синхронизация
syncDelay = 20000ms;

// Рендеринг
renderDelay = 100ms;
maxCells = 1000;      // Для iOS
maxLines = 100;       // Для сетки
```

## 🎨 Темы и стили карт

### Темы
- `dark` - темная тема (по умолчанию)
- `light` - светлая тема

### Стили карт
- `osm` - OpenStreetMap
- `hot` - OSM HOT
- `topo` - Топографическая
- `positron` - CartoDB Light
- `dark` - CartoDB Dark
- `satellite` - Спутник

## 📱 Версии JavaScript файлов

### battlemap-stable.js (РЕКОМЕНДУЕТСЯ)
- Максимальная стабильность
- Оптимизирован для iOS
- Tap-only режим
- Разделенное управление desktop/mobile

### battlemap-final.js
- Полный функционал
- Drawing mode (может вызывать нагрузку)
- Rate limiting 5 клик/сек

### battlemap-optimized.js
- Экспериментальные оптимизации
- Viewport caching
- Rate limiting 15 клик/сек

## 🚀 Деплой

1. Проект настроен для Vercel
2. Автоматический деплой из GitHub
3. Serverless функции в папке `/api`
4. Статика в папке `/public`

## 💾 Локальное хранение

```javascript
localStorage:
- battleMapPlayerId - ID игрока
- battleMapProgress - сохраненный прогресс
- battleMapTheme - выбранная тема
```

## 📈 Мониторинг производительности

Ключевые метрики для отслеживания:
- FPS при рендеринге
- Время отклика API
- Размер батчей
- Rate limit hits
- Синхронизация задержек

## 🔄 Будущие улучшения

1. WebSocket для real-time обновлений
2. Оптимизация для больших датасетов
3. Прогрессивная загрузка клеток
4. Кэширование на CDN
5. Добавление достижений и геймификации

## 📝 Команды разработки

```bash
# Локальная разработка
npm run dev

# Деплой на Vercel
vercel --prod

# Проверка логов
vercel logs
```

## ⚠️ Важные заметки

1. **Всегда используйте battlemap-stable.js в продакшене** - самая стабильная версия
2. **iOS требует особого внимания** - отключайте анимации, используйте throttling
3. **Rate limiting критичен** - защита от спама и перегрузки
4. **Upstash имеет ограничения** - не используйте pipeline команды
5. **Тестируйте на реальных устройствах** - эмуляторы не показывают все проблемы

## 🤝 Контакты и поддержка

При возникновении проблем проверьте:
1. Консоль браузера на ошибки
2. Network tab на 500 ошибки
3. Vercel логи на серверные ошибки
4. Redis метрики в Upstash dashboard

---

*Последнее обновление: Декабрь 2024*
*Версия: 2.0 (stable)*