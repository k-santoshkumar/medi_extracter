import os
from dotenv import load_dotenv
from supabase import create_client, Client
import google.generativeai as genai

load_dotenv()

def check_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    print(f"Supabase URL: {url}")
    try:
        supabase: Client = create_client(url, key)
        res = supabase.table("reports").select("id").limit(1).execute()
        print("Supabase connection: OK")
    except Exception as e:
        print(f"Supabase connection: FAILED - {e}")

def check_gemini():
    api_key = os.environ.get("GOOGLE_API_KEY")
    print(f"Google API Key: {api_key[:5]}...{api_key[-5:] if api_key else ''}")
    try:
        genai.configure(api_key=api_key)
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"Model: {m.name}")
    except Exception as e:
        print(f"Gemini connection: FAILED - {e}")

if __name__ == "__main__":
    check_supabase()
    print("-" * 20)
    check_gemini()
