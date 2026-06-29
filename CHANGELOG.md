# Changelog

All notable changes to the **Dell Monitor Brightness** Ulanzi Deck plugin.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.2] - 2026-06-29

### Fixed
- **Custom key icons are no longer reset to the plugin default on every screen
  switch.** The action used to repaint its own sun icon (`setBaseDataIcon`) both
  when it was added and on every `setactive` event — and the host fires
  `setactive` for each key whenever its page/screen becomes visible again. That
  repaint overwrote any icon the user had chosen in Ulanzi Studio. The plugin no
  longer paints on add or on screen activation; the host now renders the key's
  configured image (the manifest default **or** the user's custom icon). The
  brief on-press brightness-percentage flash is unchanged.

## [1.0.1] - 2026-06-28

### Fixed
- Render icons via base64 `setBaseDataIcon` instead of a plugin-relative
  `setPathIcon` path, which did not resolve on the host and blanked the key.

## [1.0.0] - 2026-06-28

### Added
- Initial release: Dell U2720Q (and any DDC/CI monitor) brightness control from
  the Ulanzi Deck via **Brighter** / **Darker** keys, configurable step
  (1 / 3 / 5 / 10), monitor selection, and an optional on-key value flash.
