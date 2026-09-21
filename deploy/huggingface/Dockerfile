# PropAI API for a free Hugging Face Space (Docker). This is ALL the Space needs besides README.md:
# it downloads the backend from the public GitHub repository while building, so updating the API = "Factory rebuild" in the Space.
FROM python:3.11-slim

# Tesseract (English + Marathi) for bill reading, and a small Redis that lives inside this container (sessions / one-time codes).
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-mar libglib2.0-0 redis-server curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip setuptools
RUN useradd -m -u 1000 user
WORKDIR /app

# Python libraries first (this layer is reused unless requirements.txt changes)
ADD https://raw.githubusercontent.com/SamruddhiKadam2023in/PropAI/main/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN pip install --no-cache-dir https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl

# The backend code itself
ADD https://github.com/SamruddhiKadam2023in/PropAI/archive/refs/heads/main.tar.gz /tmp/propai.tar.gz
RUN tar -xzf /tmp/propai.tar.gz -C /tmp && cp -r /tmp/PropAI-main/backend/. /app/ && rm -rf /tmp/PropAI-main /tmp/propai.tar.gz

RUN printf '#!/bin/sh\nredis-server --port 6379 --bind 127.0.0.1 --save "" --appendonly no --daemonize yes\nexec uvicorn app.main:app --host 0.0.0.0 --port 7860 --proxy-headers --forwarded-allow-ips="*"\n' > /app/start.sh \
    && chmod +x /app/start.sh && mkdir -p /app/uploads && chown -R user:user /app

# Non-secret defaults. Everything secret (DATABASE_URL, MONGODB_URL, SECRET_KEY, SMTP_*) is set in the Space's "Secrets".
ENV REDIS_URL=redis://127.0.0.1:6379 \
    DEBUG=false \
    EMAIL_DEV_LOG_CODES=false \
    MIRROR_UPLOADS_TO_MONGO=true \
    UPLOAD_DIR=uploads \
    ACCESS_TOKEN_EXPIRE_MINUTES=15 \
    REFRESH_TOKEN_EXPIRE_DAYS=7 \
    PYTHONUNBUFFERED=1

USER user
EXPOSE 7860
CMD ["/app/start.sh"]
