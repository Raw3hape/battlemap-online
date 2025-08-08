// Валидация middleware для API endpoints

// Валидация координат клетки
export function validateCellKey(cellKey) {
    if (!cellKey || typeof cellKey !== 'string') {
        return { valid: false, error: 'Cell key is required and must be a string' };
    }
    
    const pattern = /^-?\d+\.\d+,-?\d+\.\d+$/;
    if (!pattern.test(cellKey)) {
        return { valid: false, error: 'Invalid cell key format. Expected: "lat,lng"' };
    }
    
    const [lat, lng] = cellKey.split(',').map(Number);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { valid: false, error: 'Coordinates out of valid range' };
    }
    
    return { valid: true };
}

// Валидация userId
export function validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
        return { valid: false, error: 'User ID is required and must be a string' };
    }
    
    if (userId.length < 3 || userId.length > 50) {
        return { valid: false, error: 'User ID must be between 3 and 50 characters' };
    }
    
    const pattern = /^[a-zA-Z0-9_-]+$/;
    if (!pattern.test(userId)) {
        return { valid: false, error: 'User ID can only contain letters, numbers, underscores and hyphens' };
    }
    
    return { valid: true };
}

// Middleware для валидации тела запроса
export function validationMiddleware(validations) {
    return (handler) => {
        return async (req, res) => {
            // Проверяем каждое поле согласно правилам валидации
            for (const [field, validator] of Object.entries(validations)) {
                const value = req.body?.[field];
                const result = validator(value);
                
                if (!result.valid) {
                    return res.status(400).json({
                        success: false,
                        error: `Validation error: ${result.error}`,
                        field
                    });
                }
            }
            
            // Если валидация прошла, передаем управление handler
            return handler(req, res);
        };
    };
}