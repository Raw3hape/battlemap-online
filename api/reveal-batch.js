import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Rate limiting на уровне IP (в памяти)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 минута
const MAX_REQUESTS_PER_WINDOW = 100; // 100 батчей в минуту
const MAX_CELLS_PER_BATCH = 50; // Максимум клеток в батче

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Обработка OPTIONS для CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Только POST
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
        
        // Rate limiting по IP
        const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();
        
        // Очищаем старые записи
        for (const [ip, data] of rateLimits.entries()) {
            if (now - data.windowStart > RATE_LIMIT_WINDOW) {
                rateLimits.delete(ip);
            }
        }
        
        // Проверяем лимит для текущего IP
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
            // Новое окно
            ipData.windowStart = now;
            ipData.requests = 1;
        }
        
        // Проверяем валидность координат
        const validCells = cells.filter(cell => {
            if (typeof cell !== 'string') return false;
            const parts = cell.split(',');
            if (parts.length !== 2) return false;
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            return !isNaN(lat) && !isNaN(lng) && 
                   lat >= -90 && lat <= 90 && 
                   lng >= -180 && lng <= 180;
        });
        
        if (validCells.length === 0) {
            return res.status(400).json({ error: 'No valid cells in batch' });
        }
        
        // Добавляем все клетки в основной набор одной командой
        const gameStateKey = 'revealed:cells';
        if (validCells.length > 0) {
            await redis.sadd(gameStateKey, ...validCells);
        }
        
        // Обновляем timeline для каждой клетки (для подсчета онлайн игроков)
        const timelineKey = 'revealed:timeline';
        const currentTime = Date.now();
        
        // Добавляем записи в timeline
        for (const cell of validCells) {
            await redis.zadd(timelineKey, {
                score: currentTime,
                member: `${cell}:${playerId || 'anonymous'}`
            });
        }
        
        // Определяем страны для клеток и обновляем счетчики
        for (const cell of validCells) {
            const [lat, lng] = cell.split(',').map(parseFloat);
            let countryCode = 'XX'; // Неизвестная страна по умолчанию
            
            // Простая логика определения страны по координатам
            // Россия
            if (lat > 41 && lat < 82 && lng > 19 && lng < 180) {
                countryCode = 'RU';
            }
            // США
            else if (lat > 25 && lat < 50 && lng > -130 && lng < -65) {
                countryCode = 'US';
            }
            // Канада
            else if (lat > 45 && lat < 75 && lng > -140 && lng < -50) {
                countryCode = 'CA';
            }
            // Бразилия
            else if (lat > -35 && lat < 12 && lng > -75 && lng < -35) {
                countryCode = 'BR';
            }
            // Китай
            else if (lat > 18 && lat < 54 && lng > 73 && lng < 135) {
                countryCode = 'CN';
            }
            // Австралия
            else if (lat > -45 && lat < -10 && lng > 112 && lng < 155) {
                countryCode = 'AU';
            }
            // Индия
            else if (lat > 8 && lat < 37 && lng > 68 && lng < 97) {
                countryCode = 'IN';
            }
            // Франция
            else if (lat > 42 && lat < 51 && lng > -5 && lng < 8) {
                countryCode = 'FR';
            }
            // Германия
            else if (lat > 47 && lat < 55 && lng > 6 && lng < 15) {
                countryCode = 'DE';
            }
            // Италия
            else if (lat > 36 && lat < 47 && lng > 6 && lng < 19) {
                countryCode = 'IT';
            }
            // Испания
            else if (lat > 36 && lat < 43 && lng > -10 && lng < 3) {
                countryCode = 'ES';
            }
            // Великобритания
            else if (lat > 50 && lat < 60 && lng > -10 && lng < 2) {
                countryCode = 'GB';
            }
            // Япония
            else if (lat > 30 && lat < 46 && lng > 130 && lng < 146) {
                countryCode = 'JP';
            }
            // Мексика
            else if (lat > 14 && lat < 33 && lng > -118 && lng < -86) {
                countryCode = 'MX';
            }
            // Аргентина
            else if (lat > -55 && lat < -22 && lng > -74 && lng < -53) {
                countryCode = 'AR';
            }
            
            // Увеличиваем счетчик для страны
            await redis.hincrby('country:revealed:count', countryCode, 1);
        }
        
        // Очищаем старые записи из timeline (старше 1 часа для экономии памяти)
        const oneHourAgo = currentTime - (60 * 60 * 1000);
        await redis.zremrangebyscore(timelineKey, '-inf', oneHourAgo);
        
        // Получаем общую статистику
        const totalRevealed = await redis.scard(gameStateKey) || 0;
        
        // Подсчитываем онлайн игроков (активность за последние 5 минут)
        const fiveMinutesAgo = currentTime - (5 * 60 * 1000);
        const recentActivity = await redis.zrange(timelineKey, fiveMinutesAgo, currentTime, {
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
        
        // Логирование для мониторинга
        console.log(`Batch processed: ${validCells.length} cells from ${clientIp}, total: ${totalRevealed}`);
        
        res.status(200).json({
            success: true,
            processed: validCells.length,
            rejected: cells.length - validCells.length,
            totalRevealed,
            onlinePlayers
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({ 
            error: 'Failed to process batch',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}