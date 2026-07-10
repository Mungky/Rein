# Bridge MQTT → historian R-Net, sebagai container (deploy via Coolify).
# Build context: folder ini (deploy/scada/mqtt-bridge).
# Env wajib: DATABASE_URL (Supabase TRANSACTION pooler, port 6543).
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bridge.py .

ENV PYTHONUNBUFFERED=1
CMD ["python", "bridge.py"]
