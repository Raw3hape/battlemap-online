// Временный endpoint для отладки формата данных пикселей
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
        // Получаем первые 5 записей для анализа
        const pixelsMap = await redis.hgetall('pixels:map') || {};
        const entries = Object.entries(pixelsMap).slice(0, 5);
        
        const debug = entries.map(([key, value]) => {
            let parsed = null;
            let error = null;
            
            try {
                if (value && typeof value === 'string' && value.length > 1) {
                    parsed = JSON.parse(value);
                }
            } catch (e) {
                error = e.message;
            }
            
            return {
                key: key,
                rawValue: value,
                valueType: typeof value,
                valueLength: value ? value.length : 0,
                parsed: parsed,
                parseError: error,
                hasPosition: parsed?.position ? true : false,
                hasColor: parsed?.color ? true : false,
                hasOpacity: parsed?.opacity !== undefined
            };
        });
        
        const totalKeys = Object.keys(pixelsMap).length;
        
        res.status(200).json({
            totalKeys: totalKeys,
            sampleData: debug,
            message: "Debug information for first 5 pixels"
        });
        
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({ 
            error: 'Failed to debug pixels',
            message: error.message
        });
    }
}