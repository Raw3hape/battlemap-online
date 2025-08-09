// Временный endpoint для проверки всех ключей в pixels:map
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

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
        // Получаем все ключи и значения
        const pixelsMap = await redis.hgetall('pixels:map') || {};
        const allEntries = Object.entries(pixelsMap);
        
        // Группируем по типу ключа
        const coordinateKeys = [];
        const numericKeys = [];
        const otherKeys = [];
        
        allEntries.forEach(([key, value]) => {
            // Проверяем, похож ли ключ на координаты (lat,lng)
            if (key.includes(',') && key.match(/^-?\d+\.?\d*,-?\d+\.?\d*$/)) {
                coordinateKeys.push({
                    key: key,
                    value: value,
                    type: typeof value
                });
            } else if (/^\d+$/.test(key)) {
                numericKeys.push({
                    key: key,
                    value: value,
                    type: typeof value
                });
            } else {
                otherKeys.push({
                    key: key,
                    value: value,
                    type: typeof value
                });
            }
        });
        
        res.status(200).json({
            totalKeys: allEntries.length,
            coordinateKeys: {
                count: coordinateKeys.length,
                samples: coordinateKeys.slice(0, 3)
            },
            numericKeys: {
                count: numericKeys.length,
                samples: numericKeys.slice(0, 5)
            },
            otherKeys: {
                count: otherKeys.length,
                samples: otherKeys.slice(0, 3)
            }
        });
        
    } catch (error) {
        console.error('Debug keys error:', error);
        res.status(500).json({ 
            error: 'Failed to debug keys',
            message: error.message
        });
    }
}