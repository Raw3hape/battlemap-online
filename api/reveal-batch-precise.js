// API endpoint: Batch обработка раскрытия клеток с точным определением границ
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Rate limiting
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;
const MAX_CELLS_PER_BATCH = 50;

// Кэш для геокодинга (в памяти для скорости)
const geoCache = new Map();
const MAX_CACHE_SIZE = 10000;

// Упрощенная быстрая проверка воды для производительности
function quickWaterCheck(lat, lng) {
    // Центр Тихого океана
    if (lat > -40 && lat < 40 && ((lng > 160 && lng <= 180) || (lng >= -180 && lng < -140))) {
        return true;
    }
    // Центр Атлантики
    if (lat > -40 && lat < 50 && lng > -50 && lng < -20) {
        // Исключаем береговые зоны
        if (lat < 20 || lat > 40) return true;
    }
    // Индийский океан
    if (lat > -40 && lat < 0 && lng > 50 && lng < 100) {
        return true;
    }
    // Арктика
    if (lat > 80) return true;
    // Антарктика
    if (lat < -65) return true;
    
    return false;
}

// Получение точной информации о локации
async function getLocationInfo(lat, lng) {
    // Проверяем локальный кэш
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (geoCache.has(cacheKey)) {
        return geoCache.get(cacheKey);
    }
    
    // Быстрая проверка очевидной воды
    if (quickWaterCheck(lat, lng)) {
        const result = { type: 'water', country_code: null };
        geoCache.set(cacheKey, result);
        return result;
    }
    
    try {
        // Вызываем наш geocode API
        const response = await fetch(
            `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/geocode`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng }),
                signal: AbortSignal.timeout(3000) // 3 секунды таймаут
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            
            // Сохраняем в кэш
            if (geoCache.size > MAX_CACHE_SIZE) {
                // Очищаем старые записи
                const toDelete = Math.floor(MAX_CACHE_SIZE / 4);
                const keys = Array.from(geoCache.keys()).slice(0, toDelete);
                keys.forEach(key => geoCache.delete(key));
            }
            geoCache.set(cacheKey, data);
            
            return data;
        }
    } catch (error) {
        console.error('Geocoding failed:', error);
    }
    
    // Fallback на старый метод прямоугольников
    return {
        type: 'land',
        country_code: getFallbackCountryCode(lat, lng)
    };
}

// Fallback определение страны (старый метод)
function getFallbackCountryCode(lat, lng) {
    // Используем упрощенную логику для основных стран
    if (lat > 41 && lat < 82 && lng > 27 && lng < 180) return 'RU';
    if (lat > 24 && lat < 50 && lng > -130 && lng < -65) return 'US';
    if (lat > 45 && lat < 75 && lng > -140 && lng < -50) return 'CA';
    if (lat > -35 && lat < 6 && lng > -74 && lng < -34) return 'BR';
    if (lat > 18 && lat < 54 && lng > 73 && lng < 135) return 'CN';
    if (lat > -44 && lat < -10 && lng > 112 && lng < 154) return 'AU';
    if (lat > 6 && lat < 36 && lng > 68 && lng < 98) return 'IN';
    if (lat > 41 && lat < 51.5 && lng > -5 && lng < 9.5) return 'FR';
    if (lat > 47 && lat < 55.5 && lng > 5.5 && lng < 15.5) return 'DE';
    if (lat > 57 && lat < 72 && lng > 4 && lng < 32) {
        if (lng < 25 || lat > 68) return 'NO';
    }
    return 'XX';
}

// Маппинг кодов стран на названия
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
    'DK': '🇩🇰 Дания',
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
        const { cells, playerId, timestamp } = req.body;
        
        // Валидация
        if (!cells || !Array.isArray(cells)) {
            return res.status(400).json({ error: 'Invalid cells data' });
        }
        
        if (cells.length === 0) {
            return res.status(400).json({ error: 'Empty batch' });
        }
        
        if (cells.length > MAX_CELLS_PER_BATCH) {
            return res.status(400).json({ 
                error: `Batch too large. Maximum ${MAX_CELLS_PER_BATCH} cells per batch` 
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
        
        // Обрабатываем клетки
        const validLandCells = [];
        const waterCells = [];
        const countryCounts = {};
        
        // Параллельная обработка для скорости
        const cellPromises = cells.map(async (cell) => {
            if (typeof cell !== 'string') return null;
            
            const parts = cell.split(',');
            if (parts.length !== 2) return null;
            
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            
            if (isNaN(lat) || isNaN(lng) || 
                lat < -90 || lat > 90 || 
                lng < -180 || lng > 180) {
                return null;
            }
            
            // Получаем информацию о локации
            const locationInfo = await getLocationInfo(lat, lng);
            
            return {
                cell,
                lat,
                lng,
                type: locationInfo.type,
                country_code: locationInfo.country_code
            };
        });
        
        const results = await Promise.all(cellPromises);
        
        // Обрабатываем результаты
        for (const result of results) {
            if (!result) continue;
            
            if (result.type === 'water' || 
                result.type === 'international_waters' || 
                result.type === 'ocean') {
                waterCells.push(result.cell);
                console.log(`Water cell rejected: ${result.cell}`);
            } else {
                validLandCells.push(result.cell);
                
                // Считаем страны
                if (result.country_code) {
                    countryCounts[result.country_code] = (countryCounts[result.country_code] || 0) + 1;
                    
                    // Логируем интересные страны
                    if (result.country_code === 'NO') {
                        console.log(`Норвегия: ${result.lat}, ${result.lng}`);
                    }
                }
            }
        }
        
        // Сохраняем только клетки суши
        if (validLandCells.length > 0) {
            const gameStateKey = 'revealed:cells';
            await redis.sadd(gameStateKey, ...validLandCells);
            
            // Обновляем timeline
            const timelineKey = 'revealed:timeline';
            const currentTime = Date.now();
            
            for (const cell of validLandCells) {
                await redis.zadd(timelineKey, {
                    score: currentTime,
                    member: `${cell}:${playerId || 'anonymous'}`
                });
            }
            
            // Обновляем счетчики стран
            for (const [code, count] of Object.entries(countryCounts)) {
                await redis.hincrby('country:revealed:count', code, count);
            }
            
            // Очищаем старые записи
            const oneHourAgo = currentTime - (60 * 60 * 1000);
            await redis.zremrangebyscore(timelineKey, '-inf', oneHourAgo);
        }
        
        // Статистика
        const totalRevealed = await redis.scard('revealed:cells') || 0;
        
        // Онлайн игроки
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const recentActivity = await redis.zrange('revealed:timeline', fiveMinutesAgo, Date.now(), {
            byScore: true
        }) || [];
        
        const uniquePlayers = new Set();
        recentActivity.forEach(item => {
            if (item && item.member) {
                const parts = item.member.split(':');
                if (parts[parts.length - 1]) {
                    uniquePlayers.add(parts[parts.length - 1]);
                }
            }
        });
        
        const onlinePlayers = Math.max(1, uniquePlayers.size);
        
        // Логирование
        console.log(`Batch: ${validLandCells.length} land, ${waterCells.length} water cells from ${clientIp}`);
        if (Object.keys(countryCounts).length > 0) {
            console.log('Countries:', countryCounts);
        }
        
        res.status(200).json({
            success: true,
            processed: validLandCells.length,
            rejected: cells.length - validLandCells.length,
            water_cells: waterCells.length,
            totalRevealed,
            onlinePlayers,
            countries: countryCounts
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({ 
            error: 'Failed to process batch',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Экспортируем для использования в других API
export { countryNames };