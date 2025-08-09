// API endpoint: Получение состояния всех пикселей
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Цвета для статистики
const COLOR_NAMES = {
    '#ff0000': 'Красный',
    '#0000ff': 'Синий',
    '#00ff00': 'Зеленый',
    '#ffff00': 'Желтый',
    '#ffa500': 'Оранжевый',
    '#800080': 'Фиолетовый',
    '#ffc0cb': 'Розовый',
    '#00ffff': 'Голубой',
    '#000000': 'Черный',
    '#ffffff': 'Белый'
};

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // Получаем все пиксели
        const pixelsMap = await redis.hgetall('pixels:map') || {};
        
        // Преобразуем в массив
        const pixels = Object.entries(pixelsMap).map(([position, dataStr]) => {
            try {
                const data = JSON.parse(dataStr);
                return {
                    position,
                    color: data.color,
                    opacity: data.opacity,
                    playerId: data.playerId
                };
            } catch (e) {
                return null;
            }
        }).filter(p => p !== null);
        
        // Получаем статистику по цветам
        const colorCounts = await redis.hgetall('pixels:colors:count') || {};
        const topColors = Object.entries(colorCounts)
            .map(([color, count]) => ({
                hex: color,
                name: COLOR_NAMES[color] || 'Другой',
                count: parseInt(count)
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        
        // Получаем общую статистику
        const totalPixels = await redis.get('pixels:total') || 0;
        
        // Считаем онлайн игроков (активность за последние 5 минут)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const recentActivity = await redis.zrange('pixels:timeline', fiveMinutesAgo, Date.now(), {
            byScore: true
        }) || [];
        
        const uniquePlayers = new Set();
        recentActivity.forEach(item => {
            if (item && typeof item === 'string') {
                const parts = item.split(':');
                if (parts[1]) uniquePlayers.add(parts[1]);
            }
        });
        
        // Ограничиваем количество пикселей для больших карт
        const maxPixelsToSend = 10000;
        const pixelsToSend = pixels.length > maxPixelsToSend ? 
            pixels.slice(-maxPixelsToSend) : // Берем последние
            pixels;
        
        res.status(200).json({
            success: true,
            pixels: pixelsToSend,
            stats: {
                totalPixels: parseInt(totalPixels),
                onlinePlayers: uniquePlayers.size,
                topColors: topColors
            },
            truncated: pixels.length > maxPixelsToSend
        });
        
    } catch (error) {
        console.error('Error fetching pixels state:', error);
        res.status(500).json({ 
            error: 'Failed to fetch pixels state',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}