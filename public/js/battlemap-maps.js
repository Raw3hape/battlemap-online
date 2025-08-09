// BattleMap Online - Точное управление как в Google Maps
class BattleMapMaps {
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
        
        // Размеры клетки
        this.CELL_SIZE_KM = 10;
        this.CELL_SIZE_LAT = 10 / 111;
        
        // Состояние
        this.revealedCells = new Set();
        this.showGrid = true;
        this.currentZoom = 5;
        
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
        this.renderDelay = 50;
        
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
        this.initMap();
        this.setupInteraction();
        this.applyTheme(this.theme);
        
        setTimeout(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.render();
            this.startOnlineSync();
            this.updateUIState();
        }, 100);
        
        console.log('BattleMap Maps - точное управление как в Google Maps');
    }
    
    initMap() {
        // КРИТИЧНО: Настройки для работы как в Google Maps
        const mapOptions = {
            center: [55.7558, 37.6173],
            zoom: 5,
            minZoom: 3,
            maxZoom: 15,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            
            // Включаем ВСЕ стандартные контролы Leaflet
            zoomControl: true,
            attributionControl: false,
            
            // ВАЖНО: Все взаимодействия включены
            dragging: true,
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheelZoom: true,
            boxZoom: false,
            keyboard: true,
            tap: true,
            tapTolerance: 15,
            touchZoom: 'center',
            
            // Производительность
            preferCanvas: true,
            renderer: L.canvas(),
            
            // Инерция для плавности
            inertia: true,
            inertiaDeceleration: 3000,
            inertiaMaxSpeed: 1500,
            easeLinearity: 0.2,
            
            // Анимации
            fadeAnimation: !this.isIOS,
            zoomAnimation: !this.isIOS,
            markerZoomAnimation: false
        };
        
        this.map = L.map('map', mapOptions);
        
        // Тайлы
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 3,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false,
            updateWhenZooming: true,
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
        
        // События карты
        this.map.on('moveend', () => this.scheduleRender());
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.scheduleRender();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
    }
    
    setupInteraction() {
        // КРИТИЧНО: Канвас НЕ блокирует события мыши для драга
        // Но ловит клики для раскрытия клеток
        
        // Флаг для отслеживания драга
        let isDragging = false;
        let mouseDownTime = 0;
        let startX = 0;
        let startY = 0;
        
        // === DESKTOP ===
        // Mousedown - начало потенциального драга или клика
        this.gridCanvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Только левая кнопка
            
            mouseDownTime = Date.now();
            startX = e.clientX;
            startY = e.clientY;
            isDragging = false;
            
            // ВАЖНО: Сразу передаем событие карте для начала драга
            // Временно делаем канвас прозрачным для событий
            this.gridCanvas.style.pointerEvents = 'none';
            
            // Симулируем mousedown на карте
            const mapContainer = this.map.getContainer();
            const evt = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                clientX: e.clientX,
                clientY: e.clientY,
                button: 0
            });
            mapContainer.dispatchEvent(evt);
        });
        
        // Mousemove - определяем драг
        document.addEventListener('mousemove', (e) => {
            if (mouseDownTime > 0) {
                const dx = Math.abs(e.clientX - startX);
                const dy = Math.abs(e.clientY - startY);
                if (dx > 3 || dy > 3) {
                    isDragging = true;
                }
            }
        });
        
        // Mouseup - завершение драга или клик
        document.addEventListener('mouseup', (e) => {
            if (mouseDownTime > 0) {
                const clickDuration = Date.now() - mouseDownTime;
                
                // Восстанавливаем события канваса
                this.gridCanvas.style.pointerEvents = 'auto';
                
                // Если это был быстрый клик без движения - раскрываем клетку
                if (!isDragging && clickDuration < 200) {
                    // Проверяем что клик был над канвасом
                    const rect = this.gridCanvas.getBoundingClientRect();
                    if (e.clientX >= rect.left && e.clientX <= rect.right &&
                        e.clientY >= rect.top && e.clientY <= rect.bottom) {
                        this.handleReveal(e.clientX, e.clientY);
                    }
                }
                
                mouseDownTime = 0;
                isDragging = false;
            }
        });
        
        // === MOBILE ===
        let touchStartTime = 0;
        let touchStartX = 0;
        let touchStartY = 0;
        let isTouchDragging = false;
        
        // Touchstart
        this.gridCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartTime = Date.now();
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                isTouchDragging = false;
                
                // Передаем событие карте
                this.gridCanvas.style.pointerEvents = 'none';
            }
        }, { passive: true });
        
        // Touchmove
        this.gridCanvas.addEventListener('touchmove', (e) => {
            if (touchStartTime > 0 && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - touchStartX);
                const dy = Math.abs(touch.clientY - touchStartY);
                if (dx > 10 || dy > 10) {
                    isTouchDragging = true;
                }
            }
        }, { passive: true });
        
        // Touchend
        this.gridCanvas.addEventListener('touchend', (e) => {
            if (touchStartTime > 0) {
                const touchDuration = Date.now() - touchStartTime;
                
                // Восстанавливаем события
                this.gridCanvas.style.pointerEvents = 'auto';
                
                // Если был короткий тап без движения
                if (!isTouchDragging && touchDuration < 200 && e.changedTouches.length === 1) {
                    const touch = e.changedTouches[0];
                    this.handleReveal(touch.clientX, touch.clientY);
                }
                
                touchStartTime = 0;
                isTouchDragging = false;
            }
        }, { passive: true });
        
        // Отключаем выделение текста и контекстное меню
        this.gridCanvas.addEventListener('selectstart', (e) => e.preventDefault());
        this.gridCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Ресайз
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.scheduleRender();
        });
    }
    
    handleReveal(x, y) {
        // Обновляем активность
        this.lastActivity = Date.now();
        
        // Проверка cooldown
        const now = Date.now();
        if (now - this.lastRevealTime < this.revealCooldown) {
            return;
        }
        this.lastRevealTime = now;
        
        // Конвертируем координаты в lat/lng
        const point = L.point(x, y);
        const latLng = this.map.containerPointToLatLng(point);
        
        // Вычисляем клетку
        const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
        
        // Проверка дубликата
        if (this.revealedCells.has(cellKey) || this.pendingReveals.has(cellKey)) {
            return;
        }
        
        // Добавляем в батч
        this.addToBatch(cellKey);
        
        // Сразу показываем локально
        this.revealedCells.add(cellKey);
        this.updateLocalStats();
        this.scheduleRender();
        
        // Визуальная обратная связь
        this.showClickFeedback(x, y);
    }
    
    showClickFeedback(x, y) {
        const ripple = document.createElement('div');
        ripple.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 30px;
            height: 30px;
            margin: -15px 0 0 -15px;
            border: 2px solid ${this.theme === 'dark' ? '#4CAF50' : '#2E7D32'};
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            animation: rippleEffect 0.6s ease-out;
            opacity: 0;
        `;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
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
        requestAnimationFrame(() => {
            const bounds = this.map.getBounds();
            
            // Очистка
            this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
            this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
            
            // Границы
            const startLat = Math.floor(bounds.getSouth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
            const endLat = Math.ceil(bounds.getNorth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
            const startLng = Math.floor(bounds.getWest() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
            const endLng = Math.ceil(bounds.getEast() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
            
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
                        
                        this.fogCtx.rect(
                            Math.floor(nw.x),
                            Math.floor(nw.y),
                            Math.ceil(se.x - nw.x),
                            Math.ceil(se.y - nw.y)
                        );
                        cellCount++;
                    }
                }
            }
            
            this.fogCtx.fill();
            
            // Сетка
            if (this.showGrid && this.currentZoom >= 10) {
                this.drawGrid(startLat, endLat, startLng, endLng);
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
            this.gridCtx.moveTo(point.x, point.y);
            this.gridCtx.lineTo(endPoint.x, endPoint.y);
            lineCount++;
        }
        
        for (let lng = startLng; lng <= endLng && lineCount < maxLines; lng += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([startLat, lng]);
            const endPoint = this.map.latLngToContainerPoint([endLat, lng]);
            this.gridCtx.moveTo(point.x, point.y);
            this.gridCtx.lineTo(endPoint.x, endPoint.y);
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
        
        // Пропускаем если нет активности > 5 минут
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
        
        document.getElementById('currentLocation').textContent = 'Карта работает как Google Maps';
        document.getElementById('currentLocation').style.fontSize = '9px';
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
            updateWhenZooming: true,
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

// CSS для анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes rippleEffect {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
    
    #gridCanvas {
        cursor: crosshair !important;
    }
    
    #fogCanvas {
        pointer-events: none !important;
    }
    
    .leaflet-container {
        cursor: grab !important;
    }
    
    .leaflet-dragging .leaflet-container {
        cursor: grabbing !important;
    }
`;
document.head.appendChild(style);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.battleMap = new BattleMapMaps();
});