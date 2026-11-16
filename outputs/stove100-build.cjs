const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, 'stove100-background');
fs.copyFileSync(path.join(__dirname, 'stove-100.js'), path.join(out, 'engine.js'));
console.log('FullAuto100 extension engine synchronized.');
