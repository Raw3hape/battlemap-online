// API endpoint: Сохранение цветных пикселей
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
        
        // Очистка старых записей rate limit
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
        
        // Сохраняем пиксели в Redis
        const pipeline = redis.pipeline();
        const timestamp = Date.now();
        
        for (const pixel of pixels) {
            if (!pixel.position || !pixel.color) continue;
            
            const pixelData = {
                position: pixel.position,
                color: pixel.color,
                opacity: pixel.opacity || 0.6,
                playerId: playerId || 'anonymous',
                timestamp: timestamp
            };
            
            // Сохраняем в хэш по позиции
            pipeline.hset('pixels:map', pixel.position, JSON.stringify(pixelData));
            
            // Добавляем в timeline для истории
            pipeline.zadd('pixels:timeline', {
                score: timestamp,
                member: `${pixel.position}:${playerId}:${pixel.color}`
            });
            
            // Обновляем счетчики цветов
            const colorKey = pixel.color.toLowerCase();
            pipeline.hincrby('pixels:colors:count', colorKey, 1);
            
            // Обновляем счетчик игрока
            pipeline.hincrby('pixels:players:count', playerId || 'anonymous', 1);
        }
        
        // Обновляем общий счетчик
        pipeline.incrby('pixels:total', pixels.length);
        
        // Выполняем все команды
        await pipeline.exec();
        
        // Очищаем старые записи из timeline (храним последние 24 часа)
        const oneDayAgo = timestamp - (24 * 60 * 60 * 1000);
        await redis.zremrangebyscore('pixels:timeline', '-inf', oneDayAgo);
        
        // Получаем статистику
        const totalPixels = await redis.get('pixels:total') || 0;
        
        // Считаем активных игроков (последние 5 минут)
        const fiveMinutesAgo = timestamp - (5 * 60 * 1000);
        const recentActivity = await redis.zrange('pixels:timeline', fiveMinutesAgo, timestamp, {
            byScore: true
        }) || [];
        
        const uniquePlayers = new Set();
        recentActivity.forEach(item => {
            if (item && typeof item === 'string') {
                const parts = item.split(':');
                if (parts[1]) uniquePlayers.add(parts[1]);
            }
        });
        
        res.status(200).json({
            success: true,
            processed: pixels.length,
            totalPixels: parseInt(totalPixels),
            onlinePlayers: uniquePlayers.size
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        res.status(500).json({ 
            error: 'Failed to process batch',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}