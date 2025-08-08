
// BattleMap Online Bundle - Generated 2025-08-08T22:29:01.455Z
(function() {
    'use strict';
    

    // === src/client/js/ApiService.js ===
    // ApiService - сервис для работы с API
window.class ApiService {
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
    

    // === src/client/js/BattleMap.js ===
    // BattleMap - основной класс игры
window.class BattleMap {
    constructor(config = {}) {
        this.config = {
            mapId: config.mapId || 'map',
            defaultZoom: config.defaultZoom || 4,
            center: config.center || [40, 0],
            cellSize: config.cellSize || 0.1,
            syncInterval: config.syncInterval || 5000,
            ...config
        };
        
        this.map = null;
        this.fogCanvas = null;
        this.fogCtx = null;
        this.revealedCells = new Set();
        this.playerId = this.getOrCreatePlayerId();
        this.syncInterval = null;
        
        this.init();
    }
    
    init() {
        this.initMap();
        this.initFog();
        this.initControls();
        this.initSync();
        this.loadProgress();
    }
    
    initMap() {
        // Инициализация карты
        this.map = L.map(this.config.mapId, {
            center: this.config.center,
            zoom: this.config.defaultZoom,
            zoomControl: false,
            attributionControl: true
        });
        
        // Устанавливаем стиль карты по умолчанию
        this.setMapStyle('dark');
        
        // Добавляем обработчики событий
        this.map.on('click', (e) => this.handleMapClick(e));
        this.map.on('moveend', () => this.render());
        this.map.on('zoomend', () => this.render());
    }
    
    initFog() {
        // Создание канваса для тумана войны
        this.fogCanvas = L.canvas({ padding: 0 });
        
        const canvasLayer = L.canvasLayer({
            render: () => this.render()
        }).addTo(this.map);
        
        this.fogCanvas = canvasLayer._canvas;
        this.fogCtx = this.fogCanvas.getContext('2d');
        
        // Устанавливаем стиль канваса
        this.fogCanvas.style.pointerEvents = 'none';
        this.fogCanvas.style.zIndex = '1000';
    }
    
    initControls() {
        // Добавляем кнопки управления
        const zoomIn = document.getElementById('zoomIn');
        const zoomOut = document.getElementById('zoomOut');
        const resetView = document.getElementById('resetView');
        
        if (zoomIn) {
            zoomIn.addEventListener('click', () => this.map.zoomIn());
        }
        
        if (zoomOut) {
            zoomOut.addEventListener('click', () => this.map.zoomOut());
        }
        
        if (resetView) {
            resetView.addEventListener('click', () => {
                this.map.setView(this.config.center, this.config.defaultZoom);
            });
        }
        
        // Селектор стиля карты
        const styleSelector = document.getElementById('mapStyle');
        if (styleSelector) {
            styleSelector.addEventListener('change', (e) => {
                this.setMapStyle(e.target.value);
            });
        }
    }
    
    initSync() {
        // Запускаем синхронизацию с сервером
        this.startSyncTimer();
    }
    
    setMapStyle(style) {
        // Удаляем существующий слой
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }
        
        // Карта стилей
        const styles = {
            dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            watercolor: 'https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg',
            toner: 'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png',
            terrain: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png'
        };
        
        const attribution = {
            dark: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            light: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            satellite: 'Tiles &copy; Esri',
            watercolor: '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://www.stamen.com/" target="_blank">Stamen Design</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            toner: '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://www.stamen.com/" target="_blank">Stamen Design</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            terrain: '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://www.stamen.com/" target="_blank">Stamen Design</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        };
        
        this.tileLayer = L.tileLayer(styles[style] || styles.dark, {
            attribution: attribution[style] || attribution.dark,
            maxZoom: 19,
            subdomains: style === 'satellite' ? [] : ['a', 'b', 'c']
        }).addTo(this.map);
    }
    
    handleMapClick(e) {
        const cellKey = this.getCellKey(e.latlng.lat, e.latlng.lng);
        
        if (!this.revealedCells.has(cellKey)) {
            this.revealedCells.add(cellKey);
            this.saveProgress();
            this.updateStats();
            this.render();
            this.syncToServer(cellKey);
        }
    }
    
    getCellKey(lat, lng) {
        const cellLat = Math.floor(lat / this.config.cellSize) * this.config.cellSize;
        const cellLng = Math.floor(lng / this.config.cellSize) * this.config.cellSize;
        return `${cellLat.toFixed(1)},${cellLng.toFixed(1)}`;
    }
    
    render() {
        if (!this.fogCtx || !this.map) return;
        
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        
        // Очищаем канвас
        this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        
        // Рисуем туман
        this.fogCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.fogCtx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        
        // Вырезаем раскрытые области
        this.fogCtx.globalCompositeOperation = 'destination-out';
        
        this.revealedCells.forEach(cellKey => {
            const [lat, lng] = cellKey.split(',').map(Number);
            this.drawRevealedCell(lat, lng);
        });
        
        this.fogCtx.globalCompositeOperation = 'source-over';
    }
    
    drawRevealedCell(lat, lng) {
        const topLeft = this.map.latLngToContainerPoint([lat + this.config.cellSize, lng]);
        const bottomRight = this.map.latLngToContainerPoint([lat, lng + this.config.cellSize]);
        
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;
        
        // Создаем градиент для плавного перехода
        const gradient = this.fogCtx.createRadialGradient(
            topLeft.x + width/2, topLeft.y + height/2, 0,
            topLeft.x + width/2, topLeft.y + height/2, Math.max(width, height)/2
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
        
        this.fogCtx.fillStyle = gradient;
        this.fogCtx.fillRect(topLeft.x, topLeft.y, width, height);
    }
    
    updateStats() {
        const cellsElement = document.getElementById('cellsRevealed');
        const areaElement = document.getElementById('areaExplored');
        
        if (cellsElement) {
            cellsElement.textContent = this.revealedCells.size;
        }
        
        if (areaElement) {
            const area = (this.revealedCells.size * 100).toLocaleString();
            areaElement.textContent = `${area} км²`;
        }
    }
    
    saveProgress() {
        localStorage.setItem('battlemap_progress', JSON.stringify({
            cells: Array.from(this.revealedCells),
            playerId: this.playerId,
            lastSaved: new Date().toISOString()
        }));
    }
    
    loadProgress() {
        const saved = localStorage.getItem('battlemap_progress');
        if (saved) {
            const data = JSON.parse(saved);
            data.cells.forEach(cell => this.revealedCells.add(cell));
            this.updateStats();
            this.render();
        }
    }
    
    getOrCreatePlayerId() {
        let playerId = localStorage.getItem('battlemap_player_id');
        if (!playerId) {
            playerId = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('battlemap_player_id', playerId);
        }
        return playerId;
    }
    
    async syncToServer(cellKey) {
        // Переопределяется в OnlineBattleMap
    }
    
    async syncFromServer() {
        // Переопределяется в OnlineBattleMap
    }
    
    startSyncTimer() {
        // Переопределяется в OnlineBattleMap
    }
    
    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        if (this.map) {
            this.map.remove();
        }
    }
}

// Canvas Layer для Leaflet
L.CanvasLayer = L.Layer.extend({
    options: {
        render: function() {}
    },
    
    initialize: function(options) {
        L.setOptions(this, options);
    },
    
    onAdd: function(map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-layer');
        
        const size = map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        
        this._canvas.style.position = 'absolute';
        this._canvas.style.top = '0';
        this._canvas.style.left = '0';
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.zIndex = '450';
        
        map._panes.overlayPane.appendChild(this._canvas);
        
        map.on('moveend', this._reset, this);
        map.on('resize', this._resize, this);
        
        this._reset();
    },
    
    onRemove: function(map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend', this._reset, this);
        map.off('resize', this._resize, this);
    },
    
    _reset: function() {
        this.options.render.call(this);
    },
    
    _resize: function() {
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._reset();
    }
});

L.canvasLayer = function(options) {
    return new L.CanvasLayer(options);
};
    

    // === src/client/js/OnlineBattleMap.js ===
    // OnlineBattleMap - расширение с онлайн функциональностью

window.class OnlineBattleMap extends BattleMap {
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
    

    // === src/client/js/app.js ===
    // Главный файл приложения

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
    

})();
