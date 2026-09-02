# Office chilli plant

A persistent, slowly changing scene for an office-hours classroom: a professor's
office with a chilli plant on the windowsill. The plant grows from a seed to a
fruiting plant as long as it is watered daily, wilts when it is not, and its
chillies can be picked one at a time into the bowl beside it. Through the
window the weather drifts and day turns to night on the office clock.

Everything is static HTML, CSS and JavaScript. The only shared state is a tiny
event log (when the seed was planted, every watering, every pick) in a free
Firebase Realtime Database. The plant's appearance is computed from that log
and the clock, so every viewer sees the same plant.

| File | Purpose |
|---|---|
| `index.html` | The display page to embed in the classroom. Read-only. |
| `control.html` | Your control page: sign in, water, pick, plant a new seed. |
| `config.js` | The only file to edit: Firebase config, office time zone, weather seed. |
| `plant-model.js` | Event log → growth, moisture, wilt, fruit, bowl. Shared by both pages. |
| `scene.js` | Draws the office, the window view and the plant as SVG. |
| `weather.js` | Deterministic weather and daylight from the clock. |
| `demo.html` | Gallery of every state the scene can be in, for visual checking. |
| `iframe-test.html` | The iframe capability test used to check the classroom. |

## Setup

### 1. Create the Firebase project (about ten minutes, free)

1. Go to <https://console.firebase.google.com>, **Add project**, give it a name,
   and turn off Google Analytics when asked.
2. **Build → Realtime Database → Create database.** Pick a location near you
   and start in **locked mode**.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**,
   then under **Settings → Authorized domains** add `cscheffler.github.io`.
4. **Project settings (gear icon) → Your apps → Web (`</>`)**, register an app,
   and copy the `firebaseConfig` object into `config.js`. Make sure it includes
   `databaseURL`; if it does not, copy the URL shown at the top of the
   Realtime Database page.

### 2. Publish

Commit and push to GitHub, then enable GitHub Pages for the repository
(Settings → Pages → Deploy from a branch → `main`, root). The display page is
then at `https://cscheffler.github.io/<repo>/index.html` and the control page
at `https://cscheffler.github.io/<repo>/control.html`.

### 3. Lock the database to you

1. Open the control page and sign in with Google. Copy the user id it shows.
2. In the Firebase console, **Realtime Database → Rules**, paste this with your
   user id in place of `YOUR_UID`, and publish:

```json
{
  "rules": {
    "plant": {
      ".read": true,
      ".write": "auth != null && auth.uid === 'YOUR_UID'"
    }
  }
}
```

Anyone can read the plant. Only your Google account can change it. The Firebase
config in `config.js` is public by design; the rules are what protect the data.

### 4. Plant and embed

On the control page press **Plant a new seed**, then **Water**. Add the
`index.html` URL to the classroom as an external resource. Bookmark the control
page on your phone.

## How the plant behaves

- **Moisture** starts at 100% when you water and decays with a 36-hour time
  constant. Watering once a day keeps it above half. Leaves start drooping
  below 50% (about a day without water) and are fully wilted around 12%
  (about three days). Watering recovers it immediately.
- **Growth** accrues only while the soil is moist, measured in "care days":
  one calendar day with a watering counts as one. A sprout appears after one
  care day, the first flower around day eleven, the first fruit around day
  thirteen, and further fruit follow. Each fruit reaches full size in two care
  days and turns from green to red over two more.
- **Picking** takes the ripest fruit that is at least full size. It appears in
  the bowl in the colour it had when picked. The empty spot flowers again
  three care days later.
- **Weather** is the real current weather at the office, fetched every ten
  minutes from [Open-Meteo](https://open-meteo.com) (free, no key) for the
  coordinates in `config.js`. Cloud cover, rain, drizzle, showers, snow,
  thunderstorms and fog are all shown. Every viewer fetches the same current
  conditions, so they agree. If the fetch fails, or `LIVE_WEATHER` is off, a
  smooth random weather keyed on UTC time and a fixed seed takes over, which
  is also the same for everyone. Weather data by Open-Meteo.com (CC BY 4.0).
- **Daylight** follows the real sun at the office's coordinates (Stirling, UK
  by default): sunrise, sunset, how high the sun climbs, and how long twilight
  lasts. Brightness is driven by the sun's elevation, so a July night in
  Stirling never goes fully dark and a January afternoon fades from 16:10. The landscape follows the northern
  hemisphere seasons: blossom in spring, deep green in summer, orange and
  yellow trees in autumn, bare trees and snow in winter. The wall clock shows
  office time, the desk lamp and the village windows come on at night.

All the numbers live at the top of `plant-model.js` in the `GROWTH` object.

## Previewing without Firebase

Open the display page with `?demo` to see a synthetic plant, and add any of:

| Parameter | Meaning | Example |
|---|---|---|
| `days` | days since planting | `?demo&days=20` |
| `dry` | days since the last watering | `?demo&days=8&dry=2` shows wilting |
| `picked` | number of recent picks | `?demo&days=25&picked=6` |
| `seed` | plant shape | `?demo&seed=3` |
| `hour` | force the office clock | `?demo&hour=22` for night |
| `cloud`, `rain` | force the weather, 0 to 1 | `?demo&cloud=0.9&rain=0.8` |
| `snow`, `fog` | force snow instead of rain, or fog | `?demo&snow=1&rain=0.6&cloud=0.9` |
| `weather=noise` | use the synthetic weather instead of Open-Meteo | `?demo&weather=noise` |
| `month` | force the season, 1 to 12 | `?demo&month=1` for snow |
| `doy` | force the day of year, for season blends | `?demo&doy=60` for the winter–spring boundary |
| `pickago`, `pickgap` | days since the last pick, and days between picks | `?demo&days=40&picked=12&pickgap=1` |
| `empty` | no plant at all | `?demo&empty` |

`demo.html` is a gallery of all of these: every growth stage, wilt level,
season, time of day, weather and plant shape, each one click away.

While `config.js` still has the placeholder config, both pages run in demo
mode automatically. To preview locally, serve the folder over HTTP, for example
`python3 -m http.server 8000`, because ES modules do not load from `file://`.
