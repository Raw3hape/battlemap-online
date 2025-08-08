// BattleMap Online - Финальная оптимизированная версия
class FinalBattleMap {
    constructor() {
        this.map = null;
        this.fogCanvas = document.getElementById('fogCanvas');
        this.gridCanvas = document.getElementById('gridCanvas');
        this.fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true });
        this.gridCtx = this.gridCanvas.getContext('2d');
        
        // Размеры клетки
        this.CELL_SIZE_KM = 10;
        this.CELL_SIZE_LAT = 10 / 111;
        
        // Состояние
        this.revealedCells = new Set();
        this.showGrid = true;
        this.isDragging = false;
        this.mouseDown = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.currentZoom = 5;
        
        // ID игрока
        this.playerId = this.getOrCreatePlayerId();
        
        // ======= ОПТИМИЗАЦИИ =======
        // Батчинг запросов
        this.pendingReveals = new Set();
        this.batchTimer = null;
        this.batchDelay = 300; // 300мс
        this.maxBatchSize = 25;
        
        // Throttling кликов
        this.lastRevealTime = 0;
        this.revealThrottle = 50; // 50мс между кликами
        
        // Rate limiting
        this.clickTimestamps = [];
        this.maxClicksPerSecond = 15;
        this.rateLimitWarned = false;
        
        // Оптимизация рендеринга
        this.renderThrottle = null;
        
        // Синхронизация (15 секунд)
        this.syncInterval = null;
        this.syncDelay = 15000;
        this.lastSync = 0;
        this.isSyncing = false;
        
        // Статистика
        this.stats = {
            clicksPerSecond: 0,
            revealedThisSession: 0,
            batchesSent: 0,
            throttledClicks: 0,
            rateLimitHits: 0
        };
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Логи
        this.logs = [];
        this.maxLogs = 100;
        this.logLevel = 'info';
        
        // Мобильные настройки
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.touches = {};
        this.lastTouchDistance = 0;
        
        this.init();
    }
    
    // ======= ИНИЦИАЛИЗАЦИЯ =======
    init() {
        this.initMap();
        this.setupEventListeners();
        this.applyTheme(this.theme);
        
        requestAnimationFrame(() => {
            this.resizeCanvas();
            this.loadProgress();
            this.render();
            this.startOnlineSync();
            this.startStatsMonitoring();
        });
        
        this.log('BattleMap инициализирован (финальная версия)', 'info');
    }
    
    // ======= ЗАЩИТА ОТ СПАМА =======
    checkRateLimit() {
        const now = Date.now();
        this.clickTimestamps = this.clickTimestamps.filter(t => now - t < 1000);
        
        if (this.clickTimestamps.length >= this.maxClicksPerSecond) {
            this.stats.rateLimitHits++;
            
            if (!this.rateLimitWarned) {
                this.showNotification('⚠️ Слишком быстро! Подождите немного', 'warning');
                this.log(`Rate limit: ${this.clickTimestamps.length} кликов/сек`, 'warn');
                this.rateLimitWarned = true;
                setTimeout(() => this.rateLimitWarned = false, 2000);
            }
            
            return false;
        }
        
        this.clickTimestamps.push(now);
        return true;
    }
    
    canReveal() {
        const now = Date.now();
        
        if (now - this.lastRevealTime < this.revealThrottle) {
            this.stats.throttledClicks++;
            return false;
        }
        
        if (!this.checkRateLimit()) {
            return false;
        }
        
        this.lastRevealTime = now;
        return true;
    }
    
    // ======= БАТЧИНГ ЗАПРОСОВ =======
    addToBatch(cellKey) {
        if (this.pendingReveals.has(cellKey)) {
            return;
        }
        
        this.pendingReveals.add(cellKey);
        
        if (this.pendingReveals.size >= this.maxBatchSize) {
            this.flushBatch();
            return;
        }
        
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => this.flushBatch(), this.batchDelay);
        }
    }
    
    async flushBatch() {
        if (this.pendingReveals.size === 0) {
            return;
        }
        
        const batch = Array.from(this.pendingReveals);
        this.pendingReveals.clear();
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        this.stats.batchesSent++;
        this.log(`Отправка батча: ${batch.length} клеток`, 'debug');
        
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
                
                batch.forEach(cell => {
                    this.revealedCells.add(cell);
                    this.stats.revealedThisSession++;
                });
                
                if (data.totalRevealed) {
                    document.getElementById('totalCells').textContent = data.totalRevealed.toLocaleString();
                }
                
                if (data.onlinePlayers) {
                    document.getElementById('onlinePlayers').textContent = data.onlinePlayers;
                }
                
                this.updateStats();
                this.scheduleRender();
            } else {
                // При ошибке все равно отображаем локально
                this.log(`Ошибка батча: ${response.status}`, 'error');
                batch.forEach(cell => {
                    this.revealedCells.add(cell);
                    this.stats.revealedThisSession++;
                });
                this.updateStats();
                this.scheduleRender();
            }
        } catch (error) {
            this.log(`Ошибка отправки батча: ${error.message}`, 'error');
            // При ошибке отображаем локально
            batch.forEach(cell => {
                this.revealedCells.add(cell);
                this.stats.revealedThisSession++;
            });
            this.updateStats();
            this.scheduleRender();
        }
    }
    
    // ======= РАСКРЫТИЕ КЛЕТОК =======
    revealAt(x, y) {
        if (!this.canReveal()) {
            return;
        }
        
        const point = L.point(x, y);
        const latLng = this.map.containerPointToLatLng(point);
        
        const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
        
        if (this.revealedCells.has(cellKey)) {
            return;
        }
        
        // Добавляем в батч
        this.addToBatch(cellKey);
        
        // Сразу отображаем локально для отзывчивости
        this.revealedCells.add(cellKey);
        this.updateStats();
        this.scheduleRender();
    }
    
    // ======= РЕНДЕРИНГ =======
    scheduleRender() {
        if (this.renderThrottle) return;
        
        this.renderThrottle = requestAnimationFrame(() => {
            this.render();
            this.renderThrottle = null;
        });
    }
    
    render() {
        const bounds = this.map.getBounds();
        
        // Очищаем канвасы
        this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        
        // Рендерим только видимую область
        const startLat = Math.floor(bounds.getSouth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLat = Math.ceil(bounds.getNorth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const startLng = Math.floor(bounds.getWest() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLng = Math.ceil(bounds.getEast() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        // Настройки тумана
        const fogColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.85)' : 
            'rgba(0, 0, 0, 0.3)';
        
        // Батчинг отрисовки
        this.fogCtx.fillStyle = fogColor;
        this.fogCtx.beginPath();
        
        for (let lat = startLat; lat <= endLat; lat += this.CELL_SIZE_LAT) {
            for (let lng = startLng; lng <= endLng; lng += this.CELL_SIZE_LAT) {
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
                }
            }
        }
        
        this.fogCtx.fill();
        
        // Рисуем сетку
        if (this.showGrid && this.currentZoom >= 10) {
            this.drawGrid(startLat, endLat, startLng, endLng);
        }
    }
    
    drawGrid(startLat, endLat, startLng, endLng) {
        this.gridCtx.strokeStyle = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.1)' : 
            'rgba(0, 0, 0, 0.1)';
        this.gridCtx.lineWidth = 0.5;
        
        this.gridCtx.beginPath();
        
        for (let lat = startLat; lat <= endLat; lat += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([lat, startLng]);
            const endPoint = this.map.latLngToContainerPoint([lat, endLng]);
            this.gridCtx.moveTo(point.x, point.y);
            this.gridCtx.lineTo(endPoint.x, endPoint.y);
        }
        
        for (let lng = startLng; lng <= endLng; lng += this.CELL_SIZE_LAT) {
            const point = this.map.latLngToContainerPoint([startLat, lng]);
            const endPoint = this.map.latLngToContainerPoint([endLat, lng]);
            this.gridCtx.moveTo(point.x, point.y);
            this.gridCtx.lineTo(endPoint.x, endPoint.y);
        }
        
        this.gridCtx.stroke();
    }
    
    // ======= СИНХРОНИЗАЦИЯ (15 секунд) =======
    startOnlineSync() {
        this.syncWithServer();
        
        this.syncInterval = setInterval(() => {
            this.syncWithServer();
        }, this.syncDelay);
        
        this.log(`Синхронизация запущена (каждые ${this.syncDelay/1000} сек)`, 'info');
    }
    
    async syncWithServer() {
        if (this.isSyncing) {
            this.log('Пропуск синхронизации - уже выполняется', 'debug');
            return;
        }
        
        this.isSyncing = true;
        const syncStatus = document.getElementById('syncStatus');
        
        try {
            syncStatus?.classList.add('show');
            
            const response = await fetch('/api/game-state');
            
            if (response.ok) {
                const data = await response.json();
                
                // Обновляем клетки (поддержка обоих форматов API)
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
                        this.log(`Синхронизировано ${newCells} новых клеток`, 'debug');
                        this.scheduleRender();
                    }
                }
                
                // Обновляем статистику
                this.updateOnlineStats(data);
                
                this.lastSync = Date.now();
            }
        } catch (error) {
            this.log(`Ошибка синхронизации: ${error.message}`, 'error');
        } finally {
            this.isSyncing = false;
            setTimeout(() => syncStatus?.classList.remove('show'), 1000);
        }
    }
    
    // ======= МОНИТОРИНГ =======
    startStatsMonitoring() {
        setInterval(() => {
            const now = Date.now();
            this.stats.clicksPerSecond = this.clickTimestamps.filter(t => now - t < 1000).length;
            
            if (this.logLevel === 'debug') {
                this.log(`Статистика: ${this.stats.clicksPerSecond} кликов/сек, ${this.stats.throttledClicks} заблокировано, ${this.stats.batchesSent} батчей`, 'debug');
            }
        }, 1000);
    }
    
    // ======= ОБРАБОТЧИКИ СОБЫТИЙ =======
    setupEventListeners() {
        // Карта
        this.map.on('moveend', () => {
            this.scheduleRender();
        });
        
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.scheduleRender();
            document.getElementById('zoomLevel').textContent = this.currentZoom;
        });
        
        // Мышь
        this.gridCanvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 && !e.shiftKey) {
                this.mouseDown = true;
                this.revealAt(e.clientX, e.clientY);
            }
        });
        
        this.gridCanvas.addEventListener('mousemove', (e) => {
            if (this.mouseDown && !e.shiftKey) {
                this.revealAt(e.clientX, e.clientY);
            }
        });
        
        this.gridCanvas.addEventListener('mouseup', () => {
            this.mouseDown = false;
        });
        
        // Touch для мобильных
        if (this.isMobile) {
            this.setupTouchEvents();
        }
        
        // Окно
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.scheduleRender();
        });
        
        // Контекстное меню
        this.gridCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    
    setupTouchEvents() {
        let touchStartTime = 0;
        let lastTap = 0;
        
        this.gridCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartTime = Date.now();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const now = Date.now();
                
                // Двойной тап для зума
                if (now - lastTap < 300) {
                    this.map.zoomIn();
                    this.log('Двойной тап - увеличение', 'debug');
                } else {
                    this.mouseDown = true;
                    this.revealAt(touch.clientX, touch.clientY);
                    this.dragStartX = touch.clientX;
                    this.dragStartY = touch.clientY;
                }
                lastTap = now;
                
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                this.mouseDown = false;
                const distance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                this.lastTouchDistance = distance;
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1 && this.mouseDown) {
                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - this.dragStartX);
                const dy = Math.abs(touch.clientY - this.dragStartY);
                
                if (dx > 10 || dy > 10) {
                    // Переключаемся на drag
                    this.mouseDown = false;
                    const center = this.map.getCenter();
                    const point = this.map.latLngToContainerPoint(center);
                    point.x -= (touch.clientX - this.dragStartX);
                    point.y -= (touch.clientY - this.dragStartY);
                    
                    this.map.panTo(this.map.containerPointToLatLng(point), {animate: false});
                    
                    this.dragStartX = touch.clientX;
                    this.dragStartY = touch.clientY;
                } else if (Date.now() - touchStartTime < 500) {
                    // Продолжаем раскрывать
                    this.revealAt(touch.clientX, touch.clientY);
                }
                
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                const distance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                if (this.lastTouchDistance > 0) {
                    const scale = distance / this.lastTouchDistance;
                    if (scale > 1.1) {
                        this.map.zoomIn();
                        this.lastTouchDistance = distance;
                    } else if (scale < 0.9) {
                        this.map.zoomOut();
                        this.lastTouchDistance = distance;
                    }
                }
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchend', () => {
            this.mouseDown = false;
            this.lastTouchDistance = 0;
        });
    }
    
    // ======= ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ =======
    initMap() {
        this.map = L.map('map', {
            center: [55.7558, 37.6173], // Москва
            zoom: 5,
            zoomControl: false,
            attributionControl: false
        });
        
        // Стиль карты по умолчанию
        this.changeMapStyle('osm');
        
        L.control.attribution({
            prefix: false,
            position: 'bottomleft'
        }).addTo(this.map);
    }
    
    changeMapStyle(style) {
        // Удаляем старый слой
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }
        
        let tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        let maxZoom = 18;
        let attribution = '© OpenStreetMap';
        
        switch(style) {
            case 'hot':
                tileUrl = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
                break;
            case 'topo':
                tileUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
                maxZoom = 17;
                break;
            case 'cycle':
                tileUrl = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
                break;
            case 'positron':
                tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
                attribution = '© CartoDB';
                break;
            case 'dark':
                tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
                attribution = '© CartoDB';
                break;
            case 'satellite':
                tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                attribution = '© Esri';
                break;
            case 'wikimedia':
                tileUrl = 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png';
                attribution = '© Wikimedia';
                break;
        }
        
        this.tileLayer = L.tileLayer(tileUrl, {
            maxZoom: maxZoom,
            minZoom: 2,
            attribution: attribution
        }).addTo(this.map);
        
        this.log(`Стиль карты изменен на ${style}`, 'info');
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
    
    updateStats() {
        const area = this.revealedCells.size * 100; // 10km × 10km = 100km²
        document.getElementById('areaRevealed').textContent = area.toLocaleString();
        document.getElementById('cellsRevealed').textContent = this.revealedCells.size.toLocaleString();
    }
    
    updateOnlineStats(data) {
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
    
    updateTopCountries(countries) {
        const container = document.getElementById('countriesList');
        if (!container) return;
        
        container.innerHTML = countries.map((country, index) => {
            // Извлекаем флаг и название из строки вида "🇷🇺 Россия"
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
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.theme = theme;
        localStorage.setItem('battleMapTheme', theme);
        this.scheduleRender();
    }
    
    toggleTheme() {
        const newTheme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        const icon = document.getElementById('themeToggle');
        if (icon) {
            icon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        }
        this.log(`Тема изменена на ${newTheme}`, 'info');
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.9);
            background: ${type === 'warning' ? '#ff9800' : '#4CAF50'};
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 14px;
            z-index: 10000;
            opacity: 0;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 10);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translate(-50%, -50%) scale(0.9)';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }
    
    saveProgress() {
        const data = {
            cells: Array.from(this.revealedCells),
            stats: this.stats,
            timestamp: Date.now()
        };
        localStorage.setItem('battleMapProgress', JSON.stringify(data));
        this.showNotification('💾 Прогресс сохранен');
        this.log('Прогресс сохранен', 'info');
    }
    
    loadProgress() {
        try {
            const saved = localStorage.getItem('battleMapProgress');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.cells && Array.isArray(data.cells)) {
                    this.revealedCells = new Set(data.cells);
                    this.updateStats();
                    this.scheduleRender();
                    this.log(`Загружено ${data.cells.length} клеток`, 'info');
                }
            }
        } catch (error) {
            this.log('Ошибка загрузки прогресса', 'error');
        }
    }
    
    resetFog() {
        if (confirm('Вы уверены? Это сбросит весь ваш локальный прогресс!')) {
            this.revealedCells.clear();
            this.pendingReveals.clear();
            localStorage.removeItem('battleMapProgress');
            this.updateStats();
            this.scheduleRender();
            this.showNotification('↺ Прогресс сброшен');
            this.log('Прогресс сброшен', 'info');
        }
    }
    
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.scheduleRender();
        this.log(`Сетка ${this.showGrid ? 'включена' : 'выключена'}`, 'info');
    }
    
    toggleMenu() {
        const menu = document.getElementById('sideMenu');
        menu?.classList.toggle('active');
    }
    
    toggleLogsPanel() {
        const panel = document.getElementById('logsPanel');
        if (panel) {
            panel.classList.toggle('active');
            if (panel.classList.contains('active')) {
                this.renderLogs();
            }
        }
    }
    
    // Логирование
    log(message, level = 'info') {
        if (level === 'debug' && this.logLevel !== 'debug') return;
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { timestamp, message, level };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        const logsContent = document.getElementById('logsContent');
        if (logsContent && logsContent.parentElement.parentElement.classList.contains('active')) {
            this.renderLogs();
        }
        
        const debugStatus = document.getElementById('debugStatus');
        if (debugStatus) {
            debugStatus.textContent = this.logLevel === 'debug' ? 'ON' : 'OFF';
        }
        
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
    
    renderLogs() {
        const logsContent = document.getElementById('logsContent');
        if (!logsContent) return;
        
        logsContent.innerHTML = this.logs.map(log => `
            <div class="log-entry log-${log.level}">
                <span class="log-time">${log.timestamp}</span>
                <span>${log.message}</span>
            </div>
        `).join('');
        
        logsContent.scrollTop = logsContent.scrollHeight;
    }
    
    copyLogs() {
        const logsText = this.logs.map(log => 
            `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`
        ).join('\n');
        
        navigator.clipboard.writeText(logsText).then(() => {
            this.showNotification('📋 Логи скопированы');
        });
    }
    
    clearLogs() {
        this.logs = [];
        this.renderLogs();
        this.log('Логи очищены', 'info');
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    window.battleMap = new FinalBattleMap();
});