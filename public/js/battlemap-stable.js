// BattleMap Online - Стабильная версия с оптимизацией для мобильных
class StableBattleMap {
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
        
        // ======= ОПТИМИЗАЦИИ =======
        // Батчинг запросов
        this.pendingReveals = new Set();
        this.batchTimer = null;
        this.batchDelay = 500; // Увеличено для стабильности
        this.maxBatchSize = 10; // Уменьшено для меньшей нагрузки
        
        // Rate limiting  
        this.lastRevealTime = 0;
        this.revealCooldown = 200; // 200мс между кликами
        
        // Рендеринг
        this.renderTimer = null;
        this.renderDelay = 100; // Задержка рендеринга для оптимизации
        this.isRendering = false;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 20000; // 20 секунд
        this.isSyncing = false;
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        // Отключаем рисование - только клики/тапы
        this.drawingEnabled = false;
        
        this.init();
    }
    
    // ======= ИНИЦИАЛИЗАЦИЯ =======
    init() {
        this.initMap();
        this.setupEventListeners();
        this.applyTheme(this.theme);
        
        // Отложенная инициализация для iOS
        setTimeout(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.render();
            this.startOnlineSync();
            this.updateUIState();
        }, 100);
        
        console.log('BattleMap инициализирован (стабильная версия)');
    }
    
    // ======= КАРТА =======
    initMap() {
        // Опции карты оптимизированные для мобильных
        const mapOptions = {
            center: [55.7558, 37.6173],
            zoom: 5,
            minZoom: 3,
            maxZoom: 15, // Ограничиваем максимальный зум
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            zoomControl: false,
            attributionControl: false,
            // Оптимизации для мобильных
            preferCanvas: true,
            renderer: L.canvas(),
            // Отключаем анимации на iOS
            fadeAnimation: !this.isIOS,
            zoomAnimation: !this.isIOS,
            markerZoomAnimation: !this.isIOS
        };
        
        this.map = L.map('map', mapOptions);
        
        // Простой тайловый слой
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 3,
            attribution: '© OpenStreetMap',
            updateWhenIdle: true, // Обновлять только когда карта не движется
            updateWhenZooming: false, // Не обновлять при зуме
            keepBuffer: 1 // Минимальный буфер тайлов
        }).addTo(this.map);
        
        L.control.attribution({
            prefix: false,
            position: 'bottomleft'
        }).addTo(this.map);
    }
    
    // ======= ОБРАБОТЧИКИ СОБЫТИЙ =======
    setupEventListeners() {
        // События карты
        this.map.on('moveend', () => this.scheduleRender());
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.scheduleRender();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
        
        if (this.isMobile) {
            this.setupMobileControls();
        } else {
            this.setupDesktopControls();
        }
        
        // Ресайз окна
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.scheduleRender();
        });
        
        // Предотвращение контекстного меню
        this.gridCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    
    // ======= УПРАВЛЕНИЕ ДЕСКТОП =======
    setupDesktopControls() {
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        
        // Клик для раскрытия (без рисования)
        this.gridCanvas.addEventListener('click', (e) => {
            if (!isDragging) {
                this.handleReveal(e.clientX, e.clientY);
            }
        });
        
        // Перетаскивание карты с Shift или ПКМ
        this.gridCanvas.addEventListener('mousedown', (e) => {
            if (e.shiftKey || e.button === 2) {
                isDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                this.gridCanvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        
        this.gridCanvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
                
                const center = this.map.getCenter();
                const point = this.map.latLngToContainerPoint(center);
                point.x -= dx;
                point.y -= dy;
                
                this.map.panTo(this.map.containerPointToLatLng(point), {
                    animate: false,
                    noMoveStart: true
                });
                
                dragStartX = e.clientX;
                dragStartY = e.clientY;
            }
        });
        
        this.gridCanvas.addEventListener('mouseup', () => {
            isDragging = false;
            this.gridCanvas.style.cursor = 'crosshair';
        });
        
        this.gridCanvas.addEventListener('mouseleave', () => {
            isDragging = false;
            this.gridCanvas.style.cursor = 'crosshair';
        });
        
        // Курсор
        this.gridCanvas.style.cursor = 'crosshair';
    }
    
    // ======= УПРАВЛЕНИЕ МОБИЛЬНЫЕ =======
    setupMobileControls() {
        let touchStartTime = 0;
        let lastTapTime = 0;
        let touchStartX = 0;
        let touchStartY = 0;
        let isPanning = false;
        
        this.gridCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartTime = Date.now();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                isPanning = false;
                
                // Проверка двойного тапа для зума
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    this.map.zoomIn();
                    lastTapTime = 0;
                } else {
                    lastTapTime = now;
                }
                
            } else if (e.touches.length === 2) {
                // Начало pinch-to-zoom
                isPanning = false;
                this.handlePinchStart(e.touches);
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                
                // Если движение больше 10px - это pan
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    isPanning = true;
                    
                    const center = this.map.getCenter();
                    const point = this.map.latLngToContainerPoint(center);
                    point.x -= dx;
                    point.y -= dy;
                    
                    this.map.panTo(this.map.containerPointToLatLng(point), {
                        animate: false,
                        noMoveStart: true
                    });
                    
                    touchStartX = touch.clientX;
                    touchStartY = touch.clientY;
                }
                
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                this.handlePinchMove(e.touches);
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            // Если был короткий тап без движения - раскрываем клетку
            const touchDuration = Date.now() - touchStartTime;
            if (!isPanning && touchDuration < 200 && e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
                this.handleReveal(touch.clientX, touch.clientY);
            }
            
            isPanning = false;
            this.lastPinchDistance = 0;
        }, { passive: false });
    }
    
    // Pinch-to-zoom обработка
    lastPinchDistance = 0;
    
    handlePinchStart(touches) {
        const distance = Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
        this.lastPinchDistance = distance;
    }
    
    handlePinchMove(touches) {
        const distance = Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
        
        if (this.lastPinchDistance > 0) {
            const scale = distance / this.lastPinchDistance;
            if (scale > 1.2) {
                this.map.zoomIn();
                this.lastPinchDistance = distance;
            } else if (scale < 0.8) {
                this.map.zoomOut();
                this.lastPinchDistance = distance;
            }
        }
    }
    
    // ======= РАСКРЫТИЕ КЛЕТОК =======
    handleReveal(x, y) {
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
    }
    
    // ======= БАТЧИНГ =======
    addToBatch(cellKey) {
        this.pendingReveals.add(cellKey);
        
        // Отправляем сразу если батч полный
        if (this.pendingReveals.size >= this.maxBatchSize) {
            this.flushBatch();
            return;
        }
        
        // Иначе ждем
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
                const maxCells = 1000; // Ограничение для производительности
                
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
        const maxLines = 100; // Ограничение для производительности
        
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
        this.isSyncing = true;
        
        const syncStatus = document.getElementById('syncStatus');
        
        try {
            if (syncStatus) syncStatus.classList.add('show');
            
            const response = await fetch('/api/game-state');
            
            if (response.ok) {
                const data = await response.json();
                
                // Обновляем клетки
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
                
                // Обновляем статистику
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
        // Обновляем статусы в меню
        const themeStatus = document.getElementById('themeStatus');
        if (themeStatus) {
            themeStatus.textContent = this.theme === 'dark' ? 'Темная' : 'Светлая';
        }
        
        const gridStatus = document.getElementById('gridStatus');
        if (gridStatus) {
            gridStatus.textContent = this.showGrid ? 'ON' : 'OFF';
        }
        
        // Инструкция управления
        const controlHint = this.isMobile ? 
            'Тап - раскрыть | Свайп - перемещение | Щипок - зум' :
            'Клик - раскрыть | Shift+ЛКМ или ПКМ - перемещение | Колесо - зум';
        
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
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1
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
        alert('Логирование отключено в стабильной версии');
    }
    
    clearLogs() {
        // Заглушка
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.battleMap = new StableBattleMap();
});