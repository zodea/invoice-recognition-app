use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod db; // 本地 SQLite 持久化（后端首步：识别明细库 + 已入账发票）

fn clean_path_part(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .filter_map(|c| match c {
            '\0'..='\u{1f}' => None,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => Some('＿'),
            _ => Some(c),
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let preferred = dir.join(file_name);
    if !preferred.exists() {
        return preferred;
    }

    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("文件");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    for i in 2.. {
        let name = if ext.is_empty() {
            format!("{stem}({i})")
        } else {
            format!("{stem}({i}).{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    preferred
}

#[tauri::command]
fn pick_export_dir() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择发票整理导出目录")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn write_export_file(
    root: String,
    parts: Vec<String>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let root = PathBuf::from(root);
    let mut dir = root.clone();
    for part in parts {
        dir.push(clean_path_part(&part, "未识别购买方"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_name = clean_path_part(&file_name, "未命名文件");
    let path = unique_path(&dir, &file_name);
    let bytes = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    path.strip_prefix(root)
        .unwrap_or(&path)
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "导出路径不是有效 UTF-8".to_string())
}

/// —— PaddleOCR 官方异步 API（云识别）代理 ——
/// 该 API 不带 CORS 头，WebView 里直接 fetch 会被拦，故在 Rust 侧发请求。
/// 仅允许官方域名，避免被当成通用代理滥用。
fn vl_check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://paddleocr.aistudio-app.com/")
        || url.starts_with("https://aistudio.baidu.com/")
        || url.contains(".bcebos.com/")
        || url.contains(".aistudio-hub.baidu.com/")
    {
        Ok(())
    } else {
        Err("仅允许访问 PaddleOCR 官方服务地址".to_string())
    }
}

#[tauri::command]
async fn vl_submit_file(
    base_url: String,
    token: String,
    model: String,
    optional_payload: String,
    file_name: String,
    file_base64: String,
) -> Result<String, String> {
    let url = format!("{}/api/v2/ocr/jobs", base_url.trim_end_matches('/'));
    vl_check_url(&url)?;
    let bytes = general_purpose::STANDARD
        .decode(file_base64)
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes).file_name(file_name);
    let form = reqwest::multipart::Form::new()
        .text("model", model)
        .text("optionalPayload", optional_payload)
        .part("file", part);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("bearer {token}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("提交失败 {status}：{}", &text[..text.len().min(200)]));
    }
    Ok(text)
}

#[tauri::command]
async fn vl_get_json(url: String, token: String) -> Result<String, String> {
    vl_check_url(&url)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("bearer {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("查询失败 {status}：{}", &text[..text.len().min(200)]));
    }
    Ok(text)
}

#[tauri::command]
async fn vl_get_text(url: String) -> Result<String, String> {
    vl_check_url(&url)?;
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("下载结果失败 {status}"));
    }
    Ok(text)
}

/// 用系统默认浏览器打开外部链接（仅允许 http/https，防止被喂本地路径或其它协议）。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("仅允许打开 http/https 链接".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// —— 分供方附件 / 识别明细库 的本地落盘（生产桌面端，appData 目录；ADR-0002 / ADR-0003）——
// dev 走 vite 中间件写项目内文件夹；打包桌面端走这些命令写 appData。
fn app_data_sub(app: &tauri::AppHandle, sub: &str) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(sub))
}

fn open_local(fp: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &fp.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(fp).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn sup_attach_save(
    app: tauri::AppHandle,
    company: String,
    category: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let company = clean_path_part(&company, "未命名");
    let category = clean_path_part(&category, "其他");
    let ext: String = file_name
        .rsplit('.')
        .next()
        .unwrap_or("bin")
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let ext = if ext.is_empty() { "bin".to_string() } else { ext };
    let dir = app_data_sub(&app, "分供方附件")?.join(&company);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut name = format!("{company}-{category}.{ext}");
    let mut i = 2;
    while dir.join(&name).exists() {
        name = format!("{company}-{category}({i}).{ext}");
        i += 1;
    }
    let bytes = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("{company}/{name}"))
}

#[tauri::command]
fn sup_attach_open(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let fp = app_data_sub(&app, "分供方附件")?.join(rel_path);
    if !fp.exists() {
        return Err("附件文件不存在".to_string());
    }
    open_local(&fp)
}

// —— 识别明细库 / 已入账发票：本地 SQLite（后端首步）。
// 落到 appData/songhuodan.db；首次打开自动从旧 JSON 文件迁移（db::open 内处理）。
#[tauri::command]
fn recognized_save(app: tauri::AppHandle, site: String, json: String) -> Result<(), String> {
    let site = clean_path_part(&site, "未命名工地");
    let conn = db::open(&app)?;
    db::recognized_upsert(&conn, &site, &json)
}

#[tauri::command]
fn recognized_load_all(app: tauri::AppHandle) -> Result<String, String> {
    let conn = db::open(&app)?;
    db::recognized_load_all(&conn)
}

#[tauri::command]
fn posted_invoice_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let conn = db::open(&app)?;
    db::posted_upsert(&conn, &json)
}

#[tauri::command]
fn posted_invoice_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let conn = db::open(&app)?;
    db::posted_delete(&conn, &id)
}

#[tauri::command]
fn posted_invoice_load_all(app: tauri::AppHandle) -> Result<String, String> {
    let conn = db::open(&app)?;
    db::posted_load_all(&conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_export_dir,
            write_export_file,
            open_external,
            vl_submit_file,
            vl_get_json,
            vl_get_text,
            sup_attach_save,
            sup_attach_open,
            recognized_save,
            recognized_load_all,
            posted_invoice_save,
            posted_invoice_delete,
            posted_invoice_load_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
