// API endpoint: Раскрытие клетки
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Простая проверка валидности координат
function isValidCell(cellKey) {
  if (!cellKey || typeof cellKey !== 'string') return false;
  
  const pattern = /^-?\d+\.\d+,-?\d+\.\d+$/;
  if (!pattern.test(cellKey)) return false;
  
  const [lat, lng] = cellKey.split(',').map(Number);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Определение страны по координатам (упрощенная версия)
function getCountryFromCoords(lat, lng) {
  // Упрощенная логика определения страны
  // В продакшене нужно использовать реальные границы
  
  // Россия (очень упрощенно)
  if (lat > 50 && lat < 80 && lng > 20 && lng < 180) return 'RU';
  
  // Франция
  if (lat > 42 && lat < 51 && lng > -5 && lng < 8) return 'FR';
  
  // Германия
  if (lat > 47 && lat < 55 && lng > 6 && lng < 15) return 'DE';
  
  // Италия
  if (lat > 36 && lat < 47 && lng > 7 && lng < 19) return 'IT';
  
  // Испания
  if (lat > 36 && lat < 44 && lng > -10 && lng < 4) return 'ES';
  
  // Великобритания
  if (lat > 50 && lat < 59 && lng > -8 && lng < 2) return 'GB';
  
  // США
  if (lat > 25 && lat < 50 && lng > -125 && lng < -66) return 'US';
  
  // Китай
  if (lat > 20 && lat < 54 && lng > 73 && lng < 135) return 'CN';
  
  // Бразилия
  if (lat > -34 && lat < 5 && lng > -74 && lng < -34) return 'BR';
  
  // Австралия
  if (lat > -39 && lat < -10 && lng > 113 && lng < 154) return 'AU';
  
  // Канада
  if (lat > 42 && lat < 84 && lng > -141 && lng < -52) return 'CA';
  
  // Индия
  if (lat > 8 && lat < 35 && lng > 68 && lng < 97) return 'IN';
  
  // Япония
  if (lat > 30 && lat < 46 && lng > 129 && lng < 146) return 'JP';
  
  // По умолчанию - международные воды или неизвестно
  return 'XX';
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка preflight запроса
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { cellKey, userId = 'anonymous' } = req.body;
    
    // Валидация
    if (!isValidCell(cellKey)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid cell key format' 
      });
    }
    
    // Проверяем, не раскрыта ли уже клетка
    const isRevealed = await kv.sismember('revealed:cells', cellKey);
    
    if (isRevealed) {
      return res.status(200).json({ 
        success: false, 
        reason: 'already_revealed' 
      });
    }
    
    // Определяем страну
    const [lat, lng] = cellKey.split(',').map(Number);
    const country = getCountryFromCoords(lat, lng);
    
    // Если это вода или неизвестная территория
    if (country === 'XX') {
      return res.status(200).json({ 
        success: false, 
        reason: 'water_or_unknown' 
      });
    }
    
    // Сохраняем в базу (транзакция)
    const pipeline = kv.pipeline();
    
    // Добавляем в общий список раскрытых
    pipeline.sadd('revealed:cells', cellKey);
    
    // Добавляем в список страны
    pipeline.sadd(`country:${country}:revealed`, cellKey);
    
    // Добавляем в список пользователя
    pipeline.sadd(`user:${userId}:cells`, cellKey);
    
    // Увеличиваем счетчик пользователя
    pipeline.hincrby('user:scores', userId, 1);
    
    // Увеличиваем счетчик страны
    pipeline.hincrby('country:revealed:count', country, 1);
    
    // Добавляем временную метку
    pipeline.zadd('revealed:timeline', {
      score: Date.now(),
      member: `${cellKey}:${userId}:${country}`
    });
    
    await pipeline.exec();
    
    // Получаем обновленную статистику
    const countryTotal = await kv.hget('country:totals', country) || 10000;
    const countryRevealed = await kv.scard(`country:${country}:revealed`) || 1;
    const percentage = ((countryRevealed / countryTotal) * 100).toFixed(2);
    
    // Проверяем, первое ли это раскрытие для страны
    const firstReveal = countryRevealed === 1;
    
    res.status(200).json({
      success: true,
      country,
      percentage,
      firstReveal,
      totalRevealed: countryRevealed,
      message: firstReveal ? `Вы первым начали раскрывать ${country}!` : null
    });
    
  } catch (error) {
    console.error('Error revealing cell:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to reveal cell',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}