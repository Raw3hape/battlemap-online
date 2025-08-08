// BattleMap Online - Оптимизированная версия с защитой от спама
class OptimizedBattleMap {
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
        this.hoverCell = null;
        
        // ID игрока
        this.playerId = this.getOrCreatePlayerId();
        
        // ======= ОПТИМИЗАЦИИ =======
        // Батчинг запросов
        this.pendingReveals = new Set(); // Клетки для отправки
        this.batchTimer = null;
        this.batchDelay = 300; // Отправка батча каждые 300мс
        this.maxBatchSize = 25; // Максимум клеток в батче
        
        // Throttling кликов
        this.lastRevealTime = 0;
        this.revealThrottle = 50; // Минимум 50мс между обработкой кликов
        
        // Rate limiting
        this.clickTimestamps = [];
        this.maxClicksPerSecond = 15; // Максимум 15 кликов в секунду
        this.rateLimitWarned = false;
        
        // Оптимизация рендеринга
        this.renderThrottle = null;
        this.renderDelay = 16; // 60 FPS максимум
        this.needsRender = false;
        
        // Viewport-based loading
        this.visibleBounds = null;
        this.viewportCache = new Map(); // Кэш видимых областей
        this.viewportCacheSize = 1000; // Максимум клеток в кэше
        
        // Синхронизация (15 секунд)
        this.syncInterval = null;
        this.syncDelay = 15000; // 15 секунд
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
        
        this.log('BattleMap инициализирован (оптимизированная версия)', 'info');
    }
    
    // ======= ЗАЩИТА ОТ СПАМА =======
    checkRateLimit() {
        const now = Date.now();
        
        // Удаляем старые метки времени (старше 1 секунды)
        this.clickTimestamps = this.clickTimestamps.filter(t => now - t < 1000);
        
        // Проверяем лимит
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
    
    // ======= THROTTLING =======
    canReveal() {
        const now = Date.now();
        
        // Проверка throttle
        if (now - this.lastRevealTime < this.revealThrottle) {
            this.stats.throttledClicks++;
            return false;
        }
        
        // Проверка rate limit
        if (!this.checkRateLimit()) {
            return false;
        }
        
        this.lastRevealTime = now;
        return true;
    }
    
    // ======= БАТЧИНГ ЗАПРОСОВ =======
    addToBatch(cellKey) {
        // Проверяем, не в батче ли уже
        if (this.pendingReveals.has(cellKey)) {
            return;
        }
        
        // Добавляем в батч
        this.pendingReveals.add(cellKey);
        
        // Если батч полный, отправляем сразу
        if (this.pendingReveals.size >= this.maxBatchSize) {
            this.flushBatch();
            return;
        }
        
        // Иначе запускаем таймер
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => this.flushBatch(), this.batchDelay);
        }
    }
    
    async flushBatch() {
        if (this.pendingReveals.size === 0) {
            return;
        }
        
        // Копируем батч и очищаем
        const batch = Array.from(this.pendingReveals);
        this.pendingReveals.clear();
        
        // Сбрасываем таймер
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        this.stats.batchesSent++;
        this.log(`Отправка батча: ${batch.length} клеток`, 'debug');
        
        try {
            // Отправляем батч на сервер
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
                
                // Обновляем локальное состояние
                batch.forEach(cell => {
                    this.revealedCells.add(cell);
                    this.stats.revealedThisSession++;
                });
                
                // Обновляем статистику
                if (data.totalRevealed) {
                    document.getElementById('totalCells').textContent = data.totalRevealed.toLocaleString();
                }
                
                this.scheduleRender();
            }
        } catch (error) {
            this.log(`Ошибка отправки батча: ${error.message}`, 'error');
            
            // Возвращаем клетки в очередь при ошибке
            batch.forEach(cell => this.pendingReveals.add(cell));
        }
    }
    
    // ======= VIEWPORT LOADING =======
    updateViewport() {
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        
        // Кэшируем только при высоком зуме
        if (zoom < 10) {
            this.visibleBounds = null;
            return;
        }
        
        this.visibleBounds = {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };
        
        // Очищаем старый кэш если слишком большой
        if (this.viewportCache.size > this.viewportCacheSize) {
            const toDelete = this.viewportCache.size - this.viewportCacheSize / 2;
            const keys = Array.from(this.viewportCache.keys()).slice(0, toDelete);
            keys.forEach(key => this.viewportCache.delete(key));
        }
    }
    
    isInViewport(lat, lng) {
        if (!this.visibleBounds) return true;
        
        return lat >= this.visibleBounds.south && 
               lat <= this.visibleBounds.north &&
               lng >= this.visibleBounds.west && 
               lng <= this.visibleBounds.east;
    }
    
    // ======= ОПТИМИЗИРОВАННОЕ РАСКРЫТИЕ =======
    revealAt(x, y) {
        // Проверка throttling и rate limit
        if (!this.canReveal()) {
            return;
        }
        
        const point = L.point(x, y);
        const latLng = this.map.containerPointToLatLng(point);
        
        const cellLat = Math.floor(latLng.lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellLng = Math.floor(latLng.lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const cellKey = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
        
        // Проверяем, не раскрыта ли уже
        if (this.revealedCells.has(cellKey)) {
            return;
        }
        
        // Проверяем viewport (только при высоком зуме)
        if (this.currentZoom >= 10 && !this.isInViewport(cellLat, cellLng)) {
            this.log('Клик вне видимой области', 'debug');
            return;
        }
        
        // Добавляем в батч вместо мгновенной отправки
        this.addToBatch(cellKey);
        
        // Обновляем UI сразу для отзывчивости
        this.revealedCells.add(cellKey);
        this.updateStats();
        this.scheduleRender();
    }
    
    // ======= ОПТИМИЗИРОВАННЫЙ РЕНДЕРИНГ =======
    scheduleRender() {
        if (this.renderThrottle) return;
        
        this.renderThrottle = requestAnimationFrame(() => {
            this.render();
            this.renderThrottle = null;
        });
    }
    
    render() {
        const bounds = this.map.getBounds();
        const topLeft = this.map.latLngToContainerPoint(bounds.getNorthWest());
        const bottomRight = this.map.latLngToContainerPoint(bounds.getSouthEast());
        
        // Очищаем канвасы
        this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        
        // Оптимизация: рендерим только видимую область
        const startLat = Math.floor(bounds.getSouth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLat = Math.ceil(bounds.getNorth() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const startLng = Math.floor(bounds.getWest() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const endLng = Math.ceil(bounds.getEast() / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        // Настройки тумана в зависимости от темы
        const fogColor = this.theme === 'dark' ? 
            'rgba(255, 255, 255, 0.85)' : 
            'rgba(0, 0, 0, 0.3)';
        
        // Батчинг отрисовки
        this.fogCtx.fillStyle = fogColor;
        this.fogCtx.beginPath();
        
        for (let lat = startLat; lat <= endLat; lat += this.CELL_SIZE_LAT) {
            for (let lng = startLng; lng <= endLng; lng += this.CELL_SIZE_LAT) {
                const cellKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
                
                if (!this.revealedCells.has(cellKey) && !this.pendingReveals.has(cellKey)) {
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
        
        // Рисуем сетку если включена
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
        // Первая синхронизация сразу
        this.syncWithServer();
        
        // Затем каждые 15 секунд
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
            
            // Получаем только изменения с последней синхронизации
            const response = await fetch(`/api/game-state?since=${this.lastSync}&viewport=${this.getViewportString()}`);
            
            if (response.ok) {
                const data = await response.json();
                
                // Обновляем только новые клетки
                if (data.cells && Array.isArray(data.cells)) {
                    let newCells = 0;
                    data.cells.forEach(cell => {
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
    
    getViewportString() {
        if (!this.visibleBounds) return '';
        
        return `${this.visibleBounds.north.toFixed(2)},${this.visibleBounds.south.toFixed(2)},${this.visibleBounds.east.toFixed(2)},${this.visibleBounds.west.toFixed(2)}`;
    }
    
    // ======= МОНИТОРИНГ СТАТИСТИКИ =======
    startStatsMonitoring() {
        setInterval(() => {
            // Подсчет кликов в секунду
            const now = Date.now();
            this.stats.clicksPerSecond = this.clickTimestamps.filter(t => now - t < 1000).length;
            
            // Отображение в UI если есть debug панель
            if (this.logLevel === 'debug') {
                this.log(`Статистика: ${this.stats.clicksPerSecond} кликов/сек, ${this.stats.throttledClicks} заблокировано, ${this.stats.batchesSent} батчей отправлено`, 'debug');
            }
        }, 1000);
    }
    
    // ======= ОБРАБОТЧИКИ СОБЫТИЙ =======
    setupEventListeners() {
        // Обработка карты
        this.map.on('moveend', () => {
            this.updateViewport();
            this.scheduleRender();
        });
        
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.updateViewport();
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
        
        // Touch события для мобильных
        if (this.isMobile) {
            this.setupTouchEvents();
        }
        
        // Окно
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.scheduleRender();
        });
        
        // Предотвращение контекстного меню
        this.gridCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    
    setupTouchEvents() {
        let touchStartTime = 0;
        
        this.gridCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartTime = Date.now();
            
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.mouseDown = true;
                this.revealAt(touch.clientX, touch.clientY);
                
                this.dragStartX = touch.clientX;
                this.dragStartY = touch.clientY;
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1 && this.mouseDown) {
                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - this.dragStartX);
                const dy = Math.abs(touch.clientY - this.dragStartY);
                
                // Если движение больше 10px - это drag
                if (dx > 10 || dy > 10) {
                    this.mouseDown = false;
                } else if (Date.now() - touchStartTime < 500) {
                    // Короткое движение - продолжаем раскрывать
                    this.revealAt(touch.clientX, touch.clientY);
                }
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchend', () => {
            this.mouseDown = false;
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
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            minZoom: 2
        }).addTo(this.map);
        
        L.control.attribution({
            prefix: false,
            position: 'bottomleft'
        }).addTo(this.map);
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
        
        container.innerHTML = countries.map((country, index) => `
            <div class="country-item">
                <span>${index + 1}. ${country.flag} ${country.name}</span>
                <span class="country-cells">${country.cells} клеток (${country.percentage}%)</span>
            </div>
        `).join('');
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
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
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
        this.showNotification('💾 Прогресс сохранен локально');
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
    
    // Логирование
    log(message, level = 'info') {
        if (level === 'debug' && this.logLevel !== 'debug') return;
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { timestamp, message, level };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        // Обновляем UI если панель открыта
        const logsContent = document.getElementById('logsContent');
        if (logsContent && logsContent.parentElement.parentElement.classList.contains('active')) {
            this.renderLogs();
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
    window.battleMap = new OptimizedBattleMap();
});