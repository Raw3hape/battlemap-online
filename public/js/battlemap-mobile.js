// BattleMap Online - Улучшенная версия с мобильной поддержкой
class OnlineBattleMap {
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
        
        // Синхронизация
        this.syncInterval = null;
        this.lastSync = 0;
        
        // Тема (dark/light)
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Логи
        this.logs = [];
        this.maxLogs = 100;
        this.logLevel = 'info'; // debug, info, warn, error
        
        // Мобильные настройки
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.touches = {};
        this.lastTouchDistance = 0;
        
        this.init();
    }
    
    // Система логирования
    log(message, level = 'info') {
        if (level === 'debug' && this.logLevel !== 'debug') return;
        
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const logEntry = {
            time: timestamp,
            level,
            message
        };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        // Обновляем UI логов если панель открыта
        this.updateLogsUI();
        
        // Консоль для разработки
        if (level === 'error') {
            console.error(`[${timestamp}] ${message}`);
        } else if (level === 'warn') {
            console.warn(`[${timestamp}] ${message}`);
        } else if (this.logLevel === 'debug') {
            console.log(`[${timestamp}] ${message}`);
        }
    }
    
    updateLogsUI() {
        const logsContainer = document.getElementById('logsContent');
        if (!logsContainer || !logsContainer.parentElement.classList.contains('active')) return;
        
        logsContainer.innerHTML = this.logs
            .slice(-50) // Показываем последние 50 логов
            .reverse()
            .map(log => `
                <div class="log-entry log-${log.level}">
                    <span class="log-time">${log.time}</span>
                    <span class="log-message">${log.message}</span>
                </div>
            `).join('');
    }
    
    copyLogs() {
        const logsText = this.logs
            .map(log => `[${log.time}] [${log.level.toUpperCase()}] ${log.message}`)
            .join('\n');
        
        navigator.clipboard.writeText(logsText).then(() => {
            this.showNotification('Логи скопированы в буфер обмена');
            this.log('Логи скопированы', 'info');
        }).catch(err => {
            this.log('Ошибка копирования логов: ' + err, 'error');
        });
    }
    
    clearLogs() {
        this.logs = [];
        this.updateLogsUI();
        this.log('Логи очищены', 'info');
    }
    
    // Уведомления
    showNotification(message, duration = 2000) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }
    
    getOrCreatePlayerId() {
        let playerId = localStorage.getItem('battleMapPlayerId');
        if (!playerId) {
            playerId = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('battleMapPlayerId', playerId);
            this.log(`Создан новый ID игрока: ${playerId}`, 'info');
        }
        return playerId;
    }
    
    init() {
        this.log('Инициализация BattleMap Online', 'info');
        this.applyTheme(this.theme);
        this.setupCanvas();
        this.setupMap();
        this.setupEventListeners();
        this.setupMobileUI();
        this.loadProgress();
        this.startSyncTimer();
        this.log(`Инициализация завершена. Мобильное устройство: ${this.isMobile}`, 'info');
    }
    
    // Применение темы
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.theme = theme;
        localStorage.setItem('battleMapTheme', theme);
        this.log(`Применена тема: ${theme}`, 'debug');
        
        // Обновляем туман для новой темы
        if (this.map) {
            this.render();
        }
    }
    
    toggleTheme() {
        const newTheme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        this.log(`Тема изменена на: ${newTheme}`, 'info');
    }
    
    setupCanvas() {
        const resize = () => {
            this.fogCanvas.width = window.innerWidth;
            this.fogCanvas.height = window.innerHeight;
            this.gridCanvas.width = window.innerWidth;
            this.gridCanvas.height = window.innerHeight;
            if (this.map) {
                this.render();
            }
            this.log(`Размер канваса изменен: ${window.innerWidth}x${window.innerHeight}`, 'debug');
        };
        
        resize();
        window.addEventListener('resize', resize);
        
        // Предотвращаем масштабирование на мобильных
        if (this.isMobile) {
            document.addEventListener('gesturestart', e => e.preventDefault());
            document.addEventListener('gesturechange', e => e.preventDefault());
            document.addEventListener('gestureend', e => e.preventDefault());
        }
    }
    
    setupMap() {
        this.map = L.map('map', {
            center: [55.7558, 37.6173],
            zoom: 10,
            zoomControl: false,
            attributionControl: true,
            // Важно для мобильных
            touchZoom: true,
            dragging: true,
            tap: false, // Отключаем tap, чтобы обрабатывать сами
            doubleClickZoom: false
        });
        
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(this.map);
        
        this.currentZoom = this.map.getZoom();
        
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.updateUI();
            this.render();
            this.log(`Зум изменен: ${this.currentZoom}`, 'debug');
        });
        
        this.map.on('move', () => {
            this.render();
        });
        
        this.map.whenReady(() => {
            this.updateUI();
            this.render();
            this.log('Карта готова', 'debug');
        });
    }
    
    setupMobileUI() {
        if (!this.isMobile) return;
        
        // Добавляем мобильные классы
        document.body.classList.add('mobile');
        
        // Скрываем элементы при скролле на мобильных
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            document.body.classList.add('scrolling');
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                document.body.classList.remove('scrolling');
            }, 500);
        });
        
        this.log('Мобильный UI настроен', 'debug');
    }
    
    changeMapStyle(style) {
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }
        
        let url, attribution;
        
        switch(style) {
            case 'hot':
                url = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
                attribution = '© OpenStreetMap Contributors, HOT';
                break;
            case 'topo':
                url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
                attribution = '© OpenTopoMap';
                break;
            case 'cycle':
                url = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
                attribution = '© CyclOSM | © OpenStreetMap';
                break;
            case 'positron':
                url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
                attribution = '© CartoDB | © OpenStreetMap';
                break;
            case 'dark':
                url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
                attribution = '© CartoDB | © OpenStreetMap';
                break;
            case 'satellite':
                url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                attribution = '© ESRI';
                break;
            case 'wikimedia':
                url = 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png';
                attribution = '© Wikimedia | © OpenStreetMap';
                break;
            case 'osm':
            default:
                url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
                attribution = '© OpenStreetMap';
                break;
        }
        
        this.tileLayer = L.tileLayer(url, {
            maxZoom: 19,
            attribution: attribution
        }).addTo(this.map);
        
        this.log(`Стиль карты изменен: ${style}`, 'info');
    }
    
    latLngToGridCell(lat, lng) {
        const gridLat = Math.floor(lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const gridLng = Math.floor(lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        return {
            lat: gridLat,
            lng: gridLng,
            key: `${gridLat.toFixed(6)},${gridLng.toFixed(6)}`
        };
    }
    
    pixelToLatLng(x, y) {
        const point = L.point(x, y);
        return this.map.containerPointToLatLng(point);
    }
    
    latLngToPixel(lat, lng) {
        const point = this.map.latLngToContainerPoint([lat, lng]);
        return { x: point.x, y: point.y };
    }
    
    setupEventListeners() {
        // Desktop события
        if (!this.isMobile) {
            this.setupDesktopEvents();
        }
        
        // Touch события для мобильных
        this.setupTouchEvents();
        
        // Общие события
        this.gridCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    
    setupDesktopEvents() {
        this.gridCanvas.addEventListener('mousedown', (e) => {
            if (e.shiftKey || e.button === 2) {
                this.isDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.gridCanvas.style.cursor = 'grab';
            } else {
                this.mouseDown = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.revealAt(e.clientX, e.clientY);
            }
        });
        
        this.gridCanvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const dy = e.clientY - this.dragStartY;
                
                const center = this.map.getCenter();
                const point = this.map.latLngToContainerPoint(center);
                point.x -= dx;
                point.y -= dy;
                
                this.map.panTo(this.map.containerPointToLatLng(point), {animate: false});
                
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
            } else if (this.mouseDown) {
                const dx = Math.abs(e.clientX - this.dragStartX);
                const dy = Math.abs(e.clientY - this.dragStartY);
                
                if (dx > 5 || dy > 5) {
                    this.mouseDown = false;
                    this.isDragging = true;
                    this.gridCanvas.style.cursor = 'grab';
                } else {
                    this.revealAt(e.clientX, e.clientY);
                }
            }
            
            this.updateHover(e.clientX, e.clientY);
            this.updateLocationInfo(e.clientX, e.clientY);
        });
        
        this.gridCanvas.addEventListener('mouseup', () => {
            this.mouseDown = false;
            this.isDragging = false;
            this.gridCanvas.style.cursor = 'default';
        });
        
        this.gridCanvas.addEventListener('mouseleave', () => {
            this.mouseDown = false;
            this.isDragging = false;
            this.hoverCell = null;
            this.gridCanvas.style.cursor = 'default';
            this.render();
        });
        
        this.gridCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            this.map.setZoom(this.map.getZoom() + delta);
        });
    }
    
    setupTouchEvents() {
        let touchStartTime = 0;
        let lastTap = 0;
        
        this.gridCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartTime = Date.now();
            
            // Сохраняем все касания
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                this.touches[touch.identifier] = {
                    startX: touch.clientX,
                    startY: touch.clientY,
                    currentX: touch.clientX,
                    currentY: touch.clientY
                };
            }
            
            if (e.touches.length === 1) {
                // Одно касание - раскрытие или перетаскивание
                const touch = e.touches[0];
                this.dragStartX = touch.clientX;
                this.dragStartY = touch.clientY;
                
                // Проверка двойного тапа для зума
                const now = Date.now();
                if (now - lastTap < 300) {
                    this.map.zoomIn();
                    this.log('Двойной тап - увеличение', 'debug');
                } else {
                    // Начинаем раскрытие
                    this.revealAt(touch.clientX, touch.clientY);
                    this.mouseDown = true;
                }
                lastTap = now;
                
            } else if (e.touches.length === 2) {
                // Два касания - зум
                this.mouseDown = false;
                const distance = this.getTouchDistance(e.touches);
                this.lastTouchDistance = distance;
                this.log('Начало pinch-to-zoom', 'debug');
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            // Обновляем позиции касаний
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (this.touches[touch.identifier]) {
                    this.touches[touch.identifier].currentX = touch.clientX;
                    this.touches[touch.identifier].currentY = touch.clientY;
                }
            }
            
            if (e.touches.length === 1 && this.touches[e.touches[0].identifier]) {
                const touch = e.touches[0];
                const touchData = this.touches[touch.identifier];
                const dx = Math.abs(touch.clientX - touchData.startX);
                const dy = Math.abs(touch.clientY - touchData.startY);
                
                if (Date.now() - touchStartTime > 150 && (dx > 10 || dy > 10)) {
                    // Это перетаскивание
                    this.mouseDown = false;
                    const center = this.map.getCenter();
                    const point = this.map.latLngToContainerPoint(center);
                    point.x -= (touch.clientX - this.dragStartX);
                    point.y -= (touch.clientY - this.dragStartY);
                    
                    this.map.panTo(this.map.containerPointToLatLng(point), {animate: false});
                    
                    this.dragStartX = touch.clientX;
                    this.dragStartY = touch.clientY;
                } else if (this.mouseDown) {
                    // Продолжаем раскрывать клетки
                    this.revealAt(touch.clientX, touch.clientY);
                }
                
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                const distance = this.getTouchDistance(e.touches);
                if (this.lastTouchDistance > 0) {
                    const scale = distance / this.lastTouchDistance;
                    if (scale > 1.1) {
                        this.map.zoomIn();
                        this.lastTouchDistance = distance;
                        this.log('Pinch zoom in', 'debug');
                    } else if (scale < 0.9) {
                        this.map.zoomOut();
                        this.lastTouchDistance = distance;
                        this.log('Pinch zoom out', 'debug');
                    }
                }
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            // Удаляем завершенные касания
            const remainingTouches = Array.from(e.touches);
            const touchIds = remainingTouches.map(t => t.identifier);
            
            for (let id in this.touches) {
                if (!touchIds.includes(parseInt(id))) {
                    delete this.touches[id];
                }
            }
            
            if (e.touches.length === 0) {
                this.mouseDown = false;
                this.lastTouchDistance = 0;
            }
        }, { passive: false });
        
        this.gridCanvas.addEventListener('touchcancel', () => {
            this.touches = {};
            this.mouseDown = false;
            this.lastTouchDistance = 0;
        });
    }
    
    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    updateHover(x, y) {
        if (this.isMobile) return; // Не нужно на мобильных
        
        const latLng = this.pixelToLatLng(x, y);
        const cell = this.latLngToGridCell(latLng.lat, latLng.lng);
        
        if (!this.hoverCell || this.hoverCell.key !== cell.key) {
            this.hoverCell = cell;
            this.render();
        }
    }
    
    updateLocationInfo(x, y) {
        const latLng = this.pixelToLatLng(x, y);
        const location = `${latLng.lat.toFixed(4)}°, ${latLng.lng.toFixed(4)}°`;
        const elem = document.getElementById('currentLocation');
        if (elem) elem.textContent = location;
    }
    
    async revealAt(x, y) {
        const latLng = this.pixelToLatLng(x, y);
        const cell = this.latLngToGridCell(latLng.lat, latLng.lng);
        
        if (!this.revealedCells.has(cell.key)) {
            const country = this.getCountryByCoords(latLng.lat, latLng.lng);
            
            this.revealedCells.add(cell.key);
            this.updateStats();
            this.render();
            this.saveProgress();
            
            this.log(`Клетка раскрыта: ${cell.key} (${country})`, 'debug');
            
            await this.revealCellOnServer(cell.key, country);
        }
    }
    
    getCountryByCoords(lat, lng) {
        if (lat >= 41 && lat <= 82 && lng >= -10 && lng <= 180) {
            if (lng >= 19 && lng <= 180) return '🇷🇺 Россия';
        }
        if (lat >= 47 && lat <= 55 && lng >= 22 && lng <= 40) return '🇺🇦 Украина';
        if (lat >= 51 && lat <= 56 && lng >= 23 && lng <= 33) return '🇧🇾 Беларусь';
        if (lat >= 54 && lat <= 60 && lng >= 21 && lng <= 29) return '🇱🇹 Литва';
        if (lat >= 43 && lat <= 50 && lng >= 2 && lng <= 8) return '🇫🇷 Франция';
        if (lat >= 47 && lat <= 55 && lng >= 5 && lng <= 15) return '🇩🇪 Германия';
        if (lat >= 35 && lat <= 47 && lng >= 6 && lng <= 19) return '🇮🇹 Италия';
        if (lat >= 36 && lat <= 44 && lng >= -10 && lng <= 4) return '🇪🇸 Испания';
        if (lat >= 49 && lat <= 61 && lng >= -8 && lng <= 2) return '🇬🇧 Великобритания';
        if (lat >= 49 && lat <= 60 && lng >= -140 && lng <= -53) return '🇨🇦 Канада';
        if (lat >= 25 && lat <= 49 && lng >= -125 && lng <= -66) return '🇺🇸 США';
        if (lat >= 35 && lat <= 45 && lng >= 122 && lng <= 146) return '🇯🇵 Япония';
        if (lat >= 18 && lat <= 54 && lng >= 73 && lng <= 135) return '🇨🇳 Китай';
        
        return '🌍 Мир';
    }
    
    render() {
        if (!this.map) return;
        
        this.fogCtx.clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        
        const zoom = this.map.getZoom();
        
        // Туман в зависимости от темы
        const fogColor = this.theme === 'dark' 
            ? 'rgba(255, 255, 255, 0.85)' 
            : 'rgba(0, 0, 0, 0.3)';
        
        // Рисуем туман
        this.fogCtx.fillStyle = fogColor;
        this.fogCtx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        
        // Вырезаем раскрытые клетки
        this.fogCtx.globalCompositeOperation = 'destination-out';
        
        this.revealedCells.forEach(cellKey => {
            const [lat, lng] = cellKey.split(',').map(Number);
            const cellSize = this.CELL_SIZE_LAT;
            
            const topLeft = this.latLngToPixel(lat + cellSize, lng);
            const topRight = this.latLngToPixel(lat + cellSize, lng + cellSize);
            const bottomRight = this.latLngToPixel(lat, lng + cellSize);
            const bottomLeft = this.latLngToPixel(lat, lng);
            
            this.fogCtx.beginPath();
            this.fogCtx.moveTo(topLeft.x, topLeft.y);
            this.fogCtx.lineTo(topRight.x, topRight.y);
            this.fogCtx.lineTo(bottomRight.x, bottomRight.y);
            this.fogCtx.lineTo(bottomLeft.x, bottomLeft.y);
            this.fogCtx.closePath();
            this.fogCtx.fill();
        });
        
        this.fogCtx.globalCompositeOperation = 'source-over';
        
        // Сетка
        if (this.showGrid) {
            this.drawGrid();
        }
        
        // Подсветка при наведении (только для десктопа)
        if (this.hoverCell && !this.isDragging && !this.isMobile) {
            if (!this.revealedCells.has(this.hoverCell.key)) {
                const lat = this.hoverCell.lat;
                const lng = this.hoverCell.lng;
                const cellSize = this.CELL_SIZE_LAT;
                
                const topLeft = this.latLngToPixel(lat + cellSize, lng);
                const topRight = this.latLngToPixel(lat + cellSize, lng + cellSize);
                const bottomRight = this.latLngToPixel(lat, lng + cellSize);
                const bottomLeft = this.latLngToPixel(lat, lng);
                
                this.gridCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                this.gridCtx.beginPath();
                this.gridCtx.moveTo(topLeft.x, topLeft.y);
                this.gridCtx.lineTo(topRight.x, topRight.y);
                this.gridCtx.lineTo(bottomRight.x, bottomRight.y);
                this.gridCtx.lineTo(bottomLeft.x, bottomLeft.y);
                this.gridCtx.closePath();
                this.gridCtx.fill();
                
                this.gridCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                this.gridCtx.lineWidth = 2;
                this.gridCtx.stroke();
            }
        }
    }
    
    drawGrid() {
        if (!this.map) return;
        
        const zoom = this.map.getZoom();
        if (zoom < 7) return;
        
        const bounds = this.map.getBounds();
        const cellSize = this.CELL_SIZE_LAT;
        const maxLines = 100;
        
        const startLat = Math.floor(bounds.getSouth() / cellSize) * cellSize - cellSize;
        const endLat = Math.ceil(bounds.getNorth() / cellSize) * cellSize + cellSize;
        const startLng = Math.floor(bounds.getWest() / cellSize) * cellSize - cellSize;
        const endLng = Math.ceil(bounds.getEast() / cellSize) * cellSize + cellSize;
        
        const latLines = Math.abs((endLat - startLat) / cellSize);
        const lngLines = Math.abs((endLng - startLng) / cellSize);
        
        if (latLines > maxLines || lngLines > maxLines) return;
        
        const opacity = Math.min(0.15, (zoom - 6) * 0.05);
        this.gridCtx.strokeStyle = this.theme === 'dark' 
            ? `rgba(0, 0, 0, ${opacity})`
            : `rgba(255, 255, 255, ${opacity})`;
        this.gridCtx.lineWidth = zoom > 10 ? 1 : 0.5;
        
        // Горизонтальные линии
        for (let lat = startLat; lat <= endLat; lat += cellSize) {
            const leftPoint = this.latLngToPixel(lat, startLng);
            const rightPoint = this.latLngToPixel(lat, endLng);
            
            this.gridCtx.beginPath();
            this.gridCtx.moveTo(leftPoint.x, leftPoint.y);
            this.gridCtx.lineTo(rightPoint.x, rightPoint.y);
            this.gridCtx.stroke();
        }
        
        // Вертикальные линии
        for (let lng = startLng; lng <= endLng; lng += cellSize) {
            const topPoint = this.latLngToPixel(endLat, lng);
            const bottomPoint = this.latLngToPixel(startLat, lng);
            
            this.gridCtx.beginPath();
            this.gridCtx.moveTo(topPoint.x, topPoint.y);
            this.gridCtx.lineTo(bottomPoint.x, bottomPoint.y);
            this.gridCtx.stroke();
        }
    }
    
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.render();
        this.log(`Сетка ${this.showGrid ? 'включена' : 'выключена'}`, 'info');
    }
    
    updateStats() {
        const cellsCount = this.revealedCells.size;
        const totalArea = cellsCount * this.CELL_SIZE_KM * this.CELL_SIZE_KM;
        
        document.getElementById('cellsRevealed').textContent = cellsCount.toLocaleString();
        document.getElementById('areaRevealed').textContent = Math.round(totalArea).toLocaleString();
    }
    
    updateUI() {
        const zoom = this.currentZoom;
        const zoomElem = document.getElementById('zoomLevel');
        if (zoomElem) zoomElem.textContent = zoom;
        
        const cellSizeElem = document.getElementById('cellSize');
        if (cellSizeElem) cellSizeElem.textContent = `${this.CELL_SIZE_KM} км`;
        
        const gridInfo = document.querySelector('.info-panel div:last-child');
        if (gridInfo) {
            if (zoom < 7) {
                gridInfo.innerHTML = '📐 Сетка: скрыта (приблизьте)';
                gridInfo.style.opacity = '0.5';
            } else {
                gridInfo.innerHTML = '📐 Сетка: 10×10 км';
                gridInfo.style.opacity = '1';
            }
        }
    }
    
    resetFog() {
        if (confirm('Очистить весь прогресс?')) {
            this.revealedCells.clear();
            this.updateStats();
            this.render();
            this.saveProgress();
            this.log('Прогресс очищен', 'warn');
        }
    }
    
    saveProgress() {
        const data = {
            cells: Array.from(this.revealedCells),
            center: this.map.getCenter(),
            zoom: this.map.getZoom()
        };
        localStorage.setItem('battleMapFixedGrid', JSON.stringify(data));
        this.syncToServer();
    }
    
    loadProgress() {
        const saved = localStorage.getItem('battleMapFixedGrid');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.revealedCells = new Set(data.cells);
                if (data.center) {
                    this.map.setView([data.center.lat, data.center.lng], data.zoom || 10);
                }
                this.updateStats();
                this.updateUI();
                this.render();
                this.log(`Загружен прогресс: ${this.revealedCells.size} клеток`, 'info');
            } catch (e) {
                this.log('Ошибка загрузки прогресса: ' + e.message, 'error');
            }
        }
        
        this.syncFromServer();
    }
    
    async revealCellOnServer(cellKey, country) {
        try {
            const response = await fetch('/api/reveal-cell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cellKey,
                    userId: this.playerId
                })
            });
            
            if (response.ok) {
                this.showSyncStatus('✓ Синхронизировано');
            }
        } catch (error) {
            this.log('Ошибка синхронизации: ' + error.message, 'error');
        }
    }
    
    async syncToServer() {
        // Не используется пока
    }
    
    async syncFromServer() {
        try {
            const response = await fetch('/api/game-state');
            if (!response.ok) return;
            
            const data = await response.json();
            
            if (data.allCells && data.allCells.length > 0) {
                data.allCells.forEach(cell => this.revealedCells.add(cell));
                this.updateStats();
                this.render();
            }
            
            if (data.totalCells !== undefined) {
                const elem = document.getElementById('totalCells');
                if (elem) elem.textContent = data.totalCells.toLocaleString();
            }
            
            if (data.onlinePlayers !== undefined) {
                const elem = document.getElementById('onlinePlayers');
                if (elem) elem.textContent = data.onlinePlayers;
            }
            
            if (data.topCountries) {
                this.updateTopCountries(data.topCountries);
            }
            
            this.log(`Синхронизация: ${data.totalCells} клеток, ${data.onlinePlayers} игроков`, 'debug');
            
        } catch (error) {
            this.log('Ошибка загрузки с сервера: ' + error.message, 'error');
        }
    }
    
    updateTopCountries(countries) {
        const list = document.getElementById('countriesList');
        if (!list) return;
        
        list.innerHTML = '';
        
        countries.forEach((country, index) => {
            const item = document.createElement('div');
            item.className = 'country-item';
            
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
    
    startSyncTimer() {
        this.syncInterval = setInterval(() => {
            this.syncFromServer();
        }, 5000);
        
        setTimeout(() => this.syncFromServer(), 1000);
        this.log('Таймер синхронизации запущен', 'debug');
    }
    
    // Меню функции
    toggleMenu() {
        const menu = document.getElementById('sideMenu');
        menu.classList.toggle('active');
        this.log('Меню ' + (menu.classList.contains('active') ? 'открыто' : 'закрыто'), 'debug');
    }
    
    toggleLogsPanel() {
        const panel = document.getElementById('logsPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            this.updateLogsUI();
        }
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.battleMap = new OnlineBattleMap();
});

window.OnlineBattleMap = OnlineBattleMap;