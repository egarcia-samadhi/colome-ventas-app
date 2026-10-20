FROM node:20-bookworm-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app.py backend/database.py backend/afip.py backend/ig_ventas.py backend/jurisdiccion.py backend/datos_maestros.py backend/controles.py backend/panel_ventas.py backend/otros_analisis.py backend/auditoria.py backend/snap.py backend/lfy_jul_ago_2025.json backend/budget_2025_2026.json .
COPY --from=frontend-build /frontend/out/ ./static_next/
EXPOSE 80
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80"]
