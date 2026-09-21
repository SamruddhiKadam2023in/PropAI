from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PropertyCreate(BaseModel):
    title: str
    address: str
    city: str
    state: str
    pincode: str
    property_type: str
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    area_sqft: Optional[float] = None
    rent_amount: float
    description: Optional[str] = None
    amenities: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class PropertyUpdate(BaseModel):
    title: Optional[str] = None
    rent_amount: Optional[float] = None
    description: Optional[str] = None
    is_available: Optional[bool] = None
    tenant_id: Optional[int] = None
    amenities: Optional[str] = None


class PropertyResponse(BaseModel):
    id: int
    title: str
    address: str
    city: str
    state: str
    pincode: str
    property_type: str
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    area_sqft: Optional[float] = None
    rent_amount: float
    description: Optional[str] = None
    amenities: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    image_url: Optional[str] = None
    is_available: bool
    owner_id: int
    tenant_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}
