#!/usr/bin/env node
/**
 * Parses airports.csv (OurAirports) → src/data/airports.json
 * 
 * Only keeps airports with valid IATA codes.
 * Output: Array of { iata, name, city, region, country, lat, lng, keywords, type }
 * 
 * Run: node scripts/build-airport-db.js
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'airports.csv');
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'airports.json');

// Simple CSV parser that handles quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const raw = fs.readFileSync(CSV_PATH, 'utf8');
const lines = raw.split('\n').filter(l => l.trim());
const header = parseCSVLine(lines[0]);

// Map header names → indices
const idx = {};
header.forEach((h, i) => { idx[h] = i; });

const airports = [];

for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]);
  const iata = (cols[idx['iata_code']] || '').trim();
  if (!iata || !/^[A-Z]{3}$/.test(iata)) continue;

  const type = (cols[idx['type']] || '').trim();
  // Skip heliports and closed airports
  if (type === 'heliport' || type === 'closed') continue;

  const name = (cols[idx['name']] || '').trim();
  const city = (cols[idx['municipality']] || '').trim();
  const region = (cols[idx['iso_region']] || '').trim();
  const country = (cols[idx['iso_country']] || '').trim();
  const lat = parseFloat(cols[idx['latitude_deg']]) || 0;
  const lng = parseFloat(cols[idx['longitude_deg']]) || 0;
  const keywords = (cols[idx['keywords']] || '').trim();
  const scheduled = (cols[idx['scheduled_service']] || '').trim();

  airports.push({
    iata,
    name,
    city,
    region,    // e.g. "IN-KL" for Kerala
    country,   // e.g. "IN"
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    keywords,
    type,
    scheduled: scheduled === 'yes',
  });
}

// Sort: scheduled large airports first, then by country + city
airports.sort((a, b) => {
  if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
  const typeOrder = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3 };
  const ta = typeOrder[a.type] ?? 4;
  const tb = typeOrder[b.type] ?? 4;
  if (ta !== tb) return ta - tb;
  return (a.country + a.city).localeCompare(b.country + b.city);
});

// Ensure output directory exists
const outDir = path.dirname(OUT_PATH);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(OUT_PATH, JSON.stringify(airports));

const sizeKB = Math.round(fs.statSync(OUT_PATH).size / 1024);
console.log(`✅ Built ${OUT_PATH}`);
console.log(`   ${airports.length} airports with IATA codes (${sizeKB} KB)`);
console.log(`   Scheduled: ${airports.filter(a => a.scheduled).length}`);
console.log(`   Large: ${airports.filter(a => a.type === 'large_airport').length}`);
console.log(`   Medium: ${airports.filter(a => a.type === 'medium_airport').length}`);
