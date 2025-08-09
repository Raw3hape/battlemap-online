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

// Функция определения страны по координатам
function getCountryCode(lat, lng) {
    // ЕВРОПА
    // Норвегия (ИСПРАВЛЕНО!)
    if (lat > 57 && lat < 72 && lng > 4 && lng < 32) {
        // Дополнительная проверка для точности
        if (lng < 25 || lat > 68) {
            return 'NO'; // Норвегия
        }
    }
    
    // Швеция
    if (lat > 55 && lat < 70 && lng > 11 && lng < 24) {
        return 'SE';
    }
    
    // Финляндия
    if (lat > 59 && lat < 71 && lng > 20 && lng < 32) {
        return 'FI';
    }
    
    // Дания
    if (lat > 54 && lat < 58 && lng > 8 && lng < 13) {
        return 'DK';
    }
    
    // Исландия
    if (lat > 63 && lat < 67 && lng > -25 && lng < -13) {
        return 'IS';
    }
    
    // Великобритания
    if (lat > 49 && lat < 61 && lng > -11 && lng < 2) {
        return 'GB';
    }
    
    // Ирландия
    if (lat > 51 && lat < 55.5 && lng > -11 && lng < -5.5) {
        return 'IE';
    }
    
    // Франция
    if (lat > 41 && lat < 51.5 && lng > -5 && lng < 9.5) {
        return 'FR';
    }
    
    // Германия
    if (lat > 47 && lat < 55.5 && lng > 5.5 && lng < 15.5) {
        return 'DE';
    }
    
    // Польша
    if (lat > 49 && lat < 55 && lng > 14 && lng < 25) {
        return 'PL';
    }
    
    // Италия
    if (lat > 35 && lat < 47.5 && lng > 6 && lng < 19) {
        return 'IT';
    }
    
    // Испания
    if (lat > 35.5 && lat < 44 && lng > -10 && lng < 4.5) {
        return 'ES';
    }
    
    // Португалия
    if (lat > 36.5 && lat < 42.5 && lng > -10 && lng < -6) {
        return 'PT';
    }
    
    // Нидерланды
    if (lat > 50.5 && lat < 53.5 && lng > 3.5 && lng < 7.5) {
        return 'NL';
    }
    
    // Бельгия
    if (lat > 49.5 && lat < 51.5 && lng > 2.5 && lng < 6.5) {
        return 'BE';
    }
    
    // Швейцария
    if (lat > 45.5 && lat < 48 && lng > 5.5 && lng < 10.5) {
        return 'CH';
    }
    
    // Австрия
    if (lat > 46.5 && lat < 49 && lng > 9.5 && lng < 17) {
        return 'AT';
    }
    
    // Чехия
    if (lat > 48.5 && lat < 51 && lng > 12 && lng < 19) {
        return 'CZ';
    }
    
    // Украина
    if (lat > 44 && lat < 52.5 && lng > 22 && lng < 40) {
        return 'UA';
    }
    
    // Беларусь
    if (lat > 51 && lat < 56.5 && lng > 23 && lng < 33) {
        return 'BY';
    }
    
    // Прибалтика
    if (lat > 53.5 && lat < 59.5 && lng > 20 && lng < 29) {
        if (lat < 56) return 'LT'; // Литва
        if (lat < 58) return 'LV'; // Латвия
        return 'EE'; // Эстония
    }
    
    // Греция
    if (lat > 34.5 && lat < 42 && lng > 19 && lng < 29) {
        return 'GR';
    }
    
    // Турция
    if (lat > 35.5 && lat < 42.5 && lng > 25.5 && lng < 45) {
        return 'TR';
    }
    
    // РОССИЯ (уточненные границы)
    if (lat > 41 && lat < 82) {
        if (lng > 27 && lng < 180) return 'RU';
        if (lng > -180 && lng < -168) return 'RU'; // Чукотка
    }
    
    // СЕВЕРНАЯ АМЕРИКА
    // Канада (уточнено)
    if (lat > 41.5 && lat < 84) {
        if (lng > -141 && lng < -52) return 'CA';
    }
    
    // США (включая Аляску)
    if (lat > 24 && lat < 72 && lng > -172 && lng < -66) {
        if (lat > 51 && lng < -130) return 'US'; // Аляска
        if (lat < 50) return 'US'; // Континентальные США
    }
    
    // Мексика
    if (lat > 14 && lat < 33 && lng > -118 && lng < -86) {
        return 'MX';
    }
    
    // ЮЖНАЯ АМЕРИКА
    // Бразилия
    if (lat > -34 && lat < 6 && lng > -74 && lng < -34) {
        return 'BR';
    }
    
    // Аргентина
    if (lat > -56 && lat < -21 && lng > -74 && lng < -53) {
        return 'AR';
    }
    
    // Чили
    if (lat > -56 && lat < -17 && lng > -76 && lng < -66) {
        return 'CL';
    }
    
    // Перу
    if (lat > -19 && lat < 0 && lng > -82 && lng < -68) {
        return 'PE';
    }
    
    // Колумбия
    if (lat > -5 && lat < 14 && lng > -80 && lng < -66) {
        return 'CO';
    }
    
    // Венесуэла
    if (lat > 0 && lat < 13 && lng > -74 && lng < -59) {
        return 'VE';
    }
    
    // АЗИЯ
    // Китай
    if (lat > 18 && lat < 54 && lng > 73 && lng < 135) {
        return 'CN';
    }
    
    // Индия
    if (lat > 6 && lat < 36 && lng > 68 && lng < 98) {
        return 'IN';
    }
    
    // Япония
    if (lat > 24 && lat < 46 && lng > 123 && lng < 146) {
        return 'JP';
    }
    
    // Южная Корея
    if (lat > 33 && lat < 39 && lng > 124 && lng < 131) {
        return 'KR';
    }
    
    // Индонезия
    if (lat > -11 && lat < 6 && lng > 95 && lng < 141) {
        return 'ID';
    }
    
    // Таиланд
    if (lat > 5 && lat < 21 && lng > 97 && lng < 106) {
        return 'TH';
    }
    
    // Вьетнам
    if (lat > 8 && lat < 24 && lng > 102 && lng < 110) {
        return 'VN';
    }
    
    // Казахстан
    if (lat > 40 && lat < 56 && lng > 46 && lng < 88) {
        return 'KZ';
    }
    
    // Монголия
    if (lat > 41 && lat < 52 && lng > 87 && lng < 120) {
        return 'MN';
    }
    
    // Иран
    if (lat > 25 && lat < 40 && lng > 44 && lng < 64) {
        return 'IR';
    }
    
    // Саудовская Аравия
    if (lat > 16 && lat < 33 && lng > 34 && lng < 56) {
        return 'SA';
    }
    
    // АФРИКА
    // Египет
    if (lat > 22 && lat < 32 && lng > 24 && lng < 37) {
        return 'EG';
    }
    
    // ЮАР
    if (lat > -35 && lat < -22 && lng > 16 && lng < 33) {
        return 'ZA';
    }
    
    // Нигерия
    if (lat > 4 && lat < 14 && lng > 2 && lng < 15) {
        return 'NG';
    }
    
    // Кения
    if (lat > -5 && lat < 5 && lng > 33 && lng < 42) {
        return 'KE';
    }
    
    // Алжир
    if (lat > 18 && lat < 38 && lng > -9 && lng < 12) {
        return 'DZ';
    }
    
    // ОКЕАНИЯ
    // Австралия
    if (lat > -44 && lat < -10 && lng > 112 && lng < 154) {
        return 'AU';
    }
    
    // Новая Зеландия
    if (lat > -48 && lat < -34 && lng > 166 && lng < 179) {
        return 'NZ';
    }
    
    // По умолчанию - неизвестная страна
    return 'XX';
}

// Маппинг кодов стран на названия с флагами
const countryNames = {
    'RU': '🇷🇺 Россия',
    'US': '🇺🇸 США',
    'CA': '🇨🇦 Канада',
    'BR': '🇧🇷 Бразилия',
    'CN': '🇨🇳 Китай',
    'AU': '🇦🇺 Австралия',
    'IN': '🇮🇳 Индия',
    'FR': '🇫🇷 Франция',
    'DE': '🇩🇪 Германия',
    'IT': '🇮🇹 Италия',
    'ES': '🇪🇸 Испания',
    'GB': '🇬🇧 Великобритания',
    'JP': '🇯🇵 Япония',
    'MX': '🇲🇽 Мексика',
    'AR': '🇦🇷 Аргентина',
    'NO': '🇳🇴 Норвегия',
    'SE': '🇸🇪 Швеция',
    'FI': '🇫🇮 Финляндия',
    'DK': '🇩🇰 Дания',
    'IS': '🇮🇸 Исландия',
    'IE': '🇮🇪 Ирландия',
    'PL': '🇵🇱 Польша',
    'PT': '🇵🇹 Португалия',
    'NL': '🇳🇱 Нидерланды',
    'BE': '🇧🇪 Бельгия',
    'CH': '🇨🇭 Швейцария',
    'AT': '🇦🇹 Австрия',
    'CZ': '🇨🇿 Чехия',
    'UA': '🇺🇦 Украина',
    'BY': '🇧🇾 Беларусь',
    'LT': '🇱🇹 Литва',
    'LV': '🇱🇻 Латвия',
    'EE': '🇪🇪 Эстония',
    'GR': '🇬🇷 Греция',
    'TR': '🇹🇷 Турция',
    'CL': '🇨🇱 Чили',
    'PE': '🇵🇪 Перу',
    'CO': '🇨🇴 Колумбия',
    'VE': '🇻🇪 Венесуэла',
    'KR': '🇰🇷 Южная Корея',
    'ID': '🇮🇩 Индонезия',
    'TH': '🇹🇭 Таиланд',
    'VN': '🇻🇳 Вьетнам',
    'KZ': '🇰🇿 Казахстан',
    'MN': '🇲🇳 Монголия',
    'IR': '🇮🇷 Иран',
    'SA': '🇸🇦 Саудовская Аравия',
    'EG': '🇪🇬 Египет',
    'ZA': '🇿🇦 ЮАР',
    'NG': '🇳🇬 Нигерия',
    'KE': '🇰🇪 Кения',
    'DZ': '🇩🇿 Алжир',
    'NZ': '🇳🇿 Новая Зеландия',
    'XX': '❓ Неизвестно'
};

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
            const countryCode = getCountryCode(lat, lng);
            
            // Логируем для отладки
            if (countryCode === 'NO') {
                console.log(`Норвегия определена для координат: ${lat}, ${lng}`);
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

// Экспортируем для использования в других API
export { getCountryCode, countryNames };