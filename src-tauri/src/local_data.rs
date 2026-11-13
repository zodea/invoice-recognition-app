//! Portable business data. Browser profiles are only read by the one-time migration.
//! One atomically replaced manifest is the commit point; binary files are immutable.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;
const MAGIC: &[u8; 9] = b"SDLOCAL1\n";
const FORMAT: &str = "songhuodan-local-data";
const MAX_MANIFEST: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    format: String,
    version: u32,
    pub values: BTreeMap<String, String>,
    pub attachments: BTreeMap<String, Value>,
    migrated: bool,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            format: FORMAT.into(),
            version: 1,
            values: BTreeMap::new(),
            attachments: BTreeMap::new(),
            migrated: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BinaryEntry {
    path: String,
    size: u64,
    checksum: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BackupHeader {
    snapshot: Snapshot,
    files: Vec<BinaryEntry>,
}

struct PreparedRestore {
    directory: PathBuf,
    snapshot: Snapshot,
}

pub struct DiskStore {
    root: PathBuf,
    snapshot: Option<Snapshot>,
    migration: Snapshot,
    prepared: Option<PreparedRestore>,
    restored: bool,
    load_error: Option<String>,
    _lock: File,
}

fn io(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn nonce() -> String {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    format!(
        "{:x}-{:x}-{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

// FNV-1a detects accidental truncation/corruption; this is not an authenticity signature.
fn checksum_reader(mut reader: impl Read, mut output: Option<&mut File>) -> Result<(u64, String)> {
    let mut hash = 0xcbf29ce484222325u64;
    let mut size = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buf).map_err(io)?;
        if count == 0 {
            break;
        }
        if let Some(file) = output.as_deref_mut() {
            file.write_all(&buf[..count]).map_err(io)?;
        }
        size += count as u64;
        for byte in &buf[..count] {
            hash = (hash ^ *byte as u64).wrapping_mul(0x100000001b3);
        }
    }
    Ok((size, format!("{hash:016x}")))
}

fn regular(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(io)?;
    if !meta.is_file() || meta.is_symlink() {
        return Err("数据文件不是普通文件".into());
    }
    Ok(())
}

fn blob_path(root: &Path, relative: &str) -> Result<PathBuf> {
    // Archives never supply arbitrary OS paths, even if their manifest was edited.
    let parts: Vec<_> = Path::new(relative).components().collect();
    if !relative.starts_with("blobs/")
        || parts.len() != 2
        || !parts.iter().all(|p| matches!(p, Component::Normal(_)))
        || relative.contains('\\')
        || relative.contains(':')
        || !relative[6..].ends_with(".bin")
        || !relative[6..relative.len() - 4]
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("备份含有非法文件路径".into());
    }
    let directory = root.join("blobs");
    if fs::symlink_metadata(&directory).map_err(io)?.is_symlink() {
        return Err("原件目录不能是链接".into());
    }
    let path = root.join(relative);
    if path.exists() {
        regular(&path)?;
    }
    Ok(path)
}

fn binary_refs(snapshot: &Snapshot) -> Result<BTreeMap<String, BinaryEntry>> {
    if snapshot.format != FORMAT || snapshot.version != 1 || !snapshot.migrated {
        return Err("不支持的数据格式或版本".into());
    }
    for (key, raw) in &snapshot.values {
        let arrays = [
            "paymentRecords.v1",
            "supplierDb.v1",
            "invoiceLedgerTrash.v1",
            "invoiceSupplements.v1",
            "invoiceLedgerTrashCleanup.v1",
            "deliveryPartitions.v1",
        ];
        let objects = [
            "invoiceLedger.v1",
            "expenseDirectory.v1",
            "priceCompareManualGroups",
            "expenseAssignmentBackup.v1",
            "appSettings.v1",
        ];
        if arrays.contains(&key.as_str()) || objects.contains(&key.as_str()) {
            let value: Value =
                serde_json::from_str(raw).map_err(|_| format!("{key} 数据格式损坏"))?;
            if (arrays.contains(&key.as_str()) && !value.is_array())
                || (objects.contains(&key.as_str()) && !value.is_object())
            {
                return Err(format!("{key} 数据结构异常"));
            }
        }
    }
    let mut entries = BTreeMap::new();
    for (key, record) in &snapshot.attachments {
        if record.get("key").and_then(Value::as_str) != Some(key) || !record.is_object() {
            return Err("附件索引与原件标识不一致".into());
        }
        let mut refs = Vec::new();
        if let Some(blob) = record.get("blob") {
            if !blob.is_null() {
                refs.push(blob);
            }
        }
        if let Some(supplements) = record.get("supplements") {
            for item in supplements.as_array().ok_or("附件列表格式错误")? {
                refs.push(item.get("blob").ok_or("附件缺少文件")?);
            }
        }
        for reference in refs {
            let entry: BinaryEntry = serde_json::from_value(
                reference
                    .get("$localFile")
                    .ok_or("文件引用格式错误")?
                    .clone(),
            )
            .map_err(io)?;
            if let Some(prior) = entries.insert(entry.path.clone(), entry.clone()) {
                if prior.size != entry.size || prior.checksum != entry.checksum {
                    return Err("文件引用冲突".into());
                }
            }
        }
    }
    Ok(entries)
}

fn validate_files(root: &Path, snapshot: &Snapshot, full: bool) -> Result<()> {
    for entry in binary_refs(snapshot)?.values() {
        let path = blob_path(root, &entry.path)?;
        regular(&path)?;
        if fs::metadata(&path).map_err(io)?.len() != entry.size {
            return Err("原件长度校验失败".into());
        }
        if full
            && checksum_reader(File::open(path).map_err(io)?, None)?
                != (entry.size, entry.checksum.clone())
        {
            return Err("原件内容校验失败".into());
        }
    }
    Ok(())
}

fn atomic_json(path: &Path, snapshot: &Snapshot) -> Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", nonce()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(io)?;
        serde_json::to_writer(&mut file, snapshot).map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        // Windows MoveFileExW(REPLACE_EXISTING), same directory and volume.
        fs::rename(&temporary, path).map_err(io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

impl DiskStore {
    pub fn open(root: PathBuf) -> Result<Self> {
        if root.exists() && fs::symlink_metadata(&root).map_err(io)?.is_symlink() {
            return Err("数据目录不能是链接".into());
        }
        fs::create_dir_all(root.join("blobs"))
            .map_err(|e| format!("无法写入软件旁的“数据”目录，请将软件放到可写文件夹：{e}"))?;
        blob_path(&root, "blobs/0.bin")?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("使用锁"))
            .map_err(io)?;
        lock.try_lock()
            .map_err(|_| "该数据目录正在被另一窗口使用，请先关闭另一窗口".to_string())?;
        let path = root.join("业务数据.json");
        let loaded = if path.exists() {
            (|| {
                regular(&path)?;
                if fs::metadata(&path).map_err(io)?.len() > MAX_MANIFEST {
                    return Err("业务数据文件过大".into());
                }
                let data: Snapshot = serde_json::from_reader(File::open(path).map_err(io)?)
                    .map_err(|e| format!("业务数据损坏，请从备份恢复；未写入任何新数据：{e}"))?;
                validate_files(&root, &data, false)?;
                Ok(Some(data))
            })()
        } else {
            Ok(None)
        };
        let (snapshot, load_error) = match loaded {
            Ok(data) => (data, None),
            Err(error) => (None, Some(error)),
        };
        Ok(Self {
            root,
            snapshot,
            migration: Snapshot::default(),
            prepared: None,
            restored: false,
            load_error,
            _lock: lock,
        })
    }

    fn current(&self) -> Result<&Snapshot> {
        self.snapshot.as_ref().ok_or("尚未完成旧数据迁移".into())
    }
    fn writable(&self) -> Result<()> {
        if self.restored {
            return Err("数据已恢复，请重新打开软件后继续操作".into());
        }
        Ok(())
    }
    fn commit(&mut self, next: Snapshot) -> Result<()> {
        self.writable()?;
        binary_refs(&next)?;
        atomic_json(&self.root.join("业务数据.json"), &next)?;
        self.snapshot = Some(next);
        self.load_error = None;
        Ok(())
    }

    fn import_blob(&self, value: &mut Value) -> Result<()> {
        let object = value.as_object_mut().ok_or("原件格式错误")?;
        let encoded = object.remove("dataBase64").ok_or("缺少原件内容")?;
        let bytes = STANDARD
            .decode(encoded.as_str().ok_or("原件编码错误")?)
            .map_err(io)?;
        let relative = format!("blobs/{}.bin", nonce());
        let path = blob_path(&self.root, &relative)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(io)?;
        let (size, checksum) = checksum_reader(bytes.as_slice(), Some(&mut file))?;
        file.sync_all().map_err(io)?;
        object.insert(
            "$localFile".into(),
            json!(BinaryEntry {
                path: relative,
                size,
                checksum
            }),
        );
        Ok(())
    }
    fn import_record(&self, mut record: Value) -> Result<Value> {
        if record
            .get("key")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .is_none()
        {
            return Err("缺少原件标识".into());
        }
        if let Some(blob) = record.get_mut("blob") {
            if !blob.is_null() {
                self.import_blob(blob)?;
            }
        }
        if let Some(items) = record.get_mut("supplements") {
            for item in items.as_array_mut().ok_or("附件列表格式错误")? {
                self.import_blob(item.get_mut("blob").ok_or("附件缺少原件")?)?;
            }
        }
        Ok(record)
    }
    fn export_blob(&self, value: &mut Value) -> Result<()> {
        let reference: BinaryEntry =
            serde_json::from_value(value.get("$localFile").ok_or("文件引用错误")?.clone())
                .map_err(io)?;
        let path = blob_path(&self.root, &reference.path)?;
        let bytes = fs::read(path).map_err(io)?;
        if checksum_reader(bytes.as_slice(), None)? != (reference.size, reference.checksum) {
            return Err("原件内容校验失败".into());
        }
        let object = value.as_object_mut().ok_or("原件格式错误")?;
        object.remove("$localFile");
        object.insert("dataBase64".into(), Value::String(STANDARD.encode(bytes)));
        Ok(())
    }
    fn get_record(&self, key: &str) -> Result<Option<Value>> {
        let Some(mut record) = self.current()?.attachments.get(key).cloned() else {
            return Ok(None);
        };
        if let Some(blob) = record.get_mut("blob") {
            if !blob.is_null() {
                self.export_blob(blob)?;
            }
        }
        if let Some(items) = record.get_mut("supplements") {
            for item in items.as_array_mut().ok_or("附件列表格式错误")? {
                self.export_blob(item.get_mut("blob").ok_or("附件缺少原件")?)?;
            }
        }
        Ok(Some(record))
    }

    fn backup(&self, snapshot: &Snapshot, target: &Path) -> Result<()> {
        let entries: Vec<_> = binary_refs(snapshot)?.into_values().collect();
        let header = serde_json::to_vec(&BackupHeader {
            snapshot: snapshot.clone(),
            files: entries.clone(),
        })
        .map_err(io)?;
        if header.len() as u64 > MAX_MANIFEST {
            return Err("备份索引过大".into());
        }
        let temp = target.with_extension(format!("{}.partial", nonce()));
        let result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(io)?;
            output.write_all(MAGIC).map_err(io)?;
            output
                .write_all(&(header.len() as u64).to_le_bytes())
                .map_err(io)?;
            output
                .write_all(checksum_reader(header.as_slice(), None)?.1.as_bytes())
                .map_err(io)?;
            output.write_all(&header).map_err(io)?;
            for entry in &entries {
                let source = File::open(blob_path(&self.root, &entry.path)?).map_err(io)?;
                if checksum_reader(source, Some(&mut output))?
                    != (entry.size, entry.checksum.clone())
                {
                    return Err("备份原件校验失败".into());
                }
            }
            output.sync_all().map_err(io)?;
            drop(output);
            // Never overwrite another backup or the active manifest.
            if target.exists() {
                return Err("目标文件已存在，请换一个备份文件名".into());
            }
            fs::rename(&temp, target).map_err(io)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }

    fn automatic_backup(&self, snapshot: &Snapshot, label: &str) -> Result<PathBuf> {
        let directory = self.root.join("自动备份");
        fs::create_dir_all(&directory).map_err(io)?;
        let target = directory.join(format!("{label}-{}.sdbak", nonce()));
        self.backup(snapshot, &target)?;
        Ok(target)
    }

    fn prepare_restore(&mut self, source: &Path) -> Result<Value> {
        self.writable()?;
        regular(source)?;
        self.cancel_restore();
        let directory = self.root.join(format!(".restore-{}", nonce()));
        fs::create_dir_all(directory.join("blobs")).map_err(io)?;
        let result = read_backup(source, &directory);
        match result {
            Ok(snapshot) => {
                let summary = summary(&snapshot);
                self.prepared = Some(PreparedRestore {
                    directory,
                    snapshot,
                });
                Ok(summary)
            }
            Err(error) => {
                let _ = fs::remove_dir_all(directory);
                Err(error)
            }
        }
    }

    fn cancel_restore(&mut self) {
        if let Some(prepared) = self.prepared.take() {
            let _ = fs::remove_dir_all(prepared.directory);
        }
    }

    fn restore(&mut self) -> Result<String> {
        self.writable()?;
        let prepared = self.prepared.as_ref().ok_or("请先选择并检查备份")?;
        validate_files(&prepared.directory, &prepared.snapshot, true)?;
        let previous = if let Some(current) = &self.snapshot {
            self.automatic_backup(current, "恢复前")?
        } else if self.load_error.is_some() {
            // Keep a full raw copy even when the old manifest cannot be parsed.
            let target = self
                .root
                .join("自动备份")
                .join(format!("恢复前损坏数据-{}", nonce()));
            fs::create_dir_all(target.join("blobs")).map_err(io)?;
            fs::copy(
                self.root.join("业务数据.json"),
                target.join("业务数据.json"),
            )
            .map_err(io)?;
            for entry in fs::read_dir(self.root.join("blobs")).map_err(io)? {
                let entry = entry.map_err(io)?;
                regular(&entry.path())?;
                fs::copy(entry.path(), target.join("blobs").join(entry.file_name())).map_err(io)?;
            }
            target
        } else {
            self.automatic_backup(&Snapshot::default(), "恢复前空数据")?
        };
        for entry in binary_refs(&prepared.snapshot)?.values() {
            let target = blob_path(&self.root, &entry.path)?;
            if target.exists() {
                if checksum_reader(File::open(&target).map_err(io)?, None)?
                    != (entry.size, entry.checksum.clone())
                {
                    return Err("原件标识冲突，未恢复任何业务记录".into());
                }
            } else {
                // A failed/full-disk copy must not leave a partial file under
                // its final identity, otherwise a later restore cannot retry.
                let temporary = self.root.join(format!(".restore-copy-{}.partial", nonce()));
                let copied = (|| {
                    let source =
                        File::open(blob_path(&prepared.directory, &entry.path)?).map_err(io)?;
                    let mut output = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&temporary)
                        .map_err(io)?;
                    if checksum_reader(source, Some(&mut output))?
                        != (entry.size, entry.checksum.clone())
                    {
                        return Err("恢复原件复制校验失败".into());
                    }
                    output.sync_all().map_err(io)?;
                    drop(output);
                    fs::rename(&temporary, &target).map_err(io)
                })();
                if copied.is_err() {
                    let _ = fs::remove_file(&temporary);
                }
                copied?;
            }
        }
        self.commit(prepared.snapshot.clone())?;
        self.restored = true;
        self.cancel_restore();
        Ok(previous.to_string_lossy().into())
    }
}

fn read_backup(source: &Path, directory: &Path) -> Result<Snapshot> {
    let mut input = File::open(source).map_err(io)?;
    let mut magic = [0u8; 9];
    input.read_exact(&mut magic).map_err(io)?;
    if &magic != MAGIC {
        return Err("请选择本软件生成的 .sdbak 完整备份".into());
    }
    let mut length = [0u8; 8];
    input.read_exact(&mut length).map_err(io)?;
    let length = u64::from_le_bytes(length);
    if length > MAX_MANIFEST || length > input.metadata().map_err(io)?.len().saturating_sub(33) {
        return Err("备份索引长度错误".into());
    }
    let mut header_checksum = [0u8; 16];
    input.read_exact(&mut header_checksum).map_err(io)?;
    let mut bytes = vec![0; length as usize];
    input.read_exact(&mut bytes).map_err(io)?;
    if checksum_reader(bytes.as_slice(), None)?.1.as_bytes() != header_checksum {
        return Err("备份业务记录校验失败，未修改现有数据".into());
    }
    let header: BackupHeader = serde_json::from_slice(&bytes).map_err(io)?;
    let expected = binary_refs(&header.snapshot)?;
    let mut seen = BTreeSet::new();
    for entry in &header.files {
        let declared = expected.get(&entry.path).ok_or("备份含未声明原件")?;
        if !seen.insert(&entry.path)
            || declared.size != entry.size
            || declared.checksum != entry.checksum
        {
            return Err("备份原件清单冲突".into());
        }
        let path = blob_path(directory, &entry.path)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(io)?;
        if checksum_reader((&mut input).take(entry.size), Some(&mut output))?
            != (entry.size, entry.checksum.clone())
        {
            return Err("备份已损坏或不完整，未修改现有数据".into());
        }
        output.sync_all().map_err(io)?;
    }
    if seen.len() != expected.len() || input.read(&mut [0u8; 1]).map_err(io)? != 0 {
        return Err("备份缺少原件或有多余内容".into());
    }
    Ok(header.snapshot)
}

fn summary(snapshot: &Snapshot) -> Value {
    let count = |key: &str| -> usize {
        match snapshot
            .values
            .get(key)
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            Some(Value::Array(rows)) => rows.len(),
            Some(Value::Object(rows)) => rows.len(),
            _ => 0,
        }
    };
    let files = binary_refs(snapshot).unwrap_or_default();
    json!({ "ledger": count("invoiceLedger.v1"), "payments": count("paymentRecords.v1"), "suppliers": count("supplierDb.v1"),
        "trash": count("invoiceLedgerTrash.v1"), "records": snapshot.attachments.len(), "files": files.len(),
        "bytes": files.values().map(|e| e.size).sum::<u64>(), "settings": snapshot.values.len() })
}

pub struct LocalData(pub Mutex<std::result::Result<DiskStore, String>>);

async fn access<T, F>(app: tauri::AppHandle, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut DiskStore) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalData>();
        let mut guard = state.0.lock().map_err(io)?;
        operation(guard.as_mut().map_err(|e| e.clone())?)
    })
    .await
    .map_err(io)?
}

pub fn setup(app: &tauri::AppHandle) {
    let result = (|| {
        let exe = std::env::current_exe().map_err(io)?;
        let directory = exe.parent().ok_or("无法找到软件目录")?;
        // Debug builds have a separate synthetic workspace, never the installed data.
        let root = if cfg!(debug_assertions) {
            directory.join("调试数据")
        } else {
            directory.join("数据")
        };
        DiskStore::open(root)
    })();
    app.manage(LocalData(Mutex::new(result)));
}

#[tauri::command]
pub async fn local_data_init(app: tauri::AppHandle, boot: Option<bool>) -> Result<Value> {
    access(app, move |s| {
        if boot == Some(true) { s.restored = false; }
        Ok(json!({ "root": s.root, "snapshot": s.snapshot, "loadError": s.load_error, "summary": s.snapshot.as_ref().map(summary) }))
    }).await
}

#[tauri::command]
pub async fn local_data_migrate_record(app: tauri::AppHandle, record: Value) -> Result<()> {
    access(app, move |s| {
        if s.snapshot.is_some() || s.load_error.is_some() {
            return Err("已有本地数据，禁止重复迁移".into());
        }
        let record = s.import_record(record)?;
        s.migration
            .attachments
            .insert(record["key"].as_str().unwrap().into(), record);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn local_data_finish_migration(
    app: tauri::AppHandle,
    values: BTreeMap<String, String>,
    records: usize,
) -> Result<Value> {
    access(app, move |s| {
        if s.snapshot.is_some() || s.load_error.is_some() {
            return Err("已有本地数据，禁止重复迁移".into());
        }
        if s.migration.attachments.len() != records {
            return Err("旧原件数量校验失败，未完成迁移".into());
        }
        let mut next = s.migration.clone();
        next.values = values;
        validate_files(&s.root, &next, true)?;
        let backup = s.automatic_backup(&next, "首次迁移")?;
        s.commit(next)?;
        Ok(json!({ "backup": backup, "summary": summary(s.current()?) }))
    })
    .await
}

#[tauri::command]
pub async fn local_data_save_values(
    app: tauri::AppHandle,
    values: BTreeMap<String, String>,
) -> Result<()> {
    access(app, move |s| {
        let mut next = s.current()?.clone();
        next.values = values;
        s.commit(next)
    })
    .await
}

#[tauri::command]
pub async fn local_data_get_attachment(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<Value>> {
    access(app, move |s| s.get_record(&key)).await
}

#[tauri::command]
pub async fn local_data_list_attachments(app: tauri::AppHandle) -> Result<Vec<Value>> {
    access(app, |s| Ok(s.current()?.attachments.values().map(|r| {
        json!({ "key": r["key"], "hasOriginal": r.get("blob").is_some_and(|b| !b.is_null()),
            "supplements": r.get("supplements").and_then(Value::as_array).map(|items| items.iter().map(|v| json!({"hash":v["hash"],"name":v["name"],"type":v["type"]})).collect::<Vec<_>>()).unwrap_or_default() })
    }).collect())).await
}

#[tauri::command]
pub async fn local_data_put_attachment(
    app: tauri::AppHandle,
    key: String,
    blob: Value,
    metadata: Value,
    mode: String,
) -> Result<bool> {
    access(app, move |s| {
        s.writable()?;
        let mut next = s.current()?.clone();
        let mut record = next
            .attachments
            .get(&key)
            .cloned()
            .unwrap_or(json!({"key":key}));
        if mode == "ifMissing" && record.get("blob").is_some_and(|b| !b.is_null()) {
            return Ok(false);
        }
        if mode == "supplement"
            && record
                .get("supplements")
                .and_then(Value::as_array)
                .is_some_and(|items| items.iter().any(|v| v["hash"] == metadata["hash"]))
        {
            return Ok(false);
        }
        let mut blob = blob;
        s.import_blob(&mut blob)?;
        if mode == "supplement" {
            if metadata
                .get("hash")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err("缺少附件哈希".into());
            }
            let mut item = metadata.as_object().ok_or("附件信息格式错误")?.clone();
            item.insert("blob".into(), blob);
            record
                .as_object_mut()
                .ok_or("附件信息格式错误")?
                .entry("supplements")
                .or_insert(json!([]))
                .as_array_mut()
                .ok_or("附件信息格式错误")?
                .push(Value::Object(item));
        } else if mode == "replace" || mode == "ifMissing" {
            record["name"] = blob["name"].clone();
            record["blob"] = blob;
            record["savedAt"] = metadata["savedAt"].clone();
        } else {
            return Err("未知原件操作".into());
        }
        next.attachments.insert(key, record);
        s.commit(next)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn local_data_delete_attachments(app: tauri::AppHandle, keys: Vec<String>) -> Result<()> {
    access(app, move |s| {
        let mut next = s.current()?.clone();
        for key in keys {
            next.attachments.remove(&key);
        }
        let live = binary_refs(&next)?;
        s.commit(next)?;
        // Scan unreferenced files so a deletion that failed after the manifest
        // commit is retried successfully on the next cleanup operation.
        for file in fs::read_dir(s.root.join("blobs")).map_err(io)? {
            let file = file.map_err(io)?;
            let relative = format!("blobs/{}", file.file_name().to_string_lossy());
            if !live.contains_key(&relative) {
                fs::remove_file(blob_path(&s.root, &relative)?).map_err(io)?;
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn local_data_backup(app: tauri::AppHandle) -> Result<Option<String>> {
    access(app, |s| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("保存完整数据备份")
            .add_filter("完整数据备份", &["sdbak"])
            .set_file_name(format!("送货单完整备份-{}.sdbak", nonce()))
            .save_file()
        else {
            return Ok(None);
        };
        s.backup(s.current()?, &path)?;
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
}

#[tauri::command]
pub async fn local_data_prepare_restore(app: tauri::AppHandle) -> Result<Option<Value>> {
    access(app, |s| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择完整数据备份")
            .add_filter("完整数据备份", &["sdbak"])
            .pick_file()
        else {
            return Ok(None);
        };
        let preview = s.prepare_restore(&path)?;
        Ok(Some(json!({ "path": path, "summary": preview })))
    })
    .await
}

#[tauri::command]
pub async fn local_data_restore(app: tauri::AppHandle) -> Result<String> {
    access(app, |s| s.restore()).await
}

#[tauri::command]
pub async fn local_data_cancel_restore(app: tauri::AppHandle) -> Result<()> {
    access(app, |s| {
        s.cancel_restore();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn local_data_recover(app: tauri::AppHandle) -> Result<bool> {
    access(app, |s| {
        let Some(path) = rfd::FileDialog::new().set_title("从完整备份恢复本地数据").add_filter("完整数据备份", &["sdbak"]).pick_file() else { return Ok(false); };
        let info = s.prepare_restore(&path)?;
        let accepted = rfd::MessageDialog::new().set_title("确认恢复整套数据")
            .set_description(format!("备份含 {} 张发票、{} 笔付款和 {} 份原件及附件。\n将替换本地数据，不合并；恢复前会保留当前数据副本。", info["ledger"], info["payments"], info["files"]))
            .set_buttons(rfd::MessageButtons::YesNo).show();
        if accepted != rfd::MessageDialogResult::Yes { s.cancel_restore(); return Ok(false); }
        s.restore()?; Ok(true)
    }).await
}

#[tauri::command]
pub async fn local_data_open_folder(app: tauri::AppHandle) -> Result<()> {
    access(app, |s| {
        #[cfg(target_os = "windows")]
        std::process::Command::new("explorer.exe")
            .arg(&s.root)
            .spawn()
            .map_err(io)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Workspace(PathBuf);
    impl Workspace {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("songhuodan-data-test-{}", nonce())))
        }
        fn store(&self) -> DiskStore {
            DiskStore::open(self.0.clone()).unwrap()
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn populated(store: &mut DiskStore) -> Snapshot {
        let record = json!({ "key": "付款:中文", "custom": {"preserve":true}, "blob": { "name": "付款原件.pdf", "type":"application/pdf", "dataBase64": STANDARD.encode([0,1,254,255]), "lastModified":123 },
            "supplements": [{"hash":"abc", "type":"行程单", "blob": {"name":"行程单.png", "type":"image/png", "dataBase64":STANDARD.encode(b"supplement")}}] });
        let record = store.import_record(record).unwrap();
        let mut snapshot = Snapshot::default();
        snapshot.attachments.insert("付款:中文".into(), record);
        snapshot.values.insert("invoiceLedger.v1".into(), r#"{"000123":{"number":"000123","total":106,"projectAllocations":[{"project":"工地甲","amount":53}]}}"#.into());
        snapshot.values.insert(
            "paymentRecords.v1".into(),
            r#"[{"id":"payment","total":106,"reimbursement":"已报销"}]"#.into(),
        );
        snapshot.values.insert(
            "appSettings.v1".into(),
            r#"{"vlToken":"synthetic-token"}"#.into(),
        );
        snapshot.values.insert(
            "invoiceLedgerTrash.v1".into(),
            r#"[{"id":"trash","key":"deleted","entry":{"total":25}}]"#.into(),
        );
        store.commit(snapshot.clone()).unwrap();
        snapshot
    }

    #[test]
    fn migration_preserves_every_field_and_binary() {
        let workspace = Workspace::new();
        let mut store = workspace.store();
        let expected = populated(&mut store);
        validate_files(&workspace.0, &expected, true).unwrap();
        let exported = store.get_record("付款:中文").unwrap().unwrap();
        assert_eq!(
            STANDARD
                .decode(exported["blob"]["dataBase64"].as_str().unwrap())
                .unwrap(),
            [0, 1, 254, 255]
        );
        assert_eq!(exported["blob"]["name"], "付款原件.pdf");
        assert_eq!(exported["custom"]["preserve"], true);
        assert_eq!(
            STANDARD
                .decode(
                    exported["supplements"][0]["blob"]["dataBase64"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            b"supplement"
        );
        let backup = store.automatic_backup(&expected, "首次迁移").unwrap();
        assert!(backup.is_file());
        drop(store);
        assert_eq!(workspace.store().current().unwrap(), &expected);
    }

    #[test]
    fn portable_copy_and_backup_restore_work_without_old_profile() {
        let a = Workspace::new();
        let b = Workspace::new();
        let mut first = a.store();
        let original = populated(&mut first);
        let backup = first.automatic_backup(&original, "迁移").unwrap();
        let mut second = b.store();
        second.commit(Snapshot::default()).unwrap();
        let preview = second.prepare_restore(&backup).unwrap();
        assert_eq!(preview["files"], 2);
        assert_eq!(preview["ledger"], 1);
        second.restore().unwrap();
        assert_eq!(second.current().unwrap(), &original);
        assert!(
            second.commit(Snapshot::default()).is_err(),
            "恢复后的旧窗口不能继续写旧数据"
        );
        drop(second);
        let mut second = b.store();
        let mut changed = original.clone();
        changed
            .values
            .insert("paymentRecords.v1".into(), "[]".into());
        second.commit(changed.clone()).unwrap();
        second.prepare_restore(&backup).unwrap();
        let previous = second.restore().unwrap();
        let c = Workspace::new();
        let mut third = c.store();
        third.prepare_restore(Path::new(&previous)).unwrap();
        third.restore().unwrap();
        assert_eq!(
            third.current().unwrap(),
            &changed,
            "恢复前备份必须可以再次恢复"
        );
        // Copy the data folder exactly as a human would, without its live lock.
        drop(first);
        let d = Workspace::new();
        fs::create_dir_all(d.0.join("blobs")).unwrap();
        fs::copy(a.0.join("业务数据.json"), d.0.join("业务数据.json")).unwrap();
        for entry in fs::read_dir(a.0.join("blobs")).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), d.0.join("blobs").join(entry.file_name())).unwrap();
        }
        assert_eq!(d.store().current().unwrap(), &original);
    }

    #[test]
    fn corrupt_truncated_and_edited_backups_leave_current_data_untouched() {
        let workspace = Workspace::new();
        let mut store = workspace.store();
        let original = populated(&mut store);
        let backup = store.automatic_backup(&original, "test").unwrap();
        let raw = fs::read(&backup).unwrap();
        for (index, bytes) in [
            raw[..raw.len() - 1].to_vec(),
            {
                let mut b = raw.clone();
                let last = b.len() - 1;
                b[last] ^= 1;
                b
            },
            {
                let mut b = raw.clone();
                b[40] ^= 1;
                b
            },
            {
                let mut b = raw.clone();
                b.push(0);
                b
            },
        ]
        .iter()
        .enumerate()
        {
            let path = workspace.0.join(format!("bad-{index}.sdbak"));
            fs::write(&path, bytes).unwrap();
            assert!(store.prepare_restore(&path).is_err());
            assert_eq!(store.current().unwrap(), &original);
        }
        assert!(
            store.backup(&original, &backup).is_err(),
            "不得覆盖已有备份"
        );
    }

    #[test]
    fn rejects_path_traversal_and_incompatible_business_data() {
        let workspace = Workspace::new();
        let mut store = workspace.store();
        let mut snapshot = populated(&mut store);
        for path in [
            "../outside.bin",
            "blobs/../outside.bin",
            "C:/outside.bin",
            "blobs\\00.bin",
            "blobs/name.bin",
        ] {
            assert!(blob_path(&workspace.0, path).is_err());
        }
        snapshot.version = 99;
        assert!(store.commit(snapshot.clone()).is_err());
        snapshot.version = 1;
        snapshot
            .values
            .insert("invoiceLedger.v1".into(), "[]".into());
        assert!(store.commit(snapshot.clone()).is_err());
        snapshot
            .values
            .insert("invoiceLedger.v1".into(), "{}".into());
        snapshot.attachments.get_mut("付款:中文").unwrap()["blob"]["$localFile"]["path"] =
            json!("../outside.bin");
        let path = workspace.0.join("evil.sdbak");
        let header = serde_json::to_vec(&BackupHeader {
            snapshot,
            files: vec![],
        })
        .unwrap();
        let mut output = File::create(&path).unwrap();
        output.write_all(MAGIC).unwrap();
        output
            .write_all(&(header.len() as u64).to_le_bytes())
            .unwrap();
        output
            .write_all(
                checksum_reader(header.as_slice(), None)
                    .unwrap()
                    .1
                    .as_bytes(),
            )
            .unwrap();
        output.write_all(&header).unwrap();
        drop(output);
        assert!(store.prepare_restore(&path).is_err());
        assert!(!workspace.0.parent().unwrap().join("outside.bin").exists());
    }

    #[test]
    fn failed_atomic_write_keeps_previous_memory_and_disk() {
        let workspace = Workspace::new();
        let mut store = workspace.store();
        let original = populated(&mut store);
        let path = workspace.0.join("业务数据.json");
        let old = workspace.0.join("saved.json");
        fs::rename(&path, &old).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(store.commit(Snapshot::default()).is_err());
        assert_eq!(store.current().unwrap(), &original);
        fs::remove_dir(&path).unwrap();
        fs::rename(old, path).unwrap();
        drop(store);
        assert_eq!(workspace.store().current().unwrap(), &original);
    }

    #[test]
    fn lock_and_damaged_manifest_recovery_preserve_old_data() {
        let workspace = Workspace::new();
        let mut store = workspace.store();
        let original = populated(&mut store);
        assert!(DiskStore::open(workspace.0.clone()).is_err());
        let backup = store.automatic_backup(&original, "good").unwrap();
        drop(store);
        fs::write(workspace.0.join("业务数据.json"), b"damaged manifest").unwrap();
        let mut store = workspace.store();
        assert!(store.load_error.is_some());
        assert!(store.snapshot.is_none());
        store.prepare_restore(&backup).unwrap();
        let preserved = store.restore().unwrap();
        assert_eq!(
            fs::read(Path::new(&preserved).join("业务数据.json")).unwrap(),
            b"damaged manifest"
        );
        assert_eq!(store.current().unwrap(), &original);
    }
}
