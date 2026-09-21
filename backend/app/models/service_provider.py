from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.sql import func

from app.database import Base


class ServiceProvider(Base):
    """
    A maintenance / repair professional an owner or manager can contact (plumber, electrician, ...).

    Visibility: demo rows (is_demo=True, created_by NULL) are shared sample data for testing; every other row belongs to the
    user who created it and is private to them. Demo rows are read-only and use obviously fake phone numbers (+91 00000 xxxxx).
    """
    __tablename__ = "service_providers"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(150), nullable=False)
    category = Column(String(30), nullable=False, index=True)        # see services/provider_directory.py
    phone = Column(String(20), nullable=False)                       # E.164
    whatsapp = Column(String(20), nullable=True)                     # E.164
    email = Column(String(255), nullable=True)
    service_area = Column(String(150), nullable=False)               # e.g. "Mumbai / Navi Mumbai"
    availability = Column(String(80), nullable=True)                 # e.g. "9:00 AM – 7:00 PM"
    visit_charge = Column(Numeric(10, 2), nullable=True)             # INR
    status = Column(String(15), nullable=False, default="available", index=True)   # available / unavailable
    description = Column(Text, nullable=True)
    problem_types = Column(JSON, nullable=False, default=list)       # ["Tap leakage", "Pipe blockage", ...]
    is_demo = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
