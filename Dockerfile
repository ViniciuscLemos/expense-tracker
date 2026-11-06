# the page is built with Node, then a small Python image serves it together with the API
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api api
COPY --from=web /app/dist dist
ENV SITE_DIR=/app/dist
CMD ["sh", "-c", "uvicorn --factory app.main:create_app --app-dir api --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
