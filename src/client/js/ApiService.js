// ApiService - сервис для работы с API
export class ApiService {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl || window.location.origin;
    }
    
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    }
    
    // Раскрытие клетки
    async revealCell(cellKey, userId) {
        return this.request('/api/reveal-cell', {
            method: 'POST',
            body: JSON.stringify({ cellKey, userId })
        });
    }
    
    // Получение состояния игры
    async getGameState() {
        return this.request('/api/game-state');
    }
    
    // Получение таблицы лидеров
    async getLeaderboard() {
        return this.request('/api/leaderboard');
    }
    
    // Получение состояния мира (альтернативный endpoint)
    async getWorldState() {
        return this.request('/api/world-state');
    }
}