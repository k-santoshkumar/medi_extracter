import os
from backend.services.extraction_service import extract_data_from_document
import pandas as pd

def test_extraction():
    # Use one of the PDFs from attachments
    pdf_path = "attachments/MR. SANTOSH KUMAR K.pdf"
    if not os.path.exists(pdf_path):
        # Fallback to any pdf in attachments if specific one not found
        import glob
        pdfs = glob.glob("attachments/*.pdf")
        if pdfs:
            pdf_path = pdfs[0]
        else:
            print("No PDF found in attachments to test.")
            return

    print(f"Testing extraction with: {pdf_path}")
    try:
        result = extract_data_from_document(pdf_path)
        print("Extraction Successful!")
        print("\nExtracted Metadata:")
        print(f"Patient: {result.get('patient_name')}")
        print(f"Date: {result.get('report_date')}")
        print(f"Lab: {result.get('lab_name')}")
        print(f"Doctor: {result.get('doctor_name')}")
        
        biomarkers = result.get("biomarkers", [])
        print(f"\nExtracted Biomarkers ({len(biomarkers)}):")
        for b in biomarkers[:5]:
            print(f"- {b['marker_name']}: {b['value']} {b['unit']}")
        
        # Check for expected keys
        expected = ["patient_name", "report_date", "biomarkers"]
        missing = [key for key in expected if key not in result]
        if missing:
            print(f"Warning: Missing expected keys: {missing}")
        else:
            print("\nAll expected keys present.")
            
    except Exception as e:
        print(f"Extraction failed: {e}")

if __name__ == "__main__":
    test_extraction()
