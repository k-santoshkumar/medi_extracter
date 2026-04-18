from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import datetime

DATABASE_URL = "sqlite:///./medical_data.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    reports = relationship("Report", back_populates="user")


class Report(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    filename = Column(String)
    patient_name = Column(String)
    report_date = Column(String)
    lab_name = Column(String)
    doctor_name = Column(String)
    file_path = Column(String)
    upload_date = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="reports")
    biomarkers = relationship("Biomarker", back_populates="report", cascade="all, delete-orphan")


class Biomarker(Base):
    __tablename__ = "biomarkers"
    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"))
    marker_name = Column(String, index=True)   # Normalized name (e.g., "HbA1c")
    original_name = Column(String)             # As written in the report
    value = Column(String)                     # String to handle ranges like "4.5 x 2.3"
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
