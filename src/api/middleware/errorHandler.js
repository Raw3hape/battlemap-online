// Error Handler middleware для API endpoints

export function errorHandler(handler) {
    return async (req, res) => {
        try {
            // Выполняем основной обработчик
            return await handler(req, res);
        } catch (error) {
            // Логируем ошибку
            console.error('API Error:', {
                endpoint: req.url,
                method: req.method,
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
            
            // Определяем статус код на основе типа ошибки
            let statusCode = 500;
            let message = 'Internal server error';
            
            if (error.name === 'ValidationError') {
                statusCode = 400;
                message = error.message;
            } else if (error.name === 'NotFoundError') {
                statusCode = 404;
                message = error.message;
            } else if (error.name === 'UnauthorizedError') {
                statusCode = 401;
                message = 'Unauthorized';
            } else if (error.name === 'ForbiddenError') {
                statusCode = 403;
                message = 'Forbidden';
            } else if (error.name === 'RateLimitError') {
                statusCode = 429;
                message = 'Too many requests';
            }
            
            // Отправляем ошибку клиенту
            return res.status(statusCode).json({
                success: false,
                error: message,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    };
}

// Кастомные классы ошибок
export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}

export class UnauthorizedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
    }
}

export class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
    }
}