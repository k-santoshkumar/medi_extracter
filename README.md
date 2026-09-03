# MedExtract — Medical Record Extraction Platform

A robust platform for automating the extraction, standardization, and visualization of medical biomarkers from PDF and image reports.

## Features

- **Multimodal Extraction**: Uses Azure OpenAI to extract data from text-based PDFs, scanned documents, and smartphone photos.
- **Intelligent Normalization**: Automatically standardizes biomarker names (e.g., "Hb", "Hgb" -> "Hemoglobin") using LLM-based mapping.
- **Premium Dashboard**: Responsive, mobile-first dashboard with Chart.js for visualizing health trends over time.
- **Verification Workflow**: Preview and correct extracted data before finalizing.
- **Azure Storage**: PostgreSQL stores structured records and private Azure Blob Storage stores source documents.

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, LangChain (Azure OpenAI).
- **Frontend**: Vite, Vanilla JS, CSS (Mobile-responsive, Medical-themed).
- **AI**: Azure OpenAI deployment configured through `OPENAI_API_KEY` and `MODEL_NAME`.
- **Authentication**: Microsoft Entra ID via MSAL; the API validates Entra access tokens.

To enable the Google button, configure Google as an external identity provider in the Entra tenant and keep `VITE_AZURE_GOOGLE_DOMAIN_HINT=Google`. The button cannot use Google directly because the API accepts only Entra-issued access tokens.

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

# Configure Azure PostgreSQL, Azure OpenAI, Blob Storage, and Entra ID.
cp .env.example .env
# Replace the placeholder values in .env before starting the server.

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

- Run `python -m compileall -q backend run.py` to verify Python syntax.
- Run `cd frontend && npm run build` to build the web client.
- Run `python test_extraction.py` only with a configured Azure OpenAI key and a test document.
- Upload a sample PDF via the dashboard and check the trend visualizations.
