import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))  # write next to this script
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BRAND = (255, 122, 0, 255)
BRAND_DARK = (217, 101, 0, 255)
NAVY = (28, 35, 51, 255)
WHITE = (255, 255, 255, 255)
GLASS = (191, 219, 254, 255)
DARK = (17, 21, 31, 255)

def rr(draw, box, r, **kw):
    draw.rounded_rectangle(box, radius=r, **kw)

def draw_truck(size, bg=None, pad_ratio=0.12, wordmark=True):
    """Side-view moving truck, drawn fully inside a (1-2*pad_ratio) square so it
    never clips regardless of padding. Canvas is size x size."""
    S = size * 4  # supersample, downscaled at the end
    img = Image.new("RGBA", (S, S), bg if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = S * pad_ratio
    iw = S - 2 * pad          # inner drawable width
    ih = S - 2 * pad          # inner drawable height
    ox, oy = pad, pad         # inner-origin offset

    # truck footprint as fractions of the inner box (designed at ~0.9 x 0.46 aspect)
    truck_w = iw
    truck_h = ih * 0.62
    top = oy + (ih - truck_h) / 2   # vertical-center the truck in the inner box
    ground_y = top + truck_h * 0.78
    wheel_r = truck_h * 0.235

    box_h = truck_h * 0.66
    box_w = truck_w * 0.60
    box_x0 = ox
    box_y0 = ground_y - box_h
    box_x1 = box_x0 + box_w

    cab_w = truck_w * 0.30
    cab_h = truck_h * 0.50
    gap = truck_w * 0.02
    cab_x0 = box_x1 + gap
    cab_y0 = ground_y - cab_h
    cab_x1 = cab_x0 + cab_w  # == ox + truck_w (right edge of inner box)

    lw = max(2, int(S * 0.012))

    # cargo box
    rr(d, [box_x0, box_y0, box_x1, ground_y], S * 0.03, fill=WHITE, outline=DARK, width=lw)
    d.rectangle([box_x0, box_y0, box_x1, box_y0 + box_h * 0.14], fill=BRAND_DARK)
    d.rectangle([box_x0, ground_y - box_h * 0.10, box_x1, ground_y - box_h * 0.10 + box_h * 0.07], fill=BRAND)

    # cab
    cab_pts = [
        (cab_x0, ground_y),
        (cab_x0, cab_y0 + cab_h * 0.24),
        (cab_x0 + cab_w * 0.14, cab_y0),
        (cab_x1 - cab_w * 0.08, cab_y0),
        (cab_x1, cab_y0 + cab_h * 0.17),
        (cab_x1, ground_y),
    ]
    d.polygon(cab_pts, fill=BRAND, outline=DARK, width=lw)
    wind = [
        (cab_x0 + cab_w * 0.20, cab_y0 + cab_h * 0.33),
        (cab_x0 + cab_w * 0.15, cab_y0 + cab_h * 0.07),
        (cab_x1 - cab_w * 0.16, cab_y0 - cab_h * 0.02),
        (cab_x1 - cab_w * 0.14, cab_y0 + cab_h * 0.33),
    ]
    d.polygon(wind, fill=GLASS, outline=DARK, width=max(2, int(S * 0.008)))
    d.line([(cab_x0 + cab_w * 0.55, cab_y0 + cab_h * 0.33), (cab_x0 + cab_w * 0.55, ground_y)], fill=DARK, width=max(2, int(S * 0.007)))
    hl_r = cab_w * 0.075
    d.ellipse([cab_x1 - hl_r * 2.6, ground_y - cab_h * 0.30, cab_x1 - hl_r * 0.6, ground_y - cab_h * 0.30 + hl_r * 2], fill=(255, 230, 150, 255), outline=DARK, width=max(2, int(S * 0.006)))

    # bumper joining box + cab
    d.rectangle([box_x1 - S * 0.006, ground_y - box_h * 0.09, cab_x0 + S * 0.012, ground_y], fill=DARK)

    # wheels
    for cx in (box_x0 + box_w * 0.25, cab_x0 + cab_w * 0.60):
        d.ellipse([cx - wheel_r, ground_y - wheel_r * 0.1, cx + wheel_r, ground_y - wheel_r * 0.1 + wheel_r * 2], fill=DARK)
        cy = ground_y - wheel_r * 0.1 + wheel_r
        hub_r = wheel_r * 0.42
        d.ellipse([cx - hub_r, cy - hub_r, cx + hub_r, cy + hub_r], fill=(120, 128, 145, 255))
        d.ellipse([cx - hub_r * 0.35, cy - hub_r * 0.35, cx + hub_r * 0.35, cy + hub_r * 0.35], fill=(200, 205, 215, 255))

    wheel_bottom = ground_y - wheel_r * 0.1 + wheel_r * 2
    d.line([(box_x0 - S * 0.015, wheel_bottom + S * 0.01), (cab_x1 + S * 0.015, wheel_bottom + S * 0.01)], fill=(0, 0, 0, 40), width=max(2, int(S * 0.008)))

    if wordmark:
        line1, line2 = "MyTruck", "Movers"
        fsz = int(box_w * 0.205)
        f1 = ImageFont.truetype(FONT_BOLD, fsz)
        b1 = d.textbbox((0, 0), line1, font=f1)
        b2 = d.textbbox((0, 0), line2, font=f1)
        w1, h1 = b1[2] - b1[0], b1[3] - b1[1]
        w2, h2 = b2[2] - b2[0], b2[3] - b2[1]
        gap_y = box_h * 0.07
        total_h = h1 + h2 + gap_y
        top_area = box_y0 + box_h * 0.14
        bottom_area = ground_y - box_h * 0.10
        avail_h = bottom_area - top_area
        start_y = top_area + (avail_h - total_h) / 2
        cx = (box_x0 + box_x1) / 2
        d.text((cx - w1 / 2 - b1[0], start_y - b1[1]), line1, font=f1, fill=NAVY)
        d.text((cx - w2 / 2 - b2[0], start_y + h1 + gap_y - b2[1]), line2, font=f1, fill=BRAND_DARK)

    return img.resize((size, size), Image.LANCZOS)

def save(img, path):
    img.save(path)
    print(path, img.size)

icon = draw_truck(1024, bg=NAVY, pad_ratio=0.13)
save(icon, os.path.join(OUT, "icon.png"))

adaptive = draw_truck(1024, bg=None, pad_ratio=0.24)
save(adaptive, os.path.join(OUT, "adaptive-icon.png"))

sw, sh = 1284, 2778
splash = Image.new("RGBA", (sw, sh), NAVY)
logo = draw_truck(820, bg=None, pad_ratio=0.05)
lx, ly = (sw - 820) // 2, (sh - 820) // 2 - 160
splash.alpha_composite(logo, (lx, ly))
d = ImageDraw.Draw(splash)
f = ImageFont.truetype(FONT_BOLD, 70)
txt = "MyTruckMovers"
bb = d.textbbox((0, 0), txt, font=f)
d.text(((sw - (bb[2] - bb[0])) / 2 - bb[0], ly + 820 + 50), txt, font=f, fill=WHITE)
save(splash, os.path.join(OUT, "splash.png"))

fav_src = draw_truck(512, bg=NAVY, pad_ratio=0.13)
save(fav_src, os.path.join(OUT, "favicon.png"))
for sz in (16, 32, 48, 180, 192, 512):
    im = fav_src.resize((sz, sz), Image.LANCZOS)
    save(im, os.path.join(OUT, f"icon-{sz}.png"))

ui_logo = draw_truck(256, bg=None, pad_ratio=0.04)
save(ui_logo, os.path.join(OUT, "logo.png"))
