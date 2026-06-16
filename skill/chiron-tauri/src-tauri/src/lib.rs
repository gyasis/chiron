// Chiron Tauri — native lesson serving.
//
// Service workers don't work in Tauri's (wry) webview, so the player's
// "SW-as-local-server" cannot run here. Instead we serve imported lessons via a
// native `lesson://` custom URI scheme backed by Rust, and import (unzip) the
// .chiron bundle natively. The frontend (skill/player) branches to this path
// when running inside Tauri.

use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};

#[derive(Serialize, Deserialize, Clone)]
struct Lesson {
    id: String,
    title: String,
    entry: String,
}

fn lessons_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .expect("no app local data dir")
        .join("lessons")
}

fn index_path<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    lessons_dir(app).join("index.json")
}

fn read_index<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<Lesson> {
    fs::read_to_string(index_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index<R: Runtime>(app: &tauri::AppHandle<R>, v: &[Lesson]) -> Result<(), String> {
    fs::create_dir_all(lessons_dir(app)).map_err(|e| e.to_string())?;
    fs::write(index_path(app), serde_json::to_string(v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_lessons(app: tauri::AppHandle) -> Vec<Lesson> {
    read_index(&app)
}

#[tauri::command]
fn delete_lesson(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = lessons_dir(&app).join(&id);
    let _ = fs::remove_dir_all(&dir);
    let kept: Vec<Lesson> = read_index(&app).into_iter().filter(|l| l.id != id).collect();
    write_index(&app, &kept)
}

// Import a .chiron (zip) from its raw BYTES (read on the JS side via the fs
// plugin, which understands Android content:// URIs). Unzip into
// app_local_data/lessons/<id>/, register it, return the new Lesson.
#[tauri::command]
fn import_lesson(app: tauri::AppHandle, data: Vec<u8>) -> Result<Lesson, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;

    let id = format!(
        "l{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let dest = lessons_dir(&app).join(&id);
    let mut entry = String::new();
    let mut title = String::new();

    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().replace('\\', "/");
        if name.contains("__MACOSX/") || name.ends_with(".DS_Store") {
            continue;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;

        // pick the lesson entry html (prefer lesson.html, else first root html)
        let is_html = name.ends_with(".html");
        if is_html
            && (name == "lesson.html"
                || name.ends_with("/lesson.html")
                || (entry.is_empty() && !name.contains('/')))
        {
            if entry.is_empty() || name.ends_with("lesson.html") {
                entry = name.clone();
            }
            let head = String::from_utf8_lossy(&buf[..buf.len().min(8192)]);
            if let Some(s) = head.find("<title>") {
                if let Some(e) = head[s + 7..].find("</title>") {
                    let t = head[s + 7..s + 7 + e].trim().to_string();
                    if !t.is_empty() && t != "COURSE_TITLE" {
                        title = t;
                    }
                }
            }
        }

        let out = dest.join(&name);
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&out, &buf).map_err(|e| e.to_string())?;
    }

    if entry.is_empty() {
        return Err("no lesson.html found in bundle".into());
    }
    if title.is_empty() {
        title = id.clone();
    }

    let lesson = Lesson { id, title, entry };
    let mut idx = read_index(&app);
    idx.insert(0, lesson.clone());
    write_index(&app, &idx)?;
    Ok(lesson)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        // lesson://localhost/<id>/<path>  (http://lesson.localhost/... on android/windows)
        .register_uri_scheme_protocol("lesson", |ctx, request| {
            let app = ctx.app_handle();
            let rel = request.uri().path().trim_start_matches('/').to_string();
            let full = lessons_dir(app).join(&rel);
            match fs::read(&full) {
                Ok(body) => {
                    let mime = mime_guess::from_path(&full)
                        .first_or_octet_stream()
                        .to_string();
                    tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(body)
                        .unwrap()
                }
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_lessons,
            import_lesson,
            delete_lesson
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
