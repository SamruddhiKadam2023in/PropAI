import enum
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class AgreementStatus(str, enum.Enum):
    ACTIVE = "active"            # stored; shown as "completed" once the term has run out (see services.agreements)
    COMPLETED = "completed"      # the term ran out normally
    TERMINATED = "terminated"    # the tenant left early with the agreement formally ended
    ABANDONED = "abandoned"      # the tenant left early without ending it


class Agreement(Base):
    """
    The rental agreement between one tenant and one property: the rent and term that fix what the tenant owes.
    The rent is a snapshot, so a later change to the property's advertised rent never rewrites an agreement.
    """
    __tablename__ = "agreements"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)

    monthly_rent = Column(Numeric(12, 2), nullable=False)
    start_date = Column(Date, nullable=False)
    term_months = Column(Integer, nullable=False, default=12)
    end_date = Column(Date, nullable=False)          # last day of the term (derived from start_date + term_months)

    status = Column(String(20), nullable=False, default=AgreementStatus.ACTIVE.value, server_default="active")
    terminated_on = Column(Date, nullable=True)      # the day the tenant left
    termination_reason = Column(Text, nullable=True)
    terminated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tenant = relationship("User", foreign_keys=[tenant_id])
    property = relationship("Property", foreign_keys=[property_id])
