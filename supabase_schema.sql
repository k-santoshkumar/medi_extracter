-- Run this in your Supabase SQL editor to create the expected tables!

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE
);

CREATE TABLE public.reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES public.users(id),
  filename TEXT,
  patient_name TEXT,
  report_date TEXT,
  lab_name TEXT,
  doctor_name TEXT,
  file_path TEXT,
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.biomarkers (
  id SERIAL PRIMARY KEY,
  report_id INTEGER REFERENCES public.reports(id) ON DELETE CASCADE,
  marker_name TEXT,
  original_name TEXT,
  value TEXT,
  unit TEXT,
  reference_range TEXT
);
