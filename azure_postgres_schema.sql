-- Run this in Azure Database for PostgreSQL after creating the database.

CREATE TABLE IF NOT EXISTS public.users (
  id VARCHAR(36) PRIMARY KEY,
  username TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS public.reports (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES public.users(id),
  filename TEXT,
  patient_name TEXT,
  report_date TEXT,
  lab_name TEXT,
  doctor_name TEXT,
  file_path TEXT,
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.biomarkers (
  id SERIAL PRIMARY KEY,
  report_id INTEGER REFERENCES public.reports(id) ON DELETE CASCADE,
  marker_name TEXT,
  original_name TEXT,
  value TEXT,
  unit TEXT,
  reference_range TEXT
);

CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES public.users(id),
  source_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  report_id INTEGER REFERENCES public.reports(id),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_status
  ON public.processing_jobs(user_id, status);
