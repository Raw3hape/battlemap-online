// BattleMap - Оптимизированная версия без разрывов
class OptimizedBattleMap {
    constructor() {
        this.map = null;
        this.fogCanvas = document.getElementById('fogCanvas');
        this.gridCanvas = document.getElementById('gridCanvas');
        this.fogCtx = this.fogCanvas.getContext('2d', { 
            willReadFrequently: false,
            alpha: true,
            imageSmoothingEnabled: false // Отключаем сглаживание для четких краев
        });
        this.gridCtx = this.gridCanvas.getContext('2d', {
            willReadFrequently: false,
            alpha: true
        });
        
        // Канвасы не блокируют события
        this.fogCanvas.style.pointerEvents = 'none';
        this.gridCanvas.style.pointerEvents = 'none';
        
        // Размеры клетки
        this.CELL_SIZE_KM = 10;
        this.CELL_SIZE_LAT = 10 / 111;
        
        // Состояние
        this.revealedCells = new Set();
        this.showGrid = true;
        this.currentZoom = 5;
        this.hoveredCell = null;
        
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
        
        // Рендер кэш для производительности
        this.renderRequested = false;
        
        this.init();
    }
    
    init() {
        console.log('Инициализация Optimized BattleMap');
        
        this.initMap();
        this.setupRealtimeSync();
        this.setupInteraction();
        this.applyTheme(this.theme);
        
        // Первый рендер сразу после инициализации карты
        this.map.whenReady(() => {
            this.resizeCanvas();
            this.loadProgress();
            // Двойной рендер для надежности
            this.renderImmediate();
            setTimeout(() => {
                this.renderImmediate();
                this.startOnlineSync();
                this.updateUIState();
            }, 250);
        });
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
            preferCanvas: true,
            renderer: L.canvas(),
            fadeAnimation: true,
            zoomAnimation: true,
            markerZoomAnimation: false
        });
        
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 3,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 2
        }).addTo(this.map);
        
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
        
        L.control.attribution({
            prefix: false,
            position: 'bottomleft'
        }).addTo(this.map);
    }
    
    setupRealtimeSync() {
        // Оптимизированная синхронизация с дебаунсом
        let rafId = null;
        let moveTimeout = null;
        
        const requestRender = () => {
            if (rafId) return;
            
            // Отменяем предыдущий таймаут
            if (moveTimeout) clearTimeout(moveTimeout);
            
            // Небольшая задержка для группировки событий
            moveTimeout = setTimeout(() => {
                rafId = requestAnimationFrame(() => {
                    this.renderImmediate();
                    rafId = null;
                });
            }, 16); // ~60fps
        };
        
        // События движения
        this.map.on('move', requestRender);
        this.map.on('zoom', requestRender);
        this.map.on('viewreset', requestRender);
        this.map.on('load', requestRender);
        
        // Анимация зума
        this.map.on('zoomanim', (e) => {
            const scale = this.map.getZoomScale(e.zoom);
            const offset = this.map._getCenterOffset(e.center)._multiplyBy(-scale)._add(this.map._getMapPanePos());
            
            const transform = L.DomUtil.TRANSFORM;
            this.fogCanvas.style[transform] = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
            this.gridCanvas.style[transform] = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
        });
        
        // Конец зума
        this.map.on('zoomend', () => {
            this.fogCanvas.style.transform = '';
            this.gridCanvas.style.transform = '';
            this.currentZoom = this.map.getZoom();
            this.renderImmediate();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
        
        // Ресайз
        this.map.on('resize', () => {
            this.resizeCanvas();
            this.renderImmediate();
        });
    }
    
    setupInteraction() {
        const mapContainer = this.map.getContainer();
        
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        
        // Desktop hover - УБРАНА async проверка локации!
        if (!this.isMobile) {
            mapContainer.addEventListener('mousemove', (e) => {
                if (!isDragging) {
                    const point = L.point(e.clientX, e.clientY);
                    const latLng = this.map.containerPointToLatLng(point);
                    
                    const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                    const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                    const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
                    
                    if (this.hoveredCell !== cellKey) {
                        this.hoveredCell = cellKey;
                        this.renderImmediate();
                    }
                    
                    // Простой курсор без проверок
                    mapContainer.style.cursor = !this.revealedCells.has(cellKey) ? 'pointer' : 'grab';
                }
            });
            
            mapContainer.addEventListener('mouseleave', () => {
                this.hoveredCell = null;
                this.renderImmediate();
            });
        }
        
        // Click обработка
        mapContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
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
        });
        
        // Mobile
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
        
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.renderImmediate();
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
        this.renderImmediate();
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
    
    renderImmediate() {
        // Проверка готовности карты
        if (!this.map || !this.fogCanvas || !this.gridCanvas) {
            console.log('Map or canvas not ready');
            return;
        }
        
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        
        // Проверка валидности размеров
        const width = this.fogCanvas.width;
        const height = this.fogCanvas.height;
        
        if (width === 0 || height === 0) {
            console.log('Canvas has zero dimensions');
            return;
        }
        
        // Сохраняем состояние контекста
        this.fogCtx.save();
        this.gridCtx.save();
        
        // ВАЖНО: Заливаем весь канвас цветом тумана сначала
        const fogColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.8)' : 
            'rgba(0, 0, 0, 0.8)';
        
        // Сброс композиции и стилей
        this.fogCtx.globalCompositeOperation = 'source-over';
        this.fogCtx.globalAlpha = 1.0;
        this.fogCtx.fillStyle = fogColor;
        this.fogCtx.fillRect(0, 0, width, height);
        
        // Очистка сетки
        this.gridCtx.clearRect(0, 0, width, height);
        
        // Расширенный буфер для покрытия краев
        const zoomFactor = Math.max(1, (15 - zoom) / 5);
        const buffer = 1.0 * zoomFactor; // Увеличенный буфер
        
        const startLat = Math.floor((bounds.getSouth() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLat = Math.ceil((bounds.getNorth() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const startLng = Math.floor((bounds.getWest() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLng = Math.ceil((bounds.getEast() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        // Цвет hover
        const hoverColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.6)' : 
            'rgba(0, 0, 0, 0.6)';
        
        // Лимиты для производительности
        const maxCells = zoom <= 5 ? 20000 : (this.isMobile ? 3000 : 8000);
        let cellCount = 0;
        
        // Адаптивный шаг для низких зумов
        const step = zoom <= 5 ? Math.max(1, Math.floor((8 - zoom) / 2)) : 1;
        
        // КРИТИЧНО: Используем clearRect для раскрытых клеток вместо пропуска
        // Это создает "дырки" в тумане вместо отрисовки отдельных прямоугольников
        
        for (let lat = startLat; lat <= endLat && cellCount < maxCells; lat += this.CELL_SIZE_LAT * step) {
            for (let lng = startLng; lng <= endLng && cellCount < maxCells; lng += this.CELL_SIZE_LAT * step) {
                // Проверяем группу клеток
                let hasRevealed = false;
                for (let dlat = 0; dlat < step && !hasRevealed; dlat++) {
                    for (let dlng = 0; dlng < step && !hasRevealed; dlng++) {
                        const checkLat = lat + dlat * this.CELL_SIZE_LAT;
                        const checkLng = lng + dlng * this.CELL_SIZE_LAT;
                        const cellKey = `${checkLat.toFixed(4)},${checkLng.toFixed(4)}`;
                        if (this.revealedCells.has(cellKey)) {
                            hasRevealed = true;
                        }
                    }
                }
                
                if (hasRevealed) {
                    // ВАЖНО: Вырезаем дырку в тумане для раскрытой клетки
                    const nw = this.map.latLngToContainerPoint([lat + this.CELL_SIZE_LAT * step, lng]);
                    const se = this.map.latLngToContainerPoint([lat, lng + this.CELL_SIZE_LAT * step]);
                    
                    // БЕЗ overlap для раскрытых клеток - они должны точно совпадать
                    const x = Math.floor(nw.x);
                    const y = Math.floor(nw.y);
                    const width = Math.ceil(se.x - nw.x) + 1; // +1 для полного покрытия
                    const height = Math.ceil(se.y - nw.y) + 1;
                    
                    // Очищаем область
                    this.fogCtx.clearRect(x, y, width, height);
                    
                } else if (zoom >= 8 && this.hoveredCell) {
                    // Hover эффект только на высоких зумах
                    const cellKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
                    if (this.hoveredCell === cellKey && !this.isMobile) {
                        const nw = this.map.latLngToContainerPoint([lat + this.CELL_SIZE_LAT * step, lng]);
                        const se = this.map.latLngToContainerPoint([lat, lng + this.CELL_SIZE_LAT * step]);
                        
                        const x = Math.floor(nw.x);
                        const y = Math.floor(nw.y);
                        const width = Math.ceil(se.x - nw.x) + 1;
                        const height = Math.ceil(se.y - nw.y) + 1;
                        
                        // Hover - более темный туман
                        this.fogCtx.fillStyle = hoverColor;
                        this.fogCtx.fillRect(x, y, width, height);
                    }
                }
                
                cellCount++;
            }
        }
        
        // Восстанавливаем цвет тумана после hover
        this.fogCtx.fillStyle = fogColor;
        
        // Сетка только на высоких зумах
        if (this.showGrid && zoom >= 10) {
            this.drawGrid(startLat, endLat, startLng, endLng);
        }
        
        // Восстанавливаем состояние контекстов
        this.fogCtx.restore();
        this.gridCtx.restore();
    }
    
    drawGrid(startLat, endLat, startLng, endLng) {
        this.gridCtx.strokeStyle = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.1)' : 
            'rgba(0, 0, 0, 0.1)';
        this.gridCtx.lineWidth = 0.5;
        this.gridCtx.beginPath();
        
        let lineCount = 0;
        const maxLines = this.isMobile ? 100 : 200;
        
        for (let lat = startLat; lat <= endLat && lineCount < maxLines; lat += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([lat, startLng]);
            const endPoint = this.map.latLngToContainerPoint([lat, endLng]);
            this.gridCtx.moveTo(Math.round(point.x) + 0.5, Math.round(point.y) + 0.5);
            this.gridCtx.lineTo(Math.round(endPoint.x) + 0.5, Math.round(endPoint.y) + 0.5);
            lineCount++;
        }
        
        for (let lng = startLng; lng <= endLng && lineCount < maxLines; lng += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([startLat, lng]);
            const endPoint = this.map.latLngToContainerPoint([endLat, lng]);
            this.gridCtx.moveTo(Math.round(point.x) + 0.5, Math.round(point.y) + 0.5);
            this.gridCtx.lineTo(Math.round(endPoint.x) + 0.5, Math.round(endPoint.y) + 0.5);
            lineCount++;
        }
        
        this.gridCtx.stroke();
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
            // Пробуем новый API с точным определением
            const response = await fetch('/api/reveal-batch-precise', {
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
            } else {
                // Fallback на старый API
                const fallbackResponse = await fetch('/api/reveal-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cells: batch,
                        playerId: this.playerId,
                        timestamp: Date.now()
                    })
                });
                
                if (fallbackResponse.ok) {
                    const data = await fallbackResponse.json();
                    if (data.totalRevealed) {
                        document.getElementById('totalCells').textContent = data.totalRevealed.toLocaleString();
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка батча:', error);
        }
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
                        this.renderImmediate();
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
            currentLocation.textContent = 'Optimized';
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
        
        // Важно: сразу после изменения размера нужно перерисовать
        if (this.map) {
            this.renderImmediate();
        }
    }
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.theme = theme;
        localStorage.setItem('battleMapTheme', theme);
        this.renderImmediate();
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
        this.renderImmediate();
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
                    this.renderImmediate();
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
            this.renderImmediate();
        }
    }
    
    copyLogs() {
        alert('Логи отключены');
    }
    
    clearLogs() {}
}

// CSS
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
    
    #fogCanvas, #gridCanvas {
        pointer-events: none !important;
        transform-origin: top left;
        will-change: transform;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        image-rendering: -moz-crisp-edges;
        image-rendering: -webkit-crisp-edges;
    }
    
    #map {
        cursor: grab !important;
    }
    
    #map.leaflet-drag-target {
        cursor: grabbing !important;
    }
    
    .leaflet-zoom-anim .leaflet-zoom-animated {
        will-change: transform;
    }
`;
document.head.appendChild(style);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, создаем Optimized BattleMap');
    window.battleMap = new OptimizedBattleMap();
});