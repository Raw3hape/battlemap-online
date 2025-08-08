// Тестовый скрипт для добавления клеток в разные страны
async function testReveal() {
    const baseUrl = 'https://battlemap-online.vercel.app';
    
    // Тестовые клетки для разных стран
    const testCells = [
        // Россия (Москва и окрестности)
        { cellKey: '55.7,37.6', country: 'RU' },
        { cellKey: '55.8,37.6', country: 'RU' },
        { cellKey: '55.9,37.6', country: 'RU' },
        { cellKey: '56.0,37.6', country: 'RU' },
        { cellKey: '56.1,37.6', country: 'RU' },
        
        // США (Нью-Йорк)
        { cellKey: '40.7,-74.0', country: 'US' },
        { cellKey: '40.8,-74.0', country: 'US' },
        { cellKey: '40.9,-74.0', country: 'US' },
        
        // Франция (Париж)
        { cellKey: '48.8,2.3', country: 'FR' },
        { cellKey: '48.9,2.3', country: 'FR' },
        
        // Китай (Пекин)
        { cellKey: '39.9,116.4', country: 'CN' },
        
        // Бразилия (Рио)
        { cellKey: '-22.9,-43.2', country: 'BR' },
    ];
    
    for (const test of testCells) {
        try {
            const response = await fetch(`${baseUrl}/api/reveal-cell`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cellKey: test.cellKey,
                    userId: 'test-user-' + Math.random().toString(36).substr(2, 9)
                })
            });
            
            const data = await response.json();
            console.log(`Revealed ${test.cellKey} in ${test.country}:`, data);
        } catch (error) {
            console.error(`Error revealing ${test.cellKey}:`, error);
        }
        
        // Небольшая задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Проверяем результат
    const stateResponse = await fetch(`${baseUrl}/api/game-state`);
    const state = await stateResponse.json();
    console.log('\nFinal state:');
    console.log('Top countries:', state.topCountries);
}

// Запускаем тест
testReveal();