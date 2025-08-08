// Главный файл приложения
import { OnlineBattleMap } from './OnlineBattleMap.js';

// Инициализация приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    // Конфигурация приложения
    const config = {
        mapId: 'map',
        defaultZoom: 4,
        center: [40, 0],
        cellSize: 0.1,
        syncInterval: 5000
    };
    
    // Создаем экземпляр игры
    window.battleMap = new OnlineBattleMap(config);
    
    // Добавляем обработчик для закрытия приложения
    window.addEventListener('beforeunload', () => {
        if (window.battleMap) {
            window.battleMap.saveProgress();
        }
    });
    
    // Отладочная информация
    console.log('🗺️ BattleMap Online initialized');
    console.log('Version: 2.0.0');
    console.log('Player ID:', window.battleMap.playerId);
});