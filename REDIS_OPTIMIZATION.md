# Оптимизация использования Redis для BattleMap

## Текущая ситуация
- За сессию тестирования: 4,900 команд (1,804 записи + 3,135 чтений)
- Бесплатный лимит Upstash: 500,000 команд/месяц
- При активном использовании можем превысить лимит

## Стратегии оптимизации

### 1. Увеличить интервалы синхронизации
```javascript
// Текущее: 20 секунд
syncDelay = 20000;

// Рекомендуемое: 60 секунд
syncDelay = 60000;

// Для новых игроков: 30 секунд первые 5 минут, потом 60
syncDelay = isNewPlayer ? 30000 : 60000;
```

### 2. Умная синхронизация
```javascript
// Синхронизировать только при активности
let lastActivity = Date.now();

function syncWithServer() {
    // Пропускать синхронизацию если нет активности > 5 минут
    if (Date.now() - lastActivity > 300000) {
        return;
    }
    // ... остальной код
}

// Обновлять lastActivity при любом клике
function handleReveal() {
    lastActivity = Date.now();
    // ...
}
```

### 3. Кэширование на клиенте
```javascript
// Хранить последнюю версию данных
let cachedGameState = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 секунд

async function getGameState() {
    // Использовать кэш если свежий
    if (cachedGameState && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedGameState;
    }
    
    // Иначе запросить с сервера
    const response = await fetch('/api/game-state');
    cachedGameState = await response.json();
    cacheTimestamp = Date.now();
    return cachedGameState;
}
```

### 4. Батчинг более агрессивный
```javascript
// Текущее
batchDelay = 500; // 0.5 сек
maxBatchSize = 10;

// Рекомендуемое
batchDelay = 2000; // 2 сек
maxBatchSize = 50; // больше клеток в батче
```

### 5. Дельта-синхронизация
```javascript
// В API добавить параметр timestamp
GET /api/game-state?since=1234567890

// Возвращать только новые клетки с момента since
// Это уменьшит объем данных и количество операций
```

### 6. Оптимизация структуры данных в Redis

#### Текущая структура (предположительно):
```
SET game:cells -> ["cell1", "cell2", ...] // Много операций SADD
```

#### Оптимизированная структура:
```
// Использовать битмапы для клеток
SETBIT game:bitmap <cell_index> 1

// Или HyperLogLog для подсчета уникальных
PFADD game:cells cell1 cell2 cell3

// Или упакованные строки
SET game:packed "compressed_binary_data"
```

### 7. Статистика обновлять реже
```javascript
// Топ стран обновлять раз в 5 минут
const TOP_COUNTRIES_CACHE_TTL = 300000;

// Общее количество клеток - раз в минуту
const TOTAL_CELLS_CACHE_TTL = 60000;
```

### 8. Lazy Loading для неактивных данных
```javascript
// Загружать топ стран только при открытии панели
function showTopCountries() {
    if (!topCountriesLoaded) {
        loadTopCountries();
        topCountriesLoaded = true;
    }
}
```

## Мониторинг использования

### Добавить в код отслеживание:
```javascript
class RedisMonitor {
    constructor() {
        this.stats = {
            reads: 0,
            writes: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }
    
    logRead() {
        this.stats.reads++;
        this.reportIfNeeded();
    }
    
    logWrite() {
        this.stats.writes++;
        this.reportIfNeeded();
    }
    
    reportIfNeeded() {
        // Каждые 100 операций логировать
        const total = this.stats.reads + this.stats.writes;
        if (total % 100 === 0) {
            console.log('Redis usage:', this.stats);
        }
    }
}
```

## Экстренные меры при превышении лимита

1. **Отключить синхронизацию для новых игроков**
```javascript
// Только локальное сохранение для новых
if (isOverLimit) {
    useLocalStorageOnly = true;
}
```

2. **Read-only режим**
```javascript
// Показывать только существующие данные
if (isOverLimit) {
    allowNewReveals = false;
    showMessage("Сервер перегружен, попробуйте позже");
}
```

3. **Использовать CDN для статичных данных**
```javascript
// Кэшировать game-state на CDN на 1 минуту
// Это уменьшит нагрузку на Redis
```

## Рекомендуемые изменения для продакшена

### Приоритет 1 (срочно):
- [ ] Увеличить syncDelay до 60 секунд
- [ ] Увеличить batchDelay до 2 секунд
- [ ] Добавить пропуск синхронизации при неактивности

### Приоритет 2 (важно):
- [ ] Реализовать дельта-синхронизацию
- [ ] Добавить кэширование на клиенте
- [ ] Оптимизировать структуру данных в Redis

### Приоритет 3 (желательно):
- [ ] Добавить мониторинг использования
- [ ] Реализовать lazy loading
- [ ] Настроить CDN кэширование

## Ожидаемый результат
При внедрении всех оптимизаций:
- **Снижение команд на 70-80%**
- **Остаться в пределах бесплатного тарифа**
- **Поддержка до 1000 активных игроков/день**