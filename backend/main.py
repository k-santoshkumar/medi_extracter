import datetime
import logging
import os
import uuid
from contextlib import asynccontextmanager
from logging.config import dictConfig
from pathlib import Path
from typing import Any, Optional

from PIL import Image, UnidentifiedImageError
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session

load_dotenv()

# Service imports
from backend.models.database import Biomarker, ProcessingJob, Report, SessionLocal, User, init_db, get_db
from backend.services.azure_auth_service import validate_access_token
from backend.services.blob_storage_service import build_blob_download_url, upload_file_to_blob
from backend.services.extraction_service import extract_data_from_document
from backend.services.normalization_service import normalize_biomarker_names

# ── Logging Configuration ─────────────────────────────────────────────────────
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s"
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "stream": "ext://sys.stdout",
        }
    },
    "loggers": {
        "medextract": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}

dictConfig(LOGGING_CONFIG)
logger = logging.getLogger("medextract")


def get_static_dir() -> str:
    static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
    if not os.path.exists(static_dir):
        static_dir = os.path.abspath(os.path.join(os.getcwd(), "frontend/dist"))
    return static_dir


UPLOAD_DIR = os.path.abspath("./uploads")
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


async def save_validated_upload(file: UploadFile, destination: str) -> None:
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    total_bytes = 0
    first_chunk = b""
    with open(destination, "wb") as output:
        while chunk := await file.read(1024 * 1024):
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File is too large")
            if not first_chunk:
                first_chunk = chunk[:16]
            output.write(chunk)

    if extension == ".pdf" and not first_chunk.startswith(b"%PDF-"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PDF file")
    if extension in {".jpg", ".jpeg", ".png"}:
        try:
            with Image.open(destination) as image:
                image.verify()
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file") from exc


def process_extraction_job(job_id: str) -> None:
    db = SessionLocal()
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if job is None:
        db.close()
        return

    try:
        job.status = "processing"
        job.updated_at = datetime.datetime.utcnow()
        db.commit()
        extracted_data = extract_data_from_document(job.source_path)

        if db.query(User.id).filter(User.id == job.user_id).first() is None:
            db.add(User(id=job.user_id))
            db.flush()
        report = Report(
            user_id=job.user_id,
            filename=job.original_filename,
            patient_name=extracted_data.get("patient_name") or "Manual Entry",
            report_date=extracted_data.get("report_date") or datetime.datetime.now().strftime("%Y-%m-%d"),
            lab_name=extracted_data.get("lab_name") or "Unknown Lab",
            doctor_name=extracted_data.get("doctor_name"),
            file_path=job.file_path,
        )
        db.add(report)
        db.flush()
        biomarkers = extracted_data.get("biomarkers", [])
        if biomarkers:
            norm_map = normalize_biomarker_names([item["marker_name"] for item in biomarkers])
            db.add_all([
                Biomarker(
                    report_id=report.id,
                    marker_name=norm_map.get(item["marker_name"], item["marker_name"]),
                    original_name=item["marker_name"],
                    value=str(item["value"]),
                    unit=item.get("unit"),
                    reference_range=item.get("reference_range"),
                )
                for item in biomarkers
            ])
        job.report_id = report.id
        job.status = "complete"
        job.updated_at = datetime.datetime.utcnow()
        db.commit()
    except Exception:
        db.rollback()
        job.status = "failed"
        job.error_message = "Document processing failed"
        job.updated_at = datetime.datetime.utcnow()
        db.commit()
        logger.exception("Extraction job failed", extra={"job_id": job_id})
    finally:
        if job.file_path != job.source_path and os.path.exists(job.source_path):
            os.remove(job.source_path)
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.upload_dir = UPLOAD_DIR
    Path(app.state.upload_dir).mkdir(parents=True, exist_ok=True)

    app.state.database_url = os.environ.get("DATABASE_URL") or "sqlite:///./medical_data.db"
    app.state.db_error = None

    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as exc:  # pragma: no cover - startup guard
        app.state.db_error = f"Failed to initialize database: {str(exc)}"
        logger.error(app.state.db_error)

    logger.info("FastAPI application startup complete")
    yield
    logger.info("FastAPI application shutdown complete")


app = FastAPI(
    title="MedExtract API",
    version="1.0.0",
    description="Medical extraction API built with FastAPI",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_and_tracing_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    request.state.trace_id = request.headers.get("x-trace-id") or request_id

    logger.info(
        "incoming request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "request_id": request_id,
            "client_ip": request.client.host if request.client else None,
        },
    )

    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    response.headers["x-trace-id"] = request.state.trace_id

    logger.info(
        "request completed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "request_id": request_id,
        },
    )
    return response


async def get_current_user_id(
    request: Request,
) -> str:
    authorization = request.headers.get("Authorization")
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            try:
                return validate_access_token(token)["sub"]
            except ValueError:
                pass

    logger.warning(
        "Missing or invalid Authorization header",
        extra={"request_id": getattr(request.state, "request_id", None)},
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Please log in again.",
    )


class BiomarkerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    marker_name: str
    original_name: Optional[str] = None
    value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None


@app.get("/health")
async def health_check(request: Request):
    db_error = getattr(request.app.state, "db_error", None)
    database_url = getattr(request.app.state, "database_url", None)

    db_status = "unknown"
    status_code = status.HTTP_200_OK

    if db_error:
        db_status = f"error: {db_error}"
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        try:
            with SessionLocal() as session:
                session.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception as exc:
            db_status = f"disconnected: {str(exc)}"
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if status_code == status.HTTP_200_OK else "error",
            "service": "MedExtract API",
            "database": db_status,
            "environment": {
                "DATABASE_URL_SET": bool(database_url),
            },
        },
    )


@app.get("/")
async def serve_index():
    static_dir = get_static_dir()
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"error": "Frontend build not found."})


@app.post("/api/v1/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_medical_record(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    logger.info("Received upload request", extra={"request_id": getattr(request.state, "request_id", None), "user_id": user_id})

    ext = os.path.splitext(file.filename or "")[1].lower()
    unique_filename = f"{uuid.uuid4()}{ext}"
    local_path = os.path.join(UPLOAD_DIR, unique_filename)
    blob_name = None
    retain_local_file = True

    try:
        await save_validated_upload(file, local_path)
        if os.getenv("AZURE_STORAGE_CONNECTION_STRING"):
            blob_name = upload_file_to_blob(local_path, file.filename or unique_filename, user_id)
            logger.info("Uploaded file to Blob Storage", extra={"blob_name": blob_name, "request_id": getattr(request.state, "request_id", None)})

        if db.query(User.id).filter(User.id == user_id).first() is None:
            db.add(User(id=user_id))
            db.flush()

        job = ProcessingJob(
            id=str(uuid.uuid4()),
            user_id=user_id,
            source_path=local_path,
            file_path=blob_name or unique_filename,
            original_filename=file.filename or unique_filename,
            status="queued",
        )
        db.add(job)
        db.commit()
        background_tasks.add_task(process_extraction_job, job.id)
        return {
            "job_id": job.id,
            "status": "queued",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Upload processing failed", extra={"request_id": getattr(request.state, "request_id", None)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Upload processing failed") from exc
    finally:
        if os.path.exists(local_path) and not retain_local_file:
            os.remove(local_path)


@app.get("/api/v1/jobs/{job_id}")
async def get_processing_job(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id, ProcessingJob.user_id == user_id).first()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processing job not found")

    response = {"job_id": job.id, "status": job.status, "error": job.error_message}
    if job.status == "complete" and job.report_id:
        report = db.query(Report).filter(Report.id == job.report_id, Report.user_id == user_id).first()
        if report:
            response["report_id"] = report.id
            response["file_url"] = build_blob_download_url(report.file_path) if report.file_path.startswith("users/") else None
            response["extracted"] = {
                "patient_name": report.patient_name,
                "report_date": report.report_date,
                "lab_name": report.lab_name,
                "doctor_name": report.doctor_name,
                "biomarkers": [
                    {"marker_name": item.marker_name, "original_name": item.original_name, "value": item.value,
                     "unit": item.unit, "reference_range": item.reference_range}
                    for item in report.biomarkers
                ],
            }
    return response


@app.get("/api/v1/reports")
async def list_reports(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        reports = db.query(Report).filter(Report.user_id == user_id).order_by(Report.upload_date.desc()).all()
        return [
            {
                "id": report.id,
                "user_id": report.user_id,
                "filename": report.filename,
                "patient_name": report.patient_name,
                "report_date": report.report_date,
                "lab_name": report.lab_name,
                "doctor_name": report.doctor_name,
                "file_path": report.file_path,
                "file_url": build_blob_download_url(report.file_path) if report.file_path else None,
                "upload_date": report.upload_date.isoformat() if report.upload_date else None,
            }
            for report in reports
        ]
    except Exception as exc:
        logger.exception("Failed to list reports", extra={"request_id": getattr(request.state, "request_id", None)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list reports") from exc


@app.get("/api/v1/dashboard/stats")
async def get_dashboard_stats(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        reports = db.query(Report).filter(Report.user_id == user_id).order_by(Report.upload_date.desc()).all()
        total_reports = len(reports)

        if total_reports == 0:
            return {
                "total_reports": 0,
                "total_markers": 0,
                "latest_report_date": None,
                "patient_name": None,
                "latest_vitals": [],
                "trends": [],
            }

        latest_report = reports[0]
        latest_vitals = (
            db.query(Biomarker).filter(Biomarker.report_id == latest_report.id).order_by(Biomarker.id.asc()).all()
        )
        total_markers = (
            db.query(Biomarker)
            .join(Report, Biomarker.report_id == Report.id)
            .filter(Report.user_id == user_id)
            .count()
        )

        return {
            "total_reports": total_reports,
            "total_markers": total_markers,
            "latest_report_date": latest_report.report_date,
            "patient_name": latest_report.patient_name,
            "latest_vitals": [
                {
                    "id": biomarker.id,
                    "report_id": biomarker.report_id,
                    "marker_name": biomarker.marker_name,
                    "original_name": biomarker.original_name,
                    "value": biomarker.value,
                    "unit": biomarker.unit,
                    "reference_range": biomarker.reference_range,
                }
                for biomarker in latest_vitals
            ],
            "trends": [],
        }
    except Exception as exc:
        logger.exception("Dashboard stats failed", extra={"request_id": getattr(request.state, "request_id", None)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load dashboard") from exc


@app.put("/api/v1/biomarkers/{marker_id}")
async def update_biomarker(
    request: Request,
    marker_id: int,
    value: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        biomarker = (
            db.query(Biomarker)
            .join(Report, Biomarker.report_id == Report.id)
            .filter(Biomarker.id == marker_id, Report.user_id == user_id)
            .first()
        )
        if biomarker is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Biomarker not found")

        if value is not None:
            biomarker.value = value

        db.commit()
        return {
            "id": biomarker.id,
            "report_id": biomarker.report_id,
            "marker_name": biomarker.marker_name,
            "value": biomarker.value,
        }
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to update biomarker", extra={"request_id": getattr(request.state, "request_id", None)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update biomarker") from exc


@app.delete("/api/v1/reports/{report_id}")
async def delete_report(
    request: Request,
    report_id: int,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        report = db.query(Report).filter(Report.id == report_id, Report.user_id == user_id).first()
        if report is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

        db.delete(report)
        db.commit()
        return {"status": "deleted", "report_id": report_id}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to delete report", extra={"request_id": getattr(request.state, "request_id", None)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete report") from exc


@app.get("/uploads/{filename}")
async def serve_uploads_api(
    filename: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    safe_filename = os.path.basename(filename)
    upload_path = os.path.join(UPLOAD_DIR, safe_filename)
    owns_file = db.query(Report.id).filter(Report.user_id == user_id, Report.file_path == safe_filename).first()
    if safe_filename == filename and owns_file and os.path.isfile(upload_path):
        return FileResponse(upload_path)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")


@app.get("/{path:path}")
async def serve_static(path: str):
    static_dir = get_static_dir()
    full_path = os.path.join(static_dir, path)
    if os.path.exists(full_path):
        return FileResponse(full_path)
    fallback_path = os.path.join(static_dir, "index.html")
    if os.path.exists(fallback_path):
        return FileResponse(fallback_path)
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"error": "Frontend build not found."})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
