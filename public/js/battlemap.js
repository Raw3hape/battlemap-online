// BattleMap Online - Главный класс игры
class OnlineBattleMap {
    constructor() {
        this.map = null;
        this.fogCanvas = document.getElementById('fogCanvas');
        this.gridCanvas = document.getElementById('gridCanvas');
        this.fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true });
        this.gridCtx = this.gridCanvas.getContext('2d');
        
        // ФИКСИРОВАННЫЙ размер клетки
        this.CELL_SIZE_KM = 10;
        // Размер в градусах широты (постоянный)
        this.CELL_SIZE_LAT = 10 / 111; // ~0.09 градуса
        
        // Хранилище раскрытых клеток
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
        
        this.init();
    }
    
    getOrCreatePlayerId() {
        let playerId = localStorage.getItem('battleMapPlayerId');
        if (!playerId) {
            playerId = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('battleMapPlayerId', playerId);
        }
        return playerId;
    }
    
    init() {
        this.setupCanvas();
        this.setupMap();
        this.setupEventListeners();
        this.loadProgress();
        this.startSyncTimer();
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
        };
        
        resize();
        window.addEventListener('resize', resize);
    }
    
    setupMap() {
        this.map = L.map('map', {
            center: [55.7558, 37.6173], // Москва
            zoom: 10,
            zoomControl: false,
            attributionControl: true
        });
        
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(this.map);
        
        this.currentZoom = this.map.getZoom();
        
        // Обработчики событий карты
        this.map.on('zoomend', () => {
            this.currentZoom = this.map.getZoom();
            this.updateUI();
            this.render();
        });
        
        this.map.on('move', () => {
            this.render();
        });
        
        this.map.whenReady(() => {
            this.updateUI();
            this.render();
        });
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
    }
    
    // Преобразует географические координаты в индекс клетки сетки
    latLngToGridCell(lat, lng) {
        // Используем фиксированную сетку без учета косинуса
        // Это гарантирует, что сетка всегда будет выровнена
        const gridLat = Math.floor(lat / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        const gridLng = Math.floor(lng / this.CELL_SIZE_LAT) * this.CELL_SIZE_LAT;
        
        return {
            lat: gridLat,
            lng: gridLng,
            key: `${gridLat.toFixed(6)},${gridLng.toFixed(6)}`
        };
    }
    
    // Преобразует пиксели экрана в географические координаты
    pixelToLatLng(x, y) {
        const point = L.point(x, y);
        return this.map.containerPointToLatLng(point);
    }
    
    // Преобразует географические координаты в пиксели экрана
    latLngToPixel(lat, lng) {
        const point = this.map.latLngToContainerPoint([lat, lng]);
        return { x: point.x, y: point.y };
    }
    
    setupEventListeners() {
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
        
        this.gridCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        this.gridCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            this.map.setZoom(this.map.getZoom() + delta);
        });
        
        // Touch события
        let touchStartTime = 0;
        this.gridCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartTime = Date.now();
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.dragStartX = touch.clientX;
                this.dragStartY = touch.clientY;
                this.revealAt(touch.clientX, touch.clientY);
                this.mouseDown = true;
            }
        });
        
        this.gridCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - this.dragStartX);
                const dy = Math.abs(touch.clientY - this.dragStartY);
                
                if (Date.now() - touchStartTime > 200 && (dx > 10 || dy > 10)) {
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
                    // Раскрываем клетки
                    this.revealAt(touch.clientX, touch.clientY);
                }
            }
        });
        
        this.gridCanvas.addEventListener('touchend', () => {
            this.mouseDown = false;
        });
    }
    
    updateHover(x, y) {
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
            // Определяем страну (упрощенно по координатам)
            const country = this.getCountryByCoords(latLng.lat, latLng.lng);
            
            this.revealedCells.add(cell.key);
            this.updateStats();
            this.render();
            this.saveProgress();
            
            // Отправляем на сервер
            await this.revealCellOnServer(cell.key, country);
        }
    }
    
    getCountryByCoords(lat, lng) {
        // Упрощенное определение страны по координатам
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
        
        // Адаптивная прозрачность тумана в зависимости от зума
        const zoom = this.map.getZoom();
        const fogOpacity = zoom < 5 ? 0.9 : 0.85; // Более плотный туман при отдалении
        
        // Рисуем туман
        this.fogCtx.fillStyle = `rgba(255, 255, 255, ${fogOpacity})`;
        this.fogCtx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
        
        // Вырезаем раскрытые клетки
        this.fogCtx.globalCompositeOperation = 'destination-out';
        
        this.revealedCells.forEach(cellKey => {
            const [lat, lng] = cellKey.split(',').map(Number);
            
            // Используем фиксированный размер для согласованности с сеткой
            const cellSize = this.CELL_SIZE_LAT;
            
            // Четыре угла клетки
            const topLeft = this.latLngToPixel(lat + cellSize, lng);
            const topRight = this.latLngToPixel(lat + cellSize, lng + cellSize);
            const bottomRight = this.latLngToPixel(lat, lng + cellSize);
            const bottomLeft = this.latLngToPixel(lat, lng);
            
            // Рисуем четырехугольник
            this.fogCtx.beginPath();
            this.fogCtx.moveTo(topLeft.x, topLeft.y);
            this.fogCtx.lineTo(topRight.x, topRight.y);
            this.fogCtx.lineTo(bottomRight.x, bottomRight.y);
            this.fogCtx.lineTo(bottomLeft.x, bottomLeft.y);
            this.fogCtx.closePath();
            this.fogCtx.fill();
        });
        
        this.fogCtx.globalCompositeOperation = 'source-over';
        
        // Рисуем сетку
        if (this.showGrid) {
            this.drawGrid();
        }
        
        // Подсветка при наведении
        if (this.hoverCell && !this.isDragging) {
            if (!this.revealedCells.has(this.hoverCell.key)) {
                const lat = this.hoverCell.lat;
                const lng = this.hoverCell.lng;
                const cellSize = this.CELL_SIZE_LAT;
                
                const topLeft = this.latLngToPixel(lat + cellSize, lng);
                const topRight = this.latLngToPixel(lat + cellSize, lng + cellSize);
                const bottomRight = this.latLngToPixel(lat, lng + cellSize);
                const bottomLeft = this.latLngToPixel(lat, lng);
                
                // Полупрозрачная заливка
                this.gridCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                this.gridCtx.beginPath();
                this.gridCtx.moveTo(topLeft.x, topLeft.y);
                this.gridCtx.lineTo(topRight.x, topRight.y);
                this.gridCtx.lineTo(bottomRight.x, bottomRight.y);
                this.gridCtx.lineTo(bottomLeft.x, bottomLeft.y);
                this.gridCtx.closePath();
                this.gridCtx.fill();
                
                // Рамка
                this.gridCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                this.gridCtx.lineWidth = 2;
                this.gridCtx.stroke();
            }
        }
    }
    
    drawGrid() {
        if (!this.map) return;
        
        // Скрываем сетку при малом зуме (когда клетки слишком мелкие)
        const zoom = this.map.getZoom();
        if (zoom < 7) return; // Не показываем сетку при зуме меньше 7
        
        const bounds = this.map.getBounds();
        const cellSize = this.CELL_SIZE_LAT;
        
        // Ограничиваем количество линий
        const maxLines = 100; // Максимум линий в каждом направлении
        
        // Расширяем границы для рисования сетки за пределами видимой области
        const startLat = Math.floor(bounds.getSouth() / cellSize) * cellSize - cellSize;
        const endLat = Math.ceil(bounds.getNorth() / cellSize) * cellSize + cellSize;
        const startLng = Math.floor(bounds.getWest() / cellSize) * cellSize - cellSize;
        const endLng = Math.ceil(bounds.getEast() / cellSize) * cellSize + cellSize;
        
        // Проверяем количество линий
        const latLines = Math.abs((endLat - startLat) / cellSize);
        const lngLines = Math.abs((endLng - startLng) / cellSize);
        
        if (latLines > maxLines || lngLines > maxLines) return; // Слишком много линий
        
        // Адаптивная прозрачность в зависимости от зума
        const opacity = Math.min(0.15, (zoom - 6) * 0.05);
        this.gridCtx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
        this.gridCtx.lineWidth = zoom > 10 ? 1 : 0.5;
        
        // Рисуем горизонтальные линии (параллели)
        for (let lat = startLat; lat <= endLat; lat += cellSize) {
            const leftPoint = this.latLngToPixel(lat, startLng);
            const rightPoint = this.latLngToPixel(lat, endLng);
            
            this.gridCtx.beginPath();
            this.gridCtx.moveTo(leftPoint.x, leftPoint.y);
            this.gridCtx.lineTo(rightPoint.x, rightPoint.y);
            this.gridCtx.stroke();
        }
        
        // Рисуем вертикальные линии (меридианы) - теперь с тем же шагом
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
        
        // Обновляем информацию о видимости сетки
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
        }
    }
    
    saveProgress() {
        const data = {
            cells: Array.from(this.revealedCells),
            center: this.map.getCenter(),
            zoom: this.map.getZoom()
        };
        localStorage.setItem('battleMapFixedGrid', JSON.stringify(data));
        
        // Синхронизация с сервером
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
            } catch (e) {
                console.error('Ошибка загрузки прогресса:', e);
            }
        }
        
        // Загружаем с сервера последние данные
        this.syncFromServer();
    }
    
    // Онлайн функционал
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
            console.error('Ошибка синхронизации:', error);
        }
    }
    
    async syncToServer() {
        // Пока не используется
    }
    
    async syncFromServer() {
        try {
            const response = await fetch('/api/game-state');
            if (!response.ok) return;
            
            const data = await response.json();
            
            // Объединяем клетки всех игроков
            if (data.allCells && data.allCells.length > 0) {
                data.allCells.forEach(cell => this.revealedCells.add(cell));
                this.updateStats();
                this.render();
            }
            
            // Обновляем онлайн статистику
            if (data.totalCells !== undefined) {
                const elem = document.getElementById('totalCells');
                if (elem) elem.textContent = data.totalCells.toLocaleString();
            }
            
            if (data.onlinePlayers !== undefined) {
                const elem = document.getElementById('onlinePlayers');
                if (elem) elem.textContent = data.onlinePlayers;
            }
            
            // Обновляем топ стран
            if (data.topCountries) {
                this.updateTopCountries(data.topCountries);
            }
            
        } catch (error) {
            console.error('Ошибка загрузки с сервера:', error);
        }
    }
    
    updateTopCountries(countries) {
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
    
    startSyncTimer() {
        // Синхронизация каждые 5 секунд
        this.syncInterval = setInterval(() => {
            this.syncFromServer();
        }, 5000);
        
        // Первая синхронизация через секунду
        setTimeout(() => this.syncFromServer(), 1000);
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.battleMap = new OnlineBattleMap();
});

// Экспортируем для глобального доступа
window.OnlineBattleMap = OnlineBattleMap;