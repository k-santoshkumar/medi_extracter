# Use official Python runtime as a parent image
FROM python:3.10-slim

# Install system dependencies (specifically poppler for pdf2image)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy requirement list and install python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 10000

# Command to run the application
CMD gunicorn -w 4 -b 0.0.0.0:${PORT:-10000} backend.main:app
