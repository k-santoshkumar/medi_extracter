import os
import shutil
import uuid
import datetime
from typing import List, Optional
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel

from backend.services.extraction_service import extract_data_from_document
from backend.services.normalization_service import normalize_biomarker_names

# ── App Setup ────────────────────────────────────────────────────────────────
load_dotenv()

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

UPLOAD_DIR = "./uploads"
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


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.route("/uploads/<path:filename>")
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "service": "MedExtract API connected to Supabase"})


@app.route("/api/v1/upload", methods=["POST"])
def upload_medical_record():
    if "file" not in request.files:
        return jsonify({"detail": "No file part"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"detail": "No selected file"}), 400
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"detail": f"Unsupported file type '{ext}'. Allowed: PDF, JPG, PNG"}), 400

    # Save uploaded file
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    file.save(file_path)

    # Extract biomarkers using Gemini
    try:
        df = extract_data_from_document(file_path)
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)  # Cleanup on failure
        return jsonify({"detail": f"Extraction failed: {str(e)}"}), 500

    if df.empty:
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"detail": "Could not extract data. Please ensure this is a valid medical report."}), 422

    # Normalize biomarker columns
    META_COLS = {"patient_name", "report_date", "lab_name", "doctor_name"}
    biomarker_cols = [c for c in df.columns if str(c).lower() not in META_COLS]
    col_map = normalize_biomarker_names(biomarker_cols)

    is_long_format = "marker_name" in df.columns and "value" in df.columns
    first_row = df.iloc[0] if not df.empty else {}

    patient_name = str(first_row.get("patient_name", "N/A")).strip() if "patient_name" in first_row else "N/A"
    report_date  = str(first_row.get("report_date", "N/A")).strip() if "report_date" in first_row else "N/A"
    lab_name     = str(first_row.get("lab_name", "N/A")).strip() if "lab_name" in first_row else "N/A"
    doctor_name  = str(first_row.get("doctor_name", "N/A")).strip() if "doctor_name" in first_row else "N/A"

    try:
        report_data = {
            "filename": file.filename,
            "patient_name": patient_name,
            "report_date": report_date,
            "lab_name": lab_name,
            "doctor_name": doctor_name,
            "file_path": file_path,
            "upload_date": datetime.datetime.utcnow().isoformat()
        }
        res = supabase.table("reports").insert(report_data).execute()
        if not res.data:
            raise Exception("Failed to insert report into Supabase")
        report = res.data[0]
        report_id = report["id"]

        biomarkers_to_insert = []
        if is_long_format:
            for _, row in df.iterrows():
                original = str(row.get("marker_name", "")).strip()
                if not original or original.lower() == "n/a":
                    continue
                normalized = col_map.get(original, original)
                if normalized.lower() == "ignore":
                    continue
                biomarkers_to_insert.append({
                    "report_id": report_id,
                    "marker_name": normalized,
                    "original_name": original,
                    "value": str(row.get("value", "N/A")).strip(),
                    "unit": str(row.get("unit", "")).strip(),
                    "reference_range": str(row.get("reference_range", "")).strip()
                })
        else:
            for original_col in biomarker_cols:
                normalized = col_map.get(original_col, str(original_col))
                if normalized.lower() == "ignore":
                    continue
                for _, row in df.iterrows():
                    val = str(row.get(original_col, "N/A")).strip()
                    if val and val.lower() not in ("n/a", "nan", ""):
                        biomarkers_to_insert.append({
                            "report_id": report_id,
                            "marker_name": normalized,
                            "original_name": str(original_col),
                            "value": val,
                            "unit": "",
                            "reference_range": ""
                        })

        if biomarkers_to_insert:
            supabase.table("biomarkers").insert(biomarkers_to_insert).execute()
        
        final_res = supabase.table("reports").select("*, biomarkers(*)").eq("id", report_id).single().execute()
        result = ReportOut.model_validate(final_res.data).model_dump(mode="json")
        return jsonify(result), 201

    except Exception as e:
        return jsonify({"detail": f"Database error: {str(e)}"}), 500


@app.route("/api/v1/reports", methods=["GET"])
def list_reports():
    try:
        res = supabase.table("reports").select("*, biomarkers(*)").order("upload_date", desc=True).execute()
        result = [ReportOut.model_validate(r).model_dump(mode="json") for r in res.data]
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/reports/<int:report_id>", methods=["GET"])
def get_report(report_id):
    try:
        res = supabase.table("reports").select("*, biomarkers(*)").eq("id", report_id).maybe_single().execute()
        if not res.data:
            return jsonify({"detail": "Report not found"}), 404
        result = ReportOut.model_validate(res.data).model_dump(mode="json")
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/biomarkers/<int:biomarker_id>", methods=["PUT"])
def update_biomarker(biomarker_id):
    try:
        data = request.get_json(silent=True) or request.args
        update_data = {}
        if "value" in data:
            update_data["value"] = data["value"]
        if "unit" in data:
            update_data["unit"] = data["unit"]
            
        res = supabase.table("biomarkers").update(update_data).eq("id", biomarker_id).execute()
        if not res.data:
            return jsonify({"detail": "Biomarker not found"}), 404
        return jsonify({"status": "updated", "id": biomarker_id}), 200
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/reports/<int:report_id>", methods=["DELETE"])
def delete_report(report_id):
    try:
        res = supabase.table("reports").select("file_path").eq("id", report_id).maybe_single().execute()
        if not res.data:
            return jsonify({"detail": "Report not found"}), 404
        
        file_path = res.data.get("file_path")
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
            
        supabase.table("reports").delete().eq("id", report_id).execute()
        return jsonify({"status": "deleted"}), 200
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.route("/api/v1/dashboard/stats", methods=["GET"])
def get_dashboard_stats():
    try:
        reports_res = supabase.table("reports").select("*").execute()
        total_reports = len(reports_res.data)
        
        bm_res = supabase.table("biomarkers").select("id, marker_name, value, unit, reports(report_date, lab_name)").execute()
        total_markers = len(bm_res.data)

        latest_report_date = None
        patient_name = None
        if reports_res.data:
            sorted_reports = sorted(reports_res.data, key=lambda x: x.get("report_date") or "", reverse=True)
            latest_report_date = sorted_reports[0].get("report_date")
            patient_name = sorted_reports[0].get("patient_name")

        latest_vitals = {}
        trends_dict = {}

        for bm in bm_res.data:
            m_name = bm.get("marker_name")
            v = bm.get("value")
            unit = bm.get("unit") or ""
            r_data = bm.get("reports") or {}
            
            # PostgREST may return list of dicts for one-to-many or dict for many-to-one
            if isinstance(r_data, list) and r_data:
                r_data = r_data[0]
            
            r_date = r_data.get("report_date") if isinstance(r_data, dict) else ""
            l_name = r_data.get("lab_name") if isinstance(r_data, dict) else ""

            if not r_date: r_date = ""
            if not l_name: l_name = ""

            if m_name not in latest_vitals:
                latest_vitals[m_name] = {"date": r_date, "value": v, "unit": unit}
            else:
                if r_date > latest_vitals[m_name]["date"]:
                    latest_vitals[m_name] = {"date": r_date, "value": v, "unit": unit}
                    
            if m_name not in trends_dict:
                trends_dict[m_name] = {"unit": unit, "data": []}
                
            val_to_check = str(v).lower() if v is not None else ""
            if v and val_to_check not in ("n/a", "nan", "none", ""):
                trends_dict[m_name]["data"].append({
                    "report_date": r_date,
                    "value": str(v),
                    "lab_name": l_name
                })

        trends = []
        for m_name, t_data in trends_dict.items():
            if t_data["data"]:
                t_data["data"].sort(key=lambda x: x["report_date"])
                trends.append(MarkerTrend(marker_name=m_name, unit=t_data["unit"], data=t_data["data"]))

        stats = DashboardStats(
            total_reports=total_reports,
            total_markers=total_markers,
            latest_report_date=latest_report_date,
            patient_name=patient_name,
            latest_vitals=latest_vitals,
            trends=trends,
        )
        return jsonify(stats.model_dump(mode="json")), 200

    except Exception as e:
        return jsonify({"detail": str(e)}), 500
