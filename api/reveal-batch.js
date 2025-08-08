import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
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
        
        // Пакетная обработка в Redis с использованием pipeline
        const pipeline = redis.pipeline();
        const gameStateKey = 'battlemap:revealed:cells';
        const playerKey = `battlemap:player:${playerId || 'anonymous'}`;
        const dailyKey = `battlemap:daily:${new Date().toISOString().split('T')[0]}`;
        
        // Добавляем клетки в общий набор
        validCells.forEach(cell => {
            pipeline.sadd(gameStateKey, cell);
            
            // Статистика по игроку
            if (playerId) {
                pipeline.sadd(playerKey, cell);
            }
            
            // Ежедневная статистика
            pipeline.sadd(dailyKey, cell);
        });
        
        // Обновляем счетчики
        pipeline.incrby('battlemap:stats:total_reveals', validCells.length);
        pipeline.incr('battlemap:stats:total_batches');
        
        // Обновляем последнюю активность
        pipeline.set('battlemap:last_activity', Date.now());
        
        // TTL для ежедневной статистики (7 дней)
        pipeline.expire(dailyKey, 7 * 24 * 60 * 60);
        
        // Выполняем все команды одним запросом
        await pipeline.exec();
        
        // Получаем общую статистику (кэшируем на 5 секунд)
        const cacheKey = 'battlemap:cache:stats';
        let stats = await redis.get(cacheKey);
        
        if (!stats) {
            const [totalRevealed, onlinePlayers] = await Promise.all([
                redis.scard(gameStateKey),
                redis.get('battlemap:online_players') || 1
            ]);
            
            stats = {
                totalRevealed,
                onlinePlayers,
                processedCells: validCells.length,
                rejectedCells: cells.length - validCells.length
            };
            
            // Кэшируем на 5 секунд
            await redis.setex(cacheKey, 5, JSON.stringify(stats));
        } else {
            stats = JSON.parse(stats);
            stats.processedCells = validCells.length;
            stats.rejectedCells = cells.length - validCells.length;
        }
        
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