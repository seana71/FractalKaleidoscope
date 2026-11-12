"""Capture the half-turn neighborhood, verify full images, and plot the even iterations."""
import argparse
import base64
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PROJECT = Path(__file__).resolve().parents[1]
NEIGHBORS = (179, 180, 181)
COLUMNS = (0, 2, 16, 32, 64, 120, 160)


def capture(config, directory, rolls):
    subprocess.run([
        "node", str(PROJECT / "tools/lab.cjs"), "sweep", "--config", str(config),
        "--out", str(directory), "--iterations", "160", "--frames", "all",
        "--yaw", "0", "--elevation", "0", "--distance", "0",
        "--roll", ",".join(map(str, rolls)),
    ], check=True)


def run_directories(directory):
    ranking = json.loads((directory / "ranking.json").read_text())
    return {row["roll"]: directory / row["directory"] for row in ranking["results"]}


def read(directory, iteration):
    with Image.open(directory / f"frame-{iteration:08d}.png") as image:
        return np.array(image.convert("RGBA"))


def marker_seed(config, destination):
    # Broad, asymmetric landmarks. The magenta disk is inside the inscribed circle.
    image = Image.new("RGB", (96, 96), (17, 22, 31))
    pen = ImageDraw.Draw(image)
    pen.ellipse((69, 41, 82, 54), fill=(159, 16, 140))
    pen.polygon([(23, 30), (42, 30), (42, 35), (30, 35), (30, 46), (23, 46)], fill=(12, 130, 188))
    pen.polygon([(77, 2), (93, 2), (93, 20)], fill=(160, 122, 12))
    cfg = json.loads(config.read_text())
    cfg["initial"] = {"type": "rgb", "base64": base64.b64encode(image.tobytes()).decode("ascii")}
    destination.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def compare(a, b):
    delta = np.abs(a.astype(np.int16) - b)
    return {
        "differentRGBABytes": int(np.count_nonzero(delta)),
        "differentPixels": int(np.count_nonzero(delta.any(axis=2))),
        "meanAbsoluteRGBPercent": float(delta[:, :, :3].mean() * 100 / 255),
    }


def period_trace(directory, roll):
    """Compare full decoded RGBA frames and check the green transient in seed coordinates."""
    period = {90: 4, 180: 2}[roll]
    end = json.loads((directory / "measurements.json").read_text())["iterations"]
    seed = read(directory, 0)
    seed_green = seed[:, :, 1].astype(np.int16)
    # The green wall shader in byte units is round(.995*g + 255*.0007).
    # It fixes 0..135; above 135 it subtracts one per iteration.
    green_floor = np.minimum(seed_green, 135)
    green_mismatches = 0
    last_change = np.zeros(3, dtype=int)
    rows, history = [], []
    for i in range(end + 1):
        current = read(directory, i) if i else seed
        aligned = np.rot90(current[:, :, :3], (roll // 90)*i)
        green_mismatches += int(np.count_nonzero(aligned[:, :, 1] != np.maximum(green_floor, seed_green-i)))
        if i:
            last_change[np.any(aligned != previous_aligned, axis=(0, 1))] = i
        previous_aligned = aligned
        count = maximum = None
        if len(history) == period:
            difference = np.abs(current.astype(np.int16) - history.pop(0))
            count = int(np.count_nonzero(difference.any(axis=2)))
            maximum = int(difference.max())
        rows.append({"iteration": i, "differentPixels": count, "maxAbsChannelDifference": maximum})
        history.append(current)

    first = next((row["iteration"] for row in rows if row["differentPixels"] == 0), None)
    if first is not None:
        assert all(row["differentPixels"] == 0 for row in rows[first:])
    return {"rollDegrees": roll, "lag": period, "firstExactReturnIteration": first,
            "firstObservedCycleStart": first-period if first is not None else None, "lastCheckedIteration": end,
            "seedGreen255Pixels": int(np.count_nonzero(seed_green == 255)),
            "greenPredictionMismatchesAcrossAllFrames": green_mismatches,
            "lastChangeIterationAfterUndoingRotationRGB": last_change.tolist(), "rows": rows}


def interpolate(image, x, y):
    # Bilinear sampling at pixel centers, clamped to the texture's edges.
    h, w = image.shape[:2]
    x, y = np.clip(x, 0, w-1), np.clip(y, 0, h-1)
    ix, iy = x.astype(int), y.astype(int)
    jx, jy = np.minimum(ix+1, w-1), np.minimum(iy+1, h-1)
    fx, fy = (x-ix)[..., None], (y-iy)[..., None]
    return ((1-fy)*((1-fx)*image[iy, ix] + fx*image[iy, jx])
            + fy*((1-fx)*image[jy, ix] + fx*image[jy, jx]))


def interior_drift(directory, start, end):
    # Register the noise independently of the markers and the predicted roll angle.
    # Positive angles move from right toward down in an exported PNG (clockwise).
    angles = np.deg2rad(np.arange(1440)/4)
    radii = np.arange(15, 40)[:, None]
    x = 47.5 + radii*np.cos(angles)
    y = 47.5 + radii*np.sin(angles)
    profiles = []
    for i in (start, end):
        values = interpolate(read(directory, i)[:, :, :3], x, y)
        profiles.append(values - values.mean(axis=1, keepdims=True))
    before, after = profiles
    spectrum = np.fft.rfft(before, axis=1).conj() * np.fft.rfft(after, axis=1)
    correlation = np.fft.irfft(spectrum.sum(axis=(0, 2))) / np.sqrt((before**2).sum()*(after**2).sum())
    peak = int(correlation.argmax())
    deg = ((peak+720) % 1440 - 720)/4
    # Width of the contiguous peak within 0.01 of its maximum, on the circular grid.
    # Report a descriptive tolerance in correlation units, without statistical assumptions.
    outside = np.flatnonzero(np.roll(correlation, -peak) < correlation[peak]-0.01)
    if outside.size:
        bounds = [deg-(len(correlation)-int(outside[-1])-1)/4, deg+(int(outside[0])-1)/4]
    else:
        bounds = [deg-180, deg+180]
    return {"from": start, "to": end, "clockwiseDegrees": deg,
            "degreesPerTwoIterations": 2*deg/(end-start),
            "correlation": float(correlation[peak]), "within0.01OfPeakDegrees": bounds}


def wall_comparison(directory, roll):
    # At the cube center with a square 90-degree view, the back-wall boundaries
    # project to +/-48 in pixel units before roll. Outside them the ray hits a side.
    y, x = np.indices((96, 96), dtype=float) - 47.5
    angle = np.deg2rad(roll)
    sx = x*np.cos(angle) + y*np.sin(angle)
    sy = -x*np.sin(angle) + y*np.cos(angle)
    side = (np.abs(sx) > 48) | (np.abs(sy) > 48)
    back = interpolate(read(directory, 0)[:, :, :3], sx+47.5, sy+47.5)
    # Approximate one step if a clamped back-wall texture alone filled the viewport.
    predicted = np.rint(back * [.996, .995, .996] + 255*np.array([.0006, .0007, .0011]))
    error = np.abs(predicted - read(directory, 1)[:, :, :3])
    return {"sideRayPixels": int(side.sum()), "backRayPixels": int((~side).sum()),
            "backWallModelMAEInRGBLevelsOnBack": float(error[~side].mean()),
            "backWallModelMAEInRGBLevelsOnSides": float(error[side].mean()) if side.any() else None}


def make_filmstrip(noise, markers, target):
    bg, white, muted = "#101621", "#f2f4f8", "#aabaca"
    font = ImageFont.load_default
    left, tile, gap, top = 85, 120, 8, 88
    block = 3*(tile+gap) + 60
    figure = Image.new("RGB", (left+len(COLUMNS)*(tile+gap)+16, top+2*block+8), bg)
    draw = ImageDraw.Draw(figure)
    draw.text((20, 14), "Even iterations near a half turn", fill=white, font=font(31))
    draw.text((21, 54), "Fixed camera at cube center   /   90° field of view   /   96 x 96 feedback", fill=muted, font=font(17))
    for group, (dirs, label) in enumerate(((noise, "Noise seed 1997"), (markers, "Asymmetric markers"))):
        y0 = top + group*block
        draw.text((20, y0), label, fill=white, font=font(21))
        for col, i in enumerate(COLUMNS):
            x = left+col*(tile+gap)
            draw.text((x+tile/2, y0+34), f"Iter {i}", anchor="mt", fill=muted, font=font(16))
            for row, roll in enumerate(NEIGHBORS):
                y = y0+57+row*(tile+gap)
                if col == 0:
                    draw.text((18, y+tile/2), f"{roll}°", anchor="lm", fill=white, font=font(21))
                patch = Image.fromarray(read(dirs[roll], i)).convert("RGB")
                figure.paste(patch.resize((tile,tile), Image.Resampling.NEAREST), (x, y))
    figure.save(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="roll study directory")
    parser.add_argument("--analyze-existing", action="store_true", help="analyze the saved PNGs again without recapturing")
    args = parser.parse_args()
    root = args.output.resolve()
    if not args.analyze_existing:
        root.mkdir(parents=True, exist_ok=False)
        reference = PROJECT / "examples/half-turn.json"
        capture(reference, root/"noise", (90, *NEIGHBORS))
        marker_config = root/"marker-config.json"
        marker_seed(reference, marker_config)
        capture(marker_config, root/"markers", NEIGHBORS)
    noise = run_directories(root/"noise")
    markers = run_directories(root/"markers")
    for group in (noise, markers):
        seed = read(group[180], 0)
        assert all(np.array_equal(seed, read(path, 0)) for path in group.values())
    report, traces = {}, {}
    for roll, directory in noise.items():
        last = read(directory, 160)
        pairs = {str(i): compare(last, read(directory, i)) for i in (156, 158, 159)}
        report[roll] = {"noiseRun": str(directory.relative_to(root).as_posix()),
                        "frame160ComparedTo": pairs, "firstStepWallComparison": wall_comparison(directory, roll)}
        if roll in (90, 180):
            period = 4 if roll == 90 else 2
            assert pairs[str(160-period)]["differentRGBABytes"] == 0
            assert pairs[str(160-period//2)]["differentRGBABytes"] > 0
            trace = period_trace(directory, roll)
            traces[f"noise-{roll}"] = trace
            report[roll]["exactPeriod"] = period
            report[roll]["firstObservedCycleStart"] = trace["firstObservedCycleStart"]
            report[roll]["firstExactReturnIteration"] = trace["firstExactReturnIteration"]
        if roll in NEIGHBORS:
            report[roll]["markerRun"] = markers[roll].relative_to(root).as_posix()
            report[roll]["noiseInteriorRegistration"] = [
                interior_drift(directory, a, b) for a, b in ((4,6),(16,32),(64,80),(144,160))
            ]
            report[roll]["markerInteriorRegistration"] = [
                interior_drift(markers[roll], a, b) for a, b in ((16,32),(144,160))
            ]
    traces["markers-180"] = period_trace(markers[180], 180)
    (root/"period-traces.json").write_text(json.dumps(traces, indent=2), encoding="utf-8")
    make_filmstrip(noise, markers, root/"even-iterations.png")
    (root/"comparisons.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(root/"even-iterations.png")


if __name__ == "__main__":
    main()
