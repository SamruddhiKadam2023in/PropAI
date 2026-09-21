import os, random, struct, zlib
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = os.path.dirname(os.path.abspath(__file__))       # writes next to this script (tests/assets)
os.makedirs(out, exist_ok=True)
font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 34)
big = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 44)


def bill(path, lines, fmt="PNG"):
    img = Image.new("RGB", (1100, 900), "white")
    d = ImageDraw.Draw(img)
    y = 50
    for i, line in enumerate(lines):
        d.text((60, y), line, fill="black", font=big if i < 2 else font)
        y += 80 if i < 2 else 68
    img.save(path, fmt)


bill(f"{out}/electricity_bill.png", [
    "TATA POWER", "ELECTRICITY BILL",
    "Consumer No: 1234567890",
    "Billing Date: 05/12/2025",
    "Meter Reading Units Consumed: 245 kWh",
    "Total Amount Due: Rs. 2,450.00",
    "Payment Due Date: 20/12/2025",
])
bill(f"{out}/water_bill.jpg", [
    "MCGM", "WATER BILL",
    "Water Supply Charges - Account No 88231",
    "Bill Date: 03/12/2025",
    "Water consumption 18 kl",
    "Total Amount Due: Rs. 640.00",
], fmt="JPEG")

# PDF bill (text PDF -> page rendered by the existing pipeline)
c = canvas.Canvas(f"{out}/gas_bill.pdf", pagesize=A4)
y = 780
for i, line in enumerate(["MAHANAGAR GAS", "GAS BILL", "Piped natural gas consumption - MGL connection",
                          "Billing Date: 10/12/2025", "Total Amount Due: Rs. 915.50"]):
    c.setFont("Helvetica-Bold" if i < 2 else "Helvetica", 22 if i < 2 else 16)
    c.drawString(60, y, line); y -= 40
c.save()

# blank image -> OCR finds no text
Image.new("RGB", (800, 600), "white").save(f"{out}/blank.png")

# valid PNG signature + IHDR, garbage body -> passes upload checks, OCR cannot decode it
good = open(f"{out}/electricity_bill.png", "rb").read()
# signature + IHDR then garbage: PIL rejects it at upload (400)
open(f"{out}/garbage.png", "wb").write(good[:33] + os.urandom(6000))


def corrupt_idat(data):
    """Keep a well-formed PNG chunk structure but destroy the pixel data (bad CRC + random bytes)."""
    res, pos = bytearray(data[:8]), 8
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos:pos + 12 + length]
        if ctype == b"IDAT":
            chunk = data[pos:pos + 8] + os.urandom(length) + data[pos + 8 + length:pos + 12 + length]
        res += chunk
        pos += 12 + length
    return bytes(res)


# passes the upload checks (header parses) but cannot be decoded by OCR
open(f"{out}/corrupt.png", "wb").write(corrupt_idat(good))

# PDF header + garbage -> passes sniff, OCR cannot open it
open(f"{out}/corrupt.pdf", "wb").write(b"%PDF-1.4\n" + os.urandom(3000))

# disguised executable named .png, plain text, empty, oversized
open(f"{out}/disguised.png", "wb").write(b"MZ\x90\x00" + b"\x00" * 200 + b"This program cannot be run in DOS mode")
open(f"{out}/notes.txt", "w").write("hello, this is not a document")
open(f"{out}/empty.png", "wb").write(b"")
open(f"{out}/toobig.png", "wb").write(good[:8] + b"\x00" * (10 * 1024 * 1024 + 10))
print("assets:", sorted(os.listdir(out)))
