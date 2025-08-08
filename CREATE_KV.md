# 🎯 Создание KV хранилища для BattleMap

## Шаги в Vercel Dashboard:

### 1. Откройте вкладку Storage
В вашем проекте battlemap-online нажмите на вкладку **Storage** (рядом с Settings)

### 2. Создайте KV хранилище
- Нажмите кнопку **Create Database**
- Выберите **KV** (не Postgres, не Blob)
- В поле "Database Name" введите: `battlemap-kv`
- Выберите регион: **Washington D.C. (iad1)** (ближайший к вам)
- Нажмите **Create**

### 3. Подключите к проекту
После создания:
- Нажмите **Connect Project**
- Выберите **battlemap-online**
- Нажмите **Connect**

### 4. Обновите локальные переменные
В терминале выполните:
```bash
cd "/Users/nikita/Desktop/Apps/BattleMap v2"
vercel env pull .env.local
```

### 5. Обновите vercel.json
Добавьте обратно переменные окружения:
```json
"env": {
  "KV_REST_API_URL": "@kv-rest-api-url",
  "KV_REST_API_TOKEN": "@kv-rest-api-token"
}
```

### 6. Задеплойте обновление
```bash
vercel --prod
```

## После этого заработает:
- 🌍 Общий прогресс для всех игроков
- 🏆 Топ стран по раскрытию
- 👥 Совместное раскрытие карты
- 💾 Сохранение на сервере

---

**Или просто играйте как есть - локальное сохранение уже работает!**