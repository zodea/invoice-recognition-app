use serde::Serialize;
use std::fs::{self, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{ipc::Response, Manager};

const FILE_LIMIT: u64 = 64 * 1024 * 1024;
const ENTRY_LIMIT: usize = 10_000;

#[derive(Default)]
pub struct Intake(Mutex<(u32, Option<Batch>)>);

struct Batch {
    root: PathBuf,
    files: Vec<PathBuf>,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
}

#[derive(Serialize)]
pub struct Selection {
    id: u32,
    files: Vec<Entry>,
    skipped: usize,
}

fn allowed(path: &Path, name: &str) -> bool {
    !name.starts_with("~$")
        && matches!(
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            "xlsx"
                | "xls"
                | "pdf"
                | "png"
                | "jpg"
                | "jpeg"
                | "webp"
                | "bmp"
                | "gif"
                | "tif"
                | "tiff"
        )
}

fn links_outside(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn scan(folder: PathBuf) -> Result<(Batch, Vec<Entry>, usize), String> {
    let root = folder.canonicalize().map_err(|error| error.to_string())?;
    let label = folder
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("导入目录");
    let mut batch = Batch {
        root: root.clone(),
        files: Vec::new(),
    };
    let mut entries = Vec::new();
    let mut directories = vec![root.clone()];
    let mut skipped = 0;
    let mut visited = 0;
    while let Some(directory) = directories.pop() {
        let listing = match fs::read_dir(&directory) {
            Ok(listing) => listing,
            Err(error) if directory == root => return Err(error.to_string()),
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in listing {
            visited += 1;
            if visited > ENTRY_LIMIT {
                return Err("目录项目超过 10000 个，请分批导入".into());
            }
            let Ok(entry) = entry else {
                skipped += 1;
                continue;
            };
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                skipped += 1;
                continue;
            };
            if links_outside(&metadata) {
                skipped += 1;
                continue;
            }
            if metadata.is_dir() {
                directories.push(path);
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                skipped += 1;
                continue;
            };
            if !metadata.is_file() || !allowed(&path, name) {
                continue;
            }
            if metadata.len() > FILE_LIMIT {
                skipped += 1;
                continue;
            }
            let Some(relative) = path.strip_prefix(&root).ok().and_then(Path::to_str) else {
                skipped += 1;
                continue;
            };
            entries.push(Entry {
                name: name.into(),
                path: format!("{label}/{}", relative.replace('\\', "/")),
            });
            batch.files.push(path);
        }
    }
    Ok((batch, entries, skipped))
}

#[tauri::command]
pub async fn pick_intake_folder(app: tauri::AppHandle) -> Result<Option<Selection>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("选择票据导入目录")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let folder = folder.path().to_owned();
    let (batch, files, skipped) = tauri::async_runtime::spawn_blocking(move || scan(folder))
        .await
        .map_err(|error| error.to_string())??;
    let state = app.state::<Intake>();
    let mut latest = state.0.lock().map_err(|error| error.to_string())?;
    latest.0 = latest.0.wrapping_add(1);
    latest.1 = Some(batch);
    Ok(Some(Selection {
        id: latest.0,
        files,
        skipped,
    }))
}

#[tauri::command]
pub async fn read_intake_file(
    app: tauri::AppHandle,
    selection: u32,
    index: usize,
) -> Result<Response, String> {
    let (root, path) = {
        let state = app.state::<Intake>();
        let latest = state.0.lock().map_err(|error| error.to_string())?;
        let batch = latest
            .1
            .as_ref()
            .filter(|_| latest.0 == selection)
            .ok_or("所选目录已关闭")?;
        (
            batch.root.clone(),
            batch.files.get(index).ok_or("文件不在所选目录中")?.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = path.canonicalize().map_err(|error| error.to_string())?;
        if !resolved.starts_with(root) || resolved != path {
            return Err("文件不在所选目录中".into());
        }
        let mut bytes = Vec::new();
        fs::File::open(resolved)
            .map_err(|error| error.to_string())?
            .take(FILE_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > FILE_LIMIT {
            return Err("文件超过 64 MB".into());
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn release_intake_folder(
    state: tauri::State<'_, Intake>,
    selection: u32,
) -> Result<(), String> {
    let mut latest = state.0.lock().map_err(|error| error.to_string())?;
    if latest.0 == selection {
        latest.1 = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_supported_files_with_original_subdirectories_and_ignores_office_locks() {
        let folder = std::env::temp_dir().join(format!("intake-test-{}", std::process::id()));
        let receipts = folder.join("附件");
        fs::create_dir_all(&receipts).unwrap();
        let document = receipts.join("测试.PNG");
        let workbook = folder.join("清单.xlsx");
        let office_lock = folder.join("~$清单.xlsx");
        for path in [&document, &workbook, &office_lock] {
            fs::write(path, [1, 2, 3]).unwrap();
        }
        let (_, files, skipped) = scan(folder.clone()).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .any(|entry| entry.path.ends_with("/附件/测试.PNG")));
        assert!(files.iter().any(|entry| entry.path.ends_with("/清单.xlsx")));
        for path in [document, workbook, office_lock] {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(receipts).unwrap();
        fs::remove_dir(folder).unwrap();
    }
}
