// BattleMap Online - Google Maps Style Controls
class GoogleMapsBattleMap {
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
        this.batchDelay = 2000; // Увеличено до 2 секунд
        this.maxBatchSize = 25; // Увеличен размер батча
        
        // Rate limiting  
        this.lastRevealTime = 0;
        this.revealCooldown = 200;
        
        // Рендеринг
        this.renderTimer = null;
        this.renderDelay = 50; // Быстрый отклик
        this.isRendering = false;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 60000; // Увеличено до 60 секунд для экономии Redis
        this.isSyncing = false;
        this.lastActivity = Date.now();
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        this.init();
    }
    
    // ======= ИНИЦИАЛИЗАЦИЯ =======
    init() {
        this.initMap();
        this.setupCanvasInteraction();
        this.applyTheme(this.theme);
        
        // Отложенная инициализация
        setTimeout(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.render();
            this.startOnlineSync();
            this.updateUIState();
        }, 100);
        
        console.log('BattleMap инициализирован (Google Maps style)');
    }
    
    // ======= КАРТА =======
    initMap() {
        // Настройки карты оптимизированные для плавности
        const mapOptions = {
            center: [55.7558, 37.6173],
            zoom: 5,
            minZoom: 3,
            maxZoom: 15,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            
            // ВАЖНО: Включаем встроенное управление Leaflet
            zoomControl: true,
            attributionControl: false,
            
            // Оптимизации для производительности
            preferCanvas: true,
            renderer: L.canvas(),
            
            // Включаем/отключаем анимации в зависимости от устройства
            fadeAnimation: !this.isIOS,
            zoomAnimation: !this.isIOS,
            markerZoomAnimation: !this.isIOS,
            
            // Важно для плавного драга
            dragging: true,
            touchZoom: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: false,
            
            // Инерция для плавности
            inertia: true,
            inertiaDeceleration: 3000,
            inertiaMaxSpeed: 1500,
            easeLinearity: 0.2,
            
            // Оптимизация для мобильных
            tap: true,
            tapTolerance: 15,
            touchZoom: this.isMobile ? 'center' : true
        };
        
        this.map = L.map('map', mapOptions);
        
        // Тайловый слой с оптимизациями
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 3,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false, // Обновлять во время движения для плавности
            updateWhenZooming: true, // Обновлять при зуме
            keepBuffer: 2, // Буфер тайлов для плавности
            tileSize: 256,
            zoomOffset: 0,
            crossOrigin: true
        }).addTo(this.map);
        
        // Перемещаем контролы зума
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
    
    // ======= ВЗАИМОДЕЙСТВИЕ С КАНВАСОМ =======
    setupCanvasInteraction() {
        // ВАЖНО: Делаем канвас прозрачным для событий драга
        // Но оставляем возможность кликов
        this.gridCanvas.style.pointerEvents = 'auto';
        
        // Обработка кликов/тапов для раскрытия клеток
        if (this.isMobile) {
            this.setupMobileClick();
        } else {
            this.setupDesktopClick();
        }
        
        // Ресайз окна
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.scheduleRender();
        });
    }
    
    // ======= DESKTOP КЛИКИ =======
    setupDesktopClick() {
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        
        this.gridCanvas.addEventListener('mousedown', (e) => {
            isDragging = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            
            // Пропускаем событие к карте для драга
            if (e.button !== 0) {
                this.gridCanvas.style.pointerEvents = 'none';
                setTimeout(() => {
                    this.gridCanvas.style.pointerEvents = 'auto';
                }, 100);
            }
        });
        
        this.gridCanvas.addEventListener('mousemove', (e) => {
            const dx = Math.abs(e.clientX - dragStartX);
            const dy = Math.abs(e.clientY - dragStartY);
            
            // Если движение больше 5px - это драг
            if (dx > 5 || dy > 5) {
                isDragging = true;
                // Временно отключаем события канваса чтобы карта могла драгаться
                this.gridCanvas.style.pointerEvents = 'none';
            }
        });
        
        this.gridCanvas.addEventListener('mouseup', (e) => {
            if (!isDragging && e.button === 0) {
                // Это был клик, а не драг
                this.handleReveal(e.clientX, e.clientY);
            }
            
            // Восстанавливаем события
            setTimeout(() => {
                this.gridCanvas.style.pointerEvents = 'auto';
                isDragging = false;
            }, 100);
        });
        
        // Для правильной работы драга карты
        this.gridCanvas.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        
        // Контекстное меню
        this.gridCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    // ======= MOBILE КЛИКИ =======  
    setupMobileClick() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let isTouchMoving = false;
        
        // Используем passive: false для iOS
        const touchOptions = { passive: false };
        
        this.gridCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                touchStartTime = Date.now();
                isTouchMoving = false;
            } else {
                // Множественные касания - отключаем канвас
                this.gridCanvas.style.pointerEvents = 'none';
            }
        }, touchOptions);
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - touchStartX);
                const dy = Math.abs(touch.clientY - touchStartY);
                
                // Если движение больше 10px - это свайп/драг
                if (dx > 10 || dy > 10) {
                    isTouchMoving = true;
                    // Отключаем канвас для плавного драга карты
                    this.gridCanvas.style.pointerEvents = 'none';
                }
            }
        }, touchOptions);
        
        this.gridCanvas.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;
            
            // Если был короткий тап без движения
            if (!isTouchMoving && touchDuration < 200 && e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
                this.handleReveal(touch.clientX, touch.clientY);
            }
            
            // Восстанавливаем события канваса
            setTimeout(() => {
                this.gridCanvas.style.pointerEvents = 'auto';
                isTouchMoving = false;
            }, 100);
        }, touchOptions);
        
        // Отмена события touchcancel
        this.gridCanvas.addEventListener('touchcancel', () => {
            isTouchMoving = false;
            this.gridCanvas.style.pointerEvents = 'auto';
        }, touchOptions);
    }
    
    // ======= РАСКРЫТИЕ КЛЕТОК =======
    handleReveal(x, y) {
        // Обновляем активность
        this.lastActivity = Date.now();
        
        // Проверка cooldown
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
        this.showRevealAnimation(x, y);
    }
    
    // Анимация раскрытия
    showRevealAnimation(x, y) {
        const dot = document.createElement('div');
        dot.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 20px;
            height: 20px;
            margin: -10px 0 0 -10px;
            background: ${this.theme === 'dark' ? 'rgba(76, 175, 80, 0.6)' : 'rgba(46, 125, 50, 0.6)'};
            border-radius: 50%;
            pointer-events: none;
            z-index: 1000;
            animation: revealPulse 0.4s ease-out;
        `;
        
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 400);
    }
    
    // ======= БАТЧИНГ =======
    addToBatch(cellKey) {
        this.pendingReveals.add(cellKey);
        
        if (this.pendingReveals.size >= this.maxBatchSize) {
            this.flushBatch();
            return;
        }
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
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
            console.error('Ошибка отправки батча:', error);
        }
    }
    
    // ======= РЕНДЕРИНГ =======
    scheduleRender() {
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
        }
        
        this.renderTimer = setTimeout(() => {
            this.render();
        }, this.renderDelay);
    }
    
    render() {
        if (this.isRendering) return;
        this.isRendering = true;
        
        requestAnimationFrame(() => {
            try {
                const bounds = this.map.getBounds();
                
                // Очистка канвасов
                this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
                this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
                
                // Границы видимой области
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
                const maxCells = this.isMobile ? 500 : 1500; // Меньше для мобильных
                
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
                
                // Сетка (только при высоком зуме)
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
    
    // ======= СИНХРОНИЗАЦИЯ =======
    startOnlineSync() {
        this.syncWithServer();
        
        this.syncInterval = setInterval(() => {
            this.syncWithServer();
        }, this.syncDelay);
    }
    
    async syncWithServer() {
        if (this.isSyncing) return;
        
        // Пропускаем синхронизацию если нет активности больше 5 минут
        if (Date.now() - this.lastActivity > 300000) {
            console.log('Пропуск синхронизации - нет активности');
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
    
    // ======= UI МЕТОДЫ =======
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
        
        const controlHint = this.isMobile ? 
            'Тап - раскрыть | Свайп - карта | Щипок - зум' :
            'Клик - раскрыть | Драг - карта | Колесо - зум';
        
        const currentLocation = document.getElementById('currentLocation');
        if (currentLocation) {
            currentLocation.textContent = controlHint;
            currentLocation.style.fontSize = '9px';
        }
    }
    
    // ======= ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ =======
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
    
    // ======= ПУБЛИЧНЫЕ МЕТОДЫ ДЛЯ UI =======
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
        alert('Логирование отключено в этой версии');
    }
    
    clearLogs() {
        // Заглушка
    }
}

// CSS для анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes revealPulse {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
    
    /* Убираем курсор grab для канваса */
    #gridCanvas {
        cursor: crosshair !important;
    }
    
    /* Оптимизация для плавности */
    #map {
        will-change: transform;
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
    window.battleMap = new GoogleMapsBattleMap();
});