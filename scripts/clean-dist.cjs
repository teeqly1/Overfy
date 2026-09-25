// Очистка dist перед сборкой: удаляем файлы, не трогая сами папки.
// Директория dist\assets может удерживаться другим процессом (блокировка
// каталога), поэтому rmSync целиком падает с EPERM — удаляем пофайлово.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'dist')

function clean(dir) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      clean(full)
      try { fs.rmdirSync(full) } catch { /* каталог занят — оставляем пустым */ }
    } else {
      try { fs.unlinkSync(full) } catch { /* файл занят — перезапишется vite */ }
    }
  }
}

clean(root)
