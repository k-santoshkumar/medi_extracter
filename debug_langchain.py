import os
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()
print("Google API Key exists:", bool(os.getenv("GOOGLE_API_KEY")))

try:
    llm = ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        temperature=0,
        google_api_key=os.getenv("GOOGLE_API_KEY")
    )
    print("LLM initialized")
    res = llm.invoke("Hello")
    print("Invoke successful:", res.content)
except Exception as e:
    print("Error:", e)
    import traceback
    traceback.print_exc()
