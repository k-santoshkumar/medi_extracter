#!/usr/bin/env python3
"""
Entry point for MedExtract API.
Run from the project root: python run.py
"""
import os

import uvicorn

from backend.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
