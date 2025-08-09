// Тестовый endpoint для проверки сохранения пикселей
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
        // Тестируем разные способы сохранения
        const testPosition = "55.7558,37.6173";
        const testData = {
            position: testPosition,
            color: "#ff0000",
            opacity: 0.6,
            playerId: "test",
            timestamp: Date.now()
        };
        
        // Способ 1: hset с JSON.stringify
        await redis.hset('pixels:map', {
            [testPosition]: JSON.stringify(testData)
        });
        
        // Способ 2: Добавим ещё один пиксель
        const testPosition2 = "40.7128,-74.0060";
        const testData2 = {
            position: testPosition2,
            color: "#0000ff",
            opacity: 0.7,
            playerId: "test2",
            timestamp: Date.now()
        };
        
        await redis.hset('pixels:map', testPosition2, JSON.stringify(testData2));
        
        // Читаем обратно
        const allData = await redis.hgetall('pixels:map');
        
        // Анализируем результат
        const analysis = Object.entries(allData || {}).map(([key, value]) => {
            let parsed = null;
            let error = null;
            
            try {
                if (typeof value === 'string') {
                    parsed = JSON.parse(value);
                }
            } catch (e) {
                error = e.message;
            }
            
            return {
                key: key,
                valueType: typeof value,
                isParseable: parsed !== null,
                parsedData: parsed,
                error: error
            };
        });
        
        res.status(200).json({
            success: true,
            savedPositions: [testPosition, testPosition2],
            retrievedData: analysis,
            totalKeys: Object.keys(allData || {}).length
        });
        
    } catch (error) {
        console.error('Test save error:', error);
        res.status(500).json({ 
            error: 'Failed to test save',
            message: error.message
        });
    }
}