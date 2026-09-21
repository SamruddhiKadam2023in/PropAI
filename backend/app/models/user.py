import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum as SAEnum, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class UserRole(str, enum.Enum):
    TENANT = "tenant"
    OWNER = "owner"
    MANAGER = "manager"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.TENANT, nullable=False)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True)
    # False only for a self-registered account that has not yet entered its emailed one-time code.
    email_verified = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    owned_properties = relationship(
        "Property", back_populates="owner", foreign_keys="Property.owner_id"
    )
    tenancies = relationship(
        "Property", back_populates="tenant", foreign_keys="Property.tenant_id"
    )
    documents = relationship("Document", back_populates="user")
    payments = relationship("Payment", back_populates="tenant")
