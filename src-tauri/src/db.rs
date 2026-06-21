// 本地 SQLite 持久化（后端首步，核心财务线：识别明细库 + 已入账发票）。
// 设计：纯函数操作 &Connection，便于 cargo test 用内存库直接验证；
//       与 AppHandle 相关的「DB 路径 + 旧 JSON 一次性迁移」放在 open() 薄封装里。
// 数据形态保持与原 JSON 落盘一致（records_json / data_json 直接存 JSON 文本），
// 前端契约不变；日后迁服务端时只需把这层换成 HTTP，schema 可平移到 Postgres jsonb。
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const DB_FILE: &str = "songhuodan.db";

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join(DB_FILE))
}

/// 打开（或创建）DB：建表 + 首次从旧 JSON 文件迁移。
pub fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    migrate_legacy_json(app, &conn)?;
    Ok(conn)
}

/// 建表（幂等）。meta 表存迁移标记等键值。
pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
         );
         CREATE TABLE IF NOT EXISTS recognized_site (
            site         TEXT PRIMARY KEY,
            records_json TEXT NOT NULL,
            updated_at   TEXT
         );
         CREATE TABLE IF NOT EXISTS posted_invoice (
            id           TEXT PRIMARY KEY,
            data_json    TEXT NOT NULL,
            accounted_at TEXT,
            updated_at   TEXT
         );",
    )
    .map_err(|e| e.to_string())
}

fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get::<_, String>(0))
        .ok()
}
fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn now_iso() -> String {
    // 简单时间戳即可（避免引入 chrono）：用 RFC3339 近似。
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}

// —— 识别明细库 —— records_json 直接存前端传来的 {site,version,records} JSON 文本。
pub fn recognized_upsert(conn: &Connection, site: &str, json: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO recognized_site(site,records_json,updated_at) VALUES(?1,?2,?3)
         ON CONFLICT(site) DO UPDATE SET records_json=?2, updated_at=?3",
        params![site, json, now_iso()],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// 返回 {site: records[]} 的 JSON 字符串（与原 recognized_load_all 文件版同形）。
pub fn recognized_load_all(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT site, records_json FROM recognized_site")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = serde_json::Map::new();
    for row in rows {
        let (site, json) = row.map_err(|e| e.to_string())?;
        let records = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("records").cloned())
            .unwrap_or_else(|| serde_json::Value::Array(vec![]));
        out.insert(site, records);
    }
    serde_json::to_string(&serde_json::Value::Object(out)).map_err(|e| e.to_string())
}

// —— 已入账发票 —— data_json 直接存前端 serializeForPersist 的对象 JSON。
pub fn posted_upsert(conn: &Connection, json: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return Err("已入账发票缺少 id".to_string());
    }
    let accounted_at = v.get("accountedAt").and_then(|x| x.as_str()).unwrap_or("").to_string();
    conn.execute(
        "INSERT INTO posted_invoice(id,data_json,accounted_at,updated_at) VALUES(?1,?2,?3,?4)
         ON CONFLICT(id) DO UPDATE SET data_json=?2, accounted_at=?3, updated_at=?4",
        params![id, json, accounted_at, now_iso()],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn posted_delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM posted_invoice WHERE id=?1", params![id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 返回已入账发票对象数组的 JSON 字符串。
pub fn posted_load_all(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT data_json FROM posted_invoice ORDER BY accounted_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut arr: Vec<serde_json::Value> = Vec::new();
    for row in rows {
        let json = row.map_err(|e| e.to_string())?;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            arr.push(v);
        }
    }
    serde_json::to_string(&serde_json::Value::Array(arr)).map_err(|e| e.to_string())
}

// —— 旧 JSON 一次性迁移（appData/识别明细库/*.json、appData/已入账发票/*.json）——
fn migrate_legacy_json(app: &tauri::AppHandle, conn: &Connection) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;

    if meta_get(conn, "migrated_recognized").is_none() {
        let dir = base.join("识别明细库");
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    if let Ok(txt) = fs::read_to_string(&path) {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                            let site = v
                                .get("site")
                                .and_then(|s| s.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| {
                                    path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string()
                                });
                            if !site.is_empty() {
                                let _ = recognized_upsert(conn, &site, &txt);
                            }
                        }
                    }
                }
            }
        }
        meta_set(conn, "migrated_recognized", "1")?;
    }

    if meta_get(conn, "migrated_posted").is_none() {
        let dir = base.join("已入账发票");
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    if let Ok(txt) = fs::read_to_string(&path) {
                        let _ = posted_upsert(conn, &txt);
                    }
                }
            }
        }
        meta_set(conn, "migrated_posted", "1")?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn recognized_roundtrip_and_upsert() {
        let conn = mem();
        recognized_upsert(
            &conn,
            "工地A",
            r#"{"site":"工地A","version":1,"records":[{"company":"甲","items":[{"total":100}]}]}"#,
        )
        .unwrap();
        recognized_upsert(&conn, "工地B", r#"{"site":"工地B","version":1,"records":[]}"#).unwrap();
        // 覆盖更新同一工地
        recognized_upsert(
            &conn,
            "工地A",
            r#"{"site":"工地A","version":1,"records":[{"company":"乙"}]}"#,
        )
        .unwrap();

        let out = recognized_load_all(&conn).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("工地A").is_some());
        assert!(v.get("工地B").is_some());
        assert_eq!(v["工地A"].as_array().unwrap().len(), 1);
        assert_eq!(v["工地A"][0]["company"], "乙"); // upsert 覆盖生效
        assert_eq!(v["工地B"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn posted_crud() {
        let conn = mem();
        posted_upsert(&conn, r#"{"id":"inv1","accountedAt":"2026-06-01","fields":{"number":"N1"}}"#).unwrap();
        posted_upsert(&conn, r#"{"id":"inv2","accountedAt":"2026-06-02","fields":{"number":"N2"}}"#).unwrap();
        // 同 id 覆盖
        posted_upsert(&conn, r#"{"id":"inv1","accountedAt":"2026-06-01","fields":{"number":"N1-edited"}}"#).unwrap();

        let out = posted_load_all(&conn).unwrap();
        let arr: Vec<serde_json::Value> = serde_json::from_str(&out).unwrap();
        assert_eq!(arr.len(), 2);
        let inv1 = arr.iter().find(|x| x["id"] == "inv1").unwrap();
        assert_eq!(inv1["fields"]["number"], "N1-edited");

        posted_delete(&conn, "inv1").unwrap();
        let out2 = posted_load_all(&conn).unwrap();
        let arr2: Vec<serde_json::Value> = serde_json::from_str(&out2).unwrap();
        assert_eq!(arr2.len(), 1);
        assert_eq!(arr2[0]["id"], "inv2");
    }

    #[test]
    fn posted_requires_id() {
        let conn = mem();
        assert!(posted_upsert(&conn, r#"{"accountedAt":"2026-06-01"}"#).is_err());
    }
}
