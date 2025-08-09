// Admin endpoint: Очистка данных пикселей
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

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
        const { adminKey } = req.body;
        
        // Простая проверка админского ключа
        if (adminKey !== 'BattleMap2024Admin') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        console.log('🧹 Начинаем очистку данных пикселей...');
        
        // Очищаем все ключи связанные с пикселями
        const keys = [
            'pixels:map',           // Основные данные пикселей
            'pixels:country:color', // Статистика по странам и цветам
            'pixels:country:total', // Общая статистика по странам
            'pixels:colors:count',  // Статистика по цветам
            'pixels:timeline',      // Временная линия
            'pixels:total'          // Общий счетчик
        ];
        
        let deletedKeys = 0;
        
        for (const key of keys) {
            try {
                const result = await redis.del(key);
                if (result > 0) {
                    console.log(`✅ Удален ключ: ${key}`);
                    deletedKeys++;
                } else {
                    console.log(`⚠️ Ключ не найден: ${key}`);
                }
            } catch (error) {
                console.error(`❌ Ошибка при удалении ${key}:`, error.message);
            }
        }
        
        console.log(`🎯 Очистка завершена. Удалено ключей: ${deletedKeys}`);
        
        res.status(200).json({
            success: true,
            message: 'Данные пикселей очищены',
            deletedKeys: deletedKeys,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Admin reset error:', error);
        res.status(500).json({ 
            error: 'Failed to reset pixels data',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}