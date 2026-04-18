import os
import shutil
import uuid
import datetime
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from backend.models.database import init_db, get_db, Report, Biomarker
from backend.services.extraction_service import extract_data_from_document
from backend.services.normalization_service import normalize_biomarker_names

# ── App Setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MedExtract API",
    description="Medical record extraction and biomarker dashboard API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production: restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Serve uploaded files statically
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}

# ── Pydantic Schemas ──────────────────────────────────────────────────────────
class BiomarkerOut(BaseModel):
    id: int
    marker_name: str
    original_name: str
    value: str
    unit: str
    reference_range: str

    class Config:
        from_attributes = True


class ReportOut(BaseModel):
    id: int
    filename: str
    patient_name: str
    report_date: str
    lab_name: str
    doctor_name: str
    upload_date: datetime.datetime
    biomarkers: List[BiomarkerOut] = []

    class Config:
        from_attributes = True


class TrendPoint(BaseModel):
    report_date: str
    value: str
    lab_name: str


class MarkerTrend(BaseModel):
    marker_name: str
    unit: str
    data: List[TrendPoint]


class DashboardStats(BaseModel):
    total_reports: int
    total_markers: int
    latest_report_date: Optional[str]
    patient_name: Optional[str]
    latest_vitals: dict
    trends: List[MarkerTrend]


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup_event():
    init_db()


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "MedExtract API"}


# ── Upload Endpoint ───────────────────────────────────────────────────────────
@app.post("/api/v1/upload", response_model=ReportOut)
async def upload_medical_record(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload a medical record (PDF or Image).
    Extracts biomarkers using Gemini 2.0 Flash and saves to database.
    """
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: PDF, JPG, PNG"
        )

    # Save uploaded file
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Extract biomarkers using Gemini
    try:
        df = extract_data_from_document(file_path)
    except Exception as e:
        os.remove(file_path)  # Cleanup on failure
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

    if df.empty:
        os.remove(file_path)
        raise HTTPException(status_code=422, detail="Could not extract data. Please ensure this is a valid medical report.")

    # Normalize biomarker columns
    META_COLS = {"patient_name", "report_date", "lab_name", "doctor_name"}
    biomarker_cols = [c for c in df.columns if c.lower() not in META_COLS]
    col_map = normalize_biomarker_names(biomarker_cols)

    # ── Determine report-level metadata ───────────────────────────────────────
    # If extraction returned row-per-marker format
    is_long_format = "marker_name" in df.columns and "value" in df.columns
    first_row = df.iloc[0]

    patient_name = str(first_row.get("patient_name", "N/A")).strip()
    report_date  = str(first_row.get("report_date", "N/A")).strip()
    lab_name     = str(first_row.get("lab_name", "N/A")).strip()
    doctor_name  = str(first_row.get("doctor_name", "N/A")).strip()

    # ── Save Report ────────────────────────────────────────────────────────────
    report = Report(
        filename=file.filename,
        patient_name=patient_name,
        report_date=report_date,
        lab_name=lab_name,
        doctor_name=doctor_name,
        file_path=file_path,
    )
    db.add(report)
    db.flush()  # Get the report ID before committing

    # ── Save Biomarkers ────────────────────────────────────────────────────────
    if is_long_format:
        # Row-per-marker: each row is one biomarker
        for _, row in df.iterrows():
            original = str(row.get("marker_name", "")).strip()
            if not original or original.lower() == "n/a":
                continue
            normalized = col_map.get(original, original)
            if normalized.lower() == "ignore":
                continue
            bm = Biomarker(
                report_id=report.id,
                marker_name=normalized,
                original_name=original,
                value=str(row.get("value", "N/A")).strip(),
                unit=str(row.get("unit", "")).strip(),
                reference_range=str(row.get("reference_range", "")).strip(),
            )
            db.add(bm)
    else:
        # Wide format: each column is a biomarker
        for original_col in biomarker_cols:
            normalized = col_map.get(original_col, original_col)
            if normalized.lower() == "ignore":
                continue
            for _, row in df.iterrows():
                val = str(row.get(original_col, "N/A")).strip()
                if val and val.lower() not in ("n/a", "nan", ""):
                    bm = Biomarker(
                        report_id=report.id,
                        marker_name=normalized,
                        original_name=original_col,
                        value=val,
                        unit="",
                        reference_range="",
                    )
                    db.add(bm)

    db.commit()
    db.refresh(report)
    return report


# ── List All Reports ───────────────────────────────────────────────────────────
@app.get("/api/v1/reports", response_model=List[ReportOut])
def list_reports(db: Session = Depends(get_db)):
    """Returns all uploaded reports in reverse chronological order."""
    reports = db.query(Report).order_by(Report.upload_date.desc()).all()
    return reports


# ── Get Single Report ──────────────────────────────────────────────────────────
@app.get("/api/v1/reports/{report_id}", response_model=ReportOut)
def get_report(report_id: int, db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


# ── Update Biomarker (User Correction) ────────────────────────────────────────
@app.put("/api/v1/biomarkers/{biomarker_id}")
def update_biomarker(
    biomarker_id: int,
    value: str,
    unit: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Allows the user to correct an extracted biomarker value."""
    bm = db.query(Biomarker).filter(Biomarker.id == biomarker_id).first()
    if not bm:
        raise HTTPException(status_code=404, detail="Biomarker not found")
    bm.value = value
    if unit:
        bm.unit = unit
    db.commit()
    return {"status": "updated", "id": biomarker_id}


# ── Delete Report ──────────────────────────────────────────────────────────────
@app.delete("/api/v1/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    # Remove the physical file
    if report.file_path and os.path.exists(report.file_path):
        os.remove(report.file_path)
    db.delete(report)
    db.commit()
    return {"status": "deleted"}


# ── Dashboard Stats ────────────────────────────────────────────────────────────
@app.get("/api/v1/dashboard/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """
    Returns aggregated data for the dashboard:
    - Report counts
    - Latest vital values
    - Trend data for all biomarkers
    """
    total_reports = db.query(func.count(Report.id)).scalar()
    total_markers = db.query(func.count(Biomarker.id)).scalar()

    latest_report = db.query(Report).order_by(Report.report_date.desc()).first()
    latest_report_date = latest_report.report_date if latest_report else None
    patient_name = latest_report.patient_name if latest_report else None

    # Latest vitals: most recent value for each unique marker
    latest_vitals = {}
    subq = (
        db.query(
            Biomarker.marker_name,
            func.max(Report.report_date).label("latest_date")
        )
        .join(Report)
        .group_by(Biomarker.marker_name)
        .subquery()
    )
    for row in db.query(subq).all():
        bm = (
            db.query(Biomarker)
            .join(Report)
            .filter(
                Biomarker.marker_name == row.marker_name,
                Report.report_date == row.latest_date
            )
            .first()
        )
        if bm:
            latest_vitals[row.marker_name] = {
                "value": bm.value,
                "unit": bm.unit,
                "date": row.latest_date,
            }

    # Trends: all data points grouped by marker name
    all_markers = (
        db.query(Biomarker.marker_name)
        .distinct()
        .all()
    )
    trends = []
    for (marker_name,) in all_markers:
        rows = (
            db.query(Biomarker, Report)
            .join(Report)
            .filter(Biomarker.marker_name == marker_name)
            .order_by(Report.report_date.asc())
            .all()
        )
        if not rows:
            continue
        unit = rows[-1][0].unit or ""
        data = [
            TrendPoint(
                report_date=r.report_date or "",
                value=b.value,
                lab_name=r.lab_name or "",
            )
            for b, r in rows
            if b.value and b.value.lower() not in ("n/a", "nan", "")
        ]
        if data:
            trends.append(MarkerTrend(marker_name=marker_name, unit=unit, data=data))

    return DashboardStats(
        total_reports=total_reports,
        total_markers=total_markers,
        latest_report_date=latest_report_date,
        patient_name=patient_name,
        latest_vitals=latest_vitals,
        trends=trends,
    )
