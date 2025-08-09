// BattleMap - Исправленная версия с hover и без артефактов
class FixedBattleMap {
    constructor() {
        this.map = null;
        this.fogCanvas = document.getElementById('fogCanvas');
        this.gridCanvas = document.getElementById('gridCanvas');
        this.fogCtx = this.fogCanvas.getContext('2d', { 
            willReadFrequently: false,
            alpha: true
        });
        this.gridCtx = this.gridCanvas.getContext('2d', {
            willReadFrequently: false,
            alpha: true
        });
        
        // КРИТИЧНО: Канвасы прозрачны для drag, но ловят hover
        this.fogCanvas.style.pointerEvents = 'none';
        this.gridCanvas.style.pointerEvents = 'none';
        
        // Размеры клетки
        this.CELL_SIZE_KM = 10;
        this.CELL_SIZE_LAT = 10 / 111;
        
        // Состояние
        this.revealedCells = new Set();
        this.showGrid = true;
        this.currentZoom = 5;
        this.hoveredCell = null; // Для hover эффекта
        
        // ID игрока
        this.playerId = this.getOrCreatePlayerId();
        
        // Батчинг
        this.pendingReveals = new Set();
        this.batchTimer = null;
        this.batchDelay = 2000;
        this.maxBatchSize = 25;
        
        // Rate limiting  
        this.lastRevealTime = 0;
        this.revealCooldown = 200;
        
        // Рендеринг
        this.renderTimer = null;
        this.renderDelay = 16; // 60 FPS для плавности
        this.isRendering = false;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 60000;
        this.isSyncing = false;
        this.lastActivity = Date.now();
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        this.init();
    }
    
    init() {
        console.log('Инициализация Fixed BattleMap');
        
        this.initMap();
        this.setupInteraction();
        this.applyTheme(this.theme);
        
        // Отложенная инициализация
        setTimeout(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.render();
            this.startOnlineSync();
            this.updateUIState();
        }, 100);
    }
    
    initMap() {
        this.map = L.map('map', {
            center: [55.7558, 37.6173],
            zoom: 5,
            minZoom: 3,
            maxZoom: 15,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            zoomControl: true,
            attributionControl: false,
            // Оптимизация рендеринга
            preferCanvas: true,
            renderer: L.canvas()
        });
        
        // Тайлы
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 3,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false, // Обновлять во время движения
            updateWhenZooming: false, // Не обновлять при зуме для плавности
            keepBuffer: 2
        }).addTo(this.map);
        
        // Контролы
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
        
        L.control.attribution({
            prefix: false,
            position: 'bottomleft'
        }).addTo(this.map);
        
        // События карты - с дебаунсом для оптимизации
        let moveTimer = null;
        this.map.on('move', () => {
            // Быстрый рендер при движении
            if (!this.isRendering) {
                this.render();
            }
        });
        
        this.map.on('moveend', () => {
            // Финальный рендер после остановки
            if (moveTimer) clearTimeout(moveTimer);
            moveTimer = setTimeout(() => {
                this.render();
            }, 100);
        });
        
        this.map.on('zoomstart', () => {
            // Скрываем канвасы при начале зума для производительности
            this.fogCanvas.style.opacity = '0.5';
            this.gridCanvas.style.opacity = '0.5';
        });
        
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            // Восстанавливаем канвасы
            this.fogCanvas.style.opacity = '1';
            this.gridCanvas.style.opacity = '1';
            this.render();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
    }
    
    setupInteraction() {
        const mapContainer = this.map.getContainer();
        
        // Отслеживание драга
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        
        // === DESKTOP ===
        // Hover эффект
        mapContainer.addEventListener('mousemove', (e) => {
            if (!isDragging && !this.isMobile) {
                const point = L.point(e.clientX, e.clientY);
                const latLng = this.map.containerPointToLatLng(point);
                
                const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
                
                if (this.hoveredCell !== cellKey) {
                    this.hoveredCell = cellKey;
                    this.scheduleRender();
                }
                
                // Меняем курсор
                if (!this.revealedCells.has(cellKey)) {
                    mapContainer.style.cursor = 'pointer';
                } else {
                    mapContainer.style.cursor = 'grab';
                }
            }
        });
        
        mapContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            mapContainer.style.cursor = 'grabbing';
        });
        
        mapContainer.addEventListener('mousemove', (e) => {
            if (startX !== 0) {
                const dx = Math.abs(e.clientX - startX);
                const dy = Math.abs(e.clientY - startY);
                if (dx > 3 || dy > 3) {
                    isDragging = true;
                }
            }
        });
        
        mapContainer.addEventListener('mouseup', (e) => {
            if (!isDragging && e.button === 0) {
                this.handleReveal(e.clientX, e.clientY);
            }
            isDragging = false;
            startX = 0;
            startY = 0;
            mapContainer.style.cursor = 'grab';
        });
        
        mapContainer.addEventListener('mouseleave', () => {
            this.hoveredCell = null;
            this.scheduleRender();
        });
        
        // === MOBILE ===
        if (this.isMobile) {
            let touchStartX = 0;
            let touchStartY = 0;
            let isTouchDragging = false;
            
            mapContainer.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    const touch = e.touches[0];
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                    isTouchDragging = false;
                }
            }, { passive: true });
            
            mapContainer.addEventListener('touchmove', (e) => {
                if (e.touches.length === 1) {
                    const touch = e.touches[0];
                    const dx = Math.abs(touch.clientX - touchStartX);
                    const dy = Math.abs(touch.clientY - touchStartY);
                    if (dx > 10 || dy > 10) {
                        isTouchDragging = true;
                    }
                }
            }, { passive: true });
            
            mapContainer.addEventListener('touchend', (e) => {
                if (!isTouchDragging && e.changedTouches.length === 1) {
                    const touch = e.changedTouches[0];
                    this.handleReveal(touch.clientX, touch.clientY);
                }
                isTouchDragging = false;
            }, { passive: true });
        }
        
        // Ресайз
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.render();
        });
    }
    
    handleReveal(x, y) {
        this.lastActivity = Date.now();
        
        const now = Date.now();
        if (now - this.lastRevealTime < this.revealCooldown) {
            return;
        }
        this.lastRevealTime = now;
        
        const point = L.point(x, y);
        const latLng = this.map.containerPointToLatLng(point);
        
        const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
        
        if (this.revealedCells.has(cellKey) || this.pendingReveals.has(cellKey)) {
            return;
        }
        
        console.log('Раскрытие клетки:', cellKey);
        
        this.addToBatch(cellKey);
        this.revealedCells.add(cellKey);
        this.updateLocalStats();
        this.scheduleRender();
        this.showClickEffect(x, y);
    }
    
    showClickEffect(x, y) {
        const effect = document.createElement('div');
        effect.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 20px;
            height: 20px;
            margin: -10px 0 0 -10px;
            background: ${this.theme === 'dark' ? '#4CAF50' : '#2E7D32'};
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            opacity: 0.8;
            transform: scale(0);
            animation: clickPulse 0.4s ease-out;
        `;
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 400);
    }
    
    addToBatch(cellKey) {
        this.pendingReveals.add(cellKey);
        
        if (this.pendingReveals.size >= this.maxBatchSize) {
            this.flushBatch();
            return;
        }
        
        if (this.batchTimer) clearTimeout(this.batchTimer);
        this.batchTimer = setTimeout(() => this.flushBatch(), this.batchDelay);
    }
    
    async flushBatch() {
        if (this.pendingReveals.size === 0) return;
        
        const batch = Array.from(this.pendingReveals);
        this.pendingReveals.clear();
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        try {
            const response = await fetch('/api/reveal-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cells: batch,
                    playerId: this.playerId,
                    timestamp: Date.now()
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.totalRevealed) {
                    document.getElementById('totalCells').textContent = data.totalRevealed.toLocaleString();
                }
                if (data.onlinePlayers) {
                    document.getElementById('onlinePlayers').textContent = data.onlinePlayers;
                }
            }
        } catch (error) {
            console.error('Ошибка батча:', error);
        }
    }
    
    scheduleRender() {
        if (this.renderTimer) clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => this.render(), this.renderDelay);
    }
    
    render() {
        if (this.isRendering) return;
        this.isRendering = true;
        
        requestAnimationFrame(() => {
            try {
                const bounds = this.map.getBounds();
                
                // Очистка с небольшим запасом для устранения артефактов
                this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
                this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
                
                // Добавляем буфер для предотвращения разрывов
                const buffer = 0.1; // 10% буфер
                const startLat = Math.floor((bounds.getSouth() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                const endLat = Math.ceil((bounds.getNorth() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                const startLng = Math.floor((bounds.getWest() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                const endLng = Math.ceil((bounds.getEast() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                
                // Туман
                const fogColor = this.theme === 'dark' ? 
                    'rgba(255, 255, 255, 0.85)' : 
                    'rgba(0, 0, 0, 0.3)';
                
                this.fogCtx.fillStyle = fogColor;
                this.fogCtx.beginPath();
                
                let cellCount = 0;
                const maxCells = this.isMobile ? 500 : 1500;
                
                for (let lat = startLat; lat <= endLat && cellCount < maxCells; lat += this.CELL_SIZE_LAT) {
                    for (let lng = startLng; lng <= endLng && cellCount < maxCells; lng += this.CELL_SIZE_LAT) {
                        const cellKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
                        
                        if (!this.revealedCells.has(cellKey)) {
                            const nw = this.map.latLngToContainerPoint([lat + this.CELL_SIZE_LAT, lng]);
                            const se = this.map.latLngToContainerPoint([lat, lng + this.CELL_SIZE_LAT]);
                            
                            // Добавляем 1px overlap для устранения швов
                            const x = Math.floor(nw.x) - 1;
                            const y = Math.floor(nw.y) - 1;
                            const width = Math.ceil(se.x - nw.x) + 2;
                            const height = Math.ceil(se.y - nw.y) + 2;
                            
                            // Hover эффект
                            if (this.hoveredCell === cellKey && !this.isMobile) {
                                // Рисуем hover отдельно
                                this.fogCtx.save();
                                this.fogCtx.fillStyle = this.theme === 'dark' ? 
                                    'rgba(255, 255, 255, 0.6)' : 
                                    'rgba(0, 0, 0, 0.2)';
                                this.fogCtx.fillRect(x, y, width, height);
                                this.fogCtx.restore();
                            } else {
                                this.fogCtx.rect(x, y, width, height);
                            }
                            
                            cellCount++;
                        }
                    }
                }
                
                this.fogCtx.fill();
                
                // Сетка
                if (this.showGrid && this.currentZoom >= 10) {
                    this.drawGrid(startLat, endLat, startLng, endLng);
                }
            } finally {
                this.isRendering = false;
            }
        });
    }
    
    drawGrid(startLat, endLat, startLng, endLng) {
        this.gridCtx.strokeStyle = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.1)' : 
            'rgba(0, 0, 0, 0.1)';
        this.gridCtx.lineWidth = 0.5;
        this.gridCtx.beginPath();
        
        let lineCount = 0;
        const maxLines = this.isMobile ? 50 : 150;
        
        for (let lat = startLat; lat <= endLat && lineCount < maxLines; lat += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([lat, startLng]);
            const endPoint = this.map.latLngToContainerPoint([lat, endLng]);
            this.gridCtx.moveTo(Math.floor(point.x) + 0.5, Math.floor(point.y) + 0.5);
            this.gridCtx.lineTo(Math.floor(endPoint.x) + 0.5, Math.floor(endPoint.y) + 0.5);
            lineCount++;
        }
        
        for (let lng = startLng; lng <= endLng && lineCount < maxLines; lng += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([startLat, lng]);
            const endPoint = this.map.latLngToContainerPoint([endLat, lng]);
            this.gridCtx.moveTo(Math.floor(point.x) + 0.5, Math.floor(point.y) + 0.5);
            this.gridCtx.lineTo(Math.floor(endPoint.x) + 0.5, Math.floor(endPoint.y) + 0.5);
            lineCount++;
        }
        
        this.gridCtx.stroke();
    }
    
    startOnlineSync() {
        this.syncWithServer();
        this.syncInterval = setInterval(() => this.syncWithServer(), this.syncDelay);
    }
    
    async syncWithServer() {
        if (this.isSyncing) return;
        
        if (Date.now() - this.lastActivity > 300000) {
            return;
        }
        
        this.isSyncing = true;
        const syncStatus = document.getElementById('syncStatus');
        
        try {
            if (syncStatus) syncStatus.classList.add('show');
            
            const response = await fetch('/api/game-state');
            if (response.ok) {
                const data = await response.json();
                
                const cells = data.allCells || data.cells || [];
                if (Array.isArray(cells)) {
                    let newCells = 0;
                    cells.forEach(cell => {
                        if (!this.revealedCells.has(cell)) {
                            this.revealedCells.add(cell);
                            newCells++;
                        }
                    });
                    
                    if (newCells > 0) {
                        this.scheduleRender();
                    }
                }
                
                if (data.totalCells !== undefined) {
                    document.getElementById('totalCells').textContent = data.totalCells.toLocaleString();
                }
                
                if (data.onlinePlayers !== undefined) {
                    document.getElementById('onlinePlayers').textContent = data.onlinePlayers;
                }
                
                if (data.topCountries && data.topCountries.length > 0) {
                    this.updateTopCountries(data.topCountries);
                }
            }
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
        } finally {
            this.isSyncing = false;
            if (syncStatus) {
                setTimeout(() => syncStatus.classList.remove('show'), 1000);
            }
        }
    }
    
    updateLocalStats() {
        const area = this.revealedCells.size * 100;
        const cells = this.revealedCells.size;
        document.getElementById('areaRevealed').textContent = area.toLocaleString();
        document.getElementById('cellsRevealed').textContent = cells.toLocaleString();
    }
    
    updateTopCountries(countries) {
        const container = document.getElementById('countriesList');
        if (!container) return;
        
        container.innerHTML = countries.map((country, index) => {
            const parts = country.name.split(' ');
            const flag = parts[0];
            const name = parts.slice(1).join(' ');
            
            return `
                <div class="country-item">
                    <span>${index + 1}. ${flag} ${name}</span>
                    <span class="country-cells">${country.cells} клеток (${country.percentage}%)</span>
                </div>
            `;
        }).join('');
    }
    
    updateUIState() {
        const themeStatus = document.getElementById('themeStatus');
        if (themeStatus) {
            themeStatus.textContent = this.theme === 'dark' ? 'Темная' : 'Светлая';
        }
        
        const gridStatus = document.getElementById('gridStatus');
        if (gridStatus) {
            gridStatus.textContent = this.showGrid ? 'ON' : 'OFF';
        }
        
        const currentLocation = document.getElementById('currentLocation');
        if (currentLocation) {
            currentLocation.textContent = 'Fixed версия';
            currentLocation.style.fontSize = '9px';
        }
    }
    
    getOrCreatePlayerId() {
        let playerId = localStorage.getItem('battleMapPlayerId');
        if (!playerId) {
            playerId = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('battleMapPlayerId', playerId);
        }
        return playerId;
    }
    
    resizeCanvas() {
        this.fogCanvas.width = window.innerWidth;
        this.fogCanvas.height = window.innerHeight;
        this.gridCanvas.width = window.innerWidth;
        this.gridCanvas.height = window.innerHeight;
    }
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.theme = theme;
        localStorage.setItem('battleMapTheme', theme);
        this.scheduleRender();
    }
    
    changeMapStyle(style) {
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }
        
        let tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        let maxZoom = 15;
        
        switch(style) {
            case 'hot':
                tileUrl = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
                break;
            case 'topo':
                tileUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
                break;
            case 'positron':
                tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
                break;
            case 'dark':
                tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
                break;
            case 'satellite':
                tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                break;
        }
        
        this.tileLayer = L.tileLayer(tileUrl, {
            maxZoom: maxZoom,
            minZoom: 3,
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 2
        }).addTo(this.map);
    }
    
    // Публичные методы
    toggleTheme() {
        const newTheme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        this.updateUIState();
    }
    
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.scheduleRender();
        this.updateUIState();
    }
    
    toggleMenu() {
        const menu = document.getElementById('sideMenu');
        menu?.classList.toggle('active');
    }
    
    toggleLogsPanel() {
        const panel = document.getElementById('logsPanel');
        panel?.classList.toggle('active');
    }
    
    saveProgress() {
        const data = {
            cells: Array.from(this.revealedCells),
            timestamp: Date.now()
        };
        localStorage.setItem('battleMapProgress', JSON.stringify(data));
        alert('Прогресс сохранен!');
    }
    
    loadProgress() {
        try {
            const saved = localStorage.getItem('battleMapProgress');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.cells && Array.isArray(data.cells)) {
                    this.revealedCells = new Set(data.cells);
                    this.updateLocalStats();
                    this.scheduleRender();
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки:', error);
        }
    }
    
    resetFog() {
        if (confirm('Вы уверены? Это сбросит весь ваш локальный прогресс!')) {
            this.revealedCells.clear();
            this.pendingReveals.clear();
            localStorage.removeItem('battleMapProgress');
            this.updateLocalStats();
            this.scheduleRender();
        }
    }
    
    copyLogs() {
        alert('Логи отключены');
    }
    
    clearLogs() {}
}

// CSS для анимации и стилей
const style = document.createElement('style');
style.textContent = `
    @keyframes clickPulse {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(3);
            opacity: 0;
        }
    }
    
    /* Канвасы не блокируют события */
    #fogCanvas, #gridCanvas {
        pointer-events: none !important;
    }
    
    /* Плавные переходы для канвасов */
    #fogCanvas, #gridCanvas {
        transition: opacity 0.2s ease;
    }
    
    /* Курсоры */
    #map {
        cursor: grab !important;
    }
    
    #map.leaflet-drag-target {
        cursor: grabbing !important;
    }
`;
document.head.appendChild(style);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, создаем Fixed BattleMap');
    window.battleMap = new FixedBattleMap();
});