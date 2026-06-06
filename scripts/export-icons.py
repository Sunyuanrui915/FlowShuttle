"""Export Flow Shuttle icon assets from the confirmed 1024px master PNG.

All generated icons come from:
  assets/icons/flow_shuttle_icon_1024_transparent.png

If the master icon is replaced later, rerun this script from the project root
to regenerate the full PNG, ICO, favicon, and website icon set.
"""

from __future__ import annotations

from pathlib import Path
import io
import struct
from typing import Iterable

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
MASTER = ICON_DIR / "flow_shuttle_icon_1024_transparent.png"

PNG_SIZES = [1024, 512, 256, 128, 64, 32, 16]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
WEB_ICONS = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}


def load_master() -> Image.Image:
    if not MASTER.exists():
        raise FileNotFoundError(f"Master icon not found: {MASTER}")

    image = Image.open(MASTER)
    if image.size != (1024, 1024):
        raise ValueError(f"Master icon must be 1024x1024, got {image.size}")

    return image.convert("RGBA")


def resize_icon(master: Image.Image, size: int) -> Image.Image:
    if size == master.width:
        image = master.copy()
    else:
        image = master.resize((size, size), Image.Resampling.LANCZOS)
    for xy in [(0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)]:
        red, green, blue, _alpha = image.getpixel(xy)
        image.putpixel(xy, (red, green, blue, 0))
    return image


def save_pngs(master: Image.Image) -> list[Path]:
    outputs: list[Path] = []
    for size in PNG_SIZES:
        output = ICON_DIR / f"flow-shuttle-icon-{size}.png"
        resize_icon(master, size).save(output, "PNG")
        outputs.append(output)
    return outputs


def save_web_icons(master: Image.Image) -> list[Path]:
    outputs: list[Path] = []
    for filename, size in WEB_ICONS.items():
        output = ICON_DIR / filename
        resize_icon(master, size).save(output, "PNG")
        outputs.append(output)
    return outputs


def save_ico(master: Image.Image, output: Path, sizes: Iterable[int]) -> None:
    # Store PNG-compressed RGBA frames in a Windows ICO container.
    # This avoids hidden re-sampling in the ICO writer and keeps every frame
    # generated from the same master with transparent corner pixels.
    frames: list[tuple[int, bytes]] = []
    for size in sizes:
        buffer = io.BytesIO()
        resize_icon(master, size).save(buffer, "PNG")
        frames.append((size, buffer.getvalue()))

    header_size = 6
    directory_size = 16 * len(frames)
    offset = header_size + directory_size

    with output.open("wb") as icon_file:
        icon_file.write(struct.pack("<HHH", 0, 1, len(frames)))
        for size, data in frames:
            icon_file.write(
                struct.pack(
                    "<BBBBHHII",
                    0 if size == 256 else size,
                    0 if size == 256 else size,
                    0,
                    0,
                    1,
                    32,
                    len(data),
                    offset,
                )
            )
            offset += len(data)
        for _size, data in frames:
            icon_file.write(data)


def validate_png(path: Path) -> dict[str, object]:
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    corners = [
        image.getpixel((0, 0))[3],
        image.getpixel((width - 1, 0))[3],
        image.getpixel((0, height - 1))[3],
        image.getpixel((width - 1, height - 1))[3],
    ]
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    alpha_data = alpha.get_flattened_data() if hasattr(alpha, "get_flattened_data") else alpha.getdata()
    opaque_pixels = sum(1 for value in alpha_data if value > 0)
    colors = ImageStat.Stat(ImageChops.invert(alpha)).sum[0]
    return {
        "mode": image.mode,
        "size": image.size,
        "corner_alpha": corners,
        "all_corners_transparent": all(value == 0 for value in corners),
        "nontransparent_pixels": opaque_pixels,
        "alpha_bbox": bbox,
        "alpha_variation_score": int(colors),
    }


def validate_ico(path: Path) -> list[tuple[int, int]]:
    image = Image.open(path)
    sizes = getattr(image, "ico").sizes()
    return sorted(sizes)


def validate_ico_corners(path: Path) -> list[tuple[tuple[int, int], list[int], bool]]:
    image = Image.open(path)
    results = []
    for size in sorted(image.ico.sizes()):
        frame = image.ico.getimage(size).convert("RGBA")
        width, height = frame.size
        corners = [
            frame.getpixel((0, 0))[3],
            frame.getpixel((width - 1, 0))[3],
            frame.getpixel((0, height - 1))[3],
            frame.getpixel((width - 1, height - 1))[3],
        ]
        results.append((size, corners, all(value == 0 for value in corners)))
    return results


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = load_master()

    generated = []
    generated.extend(save_pngs(master))
    generated.extend(save_web_icons(master))

    main_ico = ICON_DIR / "flow-shuttle-icon.ico"
    favicon = ICON_DIR / "favicon.ico"
    save_ico(master, main_ico, ICO_SIZES)
    save_ico(master, favicon, [16, 32, 48])

    print("Generated icons:")
    for path in generated + [main_ico, favicon]:
        print(f"- {path.relative_to(ROOT)}")

    print("\nPNG validation:")
    png_checks = [ICON_DIR / f"flow-shuttle-icon-{size}.png" for size in PNG_SIZES]
    png_checks.extend(ICON_DIR / filename for filename in WEB_ICONS)
    for path in png_checks:
        result = validate_png(path)
        print(
            f"- {path.name}: mode={result['mode']} size={result['size']} "
            f"corners={result['corner_alpha']} alpha0={result['all_corners_transparent']} "
            f"bbox={result['alpha_bbox']} nontransparent={result['nontransparent_pixels']}"
        )

    print("\nICO validation:")
    print(f"- {main_ico.name}: {validate_ico(main_ico)}")
    print(f"- {favicon.name}: {validate_ico(favicon)}")
    print("\nICO corner alpha validation:")
    for path in [main_ico, favicon]:
        print(f"- {path.name}:")
        for size, corners, is_transparent in validate_ico_corners(path):
            print(f"  {size}: corners={corners} alpha0={is_transparent}")


if __name__ == "__main__":
    main()
