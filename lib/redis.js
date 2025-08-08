// Адаптер для работы с Upstash Redis вместо Vercel KV
import { Redis } from '@upstash/redis';

// Создаем клиент Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

// Экспортируем как kv для совместимости
export const kv = redis;

// Дополнительные методы для совместимости
export default {
  ...redis,
  // Методы Vercel KV маппятся на Upstash Redis
  sismember: redis.sismember,
  sadd: redis.sadd,
  smembers: redis.smembers,
  hget: redis.hget,
  hset: redis.hset,
  hgetall: redis.hgetall,
  hincrby: redis.hincrby,
  scard: redis.scard,
  zadd: redis.zadd,
  zrange: redis.zrange,
  pipeline: () => redis.pipeline(),
};