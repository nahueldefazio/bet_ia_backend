#!/bin/bash
# deploy.sh — Script de despliegue para Hostinger VPS
# Ejecutar desde la carpeta /backend: bash deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../frontend"

echo "==> [1/6] Instalando dependencias del frontend..."
cd "$FRONTEND_DIR"
npm ci

echo "==> [2/6] Compilando Angular (producción → backend/public)..."
npm run build

echo "==> [3/6] Instalando dependencias del backend (producción)..."
cd "$SCRIPT_DIR"
npm ci --omit=dev

echo "==> [4/6] Generando cliente Prisma..."
npx prisma generate

echo "==> [5/6] Aplicando migraciones de base de datos..."
npx prisma migrate deploy

echo "==> [6/6] Compilando NestJS..."
npm run build

mkdir -p logs

echo ""
echo "✅ Deploy completado."
echo ""
echo "Para iniciar/reiniciar con PM2:"
echo "   pm2 start ecosystem.config.js --env production"
echo "   pm2 save"
echo "   pm2 startup   # solo la primera vez"
