# Dev launcher: force npmmirror for the first-run Electron binary download
# (Electron 42+ no longer downloads in postinstall; download happens on first run).
$ErrorActionPreference = 'Stop'
$env:ELECTRON_MIRROR = 'https://cdn.npmmirror.com/binaries/electron/'
& npx electron-vite dev
exit $LASTEXITCODE
