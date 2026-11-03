# PAYSIM Brand Assets & Visual Identity Specification

> **Normative Brand Architecture, Favicon Specifications & Asset Pipeline**
> **Status:** Production Ready & Verified
> **Target Application:** `apps/web` (React 18 / Vite 5)

---

## 1. Brand Concept & Visual Identity

PAYSIM's visual identity embodies the precision, reliability, and security expected of enterprise financial infrastructure while celebrating developer-first tooling.

### Concept: "The Webhook Signal P" (Concept V2)

The master mark unifies two core concepts into a singular geometric emblem:

1. **The Gateway Monogram ("P")**: A bold, continuous-stroke geometric letterform representing Payment transactions, idempotent order processing, and architectural stability. The letterform is rendered with exact proportional harmony (56px uniform track width, rounded outer and inner corner radii).
2. **Outbound Dispatch Signal Arcs**: Two concentric, energetic webhook broadcast waves radiating dynamically from the gateway loop. These arcs signify real-time event dispatch, loopback HTTP delivery, and cryptographic HMAC signature transmission.

```
       +---------------------------------------------+
       |   PAYSIM EMBLEM GEOMETRY (512 x 512)        |
       |                                             |
       |     [ Squircle Container rx=108 ]           |
       |       +-----------------------+             |
       |       |  ####    #####  )  )  |             |
       |       |  #   #   #   # )  )   |  <- Webhook |
       |       |  ####    #####  )  )  |     Signal  |
       |       |  #                    |     Arcs    |
       |       |  #       Payment "P"  |             |
       |       +-----------------------+             |
       +---------------------------------------------+
```

---

## 2. Color Palette & Design Tokens

The brand assets are drawn directly from the application's established design tokens (`apps/web/src/styles/tokens.css`):

| Element | Token / Role | Hex Gradient / Value | Purpose |
|---------|--------------|----------------------|---------|
| **Base Surface** | `--bg-app` to `--bg-surface` | `#0f172a` &rarr; `#080c14` &rarr; `#05080f` | Deep slate and charcoal fintech void background |
| **Ambient Glow** | `--color-primary-glow` | `#38bdf8` (16% opacity, radial) | Subtle illuminated depth across the top-left quadrant |
| **Container Border** | `--border-default` | `#38bdf8` (45%) &rarr; `#1e293b` &rarr; `#0f172a` | High-contrast illuminated squircle boundary |
| **Monogram P** | `--color-primary` | `#38bdf8` &rarr; `#0284c7` | Electric cyan to deep azure primary mark |
| **Signal Arcs** | `--color-success` | `#4ade80` &rarr; `#00f2fe` | High-visibility mint to cyan webhook delivery glow |
| **Theme Color** | `meta[theme-color]` | `#080c14` | Matches system shell and dashboard backdrop |

---

## 3. Production Asset Inventory

All production assets are located in `apps/web/public/` and automatically copied to the root of `apps/web/dist/` during production builds.

| File Name | Resolution | Format | Size | Purpose |
|-----------|------------|--------|------|---------|
| `favicon.svg` | Scalable | SVG (XML) | 3,176 B | Modern evergreen browsers (Chrome, Firefox, Safari, Edge) |
| `favicon.ico` | 16, 32, 48 | Binary ICO | 6,122 B | Multi-resolution fallback container for legacy browsers & desktop bookmarks |
| `favicon-16.png` | 16 &times; 16 | PNG (RGBA) | 758 B | High-contrast micro-favicon for compact browser tabs |
| `favicon-32.png` | 32 &times; 32 | PNG (RGBA) | 1,963 B | Standard browser tab favicon |
| `favicon-48.png` | 48 &times; 48 | PNG (RGBA) | 3,347 B | High-DPI browser tab & desktop shortcut icon |
| `apple-touch-icon.png` | 180 &times; 180 | PNG (RGBA) | 24,873 B | Apple iOS / iPadOS home screen bookmark icon |
| `icon-192.png` | 192 &times; 192 | PNG (RGBA) | 28,290 B | Android home screen icon & Web App Manifest standard |
| `icon-512.png` | 512 &times; 512 | PNG (RGBA) | 160,452 B | Android splash screen icon & high-res manifest asset |
| `site.webmanifest` | N/A | JSON | 523 B | W3C Web Application Manifest defining application identity |

---

## 4. HTML Integration

The `<head>` of `apps/web/index.html` integrates all brand assets according to modern web platform best practices:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PAYSIM — Payment Simulator & Webhook Testing Laboratory</title>

    <!-- Modern Vector Favicon (Preferred by Chrome, Edge, Firefox) -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <!-- Multi-Resolution Fallback (16x16, 32x32, 48x48) -->
    <link rel="icon" href="/favicon.ico" sizes="any" />

    <!-- Apple Touch Icon for iOS Safari -->
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

    <!-- Web Application Manifest -->
    <link rel="manifest" href="/site.webmanifest" />

    <!-- System Browser Shell & Tab Bar Theme Color -->
    <meta name="theme-color" content="#080c14" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## 5. Web Application Manifest

The manifest file `apps/web/public/site.webmanifest` establishes the application's local identity without introducing service workers or claiming full offline PWA behavior:

```json
{
  "name": "PAYSIM — Payment Gateway Simulator",
  "short_name": "PAYSIM",
  "description": "Local Payment Gateway Simulator & Webhook Testing Laboratory",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#080c14",
  "theme_color": "#080c14",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

---

## 6. Asset Generation & Packaging Pipeline

To maintain zero unnecessary third-party package dependencies, the asset pipeline uses Node.js and headless Google Chrome:

- **Generator Script**: `scripts/generate-brand-assets.mjs`
- **NPM Command**: `npm run generate:icons`

### Pipeline Mechanics

1. **Vector Authoring**: Generates the master SVG using mathematical cubic beziers and arc paths calibrated for anti-aliasing.
2. **Headless Chrome Rasterization**: Spawns `chrome.exe` with `--headless=new`, `--default-background-color=00000000`, and precise window dimensions to capture pristine PNG screenshots.
3. **Low-Level Microsoft ICO Container Builder**: Packages PNG buffers directly into the Microsoft Win32 ICO binary specification:
   - `ICONDIR` header (6 bytes, specifying resource type `0x0001` and image count).
   - `ICONDIRENTRY` headers (16 bytes each, defining dimensions, color planes, bit-depth, byte lengths, and absolute byte offsets).
   - Concatenated raw PNG data segments.

---

## 7. Quality Assurance & Verification

The brand assets undergo automated end-to-end verification via `scripts/verify-brand-assets.mjs`:

1. **HTTP Resource Availability**:
   - `GET /favicon.svg` &rarr; 200 OK (`image/svg+xml`)
   - `GET /favicon.ico` &rarr; 200 OK (`image/x-icon`)
   - `GET /apple-touch-icon.png` &rarr; 200 OK (`image/png`)
   - `GET /site.webmanifest` &rarr; 200 OK (`application/manifest+json`)
   - `GET /icon-192.png` &rarr; 200 OK (`image/png`)
   - `GET /icon-512.png` &rarr; 200 OK (`image/png`)
   - `GET /favicon-48.png` &rarr; 200 OK (`image/png`)
   - `GET /favicon-32.png` &rarr; 200 OK (`image/png`)
   - `GET /favicon-16.png` &rarr; 200 OK (`image/png`)
2. **In-Browser DOM & CDP Audit**:
   - Confirms all `<link>` and `<meta>` elements exist with valid paths in the running DOM.
   - Zero console errors or warnings reported.
   - Verified crisp rendering across small and large viewports.
3. **Build Output Audit**:
   - `npm run build` preserves all public icon assets directly in `apps/web/dist/` with identical byte sizes.
