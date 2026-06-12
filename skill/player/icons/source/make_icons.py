#!/usr/bin/env python3
import cv2, numpy as np

SRC = "/home/gyasis/.claude/image-cache/68f349c8-c15b-4577-9c46-21a564c9a39d/2.png"
OUT = "/home/gyasis/Documents/code/chiron/skill/player/icons"
NAVY = (73, 38, 15)  # BGR of #0f2649

img = cv2.imread(SRC, cv2.IMREAD_COLOR)
b, g, r = [img[:, :, i].astype(int) for i in range(3)]
dist = np.sqrt((b - NAVY[0])**2 + (g - NAVY[1])**2 + (r - NAVY[2])**2)
navy_mask = (dist < 70).astype(np.uint8) * 255
navy_mask = cv2.morphologyEx(navy_mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
cnts, _ = cv2.findContours(navy_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
x, y, w, h = cv2.boundingRect(max(cnts, key=cv2.contourArea))
print("tile bbox:", x, y, w, h)

tile = img[y:y + h, x:x + w]
side = max(w, h)
sq = np.full((side, side, 3), NAVY, np.uint8)
sq[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = tile
base = cv2.resize(sq, (512, 512), interpolation=cv2.INTER_AREA)   # downscale → crisp

def rounded_alpha(size, rad):
    m = np.zeros((size, size), np.uint8)
    cv2.rectangle(m, (rad, 0), (size - rad, size), 255, -1)
    cv2.rectangle(m, (0, rad), (size, size - rad), 255, -1)
    for cx, cy in [(rad, rad), (size - rad, rad), (rad, size - rad), (size - rad, size - rad)]:
        cv2.circle(m, (cx, cy), rad, 255, -1)
    return cv2.GaussianBlur(m, (0, 0), 0.6)

def write_png(path, bgr, alpha):
    out = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA); out[:, :, 3] = alpha
    cv2.imwrite(path, out)

a512 = rounded_alpha(512, 112)
write_png(f"{OUT}/icon-512.png", base, a512)
for s in (192, 180):
    write_png(f"{OUT}/icon-{s}.png",
              cv2.resize(base, (s, s), interpolation=cv2.INTER_AREA),
              rounded_alpha(s, round(112 * s / 512)))

# maskable: full-bleed navy, centaur in ~80% safe zone.
# Replace only the pure-white corner remnants with navy by a high threshold
# (the ivory centaur is < 248, so it is untouched), then place on a navy field.
filled = sq.copy()
white = (filled[:, :, 0] > 248) & (filled[:, :, 1] > 248) & (filled[:, :, 2] > 248)
filled[white] = NAVY
m = np.full((512, 512, 3), NAVY, np.uint8)
m[54:458, 54:458] = cv2.resize(filled, (404, 404), interpolation=cv2.INTER_AREA)
write_png(f"{OUT}/icon-maskable-512.png", m, np.full((512, 512), 255, np.uint8))
print("done")
