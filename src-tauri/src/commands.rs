use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackInfo {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub tags: Vec<String>,
    pub audio: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecommendationInput {
    pub history: Vec<String>,
    pub limit: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Recommendations {
    pub tags: Vec<String>,
    pub artists: Vec<String>,
    pub suggested_searches: Vec<String>,
    pub seed_count: usize,
}

fn normalize_tag(tag: &str) -> String {
    tag.trim().to_lowercase()
}

#[tauri::command]
pub fn analyze_track_tags(track_json: String) -> Result<Vec<String>, String> {
    let track: TrackInfo = serde_json::from_str(&track_json)
        .map_err(|e| format!("Ошибка разбора трека: {e}"))?;
    Ok(track
        .tags
        .into_iter()
        .map(|t| normalize_tag(&t))
        .filter(|t| !t.is_empty() && t.len() < 64)
        .collect())
}

#[tauri::command]
pub fn build_recommendations(input: RecommendationInput) -> Result<Recommendations, String> {
    let history = input.history;
    if history.len() < 5 {
        return Ok(Recommendations {
            tags: vec![],
            artists: vec![],
            suggested_searches: vec![],
            seed_count: history.len(),
        });
    }

    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    let mut artist_counts: HashMap<String, usize> = HashMap::new();

    for entry in &history {
        let maybe: Result<TrackInfo, _> = serde_json::from_str(entry);
        if let Ok(track) = maybe {
            for tag in &track.tags {
                let key = normalize_tag(tag);
                if !key.is_empty() {
                    *tag_counts.entry(key).or_insert(0) += 1;
                }
            }
            if !track.artist.is_empty() {
                *artist_counts
                    .entry(normalize_tag(&track.artist))
                    .or_insert(0) += 1;
            }
        }
    }

    let mut top_tags: Vec<(String, usize)> = tag_counts.into_iter().collect();
    top_tags.sort_by(|a, b| b.1.cmp(&a.1));
    let tags: Vec<String> = top_tags
        .into_iter()
        .take(5)
        .map(|(t, _)| t)
        .collect();

    let mut top_artists: Vec<(String, usize)> = artist_counts.into_iter().collect();
    top_artists.sort_by(|a, b| b.1.cmp(&a.1));
    let artists: Vec<String> = top_artists
        .into_iter()
        .take(3)
        .map(|(a, _)| a)
        .collect();

    let suggested_searches = [
        tags.first().cloned().unwrap_or_default(),
        artists.first().cloned().unwrap_or_default(),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect();

    Ok(Recommendations {
        tags,
        artists,
        suggested_searches,
        seed_count: history.len(),
    })
}

#[tauri::command]
pub fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0) as u64;
    let mins = total / 60;
    let secs = total % 60;
    format!("{mins}:{secs:02}")
}

// Возвращает папку для скачивания обновлений (каталог приложения в данных пользователя)
#[tauri::command]
pub fn update_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось определить папку: {e}"))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

// Удаляет файл, если существует (используется перед перезаписью установщика)
#[tauri::command]
pub fn remove_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        fs::remove_file(&path).map_err(|e| format!("Не удалось удалить файл: {e}"))?;
    }
    Ok(())
}

// Сохраняет байты установщика в путь. В цикле chunking — дописывает в конец,
// чтобы последний вызов собирал полный файл.
#[tauri::command]
pub fn save_update_file(path: String, data: Vec<u8>) -> Result<String, String> {
    let parent = Path::new(&path)
        .parent()
        .ok_or_else(|| "Некорректный путь".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    f.write_all(&data).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(path)
}

// Открывает файл с помощью системной программы по умолчанию (запуск установщика).
#[tauri::command]
pub fn launch_file(path: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Не удалось запустить файл: {e}"))
}

// Скачивает трек по прямой ссылке в папку Загрузки/Overfy пользователя
#[tauri::command]
pub async fn download_track_file(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {e}"))?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки аудио: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Сервер вернул ошибку: {}", res.status()));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения аудиоданных: {e}"))?;

    let downloads_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().audio_dir())
        .map_err(|e| format!("Не удалось определить папку Загрузки: {e}"))?;

    let target_dir = downloads_dir.join("Overfy");
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Не удалось создать папку Overfy: {e}"))?;

    let safe_name: String = filename
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();

    let safe_name = safe_name.trim();
    let file_name = if safe_name.is_empty() {
        "track.mp3".to_string()
    } else if safe_name.to_lowercase().ends_with(".mp3") {
        safe_name.to_string()
    } else {
        format!("{safe_name}.mp3")
    };

    let target_path = target_dir.join(file_name);
    fs::write(&target_path, &bytes)
        .map_err(|e| format!("Не удалось сохранить файл: {e}"))?;

    Ok(target_path.to_string_lossy().to_string())
}
