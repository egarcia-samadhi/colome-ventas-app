#!/bin/bash
# Deploy seguro para colome-ventas-app -- mismo patrón que chakana-ventas/
# chakana-reportes-contables (aborta si hay riesgo, no solo avisa).
set -e
cd /root/colome-ventas-build/colome-ventas-src

echo "== 1/5 Verificando estado de git =="
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORTA: hay cambios sin commitear en el working tree."
  git status --short
  echo "Commitear o descartar antes de desplegar (nunca docker build sobre un working tree sucio)."
  exit 1
fi

git fetch origin main:refs/remotes/origin/main -f > /dev/null 2>&1 || {
  echo "ABORTA: no se pudo hacer fetch a origin."
  exit 1
}
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "ABORTA: HEAD local ($LOCAL) no coincide con origin/main ($REMOTE)."
  echo "Si local esta atras: git reset --hard origin/main (o pull) antes de desplegar."
  echo "Si local esta adelante: hacer push a origin primero (backup real del codigo)."
  exit 1
fi
echo "OK: working tree limpio y sincronizado con origin/main ($LOCAL)"

echo "== 2/5 Backup de la base de datos =="
TS=$(date +%Y%m%d-%H%M%S)
CID=$(docker ps -qf name=colome_colome-ventas | head -1)
mkdir -p /root/colome-ventas-backups
if [ -n "$CID" ]; then
  docker cp "$CID:/data/colome-ventas.db" "/root/colome-ventas-backups/colome-ventas-$TS.db"
  echo "OK: backup en /root/colome-ventas-backups/colome-ventas-$TS.db"
  # Retener solo los ultimos 30 backups
  ls -1t /root/colome-ventas-backups/colome-ventas-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
else
  echo "AVISO: no hay contenedor corriendo, no se pudo hacer backup de la DB (deploy inicial?)."
fi

echo "== 3/5 Build =="
docker build -t "colome-ventas-app:$LOCAL" -t colome-ventas-app:latest .

echo "== 4/5 Deploy =="
docker service update --image "colome-ventas-app:$LOCAL" --force colome_colome-ventas

echo "== 5/5 Verificando =="
sleep 3
HTTP=$(curl -s -o /dev/null -w '%{http_code}' https://colome-ventas.gruposamadhiai.com/api/auth/me)
echo "HTTP /api/auth/me (esperado 401 sin sesion): $HTTP"
echo "Imagen desplegada: colome-ventas-app:$LOCAL"
echo "Para volver atras a esta version despues: docker service update --image colome-ventas-app:<SHA> --force colome_colome-ventas"
