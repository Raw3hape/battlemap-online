// API endpoint для полной очистки данных пикселей
// ВНИМАНИЕ: Удаляет ВСЕ пиксели и статистику!

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
    
    // Простая защита паролем
    const { password } = req.body;
    if (password !== 'reset2024pixels') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        console.log('Начинаем полную очистку данных пикселей...');
        
        // 1. Очищаем основную карту пикселей
        await redis.del('pixels:map');
        console.log('✓ Очищена pixels:map');
        
        // 2. Очищаем статистику по странам и цветам
        const countryColorKeys = await redis.keys('pixels:country:*');
        if (countryColorKeys && countryColorKeys.length > 0) {
            for (const key of countryColorKeys) {
                await redis.del(key);
            }
            console.log(`✓ Очищено ${countryColorKeys.length} ключей pixels:country:*`);
        }
        
        // 3. Очищаем счетчики цветов
        const colorKeys = await redis.keys('pixels:colors:*');
        if (colorKeys && colorKeys.length > 0) {
            for (const key of colorKeys) {
                await redis.del(key);
            }
            console.log(`✓ Очищено ${colorKeys.length} ключей pixels:colors:*`);
        }
        
        // 4. Очищаем timeline
        await redis.del('pixels:timeline');
        console.log('✓ Очищена pixels:timeline');
        
        // 5. Сбрасываем общий счетчик
        await redis.del('pixels:total');
        console.log('✓ Сброшен pixels:total');
        
        // 6. Очищаем старые данные от системы тумана (legacy)
        await redis.del('revealed:cells');
        await redis.del('revealed:timeline');
        const countryRevealedKeys = await redis.keys('country:revealed:*');
        if (countryRevealedKeys && countryRevealedKeys.length > 0) {
            for (const key of countryRevealedKeys) {
                await redis.del(key);
            }
            console.log(`✓ Очищено ${countryRevealedKeys.length} ключей country:revealed:*`);
        }
        
        // 7. Полностью очищаем pixels:map от любого мусора
        const allKeys = await redis.hkeys('pixels:map');
        if (allKeys && allKeys.length > 0) {
            for (const key of allKeys) {
                await redis.hdel('pixels:map', key);
            }
            console.log(`✓ Удалено ${allKeys.length} записей из pixels:map`);
        }
        
        // 8. Устанавливаем чистое начальное состояние
        await redis.set('pixels:total', 0);
        console.log('✓ Счетчик сброшен на 0');
        
        console.log('✅ Все данные пикселей успешно очищены!');
        
        res.status(200).json({
            success: true,
            message: 'Все данные пикселей успешно очищены',
            timestamp: new Date().toISOString(),
            stats: {
                pixelsDeleted: 'all',
                countriesReset: countryColorKeys ? countryColorKeys.length : 0,
                colorsReset: colorKeys ? colorKeys.length : 0,
                legacyDeleted: countryRevealedKeys ? countryRevealedKeys.length : 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка при очистке данных:', error);
        res.status(500).json({ 
            error: 'Failed to reset pixels data',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}