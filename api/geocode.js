// API endpoint: Точное определение страны и типа территории
import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// Кэш для оптимизации (хранится 30 дней)
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 дней в секундах

// Маппинг ISO кодов на наши коды
const ISO_TO_CODE = {
    'ru': 'RU', 'us': 'US', 'ca': 'CA', 'br': 'BR', 'cn': 'CN',
    'au': 'AU', 'in': 'IN', 'fr': 'FR', 'de': 'DE', 'it': 'IT',
    'es': 'ES', 'gb': 'GB', 'jp': 'JP', 'mx': 'MX', 'ar': 'AR',
    'no': 'NO', 'se': 'SE', 'fi': 'FI', 'dk': 'DK', 'is': 'IS',
    'ie': 'IE', 'pl': 'PL', 'pt': 'PT', 'nl': 'NL', 'be': 'BE',
    'ch': 'CH', 'at': 'AT', 'cz': 'CZ', 'ua': 'UA', 'by': 'BY',
    'lt': 'LT', 'lv': 'LV', 'ee': 'EE', 'gr': 'GR', 'tr': 'TR',
    'cl': 'CL', 'pe': 'PE', 'co': 'CO', 've': 'VE', 'ec': 'EC',
    'bo': 'BO', 'py': 'PY', 'uy': 'UY', 'gy': 'GY', 'sr': 'SR',
    'kr': 'KR', 'kp': 'KP', 'id': 'ID', 'th': 'TH', 'vn': 'VN',
    'ph': 'PH', 'my': 'MY', 'sg': 'SG', 'kz': 'KZ', 'mn': 'MN',
    'ir': 'IR', 'iq': 'IQ', 'sa': 'SA', 'ye': 'YE', 'om': 'OM',
    'ae': 'AE', 'kw': 'KW', 'qa': 'QA', 'bh': 'BH', 'jo': 'JO',
    'sy': 'SY', 'lb': 'LB', 'il': 'IL', 'ps': 'PS', 'eg': 'EG',
    'ly': 'LY', 'tn': 'TN', 'dz': 'DZ', 'ma': 'MA', 'mr': 'MR',
    'ml': 'ML', 'ne': 'NE', 'td': 'TD', 'sd': 'SD', 'et': 'ET',
    'so': 'SO', 'ke': 'KE', 'ug': 'UG', 'tz': 'TZ', 'rw': 'RW',
    'bi': 'BI', 'mw': 'MW', 'zm': 'ZM', 'zw': 'ZW', 'bw': 'BW',
    'za': 'ZA', 'na': 'NA', 'ao': 'AO', 'mz': 'MZ', 'mg': 'MG',
    'cd': 'CD', 'cg': 'CG', 'ga': 'GA', 'cm': 'CM', 'cf': 'CF',
    'gq': 'GQ', 'ng': 'NG', 'bj': 'BJ', 'tg': 'TG', 'gh': 'GH',
    'ci': 'CI', 'lr': 'LR', 'sl': 'SL', 'gn': 'GN', 'gw': 'GW',
    'sn': 'SN', 'gm': 'GM', 'bf': 'BF', 'nz': 'NZ', 'pg': 'PG',
    'fj': 'FJ', 'sb': 'SB', 'vu': 'VU', 'nc': 'NC', 'pf': 'PF',
    'ws': 'WS', 'to': 'TO', 'tv': 'TV', 'ki': 'KI', 'pw': 'PW',
    'mh': 'MH', 'fm': 'FM', 'nr': 'NR', 'gu': 'GU', 'pr': 'PR',
    'vi': 'VI', 'as': 'AS', 'mp': 'MP', 'ck': 'CK', 'nu': 'NU',
    'tk': 'TK', 'pn': 'PN', 'hm': 'HM', 'cc': 'CC', 'cx': 'CX',
    'nf': 'NF', 'bv': 'BV', 'tf': 'TF', 'aq': 'AQ', 'af': 'AF',
    'pk': 'PK', 'bd': 'BD', 'lk': 'LK', 'mm': 'MM', 'la': 'LA',
    'kh': 'KH', 'bn': 'BN', 'tl': 'TL', 'np': 'NP', 'bt': 'BT',
    'am': 'AM', 'az': 'AZ', 'ge': 'GE', 'tm': 'TM', 'uz': 'UZ',
    'tj': 'TJ', 'kg': 'KG', 'ro': 'RO', 'bg': 'BG', 'hu': 'HU',
    'sk': 'SK', 'si': 'SI', 'hr': 'HR', 'ba': 'BA', 'rs': 'RS',
    'me': 'ME', 'al': 'AL', 'mk': 'MK', 'xk': 'XK', 'mt': 'MT',
    'cy': 'CY', 'lu': 'LU', 'li': 'LI', 'ad': 'AD', 'mc': 'MC',
    'sm': 'SM', 'va': 'VA', 'md': 'MD'
};

// Определение типа территории
function getLocationTypeFromOSM(data) {
    // Проверка на воду
    if (data.addresstype === 'water' || 
        data.addresstype === 'ocean' ||
        data.addresstype === 'sea' ||
        data.type === 'water' ||
        data.type === 'coastline' ||
        data.type === 'bay' ||
        data.type === 'strait' ||
        data.extratags?.natural === 'water' ||
        data.extratags?.water === 'lake' ||
        data.extratags?.water === 'river' ||
        data.extratags?.water === 'sea' ||
        data.extratags?.place === 'ocean' ||
        data.extratags?.place === 'sea') {
        return 'water';
    }
    
    // Проверка на международные воды
    if (!data.address?.country_code && 
        (data.addresstype === 'ocean' || 
         data.extratags?.place === 'ocean')) {
        return 'international_waters';
    }
    
    // Антарктида
    if (data.address?.country_code === 'aq' || 
        data.address?.continent === 'Antarctica') {
        return 'antarctica';
    }
    
    // Суша по умолчанию
    return 'land';
}

// Запрос к Nominatim с резервными серверами
async function queryNominatim(lat, lng, retries = 3) {
    const servers = [
        'https://nominatim.openstreetmap.org',
        'https://nominatim.geocoding.ai',
        'https://nominatim.komoot.io'
    ];
    
    for (let i = 0; i < retries; i++) {
        const server = servers[i % servers.length];
        try {
            const response = await fetch(
                `${server}/reverse?` +
                `lat=${lat}&lon=${lng}&format=json&zoom=10&extratags=1&namedetails=1&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'BattleMap/1.0',
                        'Accept-Language': 'en'
                    },
                    signal: AbortSignal.timeout(5000) // 5 секунд таймаут
                }
            );
            
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.log(`Nominatim server ${i + 1} failed, trying next...`);
        }
    }
    
    return null;
}

// Быстрая проверка океанов по координатам
function quickOceanCheck(lat, lng) {
    // Тихий океан (центральная часть)
    if (lat > -60 && lat < 60 && lng > 150 && lng < -120) {
        // Исключаем Японию, Филиппины, Индонезию, западное побережье Америки
        if (lng > 170 || lng < -140) {
            return { type: 'water', country: null, name: 'Pacific Ocean' };
        }
    }
    
    // Атлантический океан (центральная часть)
    if (lat > -60 && lat < 60 && lng > -60 && lng < -20) {
        // Грубая проверка - центр Атлантики
        if (lat < 30 || lat > 45) {
            return { type: 'water', country: null, name: 'Atlantic Ocean' };
        }
    }
    
    // Индийский океан
    if (lat > -60 && lat < 20 && lng > 40 && lng < 120) {
        if (lat < -20) {
            return { type: 'water', country: null, name: 'Indian Ocean' };
        }
    }
    
    // Северный Ледовитый океан
    if (lat > 75) {
        return { type: 'water', country: null, name: 'Arctic Ocean' };
    }
    
    // Южный океан
    if (lat < -60) {
        return { type: 'water', country: null, name: 'Southern Ocean' };
    }
    
    return null;
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // Получаем координаты
        let lat, lng;
        if (req.method === 'POST') {
            ({ lat, lng } = req.body);
        } else {
            lat = parseFloat(req.query.lat);
            lng = parseFloat(req.query.lng);
        }
        
        // Валидация
        if (isNaN(lat) || isNaN(lng) || 
            lat < -90 || lat > 90 || 
            lng < -180 || lng > 180) {
            return res.status(400).json({ 
                error: 'Invalid coordinates',
                lat, lng 
            });
        }
        
        // Округляем до 2 знаков для кэша (примерно 1км точность)
        const cacheKey = `geo:${lat.toFixed(2)},${lng.toFixed(2)}`;
        
        // Проверяем кэш
        const cached = await redis.get(cacheKey);
        if (cached) {
            console.log(`Cache hit for ${cacheKey}`);
            return res.status(200).json({
                ...cached,
                cached: true
            });
        }
        
        // Быстрая проверка океанов
        const oceanCheck = quickOceanCheck(lat, lng);
        if (oceanCheck) {
            const result = {
                lat, lng,
                type: oceanCheck.type,
                country: oceanCheck.country,
                country_code: null,
                name: oceanCheck.name,
                ocean: true
            };
            
            // Кэшируем океаны
            await redis.set(cacheKey, result, { ex: CACHE_TTL });
            
            return res.status(200).json(result);
        }
        
        // Запрос к Nominatim
        const osmData = await queryNominatim(lat, lng);
        
        if (!osmData) {
            // Если Nominatim недоступен, используем fallback
            return res.status(200).json({
                lat, lng,
                type: 'unknown',
                country: null,
                country_code: 'XX',
                error: 'Geocoding service unavailable'
            });
        }
        
        // Определяем тип территории
        const locationType = getLocationTypeFromOSM(osmData);
        
        // Получаем код страны
        const isoCode = osmData.address?.country_code?.toLowerCase();
        const countryCode = isoCode ? (ISO_TO_CODE[isoCode] || 'XX') : 
                           (locationType === 'water' ? null : 'XX');
        
        // Формируем результат
        const result = {
            lat, lng,
            type: locationType,
            country: osmData.address?.country || null,
            country_code: countryCode,
            state: osmData.address?.state || null,
            city: osmData.address?.city || osmData.address?.town || null,
            display_name: osmData.display_name,
            osm_id: osmData.osm_id,
            osm_type: osmData.osm_type
        };
        
        // Кэшируем результат
        await redis.set(cacheKey, result, { ex: CACHE_TTL });
        
        console.log(`Geocoded: ${lat},${lng} -> ${countryCode} (${locationType})`);
        
        return res.status(200).json(result);
        
    } catch (error) {
        console.error('Geocoding error:', error);
        return res.status(500).json({ 
            error: 'Failed to geocode location',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}