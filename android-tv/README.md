# Mediarium TV 0.3.0

Lightweight Android TV client for the household Mediarium server at
http://192.168.4.52:8265. Android 8+; no native ABI dependency, including 32-bit ARM.

Uses Android's installed WebView, normal server authentication and persistent
cookies. Adds directional focus navigation, visible focus, Back handling, a
play/pause control and media-key support. Enter opens the TV keyboard on text
fields. Home remains the system Home button. The server must remain running.

Main-frame navigation is confined to the configured household origin. No JavaScript
native bridge, filesystem access, third-party cookies, analytics SDK, or embedded
login credentials. Cleartext HTTP is permitted only for the existing LAN server.
This is a LAN-only deployment and does not add TLS to the existing server.

Build on Windows: `python build.py` using Android SDK build tools 36.0.0,
platform android-34 and Android Studio's JBR (or ANDROID_HOME/JAVA_HOME overrides).
Output: `build/mediarium-tv.apk`. Preserve the private `.signing/` directory for
future compatible updates. Its local development signing password is not an
account credential; do not distribute or commit the key.

Install: `adb -s TV_IP:5555 install -r build/mediarium-tv.apk`.
Launch: `adb -s TV_IP:5555 shell am start -n app.mediarium.tv/.MainActivity`.
The server's existing username/password are entered on the TV, not bundled here.

The web application still provides its existing browser player; this wrapper is
not a replacement native video engine. Playback/codecs, physical remote keys and
the software keyboard require testing on each target TV. External source/metadata
links are blocked in this TV client. HTTPS trailer frames may load inside the
page; top-level navigation remains confined to the household server. Trailers
use the YouTube privacy-enhanced player and pause when the app backgrounds.

TV styling and remote navigation live in the shared web application. The client
identifies itself with `MediariumTV/0.3.0`; `/watch?tv=1` previews the same layout
in a browser. The legacy `assets/remote.js` is retained as historical source and
is not injected by this client.
