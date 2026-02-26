/**
 * Запустите: node generate-icons.js
 * Создаёт icon-192.png и icon-512.png из icon.svg
 * Требуется: npm install sharp (только для этого скрипта)
 */
const sharp = require('sharp');
const path = require('path');

const src = path.join(__dirname, 'icon.svg');

async function main() {
  await sharp(src).resize(192).png().toFile(path.join(__dirname, 'icon-192.png'));
  console.log('✅ icon-192.png создан');
  await sharp(src).resize(512).png().toFile(path.join(__dirname, 'icon-512.png'));
  console.log('✅ icon-512.png создан');
}

main().catch(console.error);
