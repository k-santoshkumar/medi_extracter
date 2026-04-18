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

EXTRACTION_PROMPT = """
You are expert in extracting data from medical records. Your task is to extract the biomarker values from the provided medical report.

Instructions:
1. Extract ALL biomarker names and their corresponding values.
2. The output MUST be a Markdown table.
3. The table columns MUST be: patient_name, report_date, lab_name, doctor_name, marker_name, value, unit, reference_range.
4. If a field is not found, use "N/A".
5. Standardize the date to mm-dd-yyyy format.
6. Do NOT include units in the 'value' column; put them in the 'unit' column.

Medical Report:
"""

def markdown_to_df(markdown_text):
    """Parses markdown table(s) into a single pandas DataFrame."""
    try:
        table_pattern = r"((?:\|.+\|(?:\n|\r))+\|.*\|)"
        tables = re.findall(table_pattern, markdown_text)
        if not tables:
            return pd.DataFrame()
            
        combined_df = pd.DataFrame()
        for table in tables:
            rows = [r.strip() for r in table.strip().split("\n")]
            if len(rows) < 3: continue
            
            headers = [h.strip() for h in rows[0].strip("|").split("|")]
            
            data = []
            for row in rows[2:]:
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
        # First try text extraction
        reader = PdfReader(file_path)
        text = "\n".join(page.extract_text() for page in reader.pages)
        
        # If text is too short, it might be a scan. Fallback to Vision.
        if len(text.strip()) < 100:
            return extract_data_from_images(file_path, is_pdf=True)
        
        response = llm.invoke(EXTRACTION_PROMPT + text).content
        return markdown_to_df(response)
        
    elif file_ext in [".jpg", ".jpeg", ".png"]:
        return extract_data_from_images(file_path, is_pdf=False)
        
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
