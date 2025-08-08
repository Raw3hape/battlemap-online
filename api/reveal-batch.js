import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Rate limiting на уровне IP
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 минута
const MAX_REQUESTS_PER_WINDOW = 100; // 100 батчей в минуту
const MAX_CELLS_PER_BATCH = 50; // Максимум клеток в батче

export default async function handler(req, res) {
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
        const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
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
        
        // Пакетная обработка клеток
        const gameStateKey = 'revealed:cells';
        const timestamp = Date.now();
        
        // Добавляем все клетки одной командой
        if (validCells.length > 0) {
            await redis.sadd(gameStateKey, ...validCells);
        }
        
        // Обновляем timeline для каждой клетки
        const timelinePromises = validCells.map(cell => 
            redis.zadd('revealed:timeline', {
                score: timestamp,
                member: `${cell}:${playerId || 'anonymous'}`
            })
        );
        
        await Promise.all(timelinePromises);
        
        // Определяем страны для клеток (упрощенно - по координатам)
        for (const cell of validCells) {
            const [lat, lng] = cell.split(',').map(parseFloat);
            let countryCode = 'XX'; // Неизвестная страна по умолчанию
            
            // Простая логика определения страны по координатам
            if (lat > 41 && lat < 82 && lng > -10 && lng < 180) {
                if (lng > 19 && lng < 180) countryCode = 'RU'; // Россия
                else if (lng > -10 && lng < 3) countryCode = 'GB'; // Великобритания
                else if (lng > 3 && lng < 19) countryCode = 'DE'; // Германия/Центральная Европа
            } else if (lat > 25 && lat < 50 && lng > -130 && lng < -65) {
                countryCode = 'US'; // США
            } else if (lat > 45 && lat < 75 && lng > -140 && lng < -50) {
                countryCode = 'CA'; // Канада
            } else if (lat > -35 && lat < 12 && lng > -75 && lng < -35) {
                countryCode = 'BR'; // Бразилия
            } else if (lat > 18 && lat < 54 && lng > 73 && lng < 135) {
                countryCode = 'CN'; // Китай
            } else if (lat > -45 && lat < -10 && lng > 112 && lng < 155) {
                countryCode = 'AU'; // Австралия
            } else if (lat > 8 && lat < 37 && lng > 68 && lng < 97) {
                countryCode = 'IN'; // Индия
            } else if (lat > 36 && lat < 43 && lng > -10 && lng < 3) {
                countryCode = 'ES'; // Испания
            } else if (lat > 42 && lat < 51 && lng > -5 && lng < 8) {
                countryCode = 'FR'; // Франция
            } else if (lat > 36 && lat < 47 && lng > 6 && lng < 19) {
                countryCode = 'IT'; // Италия
            }
            
            // Увеличиваем счетчик для страны
            await redis.hincrby('country:revealed:count', countryCode, 1);
        }
        
        // Получаем общую статистику
        const totalRevealed = await redis.scard(gameStateKey);
        
        // Подсчитываем онлайн игроков (активность за последние 5 минут)
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        const recentActivity = await redis.zrange('revealed:timeline', fiveMinutesAgo, now, {
            byScore: true
        }) || [];
        
        const uniquePlayers = new Set();
        recentActivity.forEach(item => {
            if (item && item.member) {
                const parts = item.member.split(':');
                if (parts[1]) uniquePlayers.add(parts[1]);
            }
        });
        
        const onlinePlayers = Math.max(1, uniquePlayers.size);
        
        // Логирование для мониторинга
        console.log(`Batch processed: ${validCells.length} cells from ${clientIp}`);
        
        res.status(200).json({
            success: true,
            processed: validCells.length,
            rejected: cells.length - validCells.length,
            totalRevealed: stats.totalRevealed,
            onlinePlayers: stats.onlinePlayers
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({ 
            error: 'Failed to process batch',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}