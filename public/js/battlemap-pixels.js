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
        this.syncDelay = 30000;
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
        
        // Определяем размер пикселя в зависимости от зума
        const pixelSizeMultiplier = Math.max(1, Math.pow(2, Math.max(0, 8 - zoom)));
        const effectivePixelSize = this.PIXEL_SIZE_LAT * pixelSizeMultiplier;
        
        // Рендерим пиксели в пределах тайла
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
                        
                        // Рисуем пиксель
                        ctx.fillStyle = pixelData.color;
                        ctx.globalAlpha = pixelData.opacity;
                        ctx.fillRect(point1.x, point1.y, width, height);
                        
                        // Рисуем границу для четкости
                        if (zoom >= 8) {
                            ctx.globalAlpha = 1;
                            ctx.strokeStyle = pixelData.color;
                            ctx.lineWidth = 0.5;
                            ctx.strokeRect(point1.x, point1.y, width, height);
                        }
                    }
                }
            }
        }
        
        ctx.globalAlpha = 1;
    }
    
    getPixelAt(lat, lng, size) {
        // Проверяем точное совпадение
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (this.pixels.has(key)) {
            return this.pixels.get(key);
        }
        
        // Для низких зумов проверяем соседние пиксели
        if (size > this.PIXEL_SIZE_LAT) {
            const steps = Math.round(size / this.PIXEL_SIZE_LAT);
            for (let dlat = 0; dlat < steps; dlat++) {
                for (let dlng = 0; dlng < steps; dlng++) {
                    const checkLat = lat + dlat * this.PIXEL_SIZE_LAT;
                    const checkLng = lng + dlng * this.PIXEL_SIZE_LAT;
                    const checkKey = `${checkLat.toFixed(4)},${checkLng.toFixed(4)}`;
                    if (this.pixels.has(checkKey)) {
                        return this.pixels.get(checkKey);
                    }
                }
            }
        }
        
        return null;
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
    
    setupInteraction() {
        const mapContainer = this.map.getContainer();
        
        // Обработка кликов
        this.map.on('click', (e) => {
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
        
        // Создаем данные пикселя
        const pixelData = {
            color: this.selectedColor,
            opacity: this.selectedOpacity,
            playerId: this.playerId,
            timestamp: Date.now()
        };
        
        // Сохраняем локально
        this.pixels.set(pixelKey, pixelData);
        
        // Добавляем в батч для отправки на сервер
        this.pendingPixels.set(pixelKey, pixelData);
        
        // Перерисовываем слой
        this.pixelLayerInstance.redraw();
        
        // Обновляем статистику
        this.updateStats();
        
        // Запускаем батч таймер
        this.scheduleBatch();
        
        // Визуальный эффект
        this.showPlaceEffect(latlng);
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
        
        // Добавляем цвета
        const colorsDiv = paletteContainer.querySelector('.palette-colors');
        this.colorPalette.forEach((color, index) => {
            const colorBtn = document.createElement('button');
            colorBtn.className = 'color-btn';
            colorBtn.style.background = color.hex;
            colorBtn.title = color.name;
            colorBtn.dataset.color = color.hex;
            
            if (index === 0) colorBtn.classList.add('active');
            
            colorBtn.addEventListener('click', () => {
                document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
                colorBtn.classList.add('active');
                this.selectedColor = color.hex;
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
            const response = await fetch('/api/pixels-batch', {
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
        
        try {
            const response = await fetch('/api/pixels-state');
            if (response.ok) {
                const data = await response.json();
                
                if (data.pixels && Array.isArray(data.pixels)) {
                    let newPixels = 0;
                    data.pixels.forEach(pixel => {
                        if (!this.pixels.has(pixel.position)) {
                            this.pixels.set(pixel.position, {
                                color: pixel.color,
                                opacity: pixel.opacity,
                                playerId: pixel.playerId
                            });
                            newPixels++;
                        }
                    });
                    
                    if (newPixels > 0) {
                        this.pixelLayerInstance.redraw();
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
        }
    }
    
    startPeriodicSync() {
        this.syncInterval = setInterval(() => this.syncWithServer(), this.syncDelay);
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
        
        container.innerHTML = colors.map((color, index) => `
            <div class="country-item">
                <span>${index + 1}. <span style="display:inline-block;width:20px;height:20px;background:${color.hex};vertical-align:middle;border-radius:2px;"></span> ${color.name}</span>
                <span class="country-cells">${color.count} пикселей</span>
            </div>
        `).join('');
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
    }
    
    .palette-opacity input {
        width: 100%;
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