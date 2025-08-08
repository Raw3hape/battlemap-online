// CORS middleware для API endpoints
export function corsMiddleware(handler) {
    return async (req, res) => {
        // Устанавливаем CORS заголовки
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        
        // Обработка preflight запросов
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }
        
        // Передаем управление следующему обработчику
        return handler(req, res);
    };
}