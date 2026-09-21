from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey,
    DateTime, Text, Boolean,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    address = Column(String(500), nullable=False)
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    pincode = Column(String(10), nullable=False)
    property_type = Column(String(50), nullable=False)   # apartment / house / commercial
    bedrooms = Column(Integer, nullable=True)
    bathrooms = Column(Integer, nullable=True)
    area_sqft = Column(Float, nullable=True)
    rent_amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    amenities = Column(Text, nullable=True)              # JSON string list
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    image_url = Column(String(500), nullable=True)
    is_available = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Foreign keys
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    owner = relationship("User", back_populates="owned_properties", foreign_keys=[owner_id])
    tenant = relationship("User", back_populates="tenancies", foreign_keys=[tenant_id])
    documents = relationship("Document", back_populates="property")
    payments = relationship("Payment", back_populates="property")
    expenses = relationship("Expense", back_populates="property")
