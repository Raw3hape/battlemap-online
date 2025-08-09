// BattleMap Pixels - Цветные пиксели вместо тумана
class PixelBattleMap {
    constructor() {
        this.map = null;
        this.pixelLayer = null;
        this.gridLayer = null;
        
        // Размеры пикселя (10км)
        this.PIXEL_SIZE_KM = 10;
        this.PIXEL_SIZE_LAT = 10 / 111;
        
        // Хранилище пикселей: Map<"lat,lng", {color: string, opacity: number, playerId: string}>
        this.pixels = new Map();
        
        // Текущий выбранный цвет
        this.selectedColor = '#FF0000'; // Красный по умолчанию
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
        this.batchDelay = 1000;
        
        // Синхронизация
        this.syncInterval = null;
        this.syncDelay = 10000; // Синхронизация каждые 10 секунд
        this.isSyncing = false;
        
        // Тема
        this.theme = localStorage.getItem('battleMapTheme') || 'dark';
        
        // Определение устройства
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        this.init();
    }
    
    init() {
        console.log('Инициализация PixelBattleMap v0.2.0');
        
        this.initMap();
        this.createPixelLayer();
        this.setupInteraction();
        this.createColorPalette();
        this.applyTheme(this.theme);
        
        // Инициализация после готовности карты
        this.map.whenReady(async () => {
            this.loadLocalPixels();
            await this.syncWithServer();
            this.startPeriodicSync();
            this.setupUIEventHandlers();
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
            preferCanvas: true
        });
        
        // Базовая карта
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15,
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
                
                const ctx = tile.getContext('2d');
                self.renderTile(ctx, coords, size);
                
                return tile;
            }
        });
        
        // Добавляем слой на карту
        this.pixelLayerInstance = new this.pixelLayer({
            tileSize: 256,
            opacity: 1,
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 2
        });
        
        this.pixelLayerInstance.addTo(this.map);
    }
    
    renderTile(ctx, coords, tileSize) {
        const zoom = coords.z;
        const tileX = coords.x;
        const tileY = coords.y;
        
        // Конвертируем координаты тайла в географические
        const nwPoint = this.getTileLatLng(tileX, tileY, zoom);
        const sePoint = this.getTileLatLng(tileX + 1, tileY + 1, zoom);
        
        const effectivePixelSize = this.PIXEL_SIZE_LAT;
        
        // На очень малых зумах сначала считаем плотность пикселей
        if (zoom <= 5) {
            const densityMap = this.calculatePixelDensity(nwPoint, sePoint, zoom);
            this.renderWithDensity(ctx, coords, tileSize, densityMap, zoom);
            return;
        }
        
        // Для средних и больших зумов - обычный рендеринг
        const startLat = Math.floor(sePoint.lat / effectivePixelSize) * effectivePixelSize;
        const endLat = Math.ceil(nwPoint.lat / effectivePixelSize) * effectivePixelSize;
        const startLng = Math.floor(nwPoint.lng / effectivePixelSize) * effectivePixelSize;
        const endLng = Math.ceil(sePoint.lng / effectivePixelSize) * effectivePixelSize;
        
        for (let lat = startLat; lat <= endLat; lat += effectivePixelSize) {
            for (let lng = startLng; lng <= endLng; lng += effectivePixelSize) {
                // Проверяем есть ли пиксель в этой позиции
                const pixelData = this.getPixelAt(lat, lng, effectivePixelSize);
                if (pixelData) {
                    // Конвертируем географические координаты в пиксели тайла
                    const point1 = this.latLngToTilePixel(lat + effectivePixelSize, lng, coords, tileSize);
                    const point2 = this.latLngToTilePixel(lat, lng + effectivePixelSize, coords, tileSize);
                    
                    if (point1 && point2) {
                        const width = Math.abs(point2.x - point1.x);
                        const height = Math.abs(point2.y - point1.y);
                        
                        // Средние зумы - маленькие квадраты
                        if (zoom <= 7) {
                            ctx.fillStyle = pixelData.color;
                            ctx.globalAlpha = pixelData.opacity;
                            const size = Math.min(width, height, 8);
                            const centerX = point1.x + (width - size) / 2;
                            const centerY = point1.y + (height - size) / 2;
                            ctx.fillRect(centerX, centerY, size, size);
                        } else {
                            // Полноразмерные пиксели
                            ctx.fillStyle = pixelData.color;
                            ctx.globalAlpha = pixelData.opacity;
                            ctx.fillRect(point1.x, point1.y, width, height);
                            
                            // Рисуем границу для четкости на высоких зумах
                            if (zoom >= 10) {
                                ctx.globalAlpha = 1;
                                ctx.strokeStyle = pixelData.color;
                                ctx.lineWidth = 0.5;
                                ctx.strokeRect(point1.x, point1.y, width, height);
                            }
                        }
                    }
                }
            }
        }
        
        ctx.globalAlpha = 1;
    }
    
    getPixelAt(lat, lng, size) {
        // Проверяем только точное совпадение - не группируем пиксели
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (this.pixels.has(key)) {
            return this.pixels.get(key);
        }
        return null;
    }
    
    // Расчет плотности пикселей для области
    calculatePixelDensity(nwPoint, sePoint, zoom) {
        const densityMap = new Map();
        
        // Размер ячейки для группировки в градусах
        // Чем меньше зум, тем больше ячейка
        const cellSize = zoom <= 2 ? 5 : zoom <= 3 ? 2 : zoom <= 4 ? 1 : 0.5;
        
        // Минимальное количество пикселей для отображения
        const minPixelsForVisibility = zoom <= 2 ? 25 : zoom <= 3 ? 15 : zoom <= 4 ? 8 : 3;
        
        // Проходим по всем пикселям и группируем их
        this.pixels.forEach((pixelData, key) => {
            const [lat, lng] = key.split(',').map(Number);
            
            // Проверяем, попадает ли пиксель в видимую область
            if (lat >= sePoint.lat && lat <= nwPoint.lat && 
                lng >= nwPoint.lng && lng <= sePoint.lng) {
                
                // Определяем ячейку для группировки
                const cellLat = Math.floor(lat / cellSize) * cellSize;
                const cellLng = Math.floor(lng / cellSize) * cellSize;
                const cellKey = `${cellLat},${cellLng}`;
                
                if (!densityMap.has(cellKey)) {
                    densityMap.set(cellKey, {
                        pixels: [],
                        colors: new Map(),
                        centerLat: cellLat + cellSize / 2,
                        centerLng: cellLng + cellSize / 2
                    });
                }
                
                const cell = densityMap.get(cellKey);
                cell.pixels.push({ lat, lng, ...pixelData });
                
                // Считаем цвета
                const colorCount = cell.colors.get(pixelData.color) || 0;
                cell.colors.set(pixelData.color, colorCount + 1);
            }
        });
        
        // Фильтруем ячейки с недостаточным количеством пикселей
        const filteredMap = new Map();
        densityMap.forEach((cell, key) => {
            if (cell.pixels.length >= minPixelsForVisibility) {
                // Определяем доминирующий цвет
                let dominantColor = null;
                let maxCount = 0;
                cell.colors.forEach((count, color) => {
                    if (count > maxCount) {
                        maxCount = count;
                        dominantColor = color;
                    }
                });
                cell.dominantColor = dominantColor;
                filteredMap.set(key, cell);
            }
        });
        
        return filteredMap;
    }
    
    // Рендеринг с учетом плотности
    renderWithDensity(ctx, coords, tileSize, densityMap, zoom) {
        densityMap.forEach(cell => {
            // Для больших групп пикселей рисуем все пиксели, а не только центр
            if (zoom >= 4 && cell.pixels.length > 3) {
                // Рисуем каждый пиксель в группе для сохранения формы
                cell.pixels.forEach(pixel => {
                    const point = this.latLngToTilePixel(pixel.lat, pixel.lng, coords, tileSize);
                    if (point) {
                        const size = zoom <= 5 ? 3 : zoom <= 6 ? 4 : 5;
                        ctx.fillStyle = pixel.color;
                        ctx.globalAlpha = pixel.opacity || 0.6;
                        ctx.fillRect(point.x - size/2, point.y - size/2, size, size);
                    }
                });
            } else {
                // Для малых зумов рисуем обобщенное представление
                const point = this.latLngToTilePixel(cell.centerLat, cell.centerLng, coords, tileSize);
                
                if (point) {
                    // Размер зависит от количества пикселей и зума
                    const baseSize = Math.min(15, 3 + Math.sqrt(cell.pixels.length * 2));
                    const size = zoom <= 2 ? baseSize * 0.8 : zoom <= 3 ? baseSize : baseSize * 1.2;
                    
                    // Прозрачность зависит от плотности
                    const opacity = Math.min(0.9, 0.4 + (cell.pixels.length / 30));
                    
                    ctx.fillStyle = cell.dominantColor;
                    ctx.globalAlpha = opacity;
                    
                    if (zoom <= 2) {
                        // Круги для очень малых зумов
                        ctx.beginPath();
                        ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        // Квадраты для средних зумов
                        ctx.fillRect(point.x - size/2, point.y - size/2, size, size);
                    }
                }
            }
        });
        
        ctx.globalAlpha = 1;
    }
    
    getTileLatLng(tileX, tileY, zoom) {
        const n = Math.pow(2, zoom);
        const lng = (tileX / n) * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n))) * 180 / Math.PI;
        return { lat, lng };
    }
    
    latLngToTilePixel(lat, lng, coords, tileSize) {
        const zoom = coords.z;
        const scale = Math.pow(2, zoom);
        
        // Конвертируем lat/lng в мировые координаты
        const worldPoint = this.map.project([lat, lng], zoom);
        
        // Конвертируем в координаты тайла
        const tilePoint = {
            x: worldPoint.x - coords.x * tileSize.x,
            y: worldPoint.y - coords.y * tileSize.y
        };
        
        // Проверяем, что точка внутри тайла
        if (tilePoint.x >= 0 && tilePoint.x <= tileSize.x &&
            tilePoint.y >= 0 && tilePoint.y <= tileSize.y) {
            return tilePoint;
        }
        
        return null;
    }
    
    setupUIEventHandlers() {
        // Предотвращаем всплытие событий от всех UI элементов
        const uiElements = [
            '.menu-button',
            '.side-menu',
            '.ui-container',
            '.stats',
            '.online-stats',
            '.controls',
            '.top-countries',
            '.logs-panel',
            '.sync-status'
        ];
        
        uiElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                element.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });
                element.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                }, { passive: true });
            });
        });
        
        // Обеспечиваем работу кнопки меню
        const menuButton = document.querySelector('.menu-button');
        if (menuButton) {
            menuButton.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.toggleMenu();
            };
        }
    }
    
    setupInteraction() {
        const mapContainer = this.map.getContainer();
        
        // Обработка кликов с проверкой UI элементов
        this.map.on('click', (e) => {
            // Проверяем, не был ли клик на UI элементе
            const target = e.originalEvent?.target;
            if (target) {
                // Если клик был на UI элементе, не обрабатываем
                if (target.closest('.color-palette') ||
                    target.closest('.side-menu') ||
                    target.closest('.menu-button') ||
                    target.closest('.ui-container') ||
                    target.closest('.controls') ||
                    target.closest('.stats') ||
                    target.closest('.online-stats') ||
                    target.closest('.top-countries') ||
                    target.closest('.logs-panel')) {
                    return;
                }
            }
            this.handlePixelPlace(e.latlng);
        });
        
        // Hover эффект для десктопа
        if (!this.isMobile) {
            this.map.on('mousemove', (e) => {
                this.showHoverPreview(e.latlng);
            });
            
            this.map.on('mouseout', () => {
                this.hideHoverPreview();
            });
        }
    }
    
    handlePixelPlace(latlng) {
        // Округляем координаты до сетки пикселей
        const pixelLat = Math.floor(latlng.lat / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const pixelLng = Math.floor(latlng.lng / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const pixelKey = `${pixelLat.toFixed(4)},${pixelLng.toFixed(4)}`;
        
        console.log(`Размещение пикселя: ${pixelKey}, цвет: ${this.selectedColor}`);
        
        // Создаем данные пикселя
        const pixelData = {
            color: this.selectedColor,
            opacity: this.selectedOpacity,
            playerId: this.playerId,
            timestamp: Date.now()
        };
        
        // Сохраняем локально (перезаписываем если уже есть)
        this.pixels.set(pixelKey, pixelData);
        
        // Добавляем в батч для отправки на сервер
        this.pendingPixels.set(pixelKey, pixelData);
        
        // Немедленно перерисовываем слой
        if (this.pixelLayerInstance) {
            this.pixelLayerInstance.redraw();
        }
        
        // Обновляем статистику
        this.updateStats();
        
        // Запускаем батч таймер (отправка на сервер)
        this.scheduleBatch();
        
        // Визуальный эффект подтверждения
        this.showPlaceEffect(latlng);
        
        // Сохраняем локально в localStorage для персистентности
        this.saveLocalPixels();
    }
    
    showPlaceEffect(latlng) {
        const point = this.map.latLngToContainerPoint(latlng);
        const effect = document.createElement('div');
        effect.style.cssText = `
            position: fixed;
            left: ${point.x}px;
            top: ${point.y}px;
            width: 30px;
            height: 30px;
            margin: -15px 0 0 -15px;
            background: ${this.selectedColor};
            opacity: ${this.selectedOpacity};
            border-radius: 4px;
            pointer-events: none;
            z-index: 10000;
            transform: scale(0);
            animation: pixelPlace 0.3s ease-out;
        `;
        document.body.appendChild(effect);
        setTimeout(() => effect.remove(), 300);
    }
    
    createColorPalette() {
        const paletteContainer = document.createElement('div');
        paletteContainer.className = 'color-palette';
        paletteContainer.innerHTML = `
            <div class="palette-header">🎨 Цвета</div>
            <div class="palette-colors"></div>
            <div class="palette-opacity">
                <label>Прозрачность: <span id="opacityValue">60%</span></label>
                <input type="range" id="opacitySlider" min="20" max="90" value="60" step="10">
            </div>
        `;
        
        // Предотвращаем всплытие событий от палитры к карте
        paletteContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        paletteContainer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        paletteContainer.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        });
        
        // Добавляем цвета
        const colorsDiv = paletteContainer.querySelector('.palette-colors');
        this.colorPalette.forEach((color, index) => {
            const colorBtn = document.createElement('button');
            colorBtn.className = 'color-btn';
            colorBtn.style.background = color.hex;
            colorBtn.title = color.name;
            colorBtn.dataset.color = color.hex;
            
            if (index === 0) colorBtn.classList.add('active');
            
            colorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
                colorBtn.classList.add('active');
                this.selectedColor = color.hex;
                console.log('Выбран цвет:', color.name, color.hex);
            });
            
            colorsDiv.appendChild(colorBtn);
        });
        
        // Слайдер прозрачности
        const opacitySlider = paletteContainer.querySelector('#opacitySlider');
        const opacityValue = paletteContainer.querySelector('#opacityValue');
        
        opacitySlider.addEventListener('input', (e) => {
            const value = e.target.value;
            this.selectedOpacity = value / 100;
            opacityValue.textContent = `${value}%`;
        });
        
        document.querySelector('.ui-container').appendChild(paletteContainer);
    }
    
    showHoverPreview(latlng) {
        // Показываем превью пикселя при наведении
        const pixelLat = Math.floor(latlng.lat / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        const pixelLng = Math.floor(latlng.lng / this.PIXEL_SIZE_LAT) * this.PIXEL_SIZE_LAT;
        
        if (!this.hoverRectangle) {
            this.hoverRectangle = L.rectangle(
                [[pixelLat, pixelLng], [pixelLat + this.PIXEL_SIZE_LAT, pixelLng + this.PIXEL_SIZE_LAT]],
                {
                    color: this.selectedColor,
                    weight: 2,
                    opacity: 0.8,
                    fillColor: this.selectedColor,
                    fillOpacity: this.selectedOpacity * 0.5,
                    interactive: false
                }
            ).addTo(this.map);
        } else {
            this.hoverRectangle.setBounds([[pixelLat, pixelLng], [pixelLat + this.PIXEL_SIZE_LAT, pixelLng + this.PIXEL_SIZE_LAT]]);
            this.hoverRectangle.setStyle({
                color: this.selectedColor,
                fillColor: this.selectedColor,
                fillOpacity: this.selectedOpacity * 0.5
            });
        }
    }
    
    hideHoverPreview() {
        if (this.hoverRectangle) {
            this.map.removeLayer(this.hoverRectangle);
            this.hoverRectangle = null;
        }
    }
    
    scheduleBatch() {
        if (this.batchTimer) clearTimeout(this.batchTimer);
        this.batchTimer = setTimeout(() => this.sendBatch(), this.batchDelay);
    }
    
    async sendBatch() {
        if (this.pendingPixels.size === 0) return;
        
        const batch = Array.from(this.pendingPixels.entries()).map(([key, data]) => ({
            position: key,
            ...data
        }));
        
        this.pendingPixels.clear();
        
        try {
            // Используем новый API с определением стран
            const response = await fetch('/api/pixels-batch-geo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pixels: batch,
                    playerId: this.playerId
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Пиксели отправлены:', data);
                
                // Запускаем синхронизацию через 2 секунды после отправки
                setTimeout(() => {
                    this.syncWithServer();
                }, 2000);
            }
        } catch (error) {
            console.error('Ошибка отправки пикселей:', error);
            // Возвращаем пиксели в очередь
            batch.forEach(pixel => {
                const { position, ...data } = pixel;
                this.pendingPixels.set(position, data);
            });
        }
    }
    
    async syncWithServer() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        
        // Показываем индикатор синхронизации
        const syncStatus = document.getElementById('syncStatus');
        if (syncStatus) {
            syncStatus.style.display = 'block';
            syncStatus.textContent = '🔄 Синхронизация...';
        }
        
        try {
            const response = await fetch('/api/pixels-state');
            if (response.ok) {
                const data = await response.json();
                
                if (data.pixels && Array.isArray(data.pixels)) {
                    let changedPixels = 0;
                    let updatedPixels = 0;
                    let skippedPixels = 0;
                    
                    // НЕ очищаем существующие пиксели! Обновляем и добавляем новые
                    data.pixels.forEach(pixel => {
                        // Проверяем полноту данных
                        if (!pixel.position || !pixel.color || pixel.opacity === undefined) {
                            console.warn('Пропущен пиксель с неполными данными:', pixel);
                            skippedPixels++;
                            return;
                        }
                        
                        const existingPixel = this.pixels.get(pixel.position);
                        
                        // Проверяем, изменился ли пиксель
                        if (!existingPixel || 
                            existingPixel.color !== pixel.color || 
                            existingPixel.opacity !== pixel.opacity) {
                            
                            this.pixels.set(pixel.position, {
                                color: pixel.color,
                                opacity: pixel.opacity || 0.6,
                                playerId: pixel.playerId || 'unknown'
                            });
                            
                            if (existingPixel) {
                                updatedPixels++;
                            } else {
                                changedPixels++;
                            }
                        }
                    });
                    
                    if (changedPixels > 0 || updatedPixels > 0) {
                        console.log(`Синхронизация: ${changedPixels} новых, ${updatedPixels} обновленных пикселей`);
                        
                        // Перерисовываем только если есть изменения
                        if (this.pixelLayerInstance) {
                            this.pixelLayerInstance.redraw();
                        }
                    }
                }
                
                // Обновляем статистику
                if (data.stats) {
                    this.updateGlobalStats(data.stats);
                }
            }
        } catch (error) {
            console.error('Ошибка синхронизации:', error);
        } finally {
            this.isSyncing = false;
            
            // Скрываем индикатор синхронизации
            const syncStatus = document.getElementById('syncStatus');
            if (syncStatus) {
                setTimeout(() => {
                    syncStatus.style.display = 'none';
                }, 1000);
            }
        }
    }
    
    startPeriodicSync() {
        this.syncInterval = setInterval(() => this.syncWithServer(), this.syncDelay);
        
        // Синхронизация при возвращении на вкладку
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('Вкладка активна, синхронизируем...');
                this.syncWithServer();
            }
        });
        
        // Синхронизация при фокусе окна
        window.addEventListener('focus', () => {
            console.log('Окно в фокусе, синхронизируем...');
            this.syncWithServer();
        });
    }
    
    loadLocalPixels() {
        try {
            const saved = localStorage.getItem('battleMapPixels');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.pixels && Array.isArray(data.pixels)) {
                    data.pixels.forEach(pixel => {
                        this.pixels.set(pixel.position, {
                            color: pixel.color,
                            opacity: pixel.opacity,
                            playerId: pixel.playerId
                        });
                    });
                    this.pixelLayerInstance.redraw();
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки локальных пикселей:', error);
        }
    }
    
    saveLocalPixels() {
        const pixelsArray = Array.from(this.pixels.entries()).map(([position, data]) => ({
            position,
            ...data
        }));
        
        localStorage.setItem('battleMapPixels', JSON.stringify({
            pixels: pixelsArray,
            timestamp: Date.now()
        }));
    }
    
    updateStats() {
        const myPixels = Array.from(this.pixels.values()).filter(p => p.playerId === this.playerId).length;
        const totalPixels = this.pixels.size;
        
        document.getElementById('cellsRevealed').textContent = myPixels;
        document.getElementById('areaRevealed').textContent = myPixels * 100; // км²
        document.getElementById('totalCells').textContent = totalPixels;
    }
    
    updateGlobalStats(stats) {
        if (stats.totalPixels !== undefined) {
            document.getElementById('totalCells').textContent = stats.totalPixels;
        }
        if (stats.onlinePlayers !== undefined) {
            document.getElementById('onlinePlayers').textContent = stats.onlinePlayers;
        }
        if (stats.topColors && Array.isArray(stats.topColors)) {
            this.updateTopColors(stats.topColors);
        }
    }
    
    updateTopColors(colors) {
        const container = document.getElementById('countriesList');
        if (!container) return;
        
        container.innerHTML = colors.map((color, index) => {
            // Формируем список захваченных стран с правильными процентами
            const countriesText = color.countries && color.countries.length > 0
                ? color.countries.map(c => {
                    // Используем отформатированный процент с сервера
                    const percentDisplay = c.percentageFormatted || 
                        (c.percentage < 0.01 ? `${c.percentage.toFixed(6)}%` : `${c.percentage.toFixed(2)}%`);
                    return `${c.name} (${percentDisplay})`;
                }).join(', ')
                : 'Нет захватов';
            
            return `
                <div class="country-item" style="margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${index + 1}.</span>
                        <span style="display:inline-block;width:20px;height:20px;background:${color.color};border-radius:2px;"></span>
                        <span style="flex: 1;">
                            <strong>${color.name}</strong>
                            <div style="font-size: 10px; opacity: 0.8;">${color.totalPixels} пикселей</div>
                            <div style="font-size: 9px; opacity: 0.6;">${countriesText}</div>
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    getOrCreatePlayerId() {
        let playerId = localStorage.getItem('battleMapPlayerId');
        if (!playerId) {
            playerId = 'player_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('battleMapPlayerId', playerId);
        }
        return playerId;
    }
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.theme = theme;
        localStorage.setItem('battleMapTheme', theme);
    }
    
    // Публичные методы
    toggleTheme() {
        const newTheme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
    }
    
    toggleMenu() {
        const menu = document.getElementById('sideMenu');
        if (menu) {
            menu.classList.toggle('active');
        }
    }
    
    clearPixels() {
        if (confirm('Удалить все ваши пиксели?')) {
            // Удаляем только пиксели текущего пользователя
            const toDelete = [];
            this.pixels.forEach((data, key) => {
                if (data.playerId === this.playerId) {
                    toDelete.push(key);
                }
            });
            
            toDelete.forEach(key => this.pixels.delete(key));
            this.pixelLayerInstance.redraw();
            this.saveLocalPixels();
            this.updateStats();
        }
    }
}

// CSS для палитры и эффектов
const style = document.createElement('style');
style.textContent = `
    @keyframes pixelPlace {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(1.5);
            opacity: 0;
        }
    }
    
    .color-palette {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--panel-bg);
        border-radius: 12px;
        padding: 10px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: auto !important;
    }
    
    .palette-header {
        font-size: 14px;
        font-weight: bold;
        text-align: center;
        color: var(--text-color);
    }
    
    .palette-colors {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
    }
    
    .color-btn {
        width: 32px;
        height: 32px;
        border: 2px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        pointer-events: auto !important;
    }
    
    .color-btn:hover {
        transform: scale(1.1);
    }
    
    .color-btn.active {
        border-color: white;
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
    }
    
    .palette-opacity {
        display: flex;
        flex-direction: column;
        gap: 5px;
        color: var(--text-color);
        font-size: 12px;
        pointer-events: auto !important;
    }
    
    .palette-opacity input {
        width: 100%;
        pointer-events: auto !important;
        cursor: pointer;
    }
    
    @media (max-width: 768px) {
        .color-palette {
            bottom: 80px;
            width: 90%;
            max-width: 320px;
        }
    }
`;
document.head.appendChild(style);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('Запуск PixelBattleMap');
    window.battleMap = new PixelBattleMap();
});