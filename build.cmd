@echo off
rem Build Overfy desktop app (Tauri, windows-gnu toolchain via MSYS2 MinGW-w64).
set "PATH=D:\msys\mingw64\bin;D:\tools\w64devkit\bin;%PATH%"
set "LIBRARY_PATH=C:\Users\Admin\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained"
npm run tauri build %*
