#!/usr/bin/env node
/**
 * Generates PNG icons from logo.svg for PWA manifest.
 * Run: node scripts/generate-icons.js
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const svgPath = join(publicDir, "logo.svg");

const svg = readFileSync(svgPath);

async function generateIcons() {
  for (const size of [192, 512]) {
    const outputPath = join(publicDir, `icon-${size}.png`);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }
}

generateIcons().catch((err) => {
  console.error("Failed to generate icons:", err.message);
  process.exit(1);
});
