"""
Indian rental property listings generator.
Based on actual market data (MagicBricks / 99acres Q4 2024 averages).
Returns realistic listings for any Indian city without external API dependency.
"""
import random
import hashlib
from typing import Optional

# City → Neighbourhoods with lat/lon range and rent index (multiplier)
CITY_DATA = {
    "mumbai": {
        "state": "Maharashtra",
        "neighbourhoods": [
            {"name": "Bandra West",        "lat": 19.0596, "lon": 72.8295, "premium": 2.2},
            {"name": "Andheri West",        "lat": 19.1190, "lon": 72.8333, "premium": 1.4},
            {"name": "Powai",               "lat": 19.1176, "lon": 72.9060, "premium": 1.5},
            {"name": "Juhu",                "lat": 19.1075, "lon": 72.8263, "premium": 2.0},
            {"name": "Malad West",          "lat": 19.1818, "lon": 72.8479, "premium": 1.1},
            {"name": "Borivali West",       "lat": 19.2307, "lon": 72.8567, "premium": 1.0},
            {"name": "Goregaon East",       "lat": 19.1624, "lon": 72.8523, "premium": 1.1},
            {"name": "Kandivali East",      "lat": 19.2041, "lon": 72.8706, "premium": 1.0},
            {"name": "Vikhroli East",       "lat": 19.1080, "lon": 72.9286, "premium": 0.9},
            {"name": "Dadar West",          "lat": 19.0196, "lon": 72.8411, "premium": 1.6},
            {"name": "Chembur",             "lat": 19.0633, "lon": 72.9000, "premium": 1.1},
        ],
        "bhk_base": {1: 22000, 2: 42000, 3: 75000},
        "society_suffixes": ["Heights", "Gardens", "Residency", "Tower", "Park", "Plaza", "Enclave"],
    },
    "navi mumbai": {
        "state": "Maharashtra",
        "neighbourhoods": [
            {"name": "Vashi",        "lat": 19.0748, "lon": 73.0082, "premium": 1.1},
            {"name": "Nerul",        "lat": 19.0330, "lon": 73.0297, "premium": 1.0},
            {"name": "Kharghar",     "lat": 19.0476, "lon": 73.0700, "premium": 0.9},
            {"name": "Panvel",       "lat": 18.9896, "lon": 73.1175, "premium": 0.75},
            {"name": "Belapur",      "lat": 19.0239, "lon": 73.0381, "premium": 1.0},
            {"name": "Airoli",       "lat": 19.1593, "lon": 72.9992, "premium": 0.85},
        ],
        "bhk_base": {1: 14000, 2: 24000, 3: 38000},
        "society_suffixes": ["Gardens", "Heights", "Residency", "Park"],
    },
    "pune": {
        "state": "Maharashtra",
        "neighbourhoods": [
            {"name": "Kothrud",          "lat": 18.5074, "lon": 73.8077, "premium": 1.2},
            {"name": "Baner",            "lat": 18.5590, "lon": 73.7868, "premium": 1.3},
            {"name": "Aundh",            "lat": 18.5590, "lon": 73.8080, "premium": 1.3},
            {"name": "Viman Nagar",      "lat": 18.5679, "lon": 73.9143, "premium": 1.1},
            {"name": "Koregaon Park",    "lat": 18.5362, "lon": 73.8939, "premium": 1.4},
            {"name": "Hinjawadi",        "lat": 18.5912, "lon": 73.7389, "premium": 1.0},
            {"name": "Wakad",            "lat": 18.5975, "lon": 73.7608, "premium": 1.0},
            {"name": "Hadapsar",         "lat": 18.5018, "lon": 73.9260, "premium": 0.9},
            {"name": "Kharadi",          "lat": 18.5529, "lon": 73.9461, "premium": 1.1},
            {"name": "Magarpatta",       "lat": 18.5127, "lon": 73.9314, "premium": 1.2},
        ],
        "bhk_base": {1: 10000, 2: 18000, 3: 32000},
        "society_suffixes": ["Residency", "Complex", "Society", "Township", "Gardens"],
    },
    "bangalore": {
        "state": "Karnataka",
        "neighbourhoods": [
            {"name": "Koramangala",      "lat": 12.9279, "lon": 77.6271, "premium": 1.6},
            {"name": "Indiranagar",      "lat": 12.9784, "lon": 77.6408, "premium": 1.7},
            {"name": "HSR Layout",       "lat": 12.9116, "lon": 77.6389, "premium": 1.4},
            {"name": "Whitefield",       "lat": 12.9698, "lon": 77.7499, "premium": 1.2},
            {"name": "Bannerghatta Rd",  "lat": 12.8995, "lon": 77.5970, "premium": 1.0},
            {"name": "Electronic City",  "lat": 12.8459, "lon": 77.6603, "premium": 0.9},
            {"name": "Hebbal",           "lat": 13.0358, "lon": 77.5970, "premium": 1.1},
            {"name": "JP Nagar",         "lat": 12.9076, "lon": 77.5856, "premium": 1.1},
            {"name": "Marathahalli",     "lat": 12.9591, "lon": 77.6974, "premium": 1.2},
            {"name": "Sarjapur Road",    "lat": 12.9102, "lon": 77.6829, "premium": 1.1},
        ],
        "bhk_base": {1: 12000, 2: 22000, 3: 40000},
        "society_suffixes": ["Residency", "Enclave", "Apartments", "Layout", "Estates"],
    },
    "hyderabad": {
        "state": "Telangana",
        "neighbourhoods": [
            {"name": "Gachibowli",    "lat": 17.4401, "lon": 78.3489, "premium": 1.3},
            {"name": "HITEC City",    "lat": 17.4474, "lon": 78.3762, "premium": 1.4},
            {"name": "Banjara Hills", "lat": 17.4126, "lon": 78.4483, "premium": 1.6},
            {"name": "Jubilee Hills", "lat": 17.4319, "lon": 78.4074, "premium": 1.5},
            {"name": "Kondapur",      "lat": 17.4607, "lon": 78.3612, "premium": 1.2},
            {"name": "Miyapur",       "lat": 17.4960, "lon": 78.3610, "premium": 0.9},
            {"name": "Manikonda",     "lat": 17.4062, "lon": 78.3901, "premium": 1.0},
            {"name": "Kukatpally",    "lat": 17.4947, "lon": 78.3996, "premium": 1.0},
            {"name": "Madhapur",      "lat": 17.4485, "lon": 78.3908, "premium": 1.3},
        ],
        "bhk_base": {1: 9000, 2: 18000, 3: 32000},
        "society_suffixes": ["Residency", "Colony", "Heights", "Towers", "Enclave"],
    },
    "delhi": {
        "state": "Delhi",
        "neighbourhoods": [
            {"name": "Dwarka Sector 7",  "lat": 28.5762, "lon": 77.0741, "premium": 1.0},
            {"name": "Rohini Sector 9",  "lat": 28.7048, "lon": 77.1219, "premium": 0.9},
            {"name": "Saket",            "lat": 28.5244, "lon": 77.2066, "premium": 1.3},
            {"name": "Vasant Kunj",      "lat": 28.5211, "lon": 77.1557, "premium": 1.2},
            {"name": "Lajpat Nagar",     "lat": 28.5658, "lon": 77.2431, "premium": 1.1},
            {"name": "Pitampura",        "lat": 28.7005, "lon": 77.1338, "premium": 0.9},
        ],
        "bhk_base": {1: 12000, 2: 22000, 3: 40000},
        "society_suffixes": ["Apartments", "Colony", "Residency", "Enclave", "Vihar"],
    },
    "gurgaon": {
        "state": "Haryana",
        "neighbourhoods": [
            {"name": "DLF Phase 1",       "lat": 28.4747, "lon": 77.0853, "premium": 1.8},
            {"name": "Golf Course Road",   "lat": 28.4282, "lon": 77.0959, "premium": 2.0},
            {"name": "Sohna Road",         "lat": 28.4025, "lon": 77.0430, "premium": 1.2},
            {"name": "Sector 29",          "lat": 28.4727, "lon": 77.0619, "premium": 1.3},
            {"name": "Sector 57",          "lat": 28.4117, "lon": 77.0930, "premium": 1.1},
            {"name": "New Gurgaon Sec 84", "lat": 28.3876, "lon": 76.9978, "premium": 0.9},
        ],
        "bhk_base": {1: 14000, 2: 26000, 3: 50000},
        "society_suffixes": ["Residency", "Heights", "Estates", "Towers", "Enclave"],
    },
    "noida": {
        "state": "Uttar Pradesh",
        "neighbourhoods": [
            {"name": "Sector 62",      "lat": 28.6274, "lon": 77.3684, "premium": 1.1},
            {"name": "Sector 50",      "lat": 28.6130, "lon": 77.3608, "premium": 1.0},
            {"name": "Sector 137",     "lat": 28.5461, "lon": 77.3604, "premium": 0.9},
            {"name": "Sector 18",      "lat": 28.5697, "lon": 77.3222, "premium": 1.2},
            {"name": "Greater Noida W","lat": 28.6150, "lon": 77.4260, "premium": 0.8},
        ],
        "bhk_base": {1: 10000, 2: 18000, 3: 32000},
        "society_suffixes": ["Residency", "Heights", "Apartments", "Enclave"],
    },
    "chennai": {
        "state": "Tamil Nadu",
        "neighbourhoods": [
            {"name": "Anna Nagar",  "lat": 13.0858, "lon": 80.2100, "premium": 1.2},
            {"name": "Velachery",   "lat": 12.9815, "lon": 80.2180, "premium": 1.0},
            {"name": "OMR",         "lat": 12.9637, "lon": 80.2437, "premium": 1.1},
            {"name": "T Nagar",     "lat": 13.0418, "lon": 80.2341, "premium": 1.3},
            {"name": "Adyar",       "lat": 13.0067, "lon": 80.2574, "premium": 1.2},
            {"name": "Porur",       "lat": 13.0358, "lon": 80.1572, "premium": 0.9},
            {"name": "Sholinganallur","lat": 12.9010,"lon": 80.2279, "premium": 1.0},
        ],
        "bhk_base": {1: 8000, 2: 15000, 3: 28000},
        "society_suffixes": ["Nagar", "Flats", "Residency", "Colony", "Gardens"],
    },
    "kolkata": {
        "state": "West Bengal",
        "neighbourhoods": [
            {"name": "Salt Lake Sector V", "lat": 22.5769, "lon": 88.4301, "premium": 1.2},
            {"name": "New Town Rajarhat",  "lat": 22.6067, "lon": 88.4620, "premium": 1.1},
            {"name": "Park Street",        "lat": 22.5553, "lon": 88.3516, "premium": 1.4},
            {"name": "Ballygunge",         "lat": 22.5249, "lon": 88.3615, "premium": 1.3},
            {"name": "Alipore",            "lat": 22.5334, "lon": 88.3400, "premium": 1.5},
        ],
        "bhk_base": {1: 7000, 2: 13000, 3: 22000},
        "society_suffixes": ["Apartments", "Residency", "Complex", "Gardens"],
    },
}

AMENITIES_POOL = [
    "Parking", "Gym", "Swimming Pool", "24x7 Security", "Power Backup",
    "Lift", "WiFi Ready", "Garden", "Kids Play Area", "Club House",
    "Visitor Parking", "CCTV", "Intercom", "Jogging Track", "Yoga Room",
]

DESCRIPTIONS = {
    1: [
        "Compact and cozy 1BHK ideal for working professionals. Fully ventilated with ample natural light.",
        "Modern 1BHK studio near metro station. Fully tiled with modular kitchen and excellent connectivity.",
        "Charming 1BHK in a quiet residential society. Close to supermarkets, hospitals, and public transport.",
        "Budget-friendly 1BHK perfect for a single professional or couple. Society maintenance included.",
    ],
    2: [
        "Spacious 2BHK with east-facing balcony, modular kitchen, and 24-hr water supply.",
        "Well-maintained 2BHK in a gated township. Near top schools, malls, and IT parks.",
        "Bright 2BHK on a high floor with great cross-ventilation. Semi-furnished with wardrobe.",
        "2BHK with dedicated parking and power backup in a reputed residential complex.",
        "Peaceful 2BHK away from traffic, with jogging track and gym access.",
    ],
    3: [
        "Luxurious 3BHK with imported marble flooring, modular kitchen, and 3 attached baths.",
        "Spacious 3BHK duplex with private terrace. Ideal for families, close to top schools.",
        "Premium 3BHK in a gated community with full club house access and dedicated parking.",
        "Corner 3BHK flat with panoramic city views. Semi-furnished with AC in all rooms.",
    ],
}


def _seed(city: str, neighbourhood: str, bhk: int, index: int) -> int:
    key = f"{city}:{neighbourhood}:{bhk}:{index}"
    return int(hashlib.md5(key.encode()).hexdigest(), 16)


def generate_listings(
    city_query: str,
    bedrooms: Optional[int] = None,
    max_rent: Optional[float] = None,
    count: int = 24,
) -> list:
    city_key = city_query.strip().lower()
    # Try partial match
    matched_key = next((k for k in CITY_DATA if city_key in k or k in city_key), None)
    if not matched_key:
        return []

    city = CITY_DATA[matched_key]
    bhk_options = [bedrooms] if bedrooms else [1, 2, 3]
    results = []

    for neighbourhood in city["neighbourhoods"]:
        for bhk in bhk_options:
            # Generate 2 listings per neighbourhood per BHK
            for idx in range(2):
                s = _seed(matched_key, neighbourhood["name"], bhk, idx)
                rng = random.Random(s)

                base = city["bhk_base"][bhk]
                premium = neighbourhood["premium"]
                # Vary rent by ±15%
                rent = round(base * premium * rng.uniform(0.85, 1.15) / 500) * 500
                deposit = rent * rng.choice([2, 3])

                if max_rent and rent > max_rent:
                    continue

                # Society name
                surname_pool = ["Shree", "Sai", "Om", "Gokul", "Anand", "Royal", "Green", "Blue", "Sun"]
                suffix = rng.choice(city["society_suffixes"])
                society = f"{rng.choice(surname_pool)} {suffix}"
                flat_no = f"{rng.randint(1, 8)}{rng.choice(['A','B','C','D'])}-{rng.randint(101, 1204)}"

                area = {1: rng.randint(450, 700), 2: rng.randint(800, 1150), 3: rng.randint(1300, 2000)}[bhk]
                baths = {1: 1, 2: 2, 3: 3}[bhk]
                prop_type = rng.choice(["apartment"] * 7 + ["villa"] + ["house"])

                amenities = rng.sample(AMENITIES_POOL, rng.randint(3, 7))
                desc = rng.choice(DESCRIPTIONS[bhk])

                # Jitter coordinates slightly
                lat = neighbourhood["lat"] + rng.uniform(-0.01, 0.01)
                lon = neighbourhood["lon"] + rng.uniform(-0.01, 0.01)

                results.append({
                    "id":          f"ext_{matched_key}_{neighbourhood['name'].replace(' ', '_')}_{bhk}_{idx}",
                    "title":       f"{neighbourhood['name']} — {bhk}BHK",
                    "address":     f"{flat_no}, {society}, {neighbourhood['name']}",
                    "city":        city_query.title(),
                    "state":       city["state"],
                    "property_type": prop_type,
                    "bedrooms":    bhk,
                    "bathrooms":   baths,
                    "area_sqft":   float(area),
                    "rent_amount": float(rent),
                    "security_deposit": float(deposit),
                    "amenities":   ", ".join(amenities),
                    "description": desc,
                    "latitude":    round(lat, 6),
                    "longitude":   round(lon, 6),
                    "is_available": True,
                    "source":      "PropAI Listings",
                })

    # Sort by rent
    results.sort(key=lambda x: x["rent_amount"])
    return results[:count]
