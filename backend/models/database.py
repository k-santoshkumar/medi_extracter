import datetime
import os

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()


def get_database_url() -> str:
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("AZURE_POSTGRES_URL")
    if database_url:
        return database_url

    if os.environ.get("ALLOW_SQLITE_FALLBACK", "false").lower() in {"1", "true", "yes", "on"}:
        return "sqlite:///./medical_data.db"

    raise RuntimeError(
        "DATABASE_URL or AZURE_POSTGRES_URL is required. Azure PostgreSQL is the default production database."
    )


_database_url = get_database_url()
_engine_kwargs = {"pool_pre_ping": True}
if _database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(_database_url, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=True)
    reports = relationship("Report", back_populates="user")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    filename = Column(String)
    patient_name = Column(String)
    report_date = Column(String)
    lab_name = Column(String)
    doctor_name = Column(String)
    file_path = Column(String)
    upload_date = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="reports")
    biomarkers = relationship("Biomarker", back_populates="report", cascade="all, delete-orphan")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    source_path = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    status = Column(String(20), nullable=False, default="queued", index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)


class Biomarker(Base):
    __tablename__ = "biomarkers"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id"), index=True)
    marker_name = Column(String, index=True)
    original_name = Column(String)
    value = Column(String)
    unit = Column(String)
    reference_range = Column(String)

    report = relationship("Report", back_populates="biomarkers")


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
