# The Roots Attendance — Implementation Plan

A React Progressive Web App (PWA) where employees check in and check out. Every punch is written straight into The Roots HR Google Sheet, in the same one-row-per-employee-per-day format HR already uses. The phone's location is recorded with each punch.

**Target sheet:** https://docs.google.com/spreadsheets/d/1B33m16hD0E7toH6GoNcNWGuQhyfb1ds03IVaLpo-bV0/edit
**Tab being written (for now):** `Test`. Switch to `Attendance Tracker` when going live (§6).

---

## 1. Architecture

```
┌──────────────────────┐   HTTPS POST (JSON)   ┌───────────────────────────┐          ┌───────────────────────────────┐
│  React PWA (Vite)    │ ────────────────────▶ │ Google Apps Script        │ ───────▶ │ The Roots HR Sheet            │
│  - Login (ID + PIN)  │ ◀──────────────────── │ Web App (runs as owner)   │          │  Test / Attendance Tracker (W)│
│  - Check In / Out    │                       │ - verifies ID + PIN       │          │  Employee Master   (read)     │
│  - GPS location      │                       │ - finds/creates today's   │          │  App Access  (new, hidden)    │
│  - Offline queue     │                       │   row, fills in the times │          │  App Log     (new, hidden)    │
└──────────────────────┘                       └───────────────────────────┘          └───────────────────────────────┘
```

**Why Apps Script:** it's free and needs no server. It runs as the sheet owner, so the sheet stays private and the locked tabs stay locked. No Google keys ship inside the app.

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite, Tailwind CSS v4 |
| PWA | `vite-plugin-pwa` (service worker, manifest, installable) |
| Offline queue | `idb-keyval` (IndexedDB) |
| Backend | Google Apps Script Web App ([apps-script/Code.gs](apps-script/Code.gs)) |
| Hosting | Vercel / Netlify (HTTPS is required for a PWA and for location) |

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Late / Early column | **Left alone.** HR fills it in by hand if needed. |
| Employee Master headers | `Employee ID`, `Employee Name`, `Designation` ✔ |
| Time zone | India, GMT+5:30 ✔ (taken from the sheet's own setting) |
| Location | **Captured on every punch** and saved in `App Log` with a Google Maps link. If the phone refuses or can't get a fix, the punch still goes through and the log says why. |
| Working on a holiday | Allowed. It gets its own row with Remarks `Worked on holiday`, and the holiday row is left alone. |
| Second check-in | Rejected ("Already checked in at 10:02 am") |
| Second check-out | Allowed. It overwrites the first, so the last check-out of the day counts. |
| Offline punches | Saved on the phone and sent on reconnect, stamped with the time the button was pressed (up to 12 hours old). |

---

## 3. How the App Writes to the Sheet

### 3.1 Tracker columns (`Test` → later `Attendance Tracker`)
| Col | Header | Written by the app |
|---|---|---|
| A | Date | Today's date (display format copied from the row above → `30-09-2026`) |
| B | Employee ID | e.g. `TR-EM0001` (dropdown chip kept, because data validation is copied) |
| C | Employee Name | From Employee Master |
| D | Designation | From Employee Master |
| E | Check In | e.g. `10:02 am` |
| F | Check Out | e.g. `6:05 pm` |
| G | Work Hours | Formula `=Check Out − Check In`, shown as `8:03`. It recalculates if HR edits the times. |
| H | Status | `Present` |
| I | Late / Early | *Not touched* |
| J | Remarks | `Worked on holiday` when applicable, otherwise left for HR |

If an existing row uses a **formula** in any of these columns (for example a lookup for Name), new rows copy that formula instead of writing a plain value.

### 3.2 Row placement
- **Check In:** if there's no row for today and this employee, one is **inserted directly after the last row dated today or earlier**. This keeps rows in date order, groups the day's rows together, and places them before any holiday rows filled in ahead of time. Because rows are inserted rather than added past the end, formulas in the Salary Tracker and HR Dashboard that point at the tracker's range stretch to include them.
- **Check Out:** fills in column F of today's row.
- **New month:** the first punch of a month adds a header row (e.g. `OCTOBER`) copied from the existing `SEPTEMBER` header. If HR already added it, the script uses theirs.
- **Formatting:** each new row copies the formatting and dropdowns of the most recent normal employee row, never a holiday row.
- **Concurrency:** `LockService` handles one punch at a time, so simultaneous punches can't overwrite each other.

### 3.3 New hidden, protected tabs (created by `setup()`)
- **`App Access`**: `EmployeeID | PIN | Active`. Login PINs live here so the locked Employee Master stays untouched.
- **`App Log`**: `ServerTime | EmployeeID | Type | ClientTime | Latitude | Longitude | Accuracy (m) | Map | Device | ClientID | Result`. There's one row per punch attempt. The `Map` column is a clickable Google Maps link. `ClientID` stops a retried offline punch from being counted twice.

---

## 4. Setup Steps

### 4.1 Apps Script (the sheet owner does this, about 10 minutes)
1. Open the sheet → **File → Settings**, and confirm the time zone is **(GMT+05:30) India Standard Time**.
2. **Extensions → Apps Script**. Replace the contents of `Code.gs` with [apps-script/Code.gs](apps-script/Code.gs).
3. In the script, change `SHARED_SECRET` from `change-me` to a random string.
4. **Project Settings (⚙)**: set the time zone to `Asia/Kolkata`.
5. Choose **`setup`** in the function dropdown and click **Run**. Approve the permission prompt: "Google hasn't verified this app" → *Advanced* → *Go to project*. This is expected for your own script.
6. Run **`syncAccessFromMaster`**. The hidden `App Access` tab then lists every employee with a random 4-digit PIN. To see it, use **View → Hidden sheets**. Give each person their PIN.
7. **Deploy → New deployment → ⚙ Web app**. Choose Execute as **Me** and Who has access **Anyone** → **Deploy**, then copy the `/exec` URL.
8. Open the `/exec` URL in a browser. You should see `{"ok":true,"service":"roots-attendance","tracker":"Test"}`.
9. **After every later script change:** Deploy → Manage deployments → ✏ → Version: **New version** → Deploy. Otherwise the same URL keeps running the old code.

> The `Test` tab should have the same 10 columns and header row as `Attendance Tracker`. The easiest way is to **duplicate** Attendance Tracker and rename the copy to `Test`. If `Test` has only the header row, the first punch creates a `SEPTEMBER`/`OCTOBER` header and plain-formatted rows.

### 4.2 Frontend
```bash
npm install
cp .env.example .env         # then edit .env:
#   VITE_SCRIPT_URL=<the /exec URL>
#   VITE_SHARED_SECRET=<same value as SHARED_SECRET>
npm run dev                  # http://localhost:5173 and a LAN URL for phones
npm run build                # production build in dist/
```
> Phones only allow location and offline mode on **HTTPS** or `localhost`. To test on a phone, deploy (§4.3) or use a tunnel (e.g. `npx localtunnel --port 5173`).

### 4.3 Deploy
1. Push the folder to GitHub, then import it in **Vercel** or **Netlify** (framework: Vite, build `npm run build`, output `dist`).
2. Add `VITE_SCRIPT_URL` and `VITE_SHARED_SECRET` as environment variables in the host's dashboard.
3. Share the URL with employees. On Android they tap **Install**. On iPhone they tap **Share → Add to Home Screen**.

---

## 5. Project Structure (built)

```
apps-script/Code.gs          Backend: login / today / punch, row insertion, setup helpers
src/
├── main.jsx, App.jsx        Entry point; shows Login or Home
├── api/sheets.js            fetch wrapper (text/plain POST, ServerError vs network error)
├── offline/queue.js         IndexedDB queue, sends in order when the phone reconnects or the app is reopened
├── context/AuthContext.jsx  Remembers the signed-in employee on the device
├── lib/location.js          Gets GPS within 10 seconds; never blocks the punch
├── lib/id.js, useOnline.js
├── pages/Login.jsx          Employee ID + PIN
├── pages/Home.jsx           Clock, Check In / Check Out button, today's times and hours
└── components/              StatusBanner (offline/syncing), InstallPrompt
public/icons/                App icons (regenerate from icon.svg with `npm run icons`)
vite.config.js               PWA manifest + service worker
```

**Home screen logic**
| Today's row | Shown |
|---|---|
| No Check In | Big green **Check In** button |
| Check In, no Check Out | Big red **Check Out** button |
| Both | "Done for today" and an **Update check-out time** link |

Times saved offline show with a `*` until they sync. If the PIN is changed or access is removed in `App Access`, the app signs that person out the next time it loads.

---

## 6. Status and Next Steps

| Phase | Status |
|---|---|
| Apps Script backend | ✅ Written. ⏳ **Owner** needs to deploy it (§4.1) |
| React PWA (login, punch, offline queue, location, install) | ✅ Built. `npm run build` passes |
| End-to-end test against `Test` tab | ⏳ Needs the `/exec` URL |
| Deploy to Vercel/Netlify | ⏳ |
| Go live | ⏳ Change `TRACKER = 'Attendance Tracker'` in Code.gs, then create a **New version** of the deployment |
| Optional extras | Geofence (reject punches too far from the office), nightly "Missing check-out" flag, Change-PIN screen |

---

## 7. Testing Checklist (on the `Test` tab)
- [ ] The first check-in adds a row in date order with a green ID chip, Name, Designation, Check In and Status = Present.
- [ ] Check-out fills Check Out on the same row, and Work Hours shows e.g. `8:03`.
- [ ] A second check-in is rejected. A second check-out updates the time.
- [ ] Two employees on the same day get rows next to each other.
- [ ] The first punch in a new month adds a month header row.
- [ ] A punch on a Holiday date adds a separate row with "Worked on holiday".
- [ ] `App Log` has lat/lng and a working Maps link. With location denied, the punch still works and the log says "permission denied".
- [ ] Airplane mode → punch → reconnect: the row appears exactly once, with the time the button was pressed.
- [ ] A wrong PIN is rejected and the sheet doesn't change.
- [ ] Several phones punching at the same moment: all rows are correct.
- [ ] The app installs on Android Chrome and iOS Safari and opens offline.

---

## 8. Security Notes
- The shared secret in the frontend only blocks casual spam. Anyone can read it in the app's code. Access is actually controlled by the **Employee ID + PIN check on the server**.
- The sheet stays private. `App Access` and `App Log` are hidden and protected so only the owner can edit them.
- Location is recorded for auditing, not enforced. A geofence can be added later if needed.
- Possible hardening later: hashed PINs, limiting failed logins per ID (`CacheService`), and a Change-PIN screen.

## 9. Limits
- Each punch takes about 1–3 seconds (Apps Script plus row insertion), and the button shows "Please wait…".
- New rows copy formatting from the row above. If HR changes the tracker's **column order**, update `COL` in Code.gs.
- A forgotten check-out leaves column F empty until HR fills it in.
