// OnlineBattleMap - расширение с онлайн функциональностью
import { BattleMap } from './BattleMap.js';
import { ApiService } from './ApiService.js';

export class OnlineBattleMap extends BattleMap {
    constructor(config = {}) {
        super(config);
        this.apiService = new ApiService();
        this.onlinePlayers = 0;
        this.topCountries = [];
    }
    
    async syncToServer(cellKey) {
        try {
            const response = await this.apiService.revealCell(cellKey, this.playerId);
            
            if (response.success) {
                this.showSyncStatus('✓ Сохранено на сервере');
                
                // Обновляем статистику стран если это первое раскрытие
                if (response.firstReveal) {
                    this.showNotification(response.message);
                }
            }
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
            this.showSyncStatus('✗ Ошибка синхронизации');
        }
    }
    
    async syncFromServer() {
        try {
            const data = await this.apiService.getGameState();
            
            // Объединяем клетки всех игроков
            if (data.allCells && data.allCells.length > 0) {
                data.allCells.forEach(cell => this.revealedCells.add(cell));
                this.updateStats();
                this.render();
            }
            
            // Обновляем онлайн статистику
            this.updateOnlineStats(data);
            
            // Обновляем топ стран
            if (data.topCountries) {
                this.updateTopCountries(data.topCountries);
            }
            
        } catch (error) {
            console.error('Ошибка загрузки с сервера:', error);
        }
    }
    
    updateOnlineStats(data) {
        if (data.totalCells !== undefined) {
            const element = document.getElementById('totalCells');
            if (element) {
                element.textContent = data.totalCells.toLocaleString();
            }
        }
        
        if (data.onlinePlayers !== undefined) {
            this.onlinePlayers = data.onlinePlayers;
            const element = document.getElementById('onlinePlayers');
            if (element) {
                element.textContent = data.onlinePlayers;
            }
        }
    }
    
    updateTopCountries(countries) {
        this.topCountries = countries;
        const list = document.getElementById('countriesList');
        if (!list) return;
        
        list.innerHTML = '';
        
        countries.forEach((country, index) => {
            const item = document.createElement('div');
            item.className = 'country-item';
            
            // Форматируем отображение с клетками и процентом
            let cellsText = country.cells || 0;
            let percentText = '';
            
            if (country.percentage > 0) {
                if (country.percentage < 0.01) {
                    percentText = '< 0.01%';
                } else if (country.percentage < 1) {
                    percentText = `${country.percentage.toFixed(2)}%`;
                } else {
                    percentText = `${country.percentage.toFixed(1)}%`;
                }
            } else {
                percentText = '0.00%';
            }
            
            item.innerHTML = `
                <span>${index + 1}. ${country.name}</span>
                <span class="country-cells">${cellsText} клеток (${percentText})</span>
            `;
            list.appendChild(item);
        });
    }
    
    showSyncStatus(message) {
        const status = document.getElementById('syncStatus');
        if (!status) return;
        
        status.textContent = message;
        status.classList.add('show');
        
        setTimeout(() => {
            status.classList.remove('show');
        }, 2000);
    }
    
    showNotification(message) {
        // Можно добавить более красивые уведомления
        console.log('🎉', message);
        
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 20px 30px;
            border-radius: 10px;
            font-size: 18px;
            z-index: 10000;
            animation: fadeInOut 3s;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    startSyncTimer() {
        // Синхронизация каждые 5 секунд
        this.syncInterval = setInterval(() => {
            this.syncFromServer();
        }, this.config.syncInterval);
        
        // Первая синхронизация через секунду
        setTimeout(() => this.syncFromServer(), 1000);
    }
    
    async getLeaderboard() {
        try {
            return await this.apiService.getLeaderboard();
        } catch (error) {
            console.error('Ошибка получения лидерборда:', error);
            return null;
        }
    }
}

// Добавляем анимацию для уведомлений
const style = document.createElement('style');
style.textContent = `
@keyframes fadeInOut {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
    20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
}
`;
document.head.appendChild(style);