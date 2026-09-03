import json
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI  # type: ignore

load_dotenv()

# Global cache for column mappings to minimize LLM calls
COLUMN_MAPPING_CACHE = {}

NORMALization_PROMPT = """
You are a medical data expert. Normalize the following biomarker names into standard generic terms (e.g., ALT, AST, HbA1c, CRP, creatinine, bilirubin, Hemoglobin, etc.). 
Use common medical conventions and international nomenclature guidelines.

Rules:
1. Use only standard abbreviations or generic names.
2. Remove units, reference ranges, and method information.
3. Convert similar names to single standard (e.g., "Hemoglobin", "Hb", "Hgb" -> "Hemoglobin").
4. If a name is already standard, return it as is.
5. For non-biomarker names (like "Patient Name", "Date"), return "ignore".

Column names to normalize: {columns}

Return ONLY a JSON dictionary:
{{
  "original_name": "normalized_name_or_ignore"
}}
"""


def get_llm():
    return ChatOpenAI(
        model=os.getenv("MODEL_NAME", "gpt-4o-mini"),
        temperature=0,
        api_key=os.getenv("OPENAI_API_KEY"),
    )

def normalize_biomarker_names(columns):
    """
    Standardizes a list of biomarker names using Gemini 2.0 Flash.
    Uses a local cache to avoid redundant LLM calls.
    """
    global COLUMN_MAPPING_CACHE
    
    # Filter for names not in cache
    unseen_columns = [col for col in columns if col not in COLUMN_MAPPING_CACHE]
    
    if not unseen_columns:
        return {col: COLUMN_MAPPING_CACHE.get(col, col) for col in columns}
    
    try:
        llm = get_llm()
        prompt = NORMALization_PROMPT.format(columns=unseen_columns)
        response = llm.invoke(prompt).content
        
        # Clean up response
        cleaned = response.replace("```json", "").replace("```", "").strip()
        new_mappings = json.loads(cleaned)
        
        # Update cache
        for orig, normalized in new_mappings.items():
            COLUMN_MAPPING_CACHE[orig] = normalized
            
        return {col: COLUMN_MAPPING_CACHE.get(col, col) for col in columns}
        
    except Exception as e:
        print(f"Normalization failed: {e}")
        # Fallback to original names if LLM fails
        return {col: col for col in columns}
