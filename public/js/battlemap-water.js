// BattleMap - Версия с отображением воды и точными границами
class WaterAwareBattleMap {
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
        
        // Канвасы не блокируют события
        this.fogCanvas.style.pointerEvents = 'none';
        this.gridCanvas.style.pointerEvents = 'none';
        
        // Размеры клетки
        this.CELL_SIZE_KM = 10;
        this.CELL_SIZE_LAT = 10 / 111;
        
        // Состояние
        this.revealedCells = new Set();
        this.waterCells = new Set(); // Новое: клетки воды
        this.showGrid = true;
        this.showWater = true; // Новое: показывать воду
        this.currentZoom = 5;
        this.hoveredCell = null;
        this.hoveredCellInfo = null; // Новое: информация о клетке под курсором
        
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
        
        // Кэш для геокодинга
        this.geoCache = new Map();
        
        this.init();
    }
    
    init() {
        console.log('Инициализация Water-Aware BattleMap');
        
        this.initMap();
        this.setupRealtimeSync();
        this.setupInteraction();
        this.applyTheme(this.theme);
        
        setTimeout(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.renderImmediate();
            this.startOnlineSync();
            this.updateUIState();
            this.addLocationIndicator();
        }, 100);
    }
    
    addLocationIndicator() {
        // Добавляем индикатор текущей локации под курсором
        const indicator = document.createElement('div');
        indicator.id = 'locationIndicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 1000;
            display: none;
            pointer-events: none;
        `;
        document.body.appendChild(indicator);
    }
    
    async checkCellLocation(lat, lng) {
        const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        
        if (this.geoCache.has(cacheKey)) {
            return this.geoCache.get(cacheKey);
        }
        
        try {
            const response = await fetch('/api/geocode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.geoCache.set(cacheKey, data);
                return data;
            }
        } catch (error) {
            console.error('Geocode error:', error);
        }
        
        return null;
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
        let rafId = null;
        const syncCanvases = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                this.renderImmediate();
                rafId = null;
            });
        };
        
        this.map.on('move', syncCanvases);
        this.map.on('zoom', syncCanvases);
        this.map.on('viewreset', syncCanvases);
        this.map.on('load', syncCanvases);
        
        this.map.on('zoomanim', (e) => {
            const scale = this.map.getZoomScale(e.zoom);
            const offset = this.map._getCenterOffset(e.center)._multiplyBy(-scale)._add(this.map._getMapPanePos());
            
            const transform = L.DomUtil.TRANSFORM;
            this.fogCanvas.style[transform] = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
            this.gridCanvas.style[transform] = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
        });
        
        this.map.on('zoomend', () => {
            this.fogCanvas.style.transform = '';
            this.gridCanvas.style.transform = '';
            this.currentZoom = this.map.getZoom();
            this.renderImmediate();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
        
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
        
        // Desktop hover с проверкой локации
        if (!this.isMobile) {
            mapContainer.addEventListener('mousemove', async (e) => {
                if (!isDragging) {
                    const point = L.point(e.clientX, e.clientY);
                    const latLng = this.map.containerPointToLatLng(point);
                    
                    const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                    const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
                    const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
                    
                    if (this.hoveredCell !== cellKey) {
                        this.hoveredCell = cellKey;
                        
                        // Проверяем локацию асинхронно
                        const locationInfo = await this.checkCellLocation(cellLat, cellLng);
                        if (locationInfo) {
                            this.hoveredCellInfo = locationInfo;
                            
                            // Обновляем индикатор
                            const indicator = document.getElementById('locationIndicator');
                            if (indicator) {
                                if (locationInfo.type === 'water') {
                                    indicator.textContent = '🌊 Вода - нельзя раскрыть';
                                    indicator.style.background = 'rgba(0, 100, 200, 0.9)';
                                } else if (locationInfo.country) {
                                    indicator.textContent = `📍 ${locationInfo.country}`;
                                    indicator.style.background = 'rgba(0, 100, 0, 0.9)';
                                } else {
                                    indicator.textContent = '🗺️ Неизвестная территория';
                                    indicator.style.background = 'rgba(100, 100, 100, 0.9)';
                                }
                                indicator.style.display = 'block';
                            }
                        }
                        
                        this.renderImmediate();
                    }
                    
                    // Курсор
                    if (this.hoveredCellInfo?.type === 'water') {
                        mapContainer.style.cursor = 'not-allowed';
                    } else if (!this.revealedCells.has(cellKey)) {
                        mapContainer.style.cursor = 'pointer';
                    } else {
                        mapContainer.style.cursor = 'grab';
                    }
                }
            });
            
            mapContainer.addEventListener('mouseleave', () => {
                this.hoveredCell = null;
                this.hoveredCellInfo = null;
                const indicator = document.getElementById('locationIndicator');
                if (indicator) indicator.style.display = 'none';
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
        
        // Mobile touch events
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
    
    async handleReveal(x, y) {
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
        
        // Проверяем, не вода ли это
        const locationInfo = await this.checkCellLocation(cellLat, cellLng);
        if (locationInfo && locationInfo.type === 'water') {
            // Показываем эффект "нельзя кликнуть"
            this.showWaterClickEffect(x, y);
            console.log('Попытка раскрыть воду:', cellKey);
            return;
        }
        
        if (this.revealedCells.has(cellKey) || this.pendingReveals.has(cellKey)) {
            return;
        }
        
        console.log('Раскрытие клетки:', cellKey, locationInfo?.country || 'Unknown');
        
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
    
    showWaterClickEffect(x, y) {
        const effect = document.createElement('div');
        effect.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 40px;
            height: 40px;
            margin: -20px 0 0 -20px;
            border: 3px solid #2196F3;
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            opacity: 1;
            transform: scale(0);
            animation: waterPulse 0.6s ease-out;
        `;
        document.body.appendChild(effect);
        
        // Текст "Вода!"
        const text = document.createElement('div');
        text.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y - 30}px;
            transform: translateX(-50%);
            color: #2196F3;
            font-weight: bold;
            font-size: 14px;
            pointer-events: none;
            z-index: 10001;
            animation: fadeUp 1s ease-out;
        `;
        text.textContent = '🌊 Вода!';
        document.body.appendChild(text);
        
        setTimeout(() => {
            effect.remove();
            text.remove();
        }, 1000);
    }
    
    renderImmediate() {
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        
        // Очистка
        this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        
        // Буфер для полного покрытия
        const zoomFactor = Math.max(1, (15 - zoom) / 5);
        const buffer = 0.5 * zoomFactor;
        
        const startLat = Math.floor((bounds.getSouth() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLat = Math.ceil((bounds.getNorth() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const startLng = Math.floor((bounds.getWest() - buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLng = Math.ceil((bounds.getEast() + buffer) / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        // Цвета тумана
        const fogColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.85)' : 
            'rgba(0, 0, 0, 0.3)';
        
        // Цвет воды (полупрозрачный синий)
        const waterColor = this.theme === 'dark' ? 
            'rgba(30, 144, 255, 0.3)' : 
            'rgba(0, 119, 190, 0.2)';
        
        // Hover цвета
        const hoverColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.6)' : 
            'rgba(0, 0, 0, 0.2)';
        
        const hoverWaterColor = 'rgba(255, 0, 0, 0.3)'; // Красный для воды под курсором
        
        const maxCells = zoom <= 5 ? 10000 : (this.isMobile ? 2000 : 5000);
        let cellCount = 0;
        
        const cellSize = Math.max(1, Math.floor(16 - zoom));
        const step = zoom <= 5 ? Math.max(1, Math.floor((8 - zoom) / 2)) : 1;
        
        // Рисуем туман
        this.fogCtx.beginPath();
        
        // Рисуем воду отдельно
        const waterPaths = [];
        
        for (let lat = startLat; lat <= endLat && cellCount < maxCells; lat += this.CELL_SIZE_LAT * step) {
            for (let lng = startLng; lng <= endLng && cellCount < maxCells; lng += this.CELL_SIZE_LAT * step) {
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
                
                if (!hasRevealed) {
                    const cellKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
                    const nw = this.map.latLngToContainerPoint([lat + this.CELL_SIZE_LAT * step, lng]);
                    const se = this.map.latLngToContainerPoint([lat, lng + this.CELL_SIZE_LAT * step]);
                    
                    const overlap = Math.max(2, Math.ceil(5 - zoom));
                    const x = Math.floor(nw.x) - overlap;
                    const y = Math.floor(nw.y) - overlap;
                    const width = Math.ceil(se.x - nw.x) + overlap * 2;
                    const height = Math.ceil(se.y - nw.y) + overlap * 2;
                    
                    // Проверяем, является ли клетка водой
                    const isWater = this.waterCells.has(cellKey) || 
                                   (this.hoveredCellInfo && 
                                    this.hoveredCell === cellKey && 
                                    this.hoveredCellInfo.type === 'water');
                    
                    if (isWater && this.showWater) {
                        // Рисуем воду
                        waterPaths.push({ x, y, width, height, isHovered: this.hoveredCell === cellKey });
                    } else {
                        // Hover эффект для обычных клеток
                        if (zoom >= 8 && this.hoveredCell === cellKey && !this.isMobile) {
                            this.fogCtx.save();
                            this.fogCtx.fillStyle = hoverColor;
                            this.fogCtx.fillRect(x, y, width, height);
                            this.fogCtx.restore();
                        } else {
                            this.fogCtx.rect(x, y, width, height);
                        }
                    }
                    
                    cellCount++;
                }
            }
        }
        
        // Заливаем туман
        this.fogCtx.fillStyle = fogColor;
        this.fogCtx.fill();
        
        // Рисуем воду поверх тумана
        if (waterPaths.length > 0) {
            waterPaths.forEach(({ x, y, width, height, isHovered }) => {
                this.fogCtx.save();
                if (isHovered) {
                    // Вода под курсором - показываем красным
                    this.fogCtx.fillStyle = hoverWaterColor;
                } else {
                    this.fogCtx.fillStyle = waterColor;
                }
                this.fogCtx.fillRect(x, y, width, height);
                
                // Добавляем волны для воды (только на высоком зуме)
                if (zoom >= 10 && !isHovered) {
                    this.fogCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    this.fogCtx.lineWidth = 1;
                    this.fogCtx.beginPath();
                    this.fogCtx.moveTo(x + width * 0.2, y + height * 0.5);
                    this.fogCtx.quadraticCurveTo(
                        x + width * 0.5, y + height * 0.3,
                        x + width * 0.8, y + height * 0.5
                    );
                    this.fogCtx.stroke();
                }
                
                this.fogCtx.restore();
            });
        }
        
        // Заполнение краев
        if (zoom <= 6) {
            this.fogCtx.fillStyle = fogColor;
            const padding = 100;
            this.fogCtx.fillRect(-padding, -padding, this.fogCanvas.width + padding * 2, padding);
            this.fogCtx.fillRect(-padding, this.fogCanvas.height, this.fogCanvas.width + padding * 2, padding);
            this.fogCtx.fillRect(-padding, -padding, padding, this.fogCanvas.height + padding * 2);
            this.fogCtx.fillRect(this.fogCanvas.width, -padding, padding, this.fogCanvas.height + padding * 2);
        }
        
        // Сетка
        if (this.showGrid && zoom >= 10) {
            this.drawGrid(startLat, endLat, startLng, endLng);
        }
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
            // Используем новый API с точным определением
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
                
                // Обрабатываем отклоненные водные клетки
                if (data.water_cells > 0) {
                    console.log(`Отклонено водных клеток: ${data.water_cells}`);
                    // Можно добавить эти клетки в waterCells для визуализации
                }
                
                if (data.totalRevealed) {
                    document.getElementById('totalCells').textContent = data.totalRevealed.toLocaleString();
                }
                if (data.onlinePlayers) {
                    document.getElementById('onlinePlayers').textContent = data.onlinePlayers;
                }
            } else {
                // Fallback на старый API если новый недоступен
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
            currentLocation.textContent = 'Water-aware';
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
    
    toggleWater() {
        this.showWater = !this.showWater;
        this.renderImmediate();
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
            waterCells: Array.from(this.waterCells),
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
                    if (data.waterCells && Array.isArray(data.waterCells)) {
                        this.waterCells = new Set(data.waterCells);
                    }
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
            this.waterCells.clear();
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

// CSS для новых анимаций
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
    
    @keyframes waterPulse {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        50% {
            transform: scale(1.5);
            opacity: 0.8;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
    
    @keyframes fadeUp {
        0% {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        100% {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
        }
    }
    
    #fogCanvas, #gridCanvas {
        pointer-events: none !important;
        transform-origin: top left;
        will-change: transform;
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
    
    #locationIndicator {
        transition: background 0.3s ease;
    }
`;
document.head.appendChild(style);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, создаем Water-Aware BattleMap');
    window.battleMap = new WaterAwareBattleMap();
});