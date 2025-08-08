// API endpoint: Получение состояния мира
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Названия стран
const COUNTRY_NAMES = {
  'RU': 'Россия',
  'FR': 'Франция', 
  'DE': 'Германия',
  'IT': 'Италия',
  'ES': 'Испания',
  'GB': 'Великобритания',
  'PL': 'Польша',
  'UA': 'Украина',
  'RO': 'Румыния',
  'NL': 'Нидерланды',
  'BE': 'Бельгия',
  'CZ': 'Чехия',
  'GR': 'Греция',
  'PT': 'Португалия',
  'SE': 'Швеция',
  'HU': 'Венгрия',
  'BY': 'Беларусь',
  'AT': 'Австрия',
  'CH': 'Швейцария',
  'BG': 'Болгария',
  'RS': 'Сербия',
  'DK': 'Дания',
  'FI': 'Финляндия',
  'SK': 'Словакия',
  'NO': 'Норвегия',
  'IE': 'Ирландия',
  'HR': 'Хорватия',
  'BA': 'Босния',
  'AL': 'Албания',
  'LT': 'Литва',
  'SI': 'Словения',
  'LV': 'Латвия',
  'EE': 'Эстония',
  'MK': 'Македония',
  'MD': 'Молдова',
  'LU': 'Люксембург',
  'MT': 'Мальта',
  'IS': 'Исландия',
  'CN': 'Китай',
  'IN': 'Индия',
  'US': 'США',
  'ID': 'Индонезия',
  'BR': 'Бразилия',
  'PK': 'Пакистан',
  'NG': 'Нигерия',
  'BD': 'Бангладеш',
  'JP': 'Япония',
  'MX': 'Мексика',
  'PH': 'Филиппины',
  'EG': 'Египет',
  'VN': 'Вьетнам',
  'TR': 'Турция',
  'IR': 'Иран',
  'TH': 'Таиланд',
  'MM': 'Мьянма',
  'KR': 'Южная Корея',
  'CO': 'Колумбия',
  'KE': 'Кения',
  'AR': 'Аргентина',
  'DZ': 'Алжир',
  'SD': 'Судан',
  'UG': 'Уганда',
  'IQ': 'Ирак',
  'CA': 'Канада',
  'AU': 'Австралия',
  'VA': 'Ватикан',
  'MC': 'Монако'
};

export default async function handler(req, res) {
  // Включаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    // Получаем все раскрытые клетки (максимум 10000 для начала)
    const revealedCells = await kv.smembers('revealed:cells') || [];
    
    // Получаем статистику по странам
    const stats = {};
    
    // Для каждой страны получаем количество раскрытых клеток
    for (const code of Object.keys(COUNTRY_NAMES)) {
      const revealed = await kv.scard(`country:${code}:revealed`) || 0;
      const total = await kv.hget('country:totals', code) || 1000; // Заглушка
      
      if (revealed > 0) {
        stats[code] = {
          code,
          name: COUNTRY_NAMES[code],
          revealed,
          total: parseInt(total),
          percentage: ((revealed / total) * 100).toFixed(2)
        };
      }
    }
    
    // Сортируем по проценту и берем топ-10
    const countryStats = Object.values(stats)
      .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
      .slice(0, 10);
    
    // Общая статистика
    const totalRevealed = revealedCells.length;
    const totalWorld = 1000000; // Примерно миллион клеток суши
    
    res.status(200).json({
      success: true,
      revealedCells: revealedCells.slice(0, 10000), // Ограничиваем для производительности
      countryStats,
      totalRevealed,
      totalWorld,
      worldPercentage: ((totalRevealed / totalWorld) * 100).toFixed(4)
    });
    
  } catch (error) {
    console.error('Error fetching world state:', error);
    
    // Возвращаем пустое состояние при ошибке
    res.status(200).json({
      success: false,
      revealedCells: [],
      countryStats: [],
      totalRevealed: 0,
      totalWorld: 1000000,
      worldPercentage: "0.0000",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Database error'
    });
  }
}