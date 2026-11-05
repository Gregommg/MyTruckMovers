import os
import shutil
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(ROOT, "truck-icon.png")


def render(size, icon_size=None, background=None):
    width, height = size
    canvas = Image.new("RGBA", size, background or (0, 0, 0, 0))
    with Image.open(SOURCE) as source:
        icon = source.convert("RGBA")
        if icon_size:
            icon.thumbnail((icon_size, icon_size), Image.LANCZOS)
        else:
            icon.thumbnail(size, Image.LANCZOS)
        canvas.alpha_composite(icon, ((width - icon.width) // 2, (height - icon.height) // 2))
    return canvas


def save(path, size, icon_size=None, background=None):
    render(size, icon_size, background).save(path)


def main():
    white = (255, 255, 255, 255)
    web_assets = os.path.join(ROOT, "..", "web", "assets")
    mobile_assets = os.path.join(ROOT, "..", "mobile", "assets")
    os.makedirs(web_assets, exist_ok=True)
    os.makedirs(mobile_assets, exist_ok=True)
    shutil.copyfile(SOURCE, os.path.join(web_assets, "truck-icon.png"))
    shutil.copyfile(SOURCE, os.path.join(mobile_assets, "truck-icon.png"))
    save(os.path.join(mobile_assets, "logo.png"), (256, 256))

    save(os.path.join(ROOT, "adaptive-icon.png"), (1024, 1024))
    save(os.path.join(ROOT, "favicon.png"), (512, 512), background=white)
    save(os.path.join(ROOT, "icon.png"), (1024, 1024), background=white)
    save(os.path.join(ROOT, "logo.png"), (256, 256))
    for size in (16, 32, 48, 180, 192, 512):
        save(os.path.join(ROOT, f"icon-{size}.png"), (size, size), background=white)

    splash_size = (1284, 2778)
    save(os.path.join(ROOT, "splash.png"), splash_size, icon_size=820, background=white)

    for name, size in (("icon-32.png", 32), ("icon-192.png", 192), ("icon-180.png", 180)):
        save(os.path.join(web_assets, name), (size, size), background=white)
    save(os.path.join(web_assets, "logo.png"), (256, 256))

    save(os.path.join(mobile_assets, "icon.png"), (1024, 1024), background=white)
    save(os.path.join(mobile_assets, "adaptive-icon.png"), (1024, 1024))
    save(os.path.join(mobile_assets, "favicon.png"), (48, 48), background=white)
    save(os.path.join(mobile_assets, "splash.png"), splash_size, icon_size=820, background=white)


if __name__ == "__main__":
    main()
