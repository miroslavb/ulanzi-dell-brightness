# Windows verification — 2026-09-13

Version **1.2.1** was installed on the operator's Windows PC running Ulanzi Studio **3.3.6.0**. A private, hash-verified backup of both brightness plugin folders, HA Hub, Config and ProfilesV2 was retained before installation.

Package source commit: `0fb51c191820f973b7846f0c360329b1a01ec62d`.
Package SHA-256: `d24d7226085d7aa6b89f6b4c956defeec6c9414bc14516f8c786a7937d2828c6`.
This source commit pins the installed package; subsequent verification-documentation commits do not change that package.

## Verified scope

- The installed HTML companion and inspector use the real browser SDK singleton.
- A separate **Brightness Display** keypad action reads current brightness; failed readings show `--`, not `0%`. Legacy Brighter/Darker behavior and UUIDs remain intact.
- The installed encoder runtime was exercised with software-injected SDK dial events against the real DDC/CI monitor: **65 → 70 → 65**. The original value was restored.
- After a full Studio restart, a fresh authenticated bridge read returned **65%** and Studio showed the encoder feedback. The temporary loopback debugger was disabled.
- The controller suite (24 named checks), real PowerShell protocol suite (4 checks), real-SDK startup/dial, bridge/auth/reconnect, inspector, display, unavailable-value and package checks passed.
- At the initial validation checkpoint, the agent had not observed manual knob rotation or placed the new standalone tile. The later operator confirmation and approved tile placement are recorded in the follow-up below.


## Follow-up: standalone MDI brightness tile

The operator confirmed the repaired plugins work and requested monitor brightness on a separate keypad tile rather than the wide display. With explicit approval, the old Brighter key was replaced by Brightness Display, `icon=monitor`, `monitor=auto`; encoder `showFeedback=false` preserves rotation without monitor feedback on the wide display. The inherited custom-image state was reset only for this replacement. A fresh foreground-pixel capture showed the monitor glyph and **65%** on the separate tile, with no monitor percentage on the wide display. The saved profile and HA globals were read back; installed plugin files were unchanged. Evidence: private `brightness-tile-verification.json` and `studio-brightness-final.png` in the existing evidence directory.

## Evidence and limits

Private local receipts, the source/installed-file comparison, monitor before/after/restore result and native Studio screenshot review are retained under `/root/.hermes/work/ulanzi-repair-20260913/`. Raw Windows logs and settings are not published: they can contain credentials. Code is on the repair feature branch; no new GitHub binary release was published as part of this task.
