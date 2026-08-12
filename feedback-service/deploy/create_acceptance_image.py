from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    image = Image.new("RGB", (800, 450), "#ffffff")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 800, 92), fill="#1f4e8c")
    draw.text((36, 28), "FLOW SHUTTLE  /  EMAIL IMAGE CHECK", fill="#ffffff")
    draw.text((36, 118), "If you can read this, the private PNG link is working.", fill="#172033")
    colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308"]
    labels = ["RED", "GREEN", "BLUE", "YELLOW"]
    for index, (color, label) in enumerate(zip(colors, labels, strict=True)):
        left = 36 + index * 186
        draw.rectangle((left, 178, left + 150, 330), fill=color)
        draw.text((left + 48, 346), label, fill="#172033")
    draw.rectangle((28, 105, 772, 410), outline="#cbd5e1", width=3)
    image.save(args.destination, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
