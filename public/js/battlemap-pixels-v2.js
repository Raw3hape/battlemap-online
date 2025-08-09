// BattleMap Pixels v2 - Улучшенная версия с исправлениями
class PixelBattleMap {
    constructor() {
        this.map = null;
        this.pixelLayer = null;
        this.pixelLayerInstance = null;
        
        // Размеры пикселя (10км)
        this.PIXEL_SIZE_KM = 10;
        this.PIXEL_SIZE_LAT = 10 / 111;
        
        // Хранилище пикселей
        this.pixels = new Map();
        
        // Текущий выбранный цвет
        this.selectedColor = '#FF0000';
        this.selectedOpacity = 0.6;
        
        // Палитра цветов
        this.colorPalette = [
            { name: 'Красный', hex: '#FF0000' },
            { name: 'Синий', hex: '#0000FF' },
            { name: 'Зеленый', hex: '#00FF00' },
            { name: 'Желтый', hex: '#FFFF00' },
            { name: 'Оранжевый', hex: '#FFA500' },
            { name: 'Фиолетовый', hex: '#800080' },
            { name: 'Розовый', hex: '#FFC0CB' },
            { name: 'Голубой', hex: '#00FFFF' },
            { name: 'Черный', hex: '#000000' },
            { name: 'Белый', hex: '#FFFFFF' }
        ];
        
        // ID игрока
        this.playerId = this.getOrCreatePlayerId();
        
        // Батчинг для оптимизации
        this.pendingPixels = new Map();
        this.batchTimer = null;
        this.batchDelay = 500;
        this.maxBatchSize = 10;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 20000; // 20 секунд
        this.isSyncing = false;
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Защита от частых кликов
        this.lastClickTime = 0;
        this.clickCooldown = 100; // 100мс между кликами
        
        // Кэш тайлов для предотвращения мерцания
        this.tileCache = new Map();
        this.renderQueue = new Set();
        this.renderTimer = null;
        
        this.init();
    }
    
    init() {
        console.log('Инициализация PixelBattleMap v2.0');
        
        this.initMap();
        this.createPixelLayer();
        this.setupInteraction();
        this.createColorPalette();
        this.applyTheme(this.theme);
        this.setupThemeToggle();
        
        // Инициализация после готовности карты
        this.map.whenReady(async () => {
            this.loadLocalPixels();
            await this.syncWithServer();
            this.startPeriodicSync();
        });
    }
    
    initMap() {
        this.map = L.map('map', {
            center: [55.7558, 37.6173], // Москва
            zoom: 5,
            minZoom: 2,
            maxZoom: 15,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            zoomControl: true,
            attributionControl: false,
            preferCanvas: true,
            // Отключаем анимации для предотвращения мерцания
            zoomAnimation: false,
            fadeAnimation: false,
            markerZoomAnimation: false
        });
        
        // Базовая карта
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 2,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 4
        }).addTo(this.map);
        
        // Контролы
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
    }
    
    createPixelLayer() {
        const self = this;
        
        // Создаем кастомный GridLayer для пикселей
        this.pixelLayer = L.GridLayer.extend({
            createTile: function(coords) {
                const key = `${coords.z}_${coords.x}_${coords.y}`;
                
                // Используем кэшированный тайл если есть
                if (self.tileCache.has(key)) {
                    const cached = self.tileCache.get(key);
                    if (cached.zoom === coords.z) {
                        return cached.tile;
                    }
                }
                
                const tile = document.createElement('canvas');
                const size = this.getTileSize();
                tile.width = size.x;
                tile.height = size.y;
                
                const ctx = tile.getContext('2d', { 
                    alpha: true,
                    willReadFrequently: false 
                });
                
                // Сохраняем в кэш
                self.tileCache.set(key, {
                    tile: tile,
                    ctx: ctx,
                    zoom: coords.z,
                    coords: coords
                });
                
                // Добавляем в очередь рендеринга
                self.queueTileRender(coords);
                
                return tile;
            }
        });
        
        // Добавляем слой на карту
        this.pixelLayerInstance = new this.pixelLayer({
            tileSize: 256,
            opacity: 1,
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 4,
            // Важно для предотвращения мерцания
            className: 'pixel-layer'
        });
        
        this.pixelLayerInstance.addTo(this.map);
        
        // Обработчики событий карты
        this.map.on('zoomstart', () => {
            // Не очищаем кэш при зуме для плавности
        });
        
        this.map.on('zoomend', () => {
            // Перерисовываем все видимые тайлы после зума
            this.renderAllVisibleTiles();
        });
        
        this.map.on('moveend', () => {
            // Перерисовываем после перемещения
            this.renderAllVisibleTiles();
        });
    }
    
    queueTileRender(coords) {
        const key = `${coords.z}_${coords.x}_${coords.y}`;
        this.renderQueue.add(key);
        
        // Используем requestAnimationFrame для плавной отрисовки
        if (!this.renderTimer) {
            this.renderTimer = requestAnimationFrame(() => {
                this.processRenderQueue();
                this.renderTimer = null;
            });
        }
    }
    
    processRenderQueue() {
        const queue = Array.from(this.renderQueue);
        this.renderQueue.clear();
        
        queue.forEach(key => {
            const cached = this.tileCache.get(key);
            if (cached) {
                this.renderTile(cached.ctx, cached.coords, { x: 256, y: 256 });
            }
        });
    }
    
    renderTile(ctx, coords, tileSize) {
        const zoom = coords.z;
        const tileX = coords.x;
        const tileY = coords.y;
        
        // Очищаем тайл
        ctx.clearRect(0, 0, tileSize.x, tileSize.y);
        
        // Конвертируем координаты тайла в географические
        const nwPoint = this.getTileLatLng(tileX, tileY, zoom);
        const sePoint = this.getTileLatLng(tileX + 1, tileY + 1, zoom);
        
        const effectivePixelSize = this.PIXEL_SIZE_LAT;
        
        // Определяем диапазон пикселей для отрисовки
        const startLat = Math.floor(sePoint.lat / effectivePixelSize) * effectivePixelSize;
        const endLat = Math.ceil(nwPoint.lat / effectivePixelSize) * effectivePixelSize;
        const startLng = Math.floor(nwPoint.lng / effectivePixelSize) * effectivePixelSize;
        const endLng = Math.ceil(sePoint.lng / effectivePixelSize) * effectivePixelSize;
        
        // Рисуем пиксели
        for (let lat = startLat; lat <= endLat; lat += effectivePixelSize) {
            for (let lng = startLng; lng <= endLng; lng += effectivePixelSize) {
                const key = this.getPixelKey(lat, lng);
                const pixelData = this.pixels.get(key);
                
                if (pixelData) {
                    this.drawPixel(ctx, lat, lng, pixelData, coords, tileSize);
                }
            }
        }
    }
    
    drawPixel(ctx, lat, lng, pixelData, coords, tileSize) {
        const zoom = coords.z;
        const effectivePixelSize = this.PIXEL_SIZE_LAT;
        
        // Преобразуем географические координаты в пиксели тайла
        const nwPoint = this.getTileLatLng(coords.x, coords.y, zoom);
        const sePoint = this.getTileLatLng(coords.x + 1, coords.y + 1, zoom);
        
        // Вычисляем положение пикселя в тайле
        const x = ((lng - nwPoint.lng) / (sePoint.lng - nwPoint.lng)) * tileSize.x;
        const y = ((nwPoint.lat - lat) / (nwPoint.lat - sePoint.lat)) * tileSize.y;
        
        // Вычисляем размер пикселя в пикселях экрана
        const width = (effectivePixelSize / (sePoint.lng - nwPoint.lng)) * tileSize.x;
        const height = (effectivePixelSize / (nwPoint.lat - sePoint.lat)) * tileSize.y;
        
        // Рисуем пиксель
        ctx.fillStyle = pixelData.color;
        ctx.globalAlpha = pixelData.opacity || 0.6;
        
        // Используем целочисленные координаты для четкости
        ctx.fillRect(
            Math.floor(x),
            Math.floor(y),
            Math.ceil(width) + 1, // +1 для устранения зазоров
            Math.ceil(height) + 1  // +1 для устранения зазоров
        );
        
        ctx.globalAlpha = 1;
    }
    
    getTileLatLng(x, y, z) {
        const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        const lng = x / Math.pow(2, z) * 360 - 180;
        return { lat, lng };
    }
    
    getPixelKey(lat, lng) {
        const gridLat = Math.floor(lat / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const gridLng = Math.floor(lng / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        return `${gridLat.toFixed(6)},${gridLng.toFixed(6)}`;
    }
    
    setupInteraction() {
        // Обработчик клика по карте
        this.map.on('click', (e) => {
            const now = Date.now();
            if (now - this.lastClickTime < this.clickCooldown) {
                return; // Игнорируем слишком частые клики
            }
            this.lastClickTime = now;
            
            this.addPixel(e.latlng.lat, e.latlng.lng);
        });
        
        // Мобильные обработчики
        if (this.isMobile) {
            this.map.on('tap', (e) => {
                const now = Date.now();
                if (now - this.lastClickTime < this.clickCooldown) {
                    return;
                }
                this.lastClickTime = now;
                
                this.addPixel(e.latlng.lat, e.latlng.lng);
            });
        }
    }
    
    addPixel(lat, lng) {
        const key = this.getPixelKey(lat, lng);
        
        // Сохраняем пиксель локально
        const pixelData = {
            position: key,
            color: this.selectedColor,
            opacity: this.selectedOpacity,
            playerId: this.playerId,
            timestamp: Date.now()
        };
        
        this.pixels.set(key, pixelData);
        
        // Добавляем в батч для отправки
        this.pendingPixels.set(key, pixelData);
        this.scheduleBatch();
        
        // Немедленно перерисовываем тайл с новым пикселем
        this.renderPixelTile(lat, lng);
        
        // Обновляем статистику
        this.updateLocalStats();
        
        // Визуальная обратная связь
        this.showPixelFeedback(lat, lng);
    }
    
    renderPixelTile(lat, lng) {
        // Находим тайл, содержащий этот пиксель
        const zoom = this.map.getZoom();
        const tileCoords = this.latLngToTileCoords(lat, lng, zoom);
        const key = `${zoom}_${tileCoords.x}_${tileCoords.y}`;
        
        const cached = this.tileCache.get(key);
        if (cached) {
            this.renderTile(cached.ctx, cached.coords, { x: 256, y: 256 });
        }
    }
    
    latLngToTileCoords(lat, lng, zoom) {
        const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
        const latRad = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y };
    }
    
    showPixelFeedback(lat, lng) {
        // Создаем временный маркер для визуальной обратной связи
        const icon = L.divIcon({
            className: 'pixel-feedback',
            html: `<div style="
                width: 20px;
                height: 20px;
                background: ${this.selectedColor};
                border: 2px solid white;
                border-radius: 50%;
                animation: pulse 0.5s ease-out;
            "></div>`,
            iconSize: [20, 20]
        });
        
        const marker = L.marker([lat, lng], { icon }).addTo(this.map);
        
        // Удаляем маркер через 500мс
        setTimeout(() => {
            this.map.removeLayer(marker);
        }, 500);
    }
    
    scheduleBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        
        this.batchTimer = setTimeout(() => {
            this.sendBatch();
        }, this.batchDelay);
        
        // Немедленная отправка при достижении максимального размера батча
        if (this.pendingPixels.size >= this.maxBatchSize) {
            clearTimeout(this.batchTimer);
            this.sendBatch();
        }
    }
    
    async sendBatch() {
        if (this.pendingPixels.size === 0) return;
        
        const pixels = Array.from(this.pendingPixels.values());
        this.pendingPixels.clear();
        
        try {
            const response = await fetch('/api/pixels-batch-geo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pixels: pixels,
                    playerId: this.playerId
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showSyncStatus('✅ Сохранено', 'success');
            } else {
                // Возвращаем пиксели в очередь при ошибке
                pixels.forEach(p => {
                    this.pendingPixels.set(p.position, p);
                });
                this.showSyncStatus('❌ Ошибка сохранения', 'error');
            }
        } catch (error) {
            console.error('Ошибка отправки батча:', error);
            // Возвращаем пиксели в очередь
            pixels.forEach(p => {
                this.pendingPixels.set(p.position, p);
            });
            this.showSyncStatus('❌ Ошибка сети', 'error');
        }
    }
    
    async syncWithServer() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        
        try {
            const response = await fetch('/api/pixels-state');
            if (!response.ok) throw new Error('Sync failed');
            
            const data = await response.json();
            
            // Обновляем пиксели (НЕ очищаем существующие!)
            if (data.pixels && Array.isArray(data.pixels)) {
                data.pixels.forEach(pixel => {
                    if (pixel.position && pixel.color) {
                        this.pixels.set(pixel.position, {
                            color: pixel.color,
                            opacity: pixel.opacity || 0.6,
                            playerId: pixel.playerId || 'unknown'
                        });
                    }
                });
            }
            
            // Обновляем статистику
            if (data.stats) {
                this.updateStats(data.stats);
            }
            
            // Перерисовываем все видимые тайлы
            this.renderAllVisibleTiles();
            
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
        } finally {
            this.isSyncing = false;
        }
    }
    
    renderAllVisibleTiles() {
        // Очищаем очередь и перерисовываем все видимые тайлы
        this.renderQueue.clear();
        
        this.tileCache.forEach((cached, key) => {
            this.renderQueue.add(key);
        });
        
        this.processRenderQueue();
    }
    
    renderAllTiles() {
        // Принудительная перерисовка всех тайлов
        if (this.pixelLayerInstance) {
            this.pixelLayerInstance.redraw();
        }
    }
    
    updateStats(stats) {
        // Обновляем основную статистику
        document.getElementById('totalPixels').textContent = stats.totalPixels || 0;
        document.getElementById('onlinePlayers').textContent = stats.onlinePlayers || 0;
        
        // Обновляем топ цветов
        if (stats.topColors && stats.topColors.length > 0) {
            const colorsList = document.getElementById('colorsList');
            colorsList.innerHTML = '';
            
            stats.topColors.slice(0, 5).forEach(colorStat => {
                const item = document.createElement('div');
                item.className = 'territory-item';
                item.innerHTML = `
                    <span>
                        <span class="territory-color" style="background: ${colorStat.color}"></span>
                        ${colorStat.name}
                    </span>
                    <span>${colorStat.totalPixels}</span>
                `;
                colorsList.appendChild(item);
            });
        }
        
        // Обновляем топ стран
        if (stats.topColors && stats.topColors.length > 0) {
            const countriesList = document.getElementById('countriesList');
            countriesList.innerHTML = '';
            
            let allCountries = [];
            stats.topColors.forEach(colorStat => {
                if (colorStat.countries) {
                    colorStat.countries.forEach(country => {
                        allCountries.push({
                            ...country,
                            color: colorStat.color
                        });
                    });
                }
            });
            
            // Сортируем по проценту и берем топ 5
            allCountries.sort((a, b) => b.percentage - a.percentage);
            allCountries.slice(0, 5).forEach(country => {
                const item = document.createElement('div');
                item.className = 'territory-item';
                item.innerHTML = `
                    <span>${country.name}</span>
                    <span>${country.percentageFormatted}</span>
                `;
                countriesList.appendChild(item);
            });
        }
    }
    
    updateLocalStats() {
        // Подсчитываем локальные пиксели пользователя
        let myPixelCount = 0;
        this.pixels.forEach(pixel => {
            if (pixel.playerId === this.playerId) {
                myPixelCount++;
            }
        });
        document.getElementById('myPixels').textContent = myPixelCount;
    }
    
    createColorPalette() {
        const container = document.getElementById('colorOptions');
        container.innerHTML = '';
        
        this.colorPalette.forEach(color => {
            const option = document.createElement('div');
            option.className = 'color-option';
            option.style.backgroundColor = color.hex;
            option.title = color.name;
            
            if (color.hex === this.selectedColor) {
                option.classList.add('selected');
            }
            
            option.addEventListener('click', () => {
                // Убираем выделение с предыдущего
                container.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                // Выделяем новый
                option.classList.add('selected');
                this.selectedColor = color.hex;
                
                // Сохраняем выбор
                localStorage.setItem('battleMapSelectedColor', color.hex);
            });
            
            container.appendChild(option);
        });
    }
    
    setupThemeToggle() {
        const themeBtn = document.getElementById('themeToggle');
        
        themeBtn.addEventListener('click', () => {
            this.theme = this.theme === 'dark' ? 'light' : 'dark';
            this.applyTheme(this.theme);
            localStorage.setItem('battleMapTheme', this.theme);
        });
    }
    
    applyTheme(theme) {
        const body = document.body;
        const themeBtn = document.getElementById('themeToggle');
        
        if (theme === 'light') {
            body.classList.add('light-theme');
            themeBtn.textContent = '☀️';
        } else {
            body.classList.remove('light-theme');
            themeBtn.textContent = '🌙';
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
    
    loadLocalPixels() {
        const saved = localStorage.getItem('battleMapPixels');
        if (saved) {
            try {
                const pixels = JSON.parse(saved);
                pixels.forEach(pixel => {
                    if (pixel.position && pixel.color) {
                        this.pixels.set(pixel.position, pixel);
                    }
                });
                this.updateLocalStats();
            } catch (e) {
                console.error('Ошибка загрузки локальных пикселей:', e);
            }
        }
        
        // Загружаем выбранный цвет
        const savedColor = localStorage.getItem('battleMapSelectedColor');
        if (savedColor) {
            this.selectedColor = savedColor;
        }
    }
    
    saveToLocal() {
        const pixelsArray = Array.from(this.pixels.entries()).map(([key, data]) => ({
            position: key,
            ...data
        }));
        localStorage.setItem('battleMapPixels', JSON.stringify(pixelsArray));
        this.showSyncStatus('💾 Сохранено локально', 'success');
    }
    
    startPeriodicSync() {
        // Первая синхронизация через 2 секунды
        setTimeout(() => this.syncWithServer(), 2000);
        
        // Периодическая синхронизация
        this.syncInterval = setInterval(() => {
            this.syncWithServer();
        }, this.syncDelay);
    }
    
    showSyncStatus(message, type = 'info') {
        const indicator = document.getElementById('syncIndicator');
        const text = document.getElementById('syncText');
        
        text.textContent = message;
        indicator.className = 'sync-indicator show';
        if (type === 'success') {
            indicator.classList.add('success');
        } else if (type === 'error') {
            indicator.classList.add('error');
        }
        
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 2000);
    }
}

// Добавляем стили для анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0% {
            transform: scale(1);
            opacity: 1;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
    
    .pixel-layer {
        image-rendering: pixelated;
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
    }
`;
document.head.appendChild(style);