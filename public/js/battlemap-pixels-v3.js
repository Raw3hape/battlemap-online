// BattleMap Pixels v3 - Исправление лагов и ошибок
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
        this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        // Защита от частых кликов
        this.lastClickTime = 0;
        this.clickCooldown = 50; // Уменьшаем до 50мс для более быстрого отклика
        
        // Упрощенный рендеринг без кэширования для устранения лагов
        this.renderTimer = null;
        
        this.init();
    }
    
    init() {
        console.log('Инициализация PixelBattleMap v3.0');
        
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
        // Настройки для уменьшения лагов
        const mapOptions = {
            center: [55.7558, 37.6173], // Москва
            zoom: 5,
            minZoom: 2,
            maxZoom: 15,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            zoomControl: true,
            attributionControl: false,
            preferCanvas: true,
            // Включаем анимации обратно для плавности
            zoomAnimation: !this.isIOS,
            fadeAnimation: !this.isIOS,
            markerZoomAnimation: false
        };
        
        this.map = L.map('map', mapOptions);
        
        // Базовая карта
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
            minZoom: 2,
            attribution: '© OpenStreetMap',
            updateWhenIdle: false,
            updateWhenZooming: true,
            keepBuffer: 2
        }).addTo(this.map);
        
        // Контролы
        L.control.zoom({
            position: 'bottomright'
        }).addTo(this.map);
    }
    
    createPixelLayer() {
        const self = this;
        
        // Упрощенный GridLayer без кэширования
        this.pixelLayer = L.GridLayer.extend({
            createTile: function(coords) {
                const tile = document.createElement('canvas');
                const size = this.getTileSize();
                tile.width = size.x;
                tile.height = size.y;
                
                const ctx = tile.getContext('2d', { 
                    alpha: true,
                    willReadFrequently: false 
                });
                
                // Рендерим сразу без очереди
                self.renderTile(ctx, coords, size);
                
                return tile;
            }
        });
        
        // Добавляем слой на карту
        this.pixelLayerInstance = new this.pixelLayer({
            tileSize: 256,
            opacity: 1,
            updateWhenIdle: false,
            updateWhenZooming: true,
            keepBuffer: 2
        });
        
        this.pixelLayerInstance.addTo(this.map);
        
        // Упрощенные обработчики событий
        this.map.on('zoomend moveend', () => {
            // Перерисовка происходит автоматически через GridLayer
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
        
        // На малых зумах группируем пиксели для производительности
        if (zoom <= 4) {
            this.renderGroupedPixels(ctx, coords, tileSize, nwPoint, sePoint);
            return;
        }
        
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
    
    renderGroupedPixels(ctx, coords, tileSize, nwPoint, sePoint) {
        // Упрощенный рендеринг для малых зумов
        const groupSize = 5; // Группируем по 5x5 пикселей
        const effectivePixelSize = this.PIXEL_SIZE_LAT * groupSize;
        
        const startLat = Math.floor(sePoint.lat / effectivePixelSize) * effectivePixelSize;
        const endLat = Math.ceil(nwPoint.lat / effectivePixelSize) * effectivePixelSize;
        const startLng = Math.floor(nwPoint.lng / effectivePixelSize) * effectivePixelSize;
        const endLng = Math.ceil(sePoint.lng / effectivePixelSize) * effectivePixelSize;
        
        // Собираем группы
        const groups = new Map();
        
        for (let lat = startLat; lat <= endLat; lat += effectivePixelSize) {
            for (let lng = startLng; lng <= endLng; lng += effectivePixelSize) {
                let hasPixels = false;
                let dominantColor = null;
                let maxCount = 0;
                const colorCounts = new Map();
                
                // Проверяем все пиксели в группе
                for (let dlat = 0; dlat < groupSize; dlat++) {
                    for (let dlng = 0; dlng < groupSize; dlng++) {
                        const checkLat = lat + dlat * this.PIXEL_SIZE_LAT;
                        const checkLng = lng + dlng * this.PIXEL_SIZE_LAT;
                        const key = this.getPixelKey(checkLat, checkLng);
                        const pixelData = this.pixels.get(key);
                        
                        if (pixelData) {
                            hasPixels = true;
                            const count = (colorCounts.get(pixelData.color) || 0) + 1;
                            colorCounts.set(pixelData.color, count);
                            
                            if (count > maxCount) {
                                maxCount = count;
                                dominantColor = pixelData.color;
                            }
                        }
                    }
                }
                
                if (hasPixels && dominantColor) {
                    this.drawPixel(ctx, lat, lng, 
                        { color: dominantColor, opacity: 0.7 }, 
                        coords, tileSize, effectivePixelSize);
                }
            }
        }
    }
    
    drawPixel(ctx, lat, lng, pixelData, coords, tileSize, customSize = null) {
        const zoom = coords.z;
        const effectivePixelSize = customSize || this.PIXEL_SIZE_LAT;
        
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
            this.handleMapClick(e.latlng.lat, e.latlng.lng);
        });
        
        // Мобильные обработчики
        if (this.isMobile) {
            let tapTimeout = null;
            
            this.map.on('tap', (e) => {
                // Предотвращаем двойные тапы
                if (tapTimeout) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                    return;
                }
                
                tapTimeout = setTimeout(() => {
                    this.handleMapClick(e.latlng.lat, e.latlng.lng);
                    tapTimeout = null;
                }, 100);
            });
        }
    }
    
    handleMapClick(lat, lng) {
        const now = Date.now();
        if (now - this.lastClickTime < this.clickCooldown) {
            return; // Игнорируем слишком частые клики
        }
        this.lastClickTime = now;
        
        this.addPixel(lat, lng);
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
        
        // Немедленно перерисовываем слой
        if (this.pixelLayerInstance) {
            this.pixelLayerInstance.redraw();
        }
        
        // Обновляем статистику
        this.updateLocalStats();
        
        // Визуальная обратная связь (упрощенная)
        this.showPixelFeedback(lat, lng);
    }
    
    showPixelFeedback(lat, lng) {
        // Простая визуальная обратная связь без создания маркера
        const point = this.map.latLngToContainerPoint([lat, lng]);
        
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            left: ${point.x - 10}px;
            top: ${point.y - 10}px;
            width: 20px;
            height: 20px;
            background: ${this.selectedColor};
            border: 2px solid white;
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            animation: pixelPulse 0.5s ease-out;
        `;
        
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            document.body.removeChild(feedback);
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
            
            // Перерисовываем слой
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
                const data = JSON.parse(saved);
                
                // Проверяем, что это массив
                if (Array.isArray(data)) {
                    data.forEach(pixel => {
                        if (pixel && pixel.position && pixel.color) {
                            this.pixels.set(pixel.position, {
                                color: pixel.color,
                                opacity: pixel.opacity || 0.6,
                                playerId: pixel.playerId || this.playerId
                            });
                        }
                    });
                } else if (data && typeof data === 'object') {
                    // Если это объект, пробуем преобразовать
                    Object.entries(data).forEach(([key, pixel]) => {
                        if (pixel && pixel.color) {
                            this.pixels.set(key, {
                                color: pixel.color,
                                opacity: pixel.opacity || 0.6,
                                playerId: pixel.playerId || this.playerId
                            });
                        }
                    });
                }
                
                this.updateLocalStats();
            } catch (e) {
                console.error('Ошибка загрузки локальных пикселей:', e);
                // Очищаем поврежденные данные
                localStorage.removeItem('battleMapPixels');
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
    @keyframes pixelPulse {
        0% {
            transform: scale(1);
            opacity: 1;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);