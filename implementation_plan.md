# Implementation Plan - Medical Extraction Platform

Build a robust backend and a premium dashboard to automate medical record extraction, standardization, and visualization.

## User Review Required

> [!IMPORTANT]
> **Data Privacy**: Medical data is sensitive. For this baseline, we will use a local SQLite database and local file storage. In a production environment, we should move to encrypted storage and a secure cloud database.

> [!NOTE]
> We will use **Gemini 2.0 Flash** for extraction and **Vite (Vanilla JS)** for the frontend to ensure a fast, premium, and mobile-responsive experience.

## Proposed Changes

### 1. Backend Infrastructure (FastAPI)

#### [NEW] `backend/main.py`
- Entry point for the FastAPI server.
- Middleware for CORS (to allow frontend communication).
- Routes for health checks.

#### [NEW] `backend/services/extraction_service.py`
- **Multimodal Pipeline**: Handles both text-based PDFs and Image-based uploads (Camera).
- **Gemini 2.0 Flash Integration**: Uses vision capabilities for JPEG/PNG/HEIC formats.
- Functions: `extract_data_from_document` (auto-detects format), `pdf_to_images` (for scanned PDFs).

#### [NEW] `backend/services/normalization_service.py`
- Logic to standardize biomarker names using the LLM normalization prompt.
- Implementation of the `COLUMN_MAPPING_CACHE`.

#### [NEW] `backend/models/database.py`
- SQLAlchemy models: `User`, `Report`, `Biomarker`.
- CRUD operations to save and retrieve extracted data.

### 2. Frontend Dashboard (Vite + Vanilla CSS/JS)

#### [NEW] `frontend/index.html`
- Clean, semantic HTML structure.
- **Camera-ready**: Implementation of a file picker with `capture="camera"` for mobile users.
- Modern, medical-themed design (Blue/Teal/White palette).

#### [NEW] `frontend/style.css`
- **Rich Aesthetics**: Glassmorphism, smooth gradients, and micro-animations.
- **Mobile First**: Responsive layouts for iPhone/Android screens.

#### [NEW] `frontend/src/dashboard.js`
- Fetching trends from the backend.
- **Chart.js integration**: Visualizing biomarker trends over time.

---

## Open Questions

- **Storage**: Should we keep the raw PDFs in the `uploads/` folder, or just extract and discard? (Recommended: Keep for user reference).
- **Marker Selection**: Which markers are most critical for the initial dashboard? (e.g., Blood Sugar, Cholesterol, WBC).

## Verification Plan

### Automated Tests
- Run `pytest` on the extraction service to verify it correctly parses a sample medical PDF from the `attachments` folder.
- Test API endpoints using `curl` or FastAPI's `/docs`.

### Manual Verification
- Upload a sample PDF via the dashboard.
- Verify the extraction appears in the "Recent Reports" table.
- Check if the trend graph updates with the new data point.
