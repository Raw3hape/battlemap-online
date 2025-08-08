// API endpoint: Таблица лидеров
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const COUNTRY_NAMES = {
  'RU': 'Россия',
  'FR': 'Франция',
  'DE': 'Германия',
  'IT': 'Италия',
  'ES': 'Испания',
  'GB': 'Великобритания',
  'US': 'США',
  'CN': 'Китай',
  'BR': 'Бразилия',
  'AU': 'Австралия',
  'CA': 'Канада',
  'IN': 'Индия',
  'JP': 'Япония'
};

const COUNTRY_FLAGS = {
  'RU': '🇷🇺',
  'FR': '🇫🇷',
  'DE': '🇩🇪',
  'IT': '🇮🇹',
  'ES': '🇪🇸',
  'GB': '🇬🇧',
  'US': '🇺🇸',
  'CN': '🇨🇳',
  'BR': '🇧🇷',
  'AU': '🇦🇺',
  'CA': '🇨🇦',
  'IN': '🇮🇳',
  'JP': '🇯🇵'
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    // Получаем топ стран по проценту раскрытия
    const countryStats = [];
    
    for (const code of Object.keys(COUNTRY_NAMES)) {
      const revealed = await kv.scard(`country:${code}:revealed`) || 0;
      
      if (revealed > 0) {
        const total = await kv.hget('country:totals', code) || 10000;
        const percentage = ((revealed / total) * 100).toFixed(2);
        
        countryStats.push({
          code,
          name: COUNTRY_NAMES[code],
          flag: COUNTRY_FLAGS[code] || '🏳️',
          revealed,
          total: parseInt(total),
          percentage: parseFloat(percentage)
        });
      }
    }
    
    // Сортируем по проценту
    countryStats.sort((a, b) => b.percentage - a.percentage);
    
    // Получаем топ игроков
    const userScores = await kv.hgetall('user:scores') || {};
    const users = Object.entries(userScores)
      .map(([userId, score]) => ({
        userId,
        username: userId.startsWith('user_') ? `Player${userId.slice(-4)}` : userId,
        score: parseInt(score)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    
    // Получаем последние раскрытия
    const recentReveals = await kv.zrange('revealed:timeline', -10, -1, {
      withScores: true,
      rev: true
    }) || [];
    
    const recentActivity = recentReveals.map(item => {
      if (!item || !item.member) return null;
      
      const [cellKey, userId, country] = item.member.split(':');
      const timestamp = new Date(item.score).toISOString();
      
      return {
        cellKey,
        userId: userId.startsWith('user_') ? `Player${userId.slice(-4)}` : userId,
        country: COUNTRY_NAMES[country] || country,
        flag: COUNTRY_FLAGS[country] || '🏳️',
        timestamp
      };
    }).filter(Boolean);
    
    res.status(200).json({
      success: true,
      countries: countryStats.slice(0, 10),
      users: users,
      recentActivity: recentActivity,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    
    res.status(200).json({
      success: false,
      countries: [],
      users: [],
      recentActivity: [],
      error: process.env.NODE_ENV === 'development' ? error.message : 'Database error'
    });
  }
}