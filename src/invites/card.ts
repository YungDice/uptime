/**
 * The streak as a picture, for sending somewhere else.
 *
 * Streak apps travel as screenshots, and a screenshot of this one is a cropped
 * phone column with a tab bar under it. This is the face on its own at a size
 * the places people post pictures expect (4:5, 1080 wide), with the nickname
 * someone needs to find you.
 *
 * Personal on purpose: it says how long *your* clock has run and nothing
 * about anybody else. PRODUCT.md rules out anything that implies a crowd.
 */

export interface CardFacts {
  /** Whole days on the clock. */
  days: number;
  /** What the number counts: "days running", or "day best run" when stopped. */
  caption: string;
  displayName: string;
  handle: string;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';

/** The design tokens, read from the page so the card cannot drift from it. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export async function renderCard(facts: CardFacts): Promise<Blob> {
  // A canvas draws with whatever face is loaded at the moment it draws, and
  // Inter arrives with the page's CSS rather than before it.
  await Promise.all(
    ["300 200px", "600 60px", "500 40px"].map((spec) =>
      document.fonts.load(`${spec} "Inter Variable"`).catch(() => []),
    ),
  );

  const run = token("--color-run", "#ff9f0a");
  const label = token("--color-label", "#ffffff");
  const label2 = token("--color-label-2", "#8e8e93");

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This device can't draw the card.");

  // True black, with the face's warm bloom behind the ring.
  g.fillStyle = "#000000";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const cx = WIDTH / 2;
  const cy = 560;
  const bloom = g.createRadialGradient(cx, cy, 40, cx, cy, 520);
  bloom.addColorStop(0, "rgba(255, 159, 10, 0.16)");
  bloom.addColorStop(1, "rgba(255, 159, 10, 0)");
  g.fillStyle = bloom;
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // Sixty ticks, every fifth long, as on the face.
  const radius = 360;
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const long = i % 5 === 0;
    const inner = radius + 34;
    const outer = inner + (long ? 30 : 14);
    g.strokeStyle = long ? "rgba(255, 159, 10, 0.75)" : "rgba(255, 159, 10, 0.3)";
    g.lineWidth = long ? 5 : 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    g.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    g.stroke();
  }

  const ring = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, "#ffc75a");
  ring.addColorStop(1, run);
  g.strokeStyle = ring;
  g.lineWidth = 22;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.stroke();

  // The number, shrunk until it sits inside the ring with room to spare.
  const digits = String(Math.max(0, Math.floor(facts.days)));
  let size = 300;
  g.font = `300 ${size}px ${FONT}`;
  while (g.measureText(digits).width > radius * 1.45 && size > 120) {
    size -= 10;
    g.font = `300 ${size}px ${FONT}`;
  }
  g.fillStyle = label;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillText(digits, cx, cy + size * 0.28);

  g.font = `500 44px ${FONT}`;
  g.fillStyle = label2;
  g.fillText(facts.caption, cx, cy + size * 0.28 + 80);

  // Who, and how to find them.
  g.font = `600 64px ${FONT}`;
  g.fillStyle = label;
  g.fillText(fit(g, facts.displayName, WIDTH - 160), cx, 1080);

  g.font = `600 40px ${FONT}`;
  g.fillStyle = run;
  g.fillText(fit(g, `Follow @${facts.handle} on Uptime`, WIDTH - 160), cx, 1190);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The card didn't render."))), "image/png"),
  );
}

/** Cut a line to the width it has, with an ellipsis, rather than overflow it. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut + "…";
}
