#!/usr/bin/env python3
"""
Entry point for MedExtract API.
Run from the project root:  python run.py
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["backend"],
    )
