use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![pick_export_dir, write_export_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
