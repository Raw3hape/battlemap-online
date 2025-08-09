// API endpoint: Сохранение цветных пикселей с определением страны
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Rate limiting
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;
const MAX_PIXELS_PER_BATCH = 50;

// Упрощенное определение страны по координатам
function getCountryCode(lat, lng) {
    // Россия
    if (lat > 41 && lat < 82 && lng > 27 && lng < 180) {
        if (lat > 50 || lng > 40) return 'RU';
    }
    // США
    if (lat > 24 && lat < 50 && lng > -130 && lng < -65) return 'US';
    // Канада
    if (lat > 45 && lat < 75 && lng > -140 && lng < -50) return 'CA';
    // Бразилия
    if (lat > -35 && lat < 6 && lng > -74 && lng < -34) return 'BR';
    // Китай
    if (lat > 18 && lat < 54 && lng > 73 && lng < 135) return 'CN';
    // Австралия
    if (lat > -44 && lat < -10 && lng > 112 && lng < 154) return 'AU';
    // Индия
    if (lat > 6 && lat < 36 && lng > 68 && lng < 98) return 'IN';
    // Франция
    if (lat > 41 && lat < 51.5 && lng > -5 && lng < 9.5) return 'FR';
    // Германия
    if (lat > 47 && lat < 55.5 && lng > 5.5 && lng < 15.5) return 'DE';
    // Италия
    if (lat > 35 && lat < 47.5 && lng > 6.5 && lng < 19) return 'IT';
    // Испания
    if (lat > 35.5 && lat < 44 && lng > -9.5 && lng < 4) return 'ES';
    // Великобритания
    if (lat > 49.5 && lat < 61 && lng > -8.5 && lng < 2) return 'GB';
    // Польша
    if (lat > 49 && lat < 55 && lng > 14 && lng < 24.5) return 'PL';
    // Украина
    if (lat > 44 && lat < 52.5 && lng > 22 && lng < 40.5) return 'UA';
    // Турция
    if (lat > 35.5 && lat < 42.5 && lng > 25.5 && lng < 45) return 'TR';
    // Япония
    if (lat > 30 && lat < 46 && lng > 129 && lng < 146) return 'JP';
    // Мексика
    if (lat > 14 && lat < 33 && lng > -118 && lng < -86) return 'MX';
    // Аргентина
    if (lat > -55 && lat < -21 && lng > -74 && lng < -53) return 'AR';
    // Норвегия
    if (lat > 57 && lat < 72 && lng > 4 && lng < 32) {
        if (lng < 25 || lat > 68) return 'NO';
    }
    // Швеция
    if (lat > 55 && lat < 69.5 && lng > 10.5 && lng < 24.5) return 'SE';
    // Финляндия
    if (lat > 59.5 && lat < 70.5 && lng > 19 && lng < 32) return 'FI';
    
    return 'XX'; // Неизвестно
}

const countryNames = {
    'RU': '🇷🇺 Россия',
    'US': '🇺🇸 США',
    'CA': '🇨🇦 Канада',
    'BR': '🇧🇷 Бразилия',
    'CN': '🇨🇳 Китай',
    'AU': '🇦🇺 Австралия',
    'IN': '🇮🇳 Индия',
    'FR': '🇫🇷 Франция',
    'DE': '🇩🇪 Германия',
    'IT': '🇮🇹 Италия',
    'ES': '🇪🇸 Испания',
    'GB': '🇬🇧 Великобритания',
    'JP': '🇯🇵 Япония',
    'MX': '🇲🇽 Мексика',
    'AR': '🇦🇷 Аргентина',
    'NO': '🇳🇴 Норвегия',
    'SE': '🇸🇪 Швеция',
    'FI': '🇫🇮 Финляндия',
    'PL': '🇵🇱 Польша',
    'UA': '🇺🇦 Украина',
    'TR': '🇹🇷 Турция',
    'XX': '❓ Неизвестно'
};

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { pixels, playerId } = req.body;
        
        // Валидация
        if (!pixels || !Array.isArray(pixels)) {
            return res.status(400).json({ error: 'Invalid pixels data' });
        }
        
        if (pixels.length === 0) {
            return res.status(400).json({ error: 'Empty batch' });
        }
        
        if (pixels.length > MAX_PIXELS_PER_BATCH) {
            return res.status(400).json({ 
                error: `Batch too large. Maximum ${MAX_PIXELS_PER_BATCH} pixels per batch` 
            });
        }
        
        // Rate limiting
        const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();
        
        for (const [ip, data] of rateLimits.entries()) {
            if (now - data.windowStart > RATE_LIMIT_WINDOW) {
                rateLimits.delete(ip);
            }
        }
        
        let ipData = rateLimits.get(clientIp);
        if (!ipData) {
            ipData = { windowStart: now, requests: 0 };
            rateLimits.set(clientIp, ipData);
        }
        
        if (now - ipData.windowStart <= RATE_LIMIT_WINDOW) {
            ipData.requests++;
            if (ipData.requests > MAX_REQUESTS_PER_WINDOW) {
                return res.status(429).json({ 
                    error: 'Rate limit exceeded',
                    retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - ipData.windowStart)) / 1000)
                });
            }
        } else {
            ipData.windowStart = now;
            ipData.requests = 1;
        }
        
        // Обрабатываем пиксели и определяем страны
        const timestamp = Date.now();
        const promises = [];
        
        for (const pixel of pixels) {
            if (!pixel.position || !pixel.color) continue;
            
            // Получаем координаты из позиции
            const [lat, lng] = pixel.position.split(',').map(Number);
            const countryCode = getCountryCode(lat, lng);
            
            const pixelData = {
                position: pixel.position,  // ВАЖНО: добавляем position в данные!
                color: pixel.color,
                opacity: pixel.opacity || 0.6,
                playerId: playerId || 'anonymous',
                country: countryCode,
                timestamp: timestamp
            };
            
            // Сохраняем пиксель (ВАЖНО: правильный формат JSON)
            promises.push(
                redis.hset('pixels:map', pixel.position, JSON.stringify(pixelData))
            );
            
            // Обновляем статистику страна+цвет
            const countryColorKey = `${countryCode}:${pixel.color}`;
            promises.push(
                redis.hincrby('pixels:country:color', countryColorKey, 1)
            );
            
            // Обновляем общую статистику страны
            promises.push(
                redis.hincrby('pixels:country:total', countryCode, 1)
            );
            
            // Обновляем статистику цветов
            promises.push(
                redis.hincrby('pixels:colors:count', pixel.color, 1)
            );
            
            // Timeline
            promises.push(
                redis.zadd('pixels:timeline', {
                    score: timestamp,
                    member: `${pixel.position}:${playerId}:${pixel.color}:${countryCode}`
                })
            );
        }
        
        // Обновляем общий счетчик
        promises.push(
            redis.incrby('pixels:total', pixels.length)
        );
        
        // Выполняем все команды параллельно
        await Promise.all(promises);
        
        // Очищаем старые записи
        const oneDayAgo = timestamp - (24 * 60 * 60 * 1000);
        await redis.zremrangebyscore('pixels:timeline', '-inf', oneDayAgo);
        
        // Получаем статистику
        const totalPixels = await redis.get('pixels:total') || 0;
        
        res.status(200).json({
            success: true,
            processed: pixels.length,
            totalPixels: parseInt(totalPixels)
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({ 
            error: 'Failed to process batch',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

export { countryNames };