class BattleMap {
    constructor() {
        this.map = null;
        this.currentLayer = null;
        this.fogLayer = null;
        this.revealedAreas = [];
        this.revealRadius = 50000; // Радиус раскрытия в метрах
        
        this.tileLayers = {
            osm: {
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: '© OpenStreetMap contributors',
                name: 'OpenStreetMap Standard'
            },
            topo: {
                url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
                attribution: '© OpenTopoMap',
                name: 'OpenTopoMap'
            },
            cycle: {
                url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
                attribution: '© CyclOSM | © OpenStreetMap',
                name: 'CyclOSM'
            },
            toner: {
                url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png',
                attribution: '© Stamen Design | © OpenStreetMap',
                name: 'Stamen Toner'
            },
            watercolor: {
                url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/watercolor/{z}/{x}/{y}.jpg',
                attribution: '© Stamen Design | © OpenStreetMap',
                name: 'Stamen Watercolor'
            },
            positron: {
                url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                attribution: '© CartoDB | © OpenStreetMap',
                name: 'CartoDB Positron'
            },
            dark: {
                url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                attribution: '© CartoDB | © OpenStreetMap',
                name: 'CartoDB Dark Matter'
            },
            satellite: {
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                attribution: '© ESRI',
                name: 'ESRI World Imagery'
            }
        };
        
        this.init();
    }
    
    init() {
        this.setupMap();
        // Ждем полной инициализации карты
        this.map.whenReady(() => {
            this.setupFog();
            this.setupEventListeners();
            this.loadProgress();
            this.updateStats();
        });
    }
    
    setupMap() {
        // Инициализация карты с центром на России
        this.map = L.map('map', {
            center: [55.7558, 37.6173], // Москва
            zoom: 5,
            minZoom: 3,
            maxZoom: 18,
            zoomControl: true
        });
        
        // Добавляем первый слой карты
        this.currentLayer = L.tileLayer(this.tileLayers.osm.url, {
            attribution: this.tileLayers.osm.attribution,
            maxZoom: 18
        }).addTo(this.map);
        
        // Создаем слой для тумана войны
        this.setupFogOverlay();
    }
    
    setupFogOverlay() {
        // Создаем пустой слой для отображения раскрытых областей
        const fogPane = this.map.createPane('fogPane');
        fogPane.style.zIndex = 450; // Выше тайлов, но ниже маркеров
        
        // Слой для тумана войны
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.style.position = 'absolute';
        this.fogCanvas.style.pointerEvents = 'none';
        document.getElementById('map').appendChild(this.fogCanvas);
        
        // Обновляем туман при изменении карты
        this.map.on('moveend', () => this.updateFog());
        this.map.on('zoomend', () => this.updateFog());
        this.map.on('resize', () => this.updateFog());
    }
    
    setupFog() {
        // Начальное состояние - вся карта покрыта туманом
        if (this.map) {
            this.updateFog();
        }
    }
    
    updateFog() {
        if (!this.map) return;
        
        const size = this.map.getSize();
        this.fogCanvas.width = size.x;
        this.fogCanvas.height = size.y;
        this.fogCanvas.style.width = size.x + 'px';
        this.fogCanvas.style.height = size.y + 'px';
        
        const ctx = this.fogCanvas.getContext('2d');
        
        // Заполняем всё туманом
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(0, 0, size.x, size.y);
        
        // Создаем "дырки" в тумане для раскрытых областей
        ctx.globalCompositeOperation = 'destination-out';
        
        this.revealedAreas.forEach(circle => {
            try {
                const bounds = circle.getBounds();
                const ne = this.map.latLngToContainerPoint(bounds.getNorthEast());
                const sw = this.map.latLngToContainerPoint(bounds.getSouthWest());
                const center = this.map.latLngToContainerPoint(circle.getLatLng());
                const radius = Math.abs(ne.x - sw.x) / 2;
            
                // Создаем градиент для плавного раскрытия
                const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
                gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
                gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                ctx.fill();
            } catch (e) {
                console.warn('Error updating fog for circle:', e);
            }
        });
        
        ctx.globalCompositeOperation = 'source-over';
    }
    
    setupEventListeners() {
        // Клик по карте для раскрытия области
        this.map.on('click', (e) => {
            if (!e.originalEvent.shiftKey && !e.originalEvent.ctrlKey) {
                this.revealArea(e.latlng);
            }
        });
        
        // Переключение стилей карты
        document.getElementById('mapStyle').addEventListener('change', (e) => {
            this.changeMapStyle(e.target.value);
        });
        
        // Кнопка сброса
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.reset();
        });
    }
    
    revealArea(latlng) {
        // Создаем невидимый круг для отслеживания раскрытой области
        const circle = L.circle(latlng, {
            radius: this.revealRadius,
            fillOpacity: 0,
            opacity: 0
        });
        
        // Добавляем круг на карту (невидимый)
        circle.addTo(this.map);
        
        this.revealedAreas.push(circle);
        this.updateFog();
        this.updateStats();
    }
    
    changeMapStyle(styleKey) {
        if (this.tileLayers[styleKey]) {
            // Удаляем текущий слой
            this.map.removeLayer(this.currentLayer);
            
            // Добавляем новый слой
            const tileConfig = this.tileLayers[styleKey];
            this.currentLayer = L.tileLayer(tileConfig.url, {
                attribution: tileConfig.attribution,
                maxZoom: 18
            }).addTo(this.map);
            
            // Обновляем туман после смены стиля
            setTimeout(() => this.updateFog(), 100);
        }
    }
    
    updateStats() {
        // Приблизительный расчет покрытия
        // Для демонстрации используем количество раскрытых областей
        const revealedCount = this.revealedAreas.length;
        const estimatedCoverage = Math.min(100, revealedCount * 2); // Примерный процент
        
        document.getElementById('revealedCount').textContent = revealedCount.toLocaleString();
        document.getElementById('progressPercent').textContent = `${estimatedCoverage.toFixed(1)}%`;
    }
    
    reset() {
        // Очищаем все раскрытые области
        this.revealedAreas = [];
        this.updateFog();
        this.updateStats();
        
        // Возвращаем карту к начальному виду
        this.map.setView([55.7558, 37.6173], 5);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BattleMap();
});