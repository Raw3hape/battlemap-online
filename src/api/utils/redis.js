// Утилита для работы с Redis
import { Redis } from '@upstash/redis';

// Создаем единый инстанс Redis
let redisClient = null;

export function getRedisClient() {
    if (!redisClient) {
        redisClient = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN,
        });
    }
    return redisClient;
}

// Хелперы для работы с Redis
export const redis = {
    // Получить клиент
    get client() {
        return getRedisClient();
    },
    
    // Сохранить раскрытую клетку
    async saveRevealedCell(cellKey, userId, country) {
        const client = getRedisClient();
        const pipeline = client.pipeline();
        
        // Добавляем в общий список раскрытых
        pipeline.sadd('revealed:cells', cellKey);
        
        // Добавляем в список страны
        if (country && country !== 'XX') {
            pipeline.sadd(`country:${country}:revealed`, cellKey);
            pipeline.hincrby('country:revealed:count', country, 1);
        }
        
        // Добавляем в список пользователя
        pipeline.sadd(`user:${userId}:cells`, cellKey);
        pipeline.hincrby('user:scores', userId, 1);
        
        // Добавляем временную метку
        pipeline.zadd('revealed:timeline', {
            score: Date.now(),
            member: `${cellKey}:${userId}:${country}`
        });
        
        return await pipeline.exec();
    },
    
    // Проверить, раскрыта ли клетка
    async isCellRevealed(cellKey) {
        const client = getRedisClient();
        return await client.sismember('revealed:cells', cellKey);
    },
    
    // Получить все раскрытые клетки
    async getAllRevealedCells(limit = 10000) {
        const client = getRedisClient();
        const cells = await client.smembers('revealed:cells') || [];
        return cells.slice(0, limit);
    },
    
    // Получить статистику по странам
    async getCountryStats() {
        const client = getRedisClient();
        return await client.hgetall('country:revealed:count') || {};
    },
    
    // Получить топ игроков
    async getTopPlayers(limit = 10) {
        const client = getRedisClient();
        const scores = await client.hgetall('user:scores') || {};
        
        return Object.entries(scores)
            .map(([userId, score]) => ({
                userId,
                score: parseInt(score) || 0
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    },
    
    // Получить последние активности
    async getRecentActivity(limit = 10) {
        const client = getRedisClient();
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        return await client.zrange('revealed:timeline', fiveMinutesAgo, now, {
            byScore: true,
            rev: true,
            count: limit
        }) || [];
    },
    
    // Получить количество активных игроков
    async getOnlinePlayersCount() {
        const recentActivity = await this.getRecentActivity(100);
        const uniquePlayers = new Set();
        
        recentActivity.forEach(item => {
            if (item && item.member) {
                const parts = item.member.split(':');
                if (parts[1]) uniquePlayers.add(parts[1]);
            }
        });
        
        return Math.max(1, uniquePlayers.size);
    }
};