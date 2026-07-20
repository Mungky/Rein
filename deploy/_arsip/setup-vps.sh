#!/bin/bash
# REIN VPS Setup Script — Ubuntu 22.04
# Run as: bash setup-vps.sh
set -e

DEPLOY_DIR="/opt/rein"
REPO_URL="https://github.com/YOUR_USERNAME/YOUR_REPO.git"  # ganti dengan repo kamu

echo "=== REIN VPS Setup ==="

# 1. System update
echo "[1/7] Update system..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip git curl

# 2. Clone / update repo
echo "[2/7] Clone repo..."
if [ -d "$DEPLOY_DIR" ]; then
  echo "  → Updating existing repo..."
  cd "$DEPLOY_DIR" && git pull
else
  sudo git clone "$REPO_URL" "$DEPLOY_DIR"
  sudo chown -R ubuntu:ubuntu "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

# 3. Python virtual environment
echo "[3/7] Setup Python venv..."
cd "$DEPLOY_DIR"
python3.11 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r backend/requirements.txt

# 4. Credentials folder
echo "[4/7] Prepare credentials folder..."
mkdir -p "$DEPLOY_DIR/backend/credentials"
echo "  → Copy credentials.json dan token.json ke $DEPLOY_DIR/backend/credentials/"
echo "     scp credentials.json ubuntu@VPS_IP:/opt/rein/backend/credentials/"
echo "     scp token.json ubuntu@VPS_IP:/opt/rein/backend/credentials/"

# 5. Environment file
echo "[5/7] Check .env..."
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  echo "  → .env dibuat dari .env.example — EDIT dulu sebelum lanjut!"
  echo "  → nano /opt/rein/.env"
  exit 1
else
  echo "  → .env sudah ada"
fi

# 6. Database migration
echo "[6/7] Run migrations..."
cd "$DEPLOY_DIR"
PYTHONPATH="$DEPLOY_DIR" venv/bin/python -m alembic -c db/alembic.ini upgrade head

# 7. Systemd service
echo "[7/7] Setup systemd service..."
sudo cp "$DEPLOY_DIR/deploy/rein-backend.service" /etc/systemd/system/rein-backend.service
sudo systemctl daemon-reload
sudo systemctl enable rein-backend
sudo systemctl restart rein-backend

echo ""
echo "=== Selesai! ==="
echo "Status: sudo systemctl status rein-backend"
echo "Logs:   sudo journalctl -u rein-backend -f"
echo ""
echo "Pastikan firewall membuka port 8000 hanya untuk internal Vercel:"
echo "  sudo ufw allow from any to any port 8000  (sementara, untuk test)"
echo "  sudo ufw status"
