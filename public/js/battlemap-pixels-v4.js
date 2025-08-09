// BattleMap Pixels v4 - Исправление смещения и обрезания пикселей
class PixelBattleMap {
    constructor() {
        this.map = null;
        this.pixelLayer = null;
        this.pixelLayerInstance = null;
        
        // Размеры пикселя (10км)
        this.PIXEL_SIZE_KM = 10;
        this.PIXEL_SIZE_LAT = 10 / 111;
        this.PIXEL_SIZE_LNG_EQUATOR = 10 / 111.32;
        
        // Хранилище пикселей
        this.pixels = new Map();
        
        // Текущий выбранный цвет
        this.selectedColor = '#FF0000';
        this.selectedOpacity = 0.7;
        
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
        this.batchDelay = 300;
        this.maxBatchSize = 10;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 20000;
        this.isSyncing = false;
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Последний клик
        this.lastClickTime = 0;
        this.clickCooldown = 50;
        
        this.init();
    }
    
    init() {
        console.log('Инициализация PixelBattleMap v4.0');
        
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
            maxZoom: 18,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            zoomControl: true,
            attributionControl: false,
            preferCanvas: true,
            zoomAnimation: true,
            fadeAnimation: false
        });
        
        // Базовая карта
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            minZoom: 2,
            attribution: '© OpenStreetMap'
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
                const tile = document.createElement('canvas');
                const size = this.getTileSize();
                tile.width = size.x;
                tile.height = size.y;
                tile.style.width = size.x + 'px';
                tile.style.height = size.y + 'px';
                
                const ctx = tile.getContext('2d', { 
                    alpha: true,
                    willReadFrequently: false,
                    imageSmoothingEnabled: false
                });
                
                // Рендерим тайл
                self.renderTile(ctx, coords, size);
                
                return tile;
            },
            
            _updateLevels: function() {
                // Переопределяем для предотвращения мерцания
                L.GridLayer.prototype._updateLevels.call(this);
            },
            
            _animateZoom: function(e) {
                // Отключаем анимацию зума для слоя пикселей
                return;
            }
        });
        
        // Добавляем слой на карту
        this.pixelLayerInstance = new this.pixelLayer({
            tileSize: 256,
            opacity: 1,
            updateWhenIdle: false,
            updateWhenZooming: true,
            keepBuffer: 1,
            pane: 'overlayPane'
        });
        
        this.pixelLayerInstance.addTo(this.map);
        
        // Обработчики событий карты
        this.map.on('zoomend moveend', () => {
            // Перерисовка при изменении вида
            if (this.pixelLayerInstance) {
                this.pixelLayerInstance.redraw();
            }
        });
    }
    
    renderTile(ctx, coords, tileSize) {
        const zoom = coords.z;
        
        // Получаем границы тайла в географических координатах
        const tileBounds = this.getTileBounds(coords);
        const north = tileBounds.north;
        const south = tileBounds.south;
        const west = tileBounds.west;
        const east = tileBounds.east;
        
        // Размер пикселя в градусах
        const pixelSizeLat = this.PIXEL_SIZE_LAT;
        const pixelSizeLng = this.getPixelSizeLng(south);
        
        // Расширяем границы для отрисовки пикселей, выходящих за границы тайла
        const expandedNorth = north + pixelSizeLat;
        const expandedSouth = south - pixelSizeLat;
        const expandedWest = west - pixelSizeLng;
        const expandedEast = east + pixelSizeLng;
        
        // Определяем пиксели для отрисовки
        const startLat = Math.floor(expandedSouth / pixelSizeLat) * pixelSizeLat;
        const endLat = Math.ceil(expandedNorth / pixelSizeLat) * pixelSizeLat;
        const startLng = Math.floor(expandedWest / pixelSizeLng) * pixelSizeLng;
        const endLng = Math.ceil(expandedEast / pixelSizeLng) * pixelSizeLng;
        
        // Рисуем пиксели
        ctx.save();
        
        for (let lat = startLat; lat <= endLat; lat += pixelSizeLat) {
            for (let lng = startLng; lng <= endLng; lng += pixelSizeLng) {
                const key = this.getPixelKey(lat, lng);
                const pixelData = this.pixels.get(key);
                
                if (pixelData) {
                    this.drawPixelOnTile(ctx, lat, lng, pixelData, tileBounds, tileSize);
                }
            }
        }
        
        ctx.restore();
    }
    
    drawPixelOnTile(ctx, lat, lng, pixelData, tileBounds, tileSize) {
        const pixelSizeLat = this.PIXEL_SIZE_LAT;
        const pixelSizeLng = this.getPixelSizeLng(lat);
        
        // Вычисляем координаты пикселя в системе координат тайла
        const x1 = ((lng - tileBounds.west) / (tileBounds.east - tileBounds.west)) * tileSize.x;
        const y1 = ((tileBounds.north - lat - pixelSizeLat) / (tileBounds.north - tileBounds.south)) * tileSize.y;
        const x2 = ((lng + pixelSizeLng - tileBounds.west) / (tileBounds.east - tileBounds.west)) * tileSize.x;
        const y2 = ((tileBounds.north - lat) / (tileBounds.north - tileBounds.south)) * tileSize.y;
        
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        // Рисуем пиксель
        ctx.fillStyle = pixelData.color;
        ctx.globalAlpha = pixelData.opacity || 0.7;
        
        // Рисуем с небольшим расширением для устранения зазоров
        ctx.fillRect(
            Math.floor(x1) - 0.5,
            Math.floor(y1) - 0.5,
            Math.ceil(width) + 1,
            Math.ceil(height) + 1
        );
        
        ctx.globalAlpha = 1;
    }
    
    getTileBounds(coords) {
        const tileSize = 256;
        const zoom = coords.z;
        const x = coords.x;
        const y = coords.y;
        
        const n = Math.pow(2, zoom);
        
        const west = (x / n) * 360 - 180;
        const east = ((x + 1) / n) * 360 - 180;
        
        const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
        
        return { north, south, west, east };
    }
    
    getPixelSizeLng(lat) {
        // Корректируем размер пикселя по долготе в зависимости от широты
        return this.PIXEL_SIZE_LNG_EQUATOR / Math.cos(lat * Math.PI / 180);
    }
    
    getPixelKey(lat, lng) {
        // Округляем координаты до сетки пикселей
        const pixelSizeLng = this.getPixelSizeLng(lat);
        const gridLat = Math.floor(lat / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const gridLng = Math.floor(lng / pixelSizeLng) * pixelSizeLng;
        
        // Используем фиксированную точность для ключа
        return `${gridLat.toFixed(4)},${gridLng.toFixed(4)}`;
    }
    
    setupInteraction() {
        // Обработчик клика по карте
        this.map.on('click', (e) => {
            const now = Date.now();
            if (now - this.lastClickTime < this.clickCooldown) {
                return;
            }
            this.lastClickTime = now;
            
            // Добавляем пиксель точно в месте клика
            this.addPixelAtLatLng(e.latlng.lat, e.latlng.lng);
        });
        
        // Мобильные обработчики
        if (this.isMobile) {
            this.map.on('tap', (e) => {
                const now = Date.now();
                if (now - this.lastClickTime < this.clickCooldown) {
                    return;
                }
                this.lastClickTime = now;
                
                this.addPixelAtLatLng(e.latlng.lat, e.latlng.lng);
            });
        }
    }
    
    addPixelAtLatLng(lat, lng) {
        // Привязываем к сетке пикселей
        const pixelSizeLng = this.getPixelSizeLng(lat);
        const gridLat = Math.floor(lat / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const gridLng = Math.floor(lng / pixelSizeLng) * pixelSizeLng;
        
        const key = this.getPixelKey(gridLat, gridLng);
        
        // Сохраняем пиксель
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
        
        // Немедленно перерисовываем
        if (this.pixelLayerInstance) {
            this.pixelLayerInstance.redraw();
        }
        
        // Обновляем статистику
        this.updateLocalStats();
        
        // Визуальная обратная связь
        this.showPixelFeedback(gridLat, gridLng);
    }
    
    showPixelFeedback(lat, lng) {
        // Создаем временный круг для обратной связи
        const circle = L.circle([lat + this.PIXEL_SIZE_LAT/2, lng + this.getPixelSizeLng(lat)/2], {
            radius: 500,
            color: this.selectedColor,
            fillColor: this.selectedColor,
            fillOpacity: 0.8,
            weight: 2
        }).addTo(this.map);
        
        // Анимация исчезновения
        let opacity = 0.8;
        const fadeInterval = setInterval(() => {
            opacity -= 0.1;
            if (opacity <= 0) {
                clearInterval(fadeInterval);
                this.map.removeLayer(circle);
            } else {
                circle.setStyle({ fillOpacity: opacity, opacity: opacity });
            }
        }, 50);
    }
    
    scheduleBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        
        this.batchTimer = setTimeout(() => {
            this.sendBatch();
        }, this.batchDelay);
        
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
                this.showSyncStatus('✅ Сохранено', 'success');
            } else {
                pixels.forEach(p => {
                    this.pendingPixels.set(p.position, p);
                });
                this.showSyncStatus('❌ Ошибка сохранения', 'error');
            }
        } catch (error) {
            console.error('Ошибка отправки батча:', error);
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
            
            // Обновляем пиксели
            if (data.pixels && Array.isArray(data.pixels)) {
                data.pixels.forEach(pixel => {
                    if (pixel.position && pixel.color) {
                        this.pixels.set(pixel.position, {
                            color: pixel.color,
                            opacity: pixel.opacity || 0.7,
                            playerId: pixel.playerId || 'unknown'
                        });
                    }
                });
            }
            
            // Обновляем статистику
            if (data.stats) {
                this.updateStats(data.stats);
            }
            
            // Перерисовываем
            if (this.pixelLayerInstance) {
                this.pixelLayerInstance.redraw();
            }
            
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
        } finally {
            this.isSyncing = false;
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
                container.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                option.classList.add('selected');
                this.selectedColor = color.hex;
                
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
                const data = JSON.parse(saved);
                
                if (Array.isArray(data)) {
                    data.forEach(pixel => {
                        if (pixel && pixel.position && pixel.color) {
                            this.pixels.set(pixel.position, {
                                color: pixel.color,
                                opacity: pixel.opacity || 0.7,
                                playerId: pixel.playerId || this.playerId
                            });
                        }
                    });
                }
                
                this.updateLocalStats();
            } catch (e) {
                console.error('Ошибка загрузки локальных пикселей:', e);
                localStorage.removeItem('battleMapPixels');
            }
        }
        
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
        setTimeout(() => this.syncWithServer(), 2000);
        
        this.syncInterval = setInterval(() => {
            this.syncWithServer();
        }, this.syncDelay);
    }
    
    showSyncStatus(message, type = 'info') {
        const indicator = document.getElementById('syncIndicator');
        const text = document.getElementById('syncText');
        
        if (indicator && text) {
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
}

// Стили для анимации
const style = document.createElement('style');
style.textContent = `
    .leaflet-tile-pane {
        image-rendering: auto;
    }
    
    .leaflet-tile {
        image-rendering: auto;
    }
`;
document.head.appendChild(style);