#!/usr/bin/env node

// Простой скрипт сборки для создания bundle файла
const fs = require('fs');
const path = require('path');

console.log('🔨 Building BattleMap Online bundle...');

// Читаем все модули
const modules = [
    'src/client/js/ApiService.js',
    'src/client/js/BattleMap.js', 
    'src/client/js/OnlineBattleMap.js',
    'src/client/js/app.js'
];

let bundleContent = `
// BattleMap Online Bundle - Generated ${new Date().toISOString()}
(function() {
    'use strict';
    
`;

// Удаляем import/export и объединяем код
modules.forEach(modulePath => {
    console.log(`  📦 Processing ${modulePath}...`);
    
    if (fs.existsSync(modulePath)) {
        let content = fs.readFileSync(modulePath, 'utf8');
        
        // Удаляем import statements
        content = content.replace(/^import .* from .*;?\n/gm, '');
        content = content.replace(/^export /gm, 'window.');
        
        bundleContent += `
    // === ${modulePath} ===
    ${content}
    
`;
    } else {
        console.warn(`  ⚠️  File not found: ${modulePath}`);
    }
});

bundleContent += `
})();
`;

// Сохраняем bundle
const outputPath = 'public/js/battlemap.bundle.js';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, bundleContent);

console.log(`✅ Bundle created at ${outputPath}`);
console.log(`📊 Bundle size: ${(bundleContent.length / 1024).toFixed(2)} KB`);