#!/usr/bin/env python3
"""
Entry point for MedExtract API.
Run from the project root:  python run.py
"""
import os
import sys

from backend.main import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
