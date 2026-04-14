const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

console.log(`Syncing version: ${version}`);

// 1. Cargo.toml
const cargoPath = path.join(root, 'backend', 'Cargo.toml');
let cargoContent = fs.readFileSync(cargoPath, 'utf8');
cargoContent = cargoContent.replace(/version\s*=\s*".*"/, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargoContent);

// 2. package.json files
const packagePaths = [
    path.join(root, 'package.json'),
    path.join(root, 'frontend', 'package.json')
];

for (const pkgPath of packagePaths) {
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.version = version;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
}

// 3. Tauri conf
const tauriConfPath = path.join(root, 'desktop', 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    tauriConf.version = version;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
}

console.log('Done.');
