import os
import shutil
import uuid
import datetime
import logging
from typing import List, Optional
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel
import re

# Service imports
try:
    from backend.services.extraction_service import extract_data_from_document
    from backend.services.normalization_service import normalize_biomarker_names
except ImportError:
    # Fallback for different import paths
    from services.extraction_service import extract_data_from_document
    from services.normalization_service import normalize_biomarker_names

# ── App Setup ────────────────────────────────────────────────────────────────
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Point static_folder to the frontend build directory
# We look for 'dist' folder in multiple common locations
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
if not os.path.exists(static_dir):
    static_dir = os.path.abspath(os.path.join(os.getcwd(), "frontend/dist"))

logger.info(f"Serving static files from: {static_dir}")

app = Flask(__name__, static_folder=static_dir, static_url_path="/")
CORS(app)

# ── Supabase Setup ───────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase = None
supabase_error = None

if not SUPABASE_URL or not SUPABASE_KEY:
    supabase_error = "SUPABASE_URL or SUPABASE_KEY is not set in environment variables."
    logger.error(supabase_error)
else:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully.")
    except Exception as e:
        supabase_error = f"Failed to initialize Supabase client: {str(e)}"
        logger.error(supabase_error)

UPLOAD_DIR = os.path.abspath("./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}

# ── Pydantic Schemas ──────────────────────────────────────────────────────────
class BiomarkerOut(BaseModel):
    id: int
    marker_name: str
    original_name: Optional[str] = None
    value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None

    class Config:
        from_attributes = True


class ReportOut(BaseModel):
    id: int
    filename: str
    patient_name: Optional[str] = None
    report_date: Optional[str] = None
    lab_name: Optional[str] = None
    doctor_name: Optional[str] = None
    upload_date: datetime.datetime


class MarkerTrend(BaseModel):
    date: str
    value: float
    unit: str


class DashboardStats(BaseModel):
    total_reports: int
    total_markers: int
    latest_report_date: Optional[str]
    patient_name: Optional[str]
    latest_vitals: dict
    trends: List[MarkerTrend]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health_check():
    db_status = "unknown"
    status_code = 200
    details = {}

    if supabase_error:
        db_status = f"error: {supabase_error}"
        status_code = 503
    elif not supabase:
        db_status = "error: Supabase client not initialized"
        status_code = 503
    else:
        try:
            # Lightweight connectivity check
            supabase.table("reports").select("id").limit(1).execute()
            db_status = "connected"
        except Exception as e:
            db_status = f"disconnected: {str(e)}"
            status_code = 503

    return jsonify({
        "status": "ok" if status_code == 200 else "error",
        "service": "MedExtract API",
        "supabase_db": db_status,
        "environment": {
            "SUPABASE_URL_SET": bool(SUPABASE_URL),
            "SUPABASE_KEY_SET": bool(SUPABASE_KEY),
            "GOOGLE_API_KEY_SET": bool(os.environ.get("GOOGLE_API_KEY")),
            "PORT": os.environ.get("PORT", "default (10000)")
        }
    }), status_code


@app.route("/")
def serve_index():
    if os.path.exists(os.path.join(app.static_folder, "index.html")):
        return send_from_directory(app.static_folder, "index.html")
    return jsonify({"error": "Frontend build not found. Please run 'npm run build' in the frontend directory."}), 404


@app.route("/api/v1/upload", methods=["POST"])
def upload_medical_record():
    logger.info(">>> Received upload request")
    if not supabase:
        logger.error("Supabase client not initialized")
        return jsonify({"detail": "Backend not properly configured with Supabase"}), 500
        
    if "file" not in request.files:
        logger.warning("No file part in request")
        return jsonify({"detail": "No file part"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        logger.warning("No selected file")
        return jsonify({"detail": "No selected file"}), 400
    
    # Save locally
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        logger.warning(f"Unsupported file extension: {ext}")
        return jsonify({"detail": "Unsupported file type"}), 400
        
    unique_filename = f"{uuid.uuid4()}{ext}"
    local_path = os.path.join(UPLOAD_DIR, unique_filename)
    logger.info(f"Saving file to: {local_path}")
    file.save(local_path)
    
    try:
        logger.info(f"Starting extraction for: {unique_filename}")
        # Extract data using AI
        extracted_data = extract_data_from_document(local_path)
        logger.info(f"Extraction successful for {unique_filename}")
        
        # Save to Supabase
        report_payload = {
            "filename": file.filename,
            "patient_name": extracted_data.get("patient_name"),
            "report_date": extracted_data.get("report_date"),
            "lab_name": extracted_data.get("lab_name"),
            "doctor_name": extracted_data.get("doctor_name"),
            "file_path": unique_filename
        }
        
        logger.info(f"Inserting report into Supabase: {report_payload['filename']}")
        report_res = supabase.table("reports").insert(report_payload).execute()
        
        if not report_res.data:
            raise Exception("Failed to insert report into Supabase")
            
        report_id = report_res.data[0]["id"]
        logger.info(f"Report created with ID: {report_id}")
        
        # 2. Normalize and Save Biomarkers
        biomarkers = extracted_data.get("biomarkers", [])
        if biomarkers:
            logger.info(f"Processing {len(biomarkers)} biomarkers")
            marker_names = [b["marker_name"] for b in biomarkers]
            norm_map = normalize_biomarker_names(marker_names)
            
            biomarker_payloads = []
            for b in biomarkers:
                biomarker_payloads.append({
                    "report_id": report_id,
                    "marker_name": norm_map.get(b["marker_name"], b["marker_name"]),
                    "original_name": b["marker_name"],
                    "value": str(b["value"]),
                    "unit": b.get("unit"),
                    "reference_range": b.get("reference_range")
                })
            
            logger.info(f"Inserting biomarkers for report {report_id}")
            supabase.table("biomarkers").insert(biomarker_payloads).execute()
        
        logger.info(f"<<< Upload and processing complete for {unique_filename}")
        return jsonify({
            "report_id": report_id,
            "extracted": extracted_data
        })
        
    except Exception as e:
        logger.exception(f"CRITICAL: Upload processing failed for {unique_filename}")
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/reports", methods=["GET"])
def list_reports():
    if not supabase: return jsonify([]), 500
    try:
        res = supabase.table("reports").select("*").order("upload_date", desc=True).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/reports/<int:report_id>", methods=["GET"])
def get_report_details(report_id):
    if not supabase: return jsonify({}), 500
    try:
        report_res = supabase.table("reports").select("*").eq("id", report_id).single().execute()
        biomarkers_res = supabase.table("biomarkers").select("*").eq("report_id", report_id).execute()
        
        return jsonify({
            "report": report_res.data,
            "biomarkers": biomarkers_res.data
        })
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/dashboard/stats", methods=["GET"])
def get_dashboard_stats():
    if not supabase: return jsonify({}), 500
    try:
        # 1. Total Reports
        reports_res = supabase.table("reports").select("*", count="exact").execute()
        total_reports = reports_res.count if reports_res.count is not None else len(reports_res.data)
        
        if total_reports == 0:
            return jsonify({
                "total_reports": 0,
                "total_markers": 0,
                "latest_report_date": None,
                "patient_name": None,
                "latest_vitals": [],
                "trends": []
            })
            
        # 2. Total Markers
        markers_res = supabase.table("biomarkers").select("id", count="exact").execute()
        total_markers = markers_res.count if markers_res.count is not None else len(markers_res.data)
        
        # 3. Latest Report info
        latest_report = reports_res.data[0] # Assumes ordered by date or similar
        
        # 4. Latest Vitals (e.g., markers from the latest report)
        latest_vitals_res = supabase.table("biomarkers").select("*").eq("report_id", latest_report["id"]).execute()
        
        return jsonify({
            "total_reports": total_reports,
            "total_markers": total_markers,
            "latest_report_date": latest_report["report_date"],
            "patient_name": latest_report["patient_name"],
            "latest_vitals": latest_vitals_res.data,
            "trends": [] # Placeholder for future logic
        })
    except Exception as e:
        logger.exception("Dashboard stats failed")
        return jsonify({"detail": str(e)}), 500

@app.route("/api/v1/trends/<marker_name>", methods=["GET"])
def get_marker_trends(marker_name):
    if not supabase: return jsonify([]), 500
    try:
        # Join biomarkers with reports to get dates
        res = supabase.table("biomarkers") \
            .select("value, unit, reports(report_date)") \
            .eq("marker_name", marker_name) \
            .execute()
            
        trends = []
        for row in res.data:
            try:
                # Basic numeric extraction for charting
                clean_val = re.sub(r'[^\d.]', '', row["value"])
                val = float(clean_val) if clean_val else 0.0
                trends.append({
                    "date": row["reports"]["report_date"],
                    "value": val,
                    "unit": row["unit"]
                })
            except: continue
            
        # Sort by date
        trends.sort(key=lambda x: x["date"])
        return jsonify(trends)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500

@app.route("/api/v1/biomarkers/<int:marker_id>", methods=["PUT"])
def update_biomarker(marker_id):
    if not supabase: return jsonify({"detail": "Not configured"}), 500
    try:
        new_value = request.args.get("value")
        logger.info(f"Updating biomarker {marker_id} to value: {new_value}")
        res = supabase.table("biomarkers").update({"value": new_value}).eq("id", marker_id).execute()
        return jsonify(res.data)
    except Exception as e:
        logger.exception(f"Failed to update biomarker {marker_id}")
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/reports/<int:report_id>", methods=["DELETE"])
def delete_report(report_id):
    if not supabase: return jsonify({"detail": "Not configured"}), 500
    try:
        logger.info(f"Deleting report {report_id}")
        # Cascade delete is handled by Supabase if configured, but let's be explicit if needed
        # Or just delete the report and let Supabase DB handle the rest.
        res = supabase.table("reports").delete().eq("id", report_id).execute()
        return jsonify({"status": "deleted", "data": res.data})
    except Exception as e:
        logger.exception(f"Failed to delete report {report_id}")
        return jsonify({"detail": str(e)}), 500


@app.route("/uploads/<path:filename>")
def serve_uploads_api(filename):
    return send_from_directory(UPLOAD_DIR, filename)

@app.route("/<path:path>")
def serve_static(path):
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
