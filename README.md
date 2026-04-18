# MedExtract — Medical Record Extraction Platform

A robust platform for automating the extraction, standardization, and visualization of medical biomarkers from PDF and image reports.

## Features

- **Multimodal Extraction**: Uses Gemini 2.0 Flash to extract data from text-based PDFs, scanned documents, and smartphone photos.
- **Intelligent Normalization**: Automatically standardizes biomarker names (e.g., "Hb", "Hgb" -> "Hemoglobin") using LLM-based mapping.
- **Premium Dashboard**: Responsive, mobile-first dashboard with Chart.js for visualizing health trends over time.
- **Verification Workflow**: Preview and correct extracted data before finalizing.
- **SQLite Storage**: Local database for reports and biomarkers.

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, LangChain (Google Generative AI).
- **Frontend**: Vite, Vanilla JS, CSS (Mobile-responsive, Medical-themed).
- **AI**: Gemini 2.0 Flash / 1.5 Flash.

## Setup Instructions

### 1. Prerequisites
- Python 3.10+
- Node.js & npm (for Vite frontend)
- `poppler-utils` (for PDF-to-image conversion)
  - macOS: `brew install poppler`
  - Linux: `sudo apt-get install poppler-utils`

### 2. Backend Setup
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Create .env file with your API key
echo "GOOGLE_API_KEY=your_gemini_api_key" > .env

# Run the backend
python run.py
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

## Folder Structure

- `backend/`: FastAPI server and services.
- `frontend/`: Vite-powered dashboard.
- `attachments/`: Sample medical records for testing.
- `uploads/`: Raw uploaded files.

## Verification Plan

- Run `python test_extraction.py` to verify Gemini API integration.
- Upload a sample PDF via the dashboard and check the trend visualizations.
