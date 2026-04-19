# Use official Python runtime as a parent image
FROM python:3.10-slim

# Install system dependencies (specifically poppler for pdf2image)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# ── Build Frontend ──
# Install Node.js to build the frontend
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install --legacy-peer-deps
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ── Setup Backend ──
# Copy requirement list and install python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 10000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Command to run the application
# We use a single worker for better debugging on Render, but can be scaled
CMD gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 2 --timeout 120 --access-logfile - --error-logfile - backend.main:app
