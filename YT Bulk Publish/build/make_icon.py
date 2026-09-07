"""Draw the program icon (build/icon.ico) with Pillow. Runs automatically during a build."""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent


def draw(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas = ImageDraw.Draw(image)
    margin = size // 12
    radius = size // 4
    # gradient-like background made of two rounded rectangles
    canvas.rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, fill=(124, 92, 255, 255))
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, fill=(56, 212, 255, 120))
    image = Image.alpha_composite(image, overlay.crop((0, 0, size, size)).transpose(Image.FLIP_TOP_BOTTOM))
    canvas = ImageDraw.Draw(image)
    # play triangle
    cx, cy = size * 0.55, size * 0.5
    half = size * 0.2
    canvas.polygon([(cx - half * 0.8, cy - half), (cx - half * 0.8, cy + half), (cx + half, cy)], fill=(255, 255, 255, 255))
    # three small bars for "bulk"
    bar_w, bar_h = size * 0.08, size * 0.05
    for i in range(3):
        y = size * 0.3 + i * size * 0.15
        canvas.rounded_rectangle([size * 0.2, y, size * 0.2 + bar_w, y + bar_h], radius=bar_h / 2, fill=(255, 255, 255, 220))
    return image


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [draw(s) for s in sizes]
    target = HERE / "icon.ico"
    images[-1].save(target, format="ICO", sizes=[(s, s) for s in sizes], append_images=images[:-1])
    print(f"Icon written to {target}")


if __name__ == "__main__":
    main()
