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
    #[serde(default)]
    slug: String, // the library slug; "" for a copy saved before slugs were recorded
}

/// Key that says "same lesson": the slug when known, else the title (only for copies with no slug).
fn same_lesson(a: &Lesson, b: &Lesson) -> bool {
    if !a.slug.is_empty() && !b.slug.is_empty() {
        return a.slug == b.slug;
    }
    if a.slug.is_empty() && b.slug.is_empty() {
        return a.title == b.title;
    }
    // one side has no slug: an older copy, matched by title as before
    a.title == b.title
}

/// Put `new` first and drop every entry for the same lesson. Returns the ids of the dropped entries.
fn merge_into(idx: Vec<Lesson>, new: Lesson) -> (Vec<Lesson>, Vec<String>) {
    let (gone, mut kept): (Vec<Lesson>, Vec<Lesson>) = idx.into_iter().partition(|l| same_lesson(l, &new));
    kept.insert(0, new);
    (kept, gone.into_iter().map(|l| l.id).collect())
}

/// Keep the first entry per lesson. Two different lessons that share a title both stay when their slugs differ.
fn dedupe(v: Vec<Lesson>) -> Vec<Lesson> {
    let mut out: Vec<Lesson> = Vec::with_capacity(v.len());
    for l in v {
        if !out.iter().any(|o| same_lesson(o, &l)) {
            out.push(l);
        }
    }
    out
}

/// The `slug` field of a chiron.json manifest, if present.
fn manifest_slug(json: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(json).ok()?;
    let s = v.get("slug")?.as_str()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn lessons_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .expect("no app local data dir")
        .join("lessons")
}

/// Parse a `Range: bytes=START-END` header (END optional) → (start, end_or_usize::MAX).
fn parse_range(h: &str) -> Option<(usize, usize)> {
    let h = h.trim().strip_prefix("bytes=")?;
    let (s, e) = h.split_once('-')?;
    let start: usize = s.trim().parse().ok()?;
    let end: usize = if e.trim().is_empty() { usize::MAX } else { e.trim().parse().ok()? };
    if end < start {
        return None;
    }
    Some((start, end))
}

fn index_path<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    lessons_dir(app).join("index.json")
}

fn read_index<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<Lesson> {
    let mut v: Vec<Lesson> = fs::read_to_string(index_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    // a copy saved before slugs were recorded: read the slug from its own chiron.json when the bundle had one
    let mut filled = false;
    for l in v.iter_mut().filter(|l| l.slug.is_empty()) {
        if let Some(s) = fs::read(lessons_dir(app).join(&l.id).join("chiron.json")).ok().and_then(|b| manifest_slug(&b)) {
            l.slug = s;
            filled = true;
        }
    }
    let v = dedupe(v);
    if filled {
        let _ = write_index(app, &v);
    }
    v
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

// Shared: unzip a .chiron's BYTES into app_local_data/lessons/<id>/, register
// it, return the new Lesson. Used by file-import AND server-download.
fn import_zip_bytes(app: &tauri::AppHandle, data: Vec<u8>, slug_hint: Option<String>) -> Result<Lesson, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;

    let id = format!(
        "l{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let dest = lessons_dir(app).join(&id);
    let mut entry = String::new();
    let mut title = String::new();
    let mut slug = slug_hint.filter(|s| !s.is_empty()).unwrap_or_default();

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
        if slug.is_empty() && name == "chiron.json" {
            slug = manifest_slug(&buf).unwrap_or_default();
        }

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

    let lesson = Lesson { id, title, entry, slug };
    let (idx, replaced) = merge_into(read_index(app), lesson.clone());
    write_index(app, &idx)?;
    for old in replaced {
        let _ = fs::remove_dir_all(lessons_dir(app).join(&old)); // the copy this import replaces
    }
    Ok(lesson)
}

// Import a .chiron from raw BYTES (read on the JS side via the fs plugin, which
// understands Android content:// URIs).
#[tauri::command]
fn import_lesson(app: tauri::AppHandle, data: Vec<u8>) -> Result<Lesson, String> {
    import_zip_bytes(&app, data, None)
}

// List a server catalog: GET <url>/lessons.json (works for http LAN + https Pages).
#[tauri::command]
fn server_lessons(url: String) -> Result<serde_json::Value, String> {
    let u = format!("{}/lessons.json", url.trim_end_matches('/'));
    let body = ureq::get(&u)
        .call()
        .map_err(|e| format!("fetch {u}: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| format!("bad lessons.json: {e}"))
}

// GET a small JSON document natively (no CORS): the :8910 static server that hosts the on-device model
// manifest sends no Access-Control-Allow-Origin, so the webview cannot fetch() it.
#[tauri::command]
fn fetch_json(url: String) -> Result<serde_json::Value, String> {
    let body = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(6))
        .call()
        .map_err(|e| format!("fetch {url}: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| format!("bad JSON from {url}: {e}"))
}

// Download a .chiron from the server and import it.
#[tauri::command]
fn import_from_server(app: tauri::AppHandle, url: String, file: String) -> Result<Lesson, String> {
    let u = format!("{}/{}", url.trim_end_matches('/'), file);
    let resp = ureq::get(&u).call().map_err(|e| format!("download {u}: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let hint = file.rsplit('/').next().unwrap_or(&file).trim_end_matches(".chiron").to_string();
    import_zip_bytes(&app, bytes, Some(hint))
}

// ---- on-device tutor grounding: bounded plain text of a SAVED (offline) lesson --------------------------------
// Mirrors skill/server/tutor_server.py slug_text(): strip markup, keep text blocks (> 25 chars), prefer the
// blocks that share the most >=4-char words with the question, else the head of the lesson. Bounded: file read
// capped at 2 MB, result capped at `cap` chars. Returns "" on any miss so the tutor still answers (ungrounded).
fn strip_blocks(html: &str, tags: &[&str]) -> String {
    let mut out = html.to_string();
    for t in tags {
        loop {
            let low = out.to_lowercase();
            let open = format!("<{t}");
            let close = format!("</{t}>");
            let Some(a) = low.find(&open) else { break };
            // `<head` must not match `<header`: require a delimiter after the tag name
            let after = low[a + open.len()..].chars().next().unwrap_or(' ');
            if !(after == '>' || after == ' ' || after == '\n' || after == '\t' || after == '/') {
                // skip this false match by blanking the '<' and re-scanning
                out.replace_range(a..a + 1, " ");
                continue;
            }
            let end = low[a..].find(&close).map(|e| a + e + close.len()).unwrap_or(out.len());
            out.replace_range(a..end, " ");
        }
    }
    out
}

fn words4(s: &str) -> std::collections::HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.chars().count() >= 4)
        .map(|w| w.to_string())
        .collect()
}

#[tauri::command]
fn lesson_text(app: tauri::AppHandle, id: String, entry: String, question: Option<String>, cap: Option<usize>) -> Result<String, String> {
    let ok_id = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.') && !id.contains("..");
    if !ok_id || entry.contains("..") || entry.starts_with('/') {
        return Err("lesson_text: bad id/entry".into());
    }
    let cap = cap.unwrap_or(2000).clamp(200, 6000);
    let path = lessons_dir(&app).join(&id).join(&entry);
    let mut raw = Vec::new();
    fs::File::open(&path)
        .map_err(|e| format!("lesson_text: open {}: {e}", path.display()))?
        .take(2_000_000)
        .read_to_end(&mut raw)
        .map_err(|e| e.to_string())?;
    let html = strip_blocks(&String::from_utf8_lossy(&raw), &["script", "style", "svg", "head"]);
    let mut txt = String::with_capacity(html.len());
    let (mut in_tag, mut tag) = (false, String::new());
    for c in html.chars() {
        if in_tag {
            if c == '>' {
                in_tag = false;
                let t = tag.trim_start_matches('/').split(|x: char| !x.is_ascii_alphanumeric()).next().unwrap_or("").to_lowercase();
                if matches!(t.as_str(), "p" | "div" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "tr" | "section" | "article" | "br") {
                    txt.push('\n');
                } else {
                    txt.push(' ');
                }
                tag.clear();
            } else if tag.len() < 24 {
                tag.push(c);
            }
        } else if c == '<' {
            in_tag = true;
        } else {
            txt.push(c);
        }
    }
    let txt = txt.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    let blocks: Vec<String> = txt
        .split('\n')
        .map(|b| b.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|b| b.chars().count() > 25)
        .collect();
    if blocks.is_empty() {
        return Ok(String::new());
    }
    let qw = words4(question.as_deref().unwrap_or(""));
    if !qw.is_empty() {
        let mut scored: Vec<(usize, usize)> = blocks.iter().enumerate().map(|(i, b)| (i, qw.intersection(&words4(b)).count())).collect();
        scored.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let (mut pick, mut used) = (Vec::new(), 0usize);
        for (i, sc) in scored {
            if sc == 0 || used >= cap {
                break;
            }
            pick.push(i);
            used += blocks[i].chars().count() + 1;
        }
        if !pick.is_empty() {
            pick.sort();
            let joined = pick.iter().map(|&i| blocks[i].chars().take(900).collect::<String>()).collect::<Vec<_>>().join("\n");
            return Ok(joined.chars().take(cap).collect());
        }
    }
    Ok(blocks.join("\n").chars().take(cap).collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())   // chiron://lesson?id=&s= and chiron://ascolto?... (Match Madness "Studia")
        .plugin(tauri_plugin_chiron_llm::init())   // on-device tutor (Veloce) + offline STT/TTS (Android only)
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
                    let total = body.len();
                    // Range support — REQUIRED for <audio>/<video> playback in the webview:
                    // webkit2gtk media elements issue a Range request and won't play a plain 200.
                    let range = request
                        .headers()
                        .get("Range")
                        .and_then(|h| h.to_str().ok())
                        .and_then(parse_range);
                    if let Some((start, end_req)) = range {
                        if start < total {
                            let end = end_req.min(total - 1);
                            let slice = body[start..=end].to_vec();
                            return tauri::http::Response::builder()
                                .status(206)
                                .header("Content-Type", mime)
                                .header("Accept-Ranges", "bytes")
                                .header("Content-Range", format!("bytes {}-{}/{}", start, end, total))
                                .header("Content-Length", (end - start + 1).to_string())
                                .header("Access-Control-Allow-Origin", "*")
                                .body(slice)
                                .unwrap();
                        }
                    }
                    tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Accept-Ranges", "bytes")
                        .header("Content-Length", total.to_string())
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
            delete_lesson,
            server_lessons,
            import_from_server,
            lesson_text,
            fetch_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(id: &str, title: &str, slug: &str) -> Lesson {
        Lesson { id: id.into(), title: title.into(), entry: "lesson.html".into(), slug: slug.into() }
    }

    #[test]
    fn two_lessons_with_one_title_both_stay() {
        let (idx, gone) = merge_into(vec![l("a", "Chiron · Italian", "chiron-italian-a")], l("b", "Chiron · Italian", "chiron-italian-b"));
        assert_eq!(idx.len(), 2);
        assert!(gone.is_empty());
    }

    #[test]
    fn same_slug_replaces_and_reports_the_old_copy() {
        let (idx, gone) = merge_into(vec![l("a", "Old title", "chiron-x")], l("b", "New title", "chiron-x"));
        assert_eq!(idx.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert_eq!(gone, vec!["a".to_string()]);
    }

    #[test]
    fn older_copy_without_slug_is_replaced_by_title() {
        let (idx, gone) = merge_into(vec![l("a", "T", ""), l("c", "Other", "")], l("b", "T", "chiron-t"));
        assert_eq!(idx.len(), 2);
        assert_eq!(gone, vec!["a".to_string()]);
    }

    #[test]
    fn dedupe_keeps_first_per_lesson() {
        let v = dedupe(vec![l("1", "T", "s1"), l("2", "T", "s2"), l("3", "T2", "s1"), l("4", "U", ""), l("5", "U", "")]);
        assert_eq!(v.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["1", "2", "4"]);
    }

    #[test]
    fn manifest_slug_reads_only_a_real_value() {
        assert_eq!(manifest_slug(br#"{"slug":"chiron-x"}"#), Some("chiron-x".into()));
        assert_eq!(manifest_slug(br#"{"slug":""}"#), None);
        assert_eq!(manifest_slug(br#"{"title":"t"}"#), None);
        assert_eq!(manifest_slug(b"not json"), None);
    }
}
