import os
import base64
import io
import pandas as pd
import re
from PIL import Image
from pdf2image import convert_from_path
from PyPDF2 import PdfReader
from langchain_google_genai import ChatGoogleGenerativeAI
from .normalization_service import get_llm
import logging

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """
You are expert in extracting data from medical records. Your task is to extract the biomarker values from the provided medical report.

Instructions:
1. Extract ALL biomarker names and their corresponding values.
2. The output MUST be a Markdown table.
3. The table columns MUST be: patient_name, report_date, lab_name, doctor_name, marker_name, value, unit, reference_range, confidence.
4. The 'confidence' column must be either "high" or "low" based on how clearly the value is legible in the report.
5. If a field is not found, use "N/A".
6. Standardize the date to mm-dd-yyyy format.
7. Do NOT include units in the 'value' column; put them in the 'unit' column.

Medical Report:
"""

def df_to_result_dict(df):
    """Converts the extracted DataFrame into the dictionary format expected by the backend."""
    if df.empty:
        return {
            "patient_name": "N/A",
            "report_date": "N/A",
            "lab_name": "N/A",
            "doctor_name": "N/A",
            "biomarkers": []
        }
    
    # Clean up column names (Gemini sometimes adds extra spaces)
    df.columns = [c.strip().lower() for c in df.columns]
    
    # Extract common fields from the first row
    first_row = df.iloc[0]
    
    # Helper to clean N/A strings
    def clean(val):
        if pd.isna(val) or str(val).lower() in ["n/a", "none", "nan", ""]:
            return "N/A"
        return str(val).strip()

    result = {
        "patient_name": clean(first_row.get("patient_name")),
        "report_date": clean(first_row.get("report_date")),
        "lab_name": clean(first_row.get("lab_name")),
        "doctor_name": clean(first_row.get("doctor_name")),
        "biomarkers": []
    }
    
    # Extract markers
    for _, row in df.iterrows():
        marker_name = clean(row.get("marker_name"))
        if marker_name != "N/A":
            result["biomarkers"].append({
                "marker_name": marker_name,
                "value": clean(row.get("value")),
                "unit": clean(row.get("unit")),
                "reference_range": clean(row.get("reference_range")),
                "confidence": clean(row.get("confidence")).lower()
            })
    
    return result

def markdown_to_df(markdown_text):
    """Parses markdown table(s) into a single pandas DataFrame."""
    try:
        # Improved regex to handle potential leading/trailing spaces and varying line breaks
        table_pattern = r"(\|.*\|(?:\n|\r)?)+"
        tables = re.findall(table_pattern, markdown_text)
        
        if not tables:
            # Fallback: find any line starting and ending with |
            rows = [line.strip() for line in markdown_text.split("\n") if line.strip().startswith("|") and line.strip().endswith("|")]
            if len(rows) < 3: return pd.DataFrame()
            
            data_rows = []
            headers = [h.strip() for h in rows[0].strip("|").split("|")]
            for r in rows[2:]:
                vals = [v.strip() for v in r.strip("|").split("|")]
                if len(vals) == len(headers):
                    data_rows.append(vals)
            return pd.DataFrame(data_rows, columns=headers)

        combined_df = pd.DataFrame()
        # Find all blocks that look like tables
        table_blocks = re.finditer(r"((?:\|.+\|(?:\n|\r?))+)", markdown_text)
        
        for match in table_blocks:
            table_text = match.group(0).strip()
            rows = [r.strip() for r in table_text.split("\n") if r.strip()]
            if len(rows) < 3: continue
            
            headers = [h.strip() for h in rows[0].strip("|").split("|")]
            
            data = []
            for row in rows[2:]: # Skip header and separator row
                values = [v.strip() for v in row.strip("|").split("|")]
                if len(values) == len(headers):
                    data.append(values)
            
            if data:
                df = pd.DataFrame(data, columns=headers)
                combined_df = pd.concat([combined_df, df], ignore_index=True)
        
        return combined_df
    except Exception as e:
        print(f"Error parsing markdown: {e}")
        return pd.DataFrame()

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_data_from_document(file_path):
    """
    Multimodal extraction pipeline.
    Handles PDF (text-based or scanned) and Image formats.
    """
    llm = get_llm()
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext == ".pdf":
        try:
            reader = PdfReader(file_path)
            text = "\n".join(page.extract_text() for page in reader.pages if page.extract_text())
            
            if len(text.strip()) < 100:
                return extract_data_from_images(file_path, is_pdf=True)
            
            response = llm.invoke(EXTRACTION_PROMPT + text).content
            df = markdown_to_df(response)
            return df_to_result_dict(df)
        except Exception as e:
            logger.warning(f"Text-based PDF extraction failed: {e}. Falling back to Vision.")
            return extract_data_from_images(file_path, is_pdf=True)
        
    elif file_ext in [".jpg", ".jpeg", ".png"]:
        df = extract_data_from_images(file_path, is_pdf=False)
        return df_to_result_dict(df)
        
    else:
        raise ValueError(f"Unsupported file format: {file_ext}")

def pdf_to_images(pdf_path):
    """Converts PDF pages to base64 encoded PNG images."""
    pages = convert_from_path(pdf_path)
    images_base64 = []
    for page in pages:
        buf = io.BytesIO()
        page.save(buf, format="PNG")
        images_base64.append(base64.b64encode(buf.getvalue()).decode('utf-8'))
    return images_base64

def extract_data_from_images(file_path, is_pdf=False):
    """Uses Gemini 2.0 Flash Vision to extract data from images/scans."""
    llm = get_llm()
    
    images_base64 = []
    if is_pdf:
        images_base64 = pdf_to_images(file_path)
    else:
        images_base64.append(encode_image(file_path))

    # Construct multimodal message
    content = [{"type": "text", "text": EXTRACTION_PROMPT}]
    for b64 in images_base64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"}
        })

    messages = [{"role": "user", "content": content}]
    response = llm.invoke(messages).content
    return markdown_to_df(response)
