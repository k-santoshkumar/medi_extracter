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
        df = extract_data_from_document(pdf_path)
        print("Extraction Successful!")
        print("\nExtracted Data (first 5 rows):")
        print(df.head())
        
        # Check for expected columns
        expected = ["patient_name", "report_date", "marker_name", "value"]
        missing = [col for col in expected if col not in df.columns]
        if missing:
            print(f"Warning: Missing expected columns: {missing}")
        else:
            print("All expected columns present.")
            
    except Exception as e:
        print(f"Extraction failed: {e}")

if __name__ == "__main__":
    test_extraction()
